import "server-only";
import { neon } from "@neondatabase/serverless";
import { decryptSecret, encryptSecret } from "./secure-storage";
import { assertMailReady, defaultInvoiceSender, emailSettingsInput, InvoiceEmailError, type EmailDelivery, type EmailSettings } from "./invoice-email";

export function emailSql() {
  if (!process.env.DATABASE_URL) throw new InvoiceEmailError("La base de datos no está configurada.", 503);
  return neon(process.env.DATABASE_URL);
}

let initialized: Promise<void> | undefined;
export async function ensureEmailStorage() {
  if (initialized) return initialized;
  initialized = (async () => {
    const sql = emailSql();
    await sql`CREATE TABLE IF NOT EXISTS invoice_email_settings (
      id TEXT PRIMARY KEY, sender_email TEXT NOT NULL, sender_name TEXT NOT NULL,
      app_password_enc TEXT NOT NULL DEFAULT '', pdf_format TEXT NOT NULL DEFAULT 'letter',
      enabled BOOLEAN NOT NULL DEFAULT FALSE, verified_at TIMESTAMPTZ, last_test_at TIMESTAMPTZ,
      last_probe_at TIMESTAMPTZ, version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`INSERT INTO invoice_email_settings (id, sender_email, sender_name) VALUES ('default', ${defaultInvoiceSender}, 'GAS LP SOLUCIONES') ON CONFLICT (id) DO NOTHING`;
    await sql`CREATE TABLE IF NOT EXISTS invoice_email_deliveries (
      invoice_id TEXT PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
      attempt_id TEXT NOT NULL, state TEXT NOT NULL, recipient TEXT NOT NULL DEFAULT '', sender TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '', message_id TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 1,
      submitted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS invoice_email_attempts (
      attempt_id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      state TEXT NOT NULL, recipient TEXT NOT NULL DEFAULT '', sender TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '', message_id TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  })().catch((error) => { initialized = undefined; throw error; });
  return initialized;
}

export async function readEmailSettings(): Promise<EmailSettings> {
  await ensureEmailStorage();
  const sql = emailSql();
  const rows = await sql`SELECT sender_email AS "senderEmail", sender_name AS "senderName", pdf_format AS format, enabled,
    (app_password_enc <> '') AS "hasPassword", verified_at AS "verifiedAt", last_test_at AS "lastTestAt", version
    FROM invoice_email_settings WHERE id = 'default'`;
  return rows[0] as EmailSettings;
}

function requireEncryptionKey() {
  if (Buffer.from(process.env.HACIENDA_ENCRYPTION_KEY || "", "base64").length !== 32) {
    throw new InvoiceEmailError("Configura HACIENDA_ENCRYPTION_KEY en el servidor antes de guardar credenciales de correo. No se utilizará una clave de desarrollo.", 503);
  }
}

export async function saveEmailSettings(payload: Record<string, unknown>) {
  const input = emailSettingsInput(payload);
  const current = await readEmailSettings();
  if (payload.version !== current.version) throw new InvoiceEmailError("La configuración cambió. Recarga antes de guardar.", 409);
  if (input.appPassword) requireEncryptionKey();
  const encrypted = input.appPassword ? encryptSecret(input.appPassword) : "";
  const sql = emailSql();
  const rows = await sql`UPDATE invoice_email_settings SET sender_email = ${input.senderEmail}, sender_name = ${input.senderName},
    pdf_format = ${input.format}, app_password_enc = CASE WHEN ${encrypted} <> '' THEN ${encrypted}
      WHEN sender_email = ${input.senderEmail} THEN app_password_enc ELSE '' END,
    enabled = FALSE, verified_at = NULL, last_test_at = NULL, version = version + 1, updated_at = NOW()
    WHERE id = 'default' AND version = ${current.version} RETURNING id`;
  if (!rows.length) throw new InvoiceEmailError("La configuración cambió. Recarga antes de guardar.", 409);
  return readEmailSettings();
}

export async function emailPassword(settings: EmailSettings) {
  requireEncryptionKey();
  const sql = emailSql();
  const rows = await sql`SELECT app_password_enc FROM invoice_email_settings WHERE id = 'default' AND version = ${settings.version}`;
  if (!rows[0]?.app_password_enc) throw new InvoiceEmailError("Guarda la contraseña de aplicación de este Gmail y verifica la conexión.", 409);
  return decryptSecret(String(rows[0].app_password_enc)).toString("utf8");
}

export async function setEmailEnabled(enabled: boolean, version: number) {
  const settings = await readEmailSettings();
  if (enabled) assertMailReady(settings);
  const sql = emailSql();
  const rows = await sql`UPDATE invoice_email_settings SET enabled = ${enabled}, version = version + 1, updated_at = NOW()
    WHERE id = 'default' AND version = ${version}
      AND (${enabled} = FALSE OR (verified_at IS NOT NULL AND app_password_enc <> '')) RETURNING id`;
  if (!rows.length) throw new InvoiceEmailError("La configuración cambió. Recarga antes de activar o desactivar.", 409);
  return readEmailSettings();
}

export async function claimEmailProbe(version: number) {
  const sql = emailSql();
  const rows = await sql`UPDATE invoice_email_settings SET last_probe_at = NOW() WHERE id = 'default' AND version = ${version}
    AND (last_probe_at IS NULL OR last_probe_at < NOW() - INTERVAL '30 seconds') RETURNING id`;
  if (!rows.length) throw new InvoiceEmailError("Espera 30 segundos entre verificaciones o pruebas y recarga si cambió la configuración.", 429);
}

export async function readEmailDelivery(invoiceId: string): Promise<EmailDelivery | null> {
  await ensureEmailStorage();
  const sql = emailSql();
  const rows = await sql`SELECT attempt_id AS "attemptId", state, recipient, sender, message, message_id AS "messageId", attempts,
    updated_at AS "updatedAt", submitted_at AS "submittedAt" FROM invoice_email_deliveries WHERE invoice_id = ${invoiceId}`;
  return (rows[0] as EmailDelivery | undefined) ?? null;
}

/** Las API solo exponen mensajes propios; nunca errores SMTP/DB que puedan contener secretos. */
export function emailApiError(error: unknown) {
  return Response.json({ error: error instanceof InvoiceEmailError ? error.message : "No se pudo procesar el correo. Revisa la configuración e inténtalo de nuevo." },
    { status: error instanceof InvoiceEmailError ? error.status : 500, headers: { "cache-control": "private, no-store" } });
}

export async function emailPayload(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new InvoiceEmailError("Formato de solicitud no permitido.", 415);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new InvoiceEmailError("Origen de solicitud no permitido.", 403);
  const text = await request.text();
  if (text.length > 4096) throw new InvoiceEmailError("La solicitud es demasiado grande.", 413);
  try {
    const payload: unknown = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
    return payload as Record<string, unknown>;
  } catch { throw new InvoiceEmailError("La solicitud no es válida."); }
}
