import "server-only";
import { readInvoiceDocument } from "./invoice-document";
import { generateInvoicePdf, generateInvoiceTicketPdf } from "./invoice-pdf";
import { InvoiceDeliveryError, validateInvoiceXml } from "./invoice-delivery";
import { canRetryEmail, deliverInvoiceEmail, invoiceEmailMessage, InvoiceEmailError, type EmailSendOptions } from "./invoice-email";
import { emailPassword, emailSql, readEmailDelivery, readEmailSettings } from "./email-storage";
import { decryptSecret } from "./secure-storage";
import { sendGmail } from "./gmail-transport";

export async function sendInvoiceEmail(invoiceId: string, options: EmailSendOptions) {
  const sql = emailSql();
  return deliverInvoiceEmail(options, {
    settings: readEmailSettings,
    current: () => readEmailDelivery(invoiceId),
    claim: async (attemptId, request) => {
      if (request.expectedAttemptId && !request.automatic) {
        const existing = await readEmailDelivery(invoiceId);
        if (!existing || existing.attemptId !== request.expectedAttemptId || !canRetryEmail(existing, request.confirmResend === true)) return false;
        const rows = await sql`WITH claimed AS (
          UPDATE invoice_email_deliveries SET attempt_id = ${attemptId}, state = 'preparing', recipient = '', sender = '',
            message = '', message_id = '', attempts = attempts + 1, submitted_at = NULL, updated_at = NOW()
          WHERE invoice_id = ${invoiceId} AND attempt_id = ${existing.attemptId} AND state = ${existing.state}
            AND (state NOT IN ('preparing', 'sending') OR updated_at < NOW() - INTERVAL '5 minutes') RETURNING invoice_id, attempt_id
        ) INSERT INTO invoice_email_attempts (invoice_id, attempt_id, state)
          SELECT invoice_id, attempt_id, 'preparing' FROM claimed RETURNING attempt_id`;
        return rows.length === 1;
      }
      const rows = await sql`WITH claimed AS (
        INSERT INTO invoice_email_deliveries (invoice_id, attempt_id, state) VALUES (${invoiceId}, ${attemptId}, 'preparing')
        ON CONFLICT (invoice_id) DO NOTHING RETURNING invoice_id, attempt_id
      ) INSERT INTO invoice_email_attempts (invoice_id, attempt_id, state)
        SELECT invoice_id, attempt_id, 'preparing' FROM claimed RETURNING attempt_id`;
      return rows.length === 1;
    },
    prepare: async (settings, attemptId) => {
      const document = await readInvoiceDocument(sql, invoiceId);
      if (!document) throw new InvoiceEmailError("La factura no existe.", 404);
      const { invoice } = document;
      if (!["FE", "TE", "NC"].includes(invoice.documentType) || invoice.haciendaStatus !== "aceptado" || invoice.haciendaEnvironment !== "production") {
        throw new InvoiceEmailError("El correo solo está habilitado para comprobantes aceptados de producción.", 409);
      }
      const rows = await sql`SELECT hacienda_signed_xml_enc, hacienda_response_xml_enc FROM invoices WHERE id = ${invoiceId}`;
      if (!rows[0]?.hacienda_signed_xml_enc || !rows[0]?.hacienda_response_xml_enc) {
        throw new InvoiceEmailError("Falta el XML firmado o la respuesta de Hacienda. Consulta el estado y vuelve a intentar el correo; no se envió nada.", 409);
      }
      const signedXml = Buffer.from(decryptSecret(String(rows[0].hacienda_signed_xml_enc)).toString("utf8"), "base64");
      const responseXml = decryptSecret(String(rows[0].hacienda_response_xml_enc));
      let signedRoot: Record<string, unknown>;
      try {
        const fiscal = { documentType: invoice.documentType as "FE" | "TE" | "NC", haciendaKey: invoice.haciendaKey };
        signedRoot = await validateInvoiceXml(signedXml.toString("utf8"), "signed", fiscal);
        await validateInvoiceXml(responseXml.toString("utf8"), "response", fiscal);
      } catch (error) {
        if (error instanceof InvoiceDeliveryError) throw new InvoiceEmailError(error.message, 409);
        throw error;
      }
      const receiver = signedRoot.Receptor as Record<string, unknown> | undefined;
      const signedReceiverEmail = typeof receiver?.CorreoElectronico === "string" ? receiver.CorreoElectronico : undefined;
      const pdf = settings.format === "letter"
        ? await generateInvoicePdf(invoice, document.settings)
        : await generateInvoiceTicketPdf(invoice, document.settings, settings.format === "ticket58" ? 58 : 80);
      return invoiceEmailMessage({ settings, invoice, signedReceiverEmail, pdf, signedXml, responseXml, attemptId });
    },
    stillConfigured: async (previous, automatic) => {
      const current = await readEmailSettings();
      return current.version === previous.version && current.hasPassword && Boolean(current.verifiedAt) && (!automatic || current.enabled);
    },
    markSending: async (attemptId, message) => {
      const results = await sql.transaction([
        sql`UPDATE invoice_email_deliveries SET state = 'sending', recipient = ${message.to}, sender = ${message.from.address},
          message_id = ${message.messageId}, updated_at = NOW() WHERE invoice_id = ${invoiceId} AND attempt_id = ${attemptId} AND state = 'preparing' RETURNING invoice_id`,
        sql`UPDATE invoice_email_attempts SET state = 'sending', recipient = ${message.to}, sender = ${message.from.address},
          message_id = ${message.messageId}, updated_at = NOW() WHERE attempt_id = ${attemptId}`,
      ]);
      if (!results[0].length) throw new InvoiceEmailError("Otro intento está procesando el correo. Recarga el estado.", 409);
    },
    send: async (message, settings) => sendGmail(message, await emailPassword(settings)),
    finish: async (attemptId, state, message) => {
      await sql.transaction([
        sql`UPDATE invoice_email_deliveries SET state = ${state}, message = ${message}, updated_at = NOW(),
          submitted_at = CASE WHEN ${state} = 'submitted' THEN NOW() ELSE submitted_at END
          WHERE invoice_id = ${invoiceId} AND attempt_id = ${attemptId}`,
        sql`UPDATE invoice_email_attempts SET state = ${state}, message = ${message}, updated_at = NOW() WHERE attempt_id = ${attemptId}`,
      ]);
    },
  });
}

/** Un problema de correo nunca cambia la aceptación fiscal ya guardada. */
export async function automaticallyEmailInvoice(invoiceId: string) {
  try { return await sendInvoiceEmail(invoiceId, { automatic: true }); }
  catch { return { state: "failed", message: "La factura fue aceptada, pero no se pudo procesar el correo. Revisa el estado de correo en la factura y Ajustes > Correo." }; }
}
