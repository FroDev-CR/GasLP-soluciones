import { neon } from "@neondatabase/serverless";
import {
  buildAndSignDocument,
  checkHaciendaStatus,
  submitToHacienda,
  type ElectronicDocumentType,
} from "../../../lib/hacienda";
import { activeHaciendaEnvironment, ensureHaciendaStorage } from "../../../lib/hacienda-storage";
import { decryptSecret, encryptSecret } from "../../../lib/secure-storage";
import { isAuthenticated, unauthorized } from "../../../lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

// CIIU 4 (TRIBU-CR): NNNN.N, exactamente 6 caracteres, tal como lo exige el
// esquema 4.4 para CodigoActividadEmisor y CodigoActividadReceptor.
const activityCodePattern = /^\d{4}\.\d$/;

function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("La base de datos no está configurada.");
  return neon(connectionString);
}

function messageFromXml(xml: string) {
  const match = xml.match(/<DetalleMensaje>([\s\S]*?)<\/DetalleMensaje>/i)
    ?? xml.match(/<Mensaje>([\s\S]*?)<\/Mensaje>/i);
  return (match?.[1] || "")
    .replace(/&#13;|&#xD;/gi, "\n")
    .replace(/&#10;|&#xA;/gi, "\n")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "No se pudo procesar el comprobante.";
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return unauthorized();
  const sql = getSql();
  const payload = (await request.json()) as { action?: string; invoiceId?: string };
  const invoiceId = String(payload.invoiceId ?? "");
  if (!invoiceId) return errorResponse(new Error("Falta la factura."), 400);

  try {
    await ensureHaciendaStorage(sql);
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_environment TEXT NOT NULL DEFAULT ''`;
    await sql`CREATE TABLE IF NOT EXISTS electronic_events (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    let environment = await activeHaciendaEnvironment(sql);
    const [settingsRows, credentialRows, invoiceRows, lineRows] = await Promise.all([
      sql`SELECT business_name, business_email, business_phone, business_address, taxpayer_identification_type, taxpayer_identification_number, taxpayer_name, trade_name, economic_activity_code, invoice_email, establishment_code, terminal_code, provider_system_identification, province_code, canton_code, district_code FROM business_settings WHERE id = 'default' LIMIT 1`,
      sql`SELECT environment, api_username_enc, api_password_enc, certificate_enc, certificate_pin_enc, last_sequence_fe, last_sequence_te, last_sequence_nc, rut_system_confirmed, sequence_confirmed, production_live_confirmed FROM hacienda_credentials WHERE id = ${environment} LIMIT 1`,
      sql`SELECT i.id, i.client_id, i.client_name, i.client_identification_type, i.client_identification_number, COALESCE(NULLIF(i.client_email, ''), c.email, '') AS client_email, COALESCE(NULLIF(i.client_province_code, ''), c.province_code, '') AS client_province_code, COALESCE(NULLIF(i.client_canton_code, ''), c.canton_code, '') AS client_canton_code, COALESCE(NULLIF(i.client_district_code, ''), c.district_code, '') AS client_district_code, COALESCE(NULLIF(i.client_address, ''), c.address, '') AS client_address, COALESCE(NULLIF(i.receiver_activity_code, ''), c.economic_activity_code, '') AS receiver_activity_code, i.observations, i.document_type, i.economic_activity_code, i.sale_condition, i.credit_term, i.payment_method, i.total_cents, i.hacienda_key, i.hacienda_consecutive, i.hacienda_status, i.hacienda_environment, i.hacienda_signed_xml_enc, i.hacienda_emission_date, i.reference_invoice_id, i.reference_key, i.reference_document_type, i.reference_date, i.reference_code, i.reference_reason FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ${invoiceId} LIMIT 1`,
      sql`SELECT description, quantity, unit_price_cents, cabys_code, unit_code, tax_rate, tax_rate_code, is_service FROM invoice_items WHERE invoice_id = ${invoiceId} ORDER BY id`,
    ]);
    const settings = settingsRows[0] as Record<string, string> | undefined;
    let credentials = credentialRows[0] as Record<string, string | number | boolean> | undefined;
    const invoice = invoiceRows[0] as Record<string, string | number> | undefined;
    const storedEnvironment = String(invoice?.hacienda_environment || "");
    if (invoice?.hacienda_key && (storedEnvironment === "sandbox" || storedEnvironment === "production") && storedEnvironment !== environment) {
      environment = storedEnvironment;
      const storedCredentialRows = await sql`SELECT environment, api_username_enc, api_password_enc, certificate_enc, certificate_pin_enc, last_sequence_fe, last_sequence_te, last_sequence_nc, rut_system_confirmed, sequence_confirmed, production_live_confirmed FROM hacienda_credentials WHERE id = ${environment} LIMIT 1`;
      credentials = storedCredentialRows[0] as Record<string, string | number | boolean> | undefined;
    }
    if (!settings || !credentials || !invoice) return errorResponse(new Error("La configuración o la factura no existe."), 404);
    const documentType = String(invoice.document_type || "") as ElectronicDocumentType;
    if (!["FE", "TE", "NC"].includes(documentType)) {
      return errorResponse(new Error("Los documentos comerciales no se envían a Hacienda."), 400);
    }

    if (!credentials.api_username_enc || !credentials.api_password_enc) {
      return errorResponse(new Error("Faltan el usuario o la contraseña del API de Hacienda."), 400);
    }
    const username = decryptSecret(String(credentials.api_username_enc)).toString("utf8");
    const password = decryptSecret(String(credentials.api_password_enc)).toString("utf8");

    if (payload.action === "status") {
      const clave = String(invoice.hacienda_key || "");
      if (!clave) return errorResponse(new Error("Esta factura todavía no fue enviada."), 400);
      const result = await checkHaciendaStatus({ environment, username, password, clave });
      const haciendaError = result.status === "rechazado" ? messageFromXml(result.responseXml) || "Comprobante rechazado." : "";
      const responseXmlEncrypted = result.responseXml ? encryptSecret(result.responseXml) : "";
      await sql`UPDATE invoices SET hacienda_status = ${result.status}, hacienda_response_xml_enc = CASE WHEN ${responseXmlEncrypted} <> '' THEN ${responseXmlEncrypted} ELSE hacienda_response_xml_enc END, hacienda_error = ${haciendaError}, status = ${result.status === "aceptado" ? "certified" : "draft"} WHERE id = ${invoiceId}`;
      await sql`INSERT INTO electronic_events (id, invoice_id, event_type, status, detail) VALUES (${`event-${crypto.randomUUID()}`}, ${invoiceId}, 'status_checked', ${result.status}, ${haciendaError.slice(0, 800)})`;
      if (result.status === "aceptado" && documentType === "NC" && invoice.reference_invoice_id) {
        await sql`UPDATE invoices SET status = 'cancelled' WHERE id = ${String(invoice.reference_invoice_id)}`;
      }
      return Response.json({
        ok: true,
        status: result.status,
        haciendaError,
        clave,
        numeroConsecutivo: String(invoice.hacienda_consecutive || ""),
        environment,
      });
    }

    if (payload.action !== "submit") return errorResponse(new Error("Acción no reconocida."), 400);
    if (String(invoice.hacienda_status || "") === "aceptado") {
      return errorResponse(new Error("Este comprobante ya fue aceptado por Hacienda."), 409);
    }
    if (String(invoice.hacienda_status || "") === "recibido") {
      return Response.json({
        ok: true,
        status: "recibido",
        clave: String(invoice.hacienda_key || ""),
        numeroConsecutivo: String(invoice.hacienda_consecutive || ""),
        environment,
      });
    }
    if (String(invoice.hacienda_status || "") === "rechazado") {
      return errorResponse(new Error("Un comprobante rechazado no se reutiliza. Crea uno nuevo que sustituya al rechazado."), 409);
    }
    if ((environment === "production" && (!credentials.rut_system_confirmed || !credentials.production_live_confirmed)) || !credentials.sequence_confirmed) {
      return errorResponse(new Error("Confirma en Ajustes el método de facturación del RUT y el último consecutivo usado."), 400);
    }
    if (!credentials.certificate_enc || !credentials.certificate_pin_enc) {
      return errorResponse(new Error("Falta cargar el certificado .p12 o su PIN."), 400);
    }
    const requiredSettings = [
      settings.taxpayer_identification_type,
      settings.taxpayer_identification_number,
      settings.taxpayer_name,
      settings.invoice_email,
      settings.business_address,
      settings.province_code,
      settings.canton_code,
      settings.district_code,
      settings.provider_system_identification,
    ];
    if (requiredSettings.some((value) => !value)) {
      return errorResponse(new Error("Completa el perfil tributario, correo y ubicación del emisor."), 400);
    }
    if (documentType !== "TE" && (!String(invoice.client_identification_number || "") || !String(invoice.client_identification_type || ""))) {
      return errorResponse(new Error("Una factura electrónica requiere la identificación del cliente."), 400);
    }
    if (documentType !== "TE") {
      const receiverLocation = [
        invoice.client_province_code,
        invoice.client_canton_code,
        invoice.client_district_code,
        invoice.client_address,
      ];
      if (receiverLocation.some((part) => !part)) {
        return errorResponse(new Error("La factura electrónica requiere la ubicación completa del receptor."), 400);
      }
    }
    const activityCode = String(invoice.economic_activity_code || settings.economic_activity_code || "");
    if (!activityCodePattern.test(activityCode)) {
      return errorResponse(new Error("Selecciona una actividad económica válida (formato CIIU 4 de Hacienda, por ejemplo 2823.0). Sincroniza el perfil tributario en Ajustes si el código sigue en el formato viejo de 6 dígitos."), 400);
    }
    const receiverActivityCode = String(invoice.receiver_activity_code || "").trim();
    if (receiverActivityCode && !activityCodePattern.test(receiverActivityCode)) {
      return errorResponse(new Error("La actividad económica del receptor debe tener el formato CIIU 4 de Hacienda, por ejemplo 2823.0. Déjala vacía si no estás seguro: en una factura electrónica es opcional."), 400);
    }
    const lines = (lineRows as Array<Record<string, unknown>>).map((line) => ({
      description: String(line.description || ""),
      quantity: Number(line.quantity),
      unitPrice: Number(line.unit_price_cents) / 100,
      cabysCode: String(line.cabys_code || ""),
      unitCode: String(line.unit_code || "Unid"),
      taxRate: Number(line.tax_rate),
      taxRateCode: String(line.tax_rate_code || ""),
      isService: Boolean(line.is_service),
    }));
    if (!lines.length || lines.some((line) => !/^\d{13}$/.test(line.cabysCode))) {
      return errorResponse(new Error("Todas las líneas deben tener un código CABYS válido de 13 dígitos."), 400);
    }
    if (lines.some((line) => !["01", "02", "03", "04", "08", "09", "10", "11"].includes(line.taxRateCode))) {
      return errorResponse(new Error("Cada línea debe tener un tratamiento de IVA válido de Hacienda."), 400);
    }
    if (documentType === "NC" && (!invoice.reference_key || !invoice.reference_date || !invoice.reference_code)) {
      return errorResponse(new Error("La nota de crédito no tiene la referencia fiscal del comprobante original."), 400);
    }

    const branch = String(settings.establishment_code || "001").trim().padStart(3, "0");
    const terminal = String(settings.terminal_code || "00001").trim().padStart(5, "0");
    if (!/^\d{3}$/.test(branch) || !/^\d{5}$/.test(terminal)) {
      return errorResponse(new Error("La sucursal debe tener 3 dígitos y la terminal 5 dígitos, tal como están registradas en Hacienda."), 400);
    }

    let clave = String(invoice.hacienda_key || "");
    let numeroConsecutivo = String(invoice.hacienda_consecutive || "");
    let fecha = String(invoice.hacienda_emission_date || "");
    let signedBase64 = invoice.hacienda_signed_xml_enc
      ? decryptSecret(String(invoice.hacienda_signed_xml_enc)).toString("utf8")
      : "";

    if (!clave || !signedBase64) {
      const documentCode = documentType === "TE" ? "04" : documentType === "NC" ? "03" : "01";
      const prefix = `${branch}${terminal}${documentCode}`;
      const sequenceRows = documentType === "TE"
        ? await sql`UPDATE hacienda_credentials SET last_sequence_te = GREATEST(last_sequence_te, COALESCE((SELECT MAX(CAST(SUBSTRING(i.hacienda_consecutive, 11, 10) AS BIGINT)) FROM invoices i WHERE i.hacienda_environment = ${environment} AND i.hacienda_consecutive LIKE ${`${prefix}%`}), 0)) + 1, updated_at = NOW() WHERE id = ${environment} RETURNING last_sequence_te AS sequence`
        : documentType === "NC"
          ? await sql`UPDATE hacienda_credentials SET last_sequence_nc = GREATEST(last_sequence_nc, COALESCE((SELECT MAX(CAST(SUBSTRING(i.hacienda_consecutive, 11, 10) AS BIGINT)) FROM invoices i WHERE i.hacienda_environment = ${environment} AND i.hacienda_consecutive LIKE ${`${prefix}%`}), 0)) + 1, updated_at = NOW() WHERE id = ${environment} RETURNING last_sequence_nc AS sequence`
          : await sql`UPDATE hacienda_credentials SET last_sequence_fe = GREATEST(last_sequence_fe, COALESCE((SELECT MAX(CAST(SUBSTRING(i.hacienda_consecutive, 11, 10) AS BIGINT)) FROM invoices i WHERE i.hacienda_environment = ${environment} AND i.hacienda_consecutive LIKE ${`${prefix}%`}), 0)) + 1, last_sequence = GREATEST(last_sequence, last_sequence_fe + 1), updated_at = NOW() WHERE id = ${environment} RETURNING last_sequence_fe AS sequence`;
      const sequence = Number(sequenceRows[0]?.sequence);
      if (!Number.isSafeInteger(sequence) || sequence > 9_999_999_999) {
        throw new Error("El consecutivo del comprobante alcanzó el límite permitido.");
      }
      const built = await buildAndSignDocument({
        documentType,
        sequence,
        branch,
        terminal,
        activityCode,
        providerIdentification: String(settings.provider_system_identification),
        saleCondition: String(invoice.sale_condition || "01"),
        creditTerm: String(invoice.credit_term || ""),
        paymentMethod: String(invoice.payment_method || "04"),
        observations: String(invoice.observations || ""),
        issuer: {
          name: String(settings.taxpayer_name),
          identificationType: String(settings.taxpayer_identification_type),
          identificationNumber: String(settings.taxpayer_identification_number),
          tradeName: String(settings.trade_name || settings.business_name || ""),
          province: String(settings.province_code),
          canton: String(settings.canton_code),
          district: String(settings.district_code),
          address: String(settings.business_address),
          phone: String(settings.business_phone || ""),
          email: String(settings.invoice_email || settings.business_email || ""),
        },
        receiver: {
          name: String(invoice.client_name),
          identificationType: String(invoice.client_identification_type),
          identificationNumber: String(invoice.client_identification_number),
          email: String(invoice.client_email || ""),
          activityCode: String(invoice.receiver_activity_code || ""),
          province: String(invoice.client_province_code || ""),
          canton: String(invoice.client_canton_code || ""),
          district: String(invoice.client_district_code || ""),
          address: String(invoice.client_address || ""),
        },
        ...(documentType === "NC" ? {
          reference: {
            documentType: String(invoice.reference_document_type) === "TE" ? "04" : "01",
            key: String(invoice.reference_key),
            emissionDate: String(invoice.reference_date),
            code: String(invoice.reference_code),
            reason: String(invoice.reference_reason || invoice.observations || "Anula documento de referencia"),
          },
        } : {}),
        lines,
      }, decryptSecret(String(credentials.certificate_enc)), decryptSecret(String(credentials.certificate_pin_enc)).toString("utf8"));
      clave = built.clave;
      numeroConsecutivo = built.numeroConsecutivo;
      fecha = built.fecha;
      signedBase64 = built.signedBase64;
      await sql`UPDATE invoices SET hacienda_key = ${clave}, hacienda_consecutive = ${numeroConsecutivo}, hacienda_emission_date = ${fecha}, hacienda_environment = ${environment}, hacienda_signed_xml_enc = ${encryptSecret(signedBase64)}, hacienda_status = 'firmado', hacienda_error = '' WHERE id = ${invoiceId}`;
      await sql`INSERT INTO electronic_events (id, invoice_id, event_type, status, detail) VALUES (${`event-${crypto.randomUUID()}`}, ${invoiceId}, 'signed', 'firmado', ${environment})`;
    }

    try {
      const result = await submitToHacienda({
        environment,
        username,
        password,
        clave,
        fecha,
        issuerType: String(settings.taxpayer_identification_type),
        issuerNumber: String(settings.taxpayer_identification_number),
        receiverType: String(invoice.client_identification_type),
        receiverNumber: String(invoice.client_identification_number),
        signedBase64,
      });
      await sql`UPDATE invoices SET hacienda_status = ${result.status}, hacienda_error = '' WHERE id = ${invoiceId}`;
      await sql`INSERT INTO electronic_events (id, invoice_id, event_type, status, detail) VALUES (${`event-${crypto.randomUUID()}`}, ${invoiceId}, 'submitted', ${result.status}, ${environment})`;
      return Response.json({ ok: true, status: result.status, clave, numeroConsecutivo, environment });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo enviar el comprobante.";
      await sql`UPDATE invoices SET hacienda_status = 'error', hacienda_error = ${message.slice(0, 800)} WHERE id = ${invoiceId}`;
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
