import { isAuthenticated, unauthorized } from "../../../lib/session";
import { claimEmailProbe, emailApiError, emailPassword, emailPayload, emailSql, readEmailSettings, saveEmailSettings, setEmailEnabled } from "../../../lib/email-storage";
import { gmailTransport, sendGmail } from "../../../lib/gmail-transport";
import { assertMailReady, InvoiceEmailError, smtpFailure } from "../../../lib/invoice-email";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "cache-control": "private, no-store" };

export async function GET() {
  if (!await isAuthenticated()) return unauthorized();
  try { return Response.json({ settings: await readEmailSettings() }, { headers }); }
  catch (error) { return emailApiError(error); }
}

export async function POST(request: Request) {
  if (!await isAuthenticated()) return unauthorized();
  try {
    const payload = await emailPayload(request);
    if (payload.action === "save") {
      return Response.json({ settings: await saveEmailSettings(payload), message: "Configuración guardada. Verifica la conexión antes de activar el envío automático." }, { headers });
    }
    const settings = await readEmailSettings();
    if (payload.version !== settings.version) throw new InvoiceEmailError("La configuración cambió. Recarga antes de continuar.", 409);
    if (payload.action === "enable" || payload.action === "disable") {
      return Response.json({ settings: await setEmailEnabled(payload.action === "enable", settings.version), message: payload.action === "enable" ? "Automático activado para las próximas confirmaciones de aceptación en la app. No se enviaron facturas antiguas en lote." : "Envío automático desactivado." }, { headers });
    }
    if (payload.action !== "verify" && payload.action !== "test") throw new InvoiceEmailError("Acción no reconocida.");
    if (payload.action === "test") assertMailReady(settings);
    const password = await emailPassword(settings);
    await claimEmailProbe(settings.version);
    const sql = emailSql();
    if (payload.action === "verify") {
      const transport = gmailTransport(settings.senderEmail, password);
      try { await transport.verify(); }
      catch (error) {
        await sql`UPDATE invoice_email_settings SET verified_at = NULL, enabled = FALSE, version = version + 1 WHERE id = 'default' AND version = ${settings.version}`;
        return Response.json({ error: smtpFailure(error).message, settings: await readEmailSettings() }, { status: 502, headers });
      } finally { transport.close(); }
      const rows = await sql`UPDATE invoice_email_settings SET verified_at = NOW() WHERE id = 'default' AND version = ${settings.version} RETURNING id`;
      if (!rows.length) throw new InvoiceEmailError("La configuración cambió durante la verificación. Verifica de nuevo.", 409);
      return Response.json({ settings: await readEmailSettings(), message: "Conexión con Gmail verificada. No se envió ningún correo. La verificación no confirma la entrega a clientes." }, { headers });
    }
    try {
      await sendGmail({
        from: { name: settings.senderName, address: settings.senderEmail }, to: settings.senderEmail,
        subject: "Prueba de correo · GAS LP SOLUCIONES",
        text: "Esta es una prueba de la conexión de correo de GAS LP SOLUCIONES. No contiene facturas ni datos de clientes. Los comprobantes reales llevarán un PDF y ambos XML. Si recibiste este mensaje, la prueba llegó a esta cuenta.",
        messageId: `<test-${crypto.randomUUID()}@${settings.senderEmail.split("@")[1]}>`, attachments: [],
      }, password);
    } catch (error) { throw new InvoiceEmailError(smtpFailure(error, true).message, 502); }
    await sql`UPDATE invoice_email_settings SET last_test_at = NOW() WHERE id = 'default' AND version = ${settings.version}`;
    return Response.json({ settings: await readEmailSettings(), message: `Gmail aceptó el correo de prueba dirigido a ${settings.senderEmail}. Comprueba Recibidos y Spam para confirmar su llegada.` }, { headers });
  } catch (error) { return emailApiError(error); }
}
