import { neon } from "@neondatabase/serverless";
import {
  buildAndSignInvoice,
  checkHaciendaStatus,
  submitToHacienda,
  type HaciendaEnvironment,
} from "../../../lib/hacienda";
import { decryptSecret, encryptSecret } from "../../../lib/secure-storage";
import { isAuthenticated, unauthorized } from "../../../lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("La base de datos no está configurada.");
  return neon(connectionString);
}

function messageFromXml(xml: string) {
  const match = xml.match(/<(?:DetalleMensaje|Mensaje)>([^<]+)<\/(?:DetalleMensaje|Mensaje)>/i);
  return match?.[1]?.trim() || "";
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
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_emission_date TEXT NOT NULL DEFAULT ''`;
    const [settingsRows, credentialRows, invoiceRows, lineRows] = await Promise.all([
      sql`SELECT business_name, business_email, business_phone, business_address, taxpayer_identification_type, taxpayer_identification_number, taxpayer_name, trade_name, economic_activity_code, invoice_email, establishment_code, terminal_code, provider_system_identification, province_code, canton_code, district_code FROM business_settings WHERE id = 'default' LIMIT 1`,
      sql`SELECT environment, api_username_enc, api_password_enc, certificate_enc, certificate_pin_enc, last_sequence, rut_system_confirmed, sequence_confirmed FROM hacienda_credentials WHERE id = 'default' LIMIT 1`,
      sql`SELECT i.id, i.client_id, i.client_name, i.client_identification_type, i.client_identification_number, i.observations, i.economic_activity_code, i.sale_condition, i.credit_term, i.payment_method, i.total_cents, i.hacienda_key, i.hacienda_consecutive, i.hacienda_status, i.hacienda_signed_xml_enc, i.hacienda_emission_date, c.email AS client_email FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ${invoiceId} LIMIT 1`,
      sql`SELECT description, quantity, unit_price_cents, cabys_code, unit_code, tax_rate, is_service FROM invoice_items WHERE invoice_id = ${invoiceId} ORDER BY id`,
    ]);
    const settings = settingsRows[0] as Record<string, string> | undefined;
    const credentials = credentialRows[0] as Record<string, string | number | boolean> | undefined;
    const invoice = invoiceRows[0] as Record<string, string | number> | undefined;
    if (!settings || !credentials || !invoice) return errorResponse(new Error("La configuración o la factura no existe."), 404);

    if (!credentials.api_username_enc || !credentials.api_password_enc) {
      return errorResponse(new Error("Faltan el usuario o la contraseña del API de Hacienda."), 400);
    }
    const username = decryptSecret(String(credentials.api_username_enc)).toString("utf8");
    const password = decryptSecret(String(credentials.api_password_enc)).toString("utf8");
    const environment = String(credentials.environment) as HaciendaEnvironment;

    if (payload.action === "status") {
      const clave = String(invoice.hacienda_key || "");
      if (!clave) return errorResponse(new Error("Esta factura todavía no fue enviada."), 400);
      const result = await checkHaciendaStatus({ environment, username, password, clave });
      const haciendaError = result.status === "rechazado" ? messageFromXml(result.responseXml) || "Comprobante rechazado." : "";
      await sql`UPDATE invoices SET hacienda_status = ${result.status}, hacienda_response_xml_enc = ${result.responseXml ? encryptSecret(result.responseXml) : ""}, hacienda_error = ${haciendaError}, status = ${result.status === "aceptado" ? "certified" : "draft"} WHERE id = ${invoiceId}`;
      return Response.json({ ok: true, status: result.status, haciendaError });
    }

    if (payload.action !== "submit") return errorResponse(new Error("Acción no reconocida."), 400);
    if (!credentials.rut_system_confirmed || !credentials.sequence_confirmed) {
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
    if (!String(invoice.client_identification_number || "") || !String(invoice.client_identification_type || "")) {
      return errorResponse(new Error("Una factura electrónica requiere la identificación del cliente."), 400);
    }
    const activityCode = String(invoice.economic_activity_code || settings.economic_activity_code || "");
    if (!/^\d{6}$/.test(activityCode)) {
      return errorResponse(new Error("Selecciona una actividad económica válida para la factura."), 400);
    }
    const lines = (lineRows as Array<Record<string, unknown>>).map((line) => ({
      description: String(line.description || ""),
      quantity: Number(line.quantity),
      unitPrice: Number(line.unit_price_cents) / 100,
      cabysCode: String(line.cabys_code || ""),
      unitCode: String(line.unit_code || "Unid"),
      taxRate: Number(line.tax_rate),
      isService: Boolean(line.is_service),
    }));
    if (!lines.length || lines.some((line) => !/^\d{13}$/.test(line.cabysCode))) {
      return errorResponse(new Error("Todas las líneas deben tener un código CABYS válido de 13 dígitos."), 400);
    }
    if (lines.some((line) => !["0", "1", "2", "4", "8", "13"].includes(String(line.taxRate)))) {
      return errorResponse(new Error("La tarifa de IVA debe ser 0%, 1%, 2%, 4%, 8% o 13%."), 400);
    }

    let clave = String(invoice.hacienda_key || "");
    let numeroConsecutivo = String(invoice.hacienda_consecutive || "");
    let fecha = String(invoice.hacienda_emission_date || "");
    let signedBase64 = invoice.hacienda_signed_xml_enc
      ? decryptSecret(String(invoice.hacienda_signed_xml_enc)).toString("utf8")
      : "";

    if (!clave || !signedBase64) {
      const sequenceRows = await sql`UPDATE hacienda_credentials SET last_sequence = last_sequence + 1, updated_at = NOW() WHERE id = 'default' RETURNING last_sequence`;
      const sequence = Number(sequenceRows[0]?.last_sequence);
      if (!Number.isSafeInteger(sequence) || sequence > 9_999_999_999) {
        throw new Error("El consecutivo de factura alcanzó el límite permitido.");
      }
      const built = await buildAndSignInvoice({
        sequence,
        branch: String(settings.establishment_code || "001"),
        terminal: String(settings.terminal_code || "00001"),
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
        },
        lines,
      }, decryptSecret(String(credentials.certificate_enc)), decryptSecret(String(credentials.certificate_pin_enc)).toString("utf8"));
      clave = built.clave;
      numeroConsecutivo = built.numeroConsecutivo;
      fecha = built.fecha;
      signedBase64 = built.signedBase64;
      await sql`UPDATE invoices SET hacienda_key = ${clave}, hacienda_consecutive = ${numeroConsecutivo}, hacienda_emission_date = ${fecha}, hacienda_signed_xml_enc = ${encryptSecret(signedBase64)}, hacienda_status = 'firmado', hacienda_error = '' WHERE id = ${invoiceId}`;
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
      return Response.json({ ok: true, status: result.status, clave, numeroConsecutivo });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo enviar el comprobante.";
      await sql`UPDATE invoices SET hacienda_status = 'error', hacienda_error = ${message.slice(0, 800)} WHERE id = ${invoiceId}`;
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
