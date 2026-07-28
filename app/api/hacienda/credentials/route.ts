import { neon } from "@neondatabase/serverless";
import { loadP12 } from "@dojocoding/hacienda-sdk";
import { decryptSecret, encryptSecret } from "../../../lib/secure-storage";
import { isAuthenticated, unauthorized } from "../../../lib/session";

export const runtime = "nodejs";

function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("La base de datos no está configurada.");
  return neon(connectionString);
}

async function ensureTable() {
  const sql = getSql();
  await sql`CREATE TABLE IF NOT EXISTS hacienda_credentials (
    id TEXT PRIMARY KEY,
    environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
    api_username_enc TEXT NOT NULL DEFAULT '',
    api_password_enc TEXT NOT NULL DEFAULT '',
    certificate_enc TEXT NOT NULL DEFAULT '',
    certificate_pin_enc TEXT NOT NULL DEFAULT '',
    certificate_filename TEXT NOT NULL DEFAULT '',
    last_sequence BIGINT NOT NULL DEFAULT 0,
    rut_system_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    sequence_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE hacienda_credentials ADD COLUMN IF NOT EXISTS sequence_confirmed BOOLEAN NOT NULL DEFAULT FALSE`;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo guardar la configuración de Hacienda.";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    if (!(await isAuthenticated())) return unauthorized();
    await ensureTable();
    const sql = getSql();
    const rows = await sql`SELECT environment, (api_username_enc <> '') AS "hasApiUsername", (api_password_enc <> '') AS "hasApiPassword", (certificate_enc <> '') AS "hasCertificate", (certificate_pin_enc <> '') AS "hasCertificatePin", certificate_filename AS "certificateFilename", last_sequence AS "lastSequence", rut_system_confirmed AS "rutSystemConfirmed", sequence_confirmed AS "sequenceConfirmed", updated_at AS "updatedAt" FROM hacienda_credentials WHERE id = 'default' LIMIT 1`;
    return Response.json(rows[0] ?? {
      environment: "sandbox",
      hasApiUsername: false,
      hasApiPassword: false,
      hasCertificate: false,
      hasCertificatePin: false,
      certificateFilename: "",
      lastSequence: 0,
      rutSystemConfirmed: false,
      sequenceConfirmed: false,
      updatedAt: null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!(await isAuthenticated())) return unauthorized();
    await ensureTable();
    const sql = getSql();
    const form = await request.formData();
    const environment = String(form.get("environment") ?? "sandbox") === "production" ? "production" : "sandbox";
    const apiUsername = String(form.get("apiUsername") ?? "").trim();
    const apiPassword = String(form.get("apiPassword") ?? "");
    const certificatePin = String(form.get("certificatePin") ?? "");
    const lastSequence = Number(form.get("lastSequence") ?? 0);
    const rutSystemConfirmed = String(form.get("rutSystemConfirmed") ?? "") === "true";
    const sequenceConfirmed = String(form.get("sequenceConfirmed") ?? "") === "true";
    const certificate = form.get("certificate");

    if (!Number.isSafeInteger(lastSequence) || lastSequence < 0 || lastSequence > 9_999_999_999) {
      return Response.json({ error: "El último consecutivo debe ser un entero entre 0 y 9 999 999 999." }, { status: 400 });
    }

    const existingRows = await sql`SELECT api_username_enc, api_password_enc, certificate_enc, certificate_pin_enc, certificate_filename FROM hacienda_credentials WHERE id = 'default' LIMIT 1`;
    const existing = existingRows[0] as Record<string, string> | undefined;
    let apiUsernameEncrypted = existing?.api_username_enc || "";
    let apiPasswordEncrypted = existing?.api_password_enc || "";
    let certificateEncrypted = existing?.certificate_enc || "";
    let certificatePinEncrypted = existing?.certificate_pin_enc || "";
    let certificateFilename = existing?.certificate_filename || "";

    if (apiUsername) apiUsernameEncrypted = encryptSecret(apiUsername);
    if (apiPassword) apiPasswordEncrypted = encryptSecret(apiPassword);

    const uploadedCertificate = certificate instanceof File && certificate.size > 0 ? certificate : null;
    if (uploadedCertificate && uploadedCertificate.size > 128 * 1024) {
      return Response.json({ error: "El certificado .p12 supera el límite de 128 KB." }, { status: 400 });
    }

    if (uploadedCertificate) {
      if (!/\.p12$/i.test(uploadedCertificate.name)) {
        return Response.json({ error: "Selecciona el certificado de firma con extensión .p12." }, { status: 400 });
      }
      if (!certificatePin) {
        return Response.json({ error: "Escribe el PIN del certificado .p12." }, { status: 400 });
      }
      const certificateBuffer = Buffer.from(await uploadedCertificate.arrayBuffer());
      await loadP12(certificateBuffer, certificatePin);
      certificateEncrypted = encryptSecret(certificateBuffer);
      certificatePinEncrypted = encryptSecret(certificatePin);
      certificateFilename = uploadedCertificate.name;
    } else if (certificatePin && certificateEncrypted) {
      const certificateBuffer = decryptSecret(certificateEncrypted);
      await loadP12(certificateBuffer, certificatePin);
      certificatePinEncrypted = encryptSecret(certificatePin);
    }

    await sql`INSERT INTO hacienda_credentials (id, environment, api_username_enc, api_password_enc, certificate_enc, certificate_pin_enc, certificate_filename, last_sequence, rut_system_confirmed, sequence_confirmed, updated_at) VALUES ('default', ${environment}, ${apiUsernameEncrypted}, ${apiPasswordEncrypted}, ${certificateEncrypted}, ${certificatePinEncrypted}, ${certificateFilename}, ${lastSequence}, ${rutSystemConfirmed}, ${sequenceConfirmed}, NOW()) ON CONFLICT (id) DO UPDATE SET environment = EXCLUDED.environment, api_username_enc = EXCLUDED.api_username_enc, api_password_enc = EXCLUDED.api_password_enc, certificate_enc = EXCLUDED.certificate_enc, certificate_pin_enc = EXCLUDED.certificate_pin_enc, certificate_filename = EXCLUDED.certificate_filename, last_sequence = EXCLUDED.last_sequence, rut_system_confirmed = EXCLUDED.rut_system_confirmed, sequence_confirmed = EXCLUDED.sequence_confirmed, updated_at = NOW()`;

    return Response.json({
      ok: true,
      environment,
      hasApiUsername: Boolean(apiUsernameEncrypted),
      hasApiPassword: Boolean(apiPasswordEncrypted),
      hasCertificate: Boolean(certificateEncrypted),
      hasCertificatePin: Boolean(certificatePinEncrypted),
      certificateFilename,
      lastSequence,
      rutSystemConfirmed,
      sequenceConfirmed,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
