import { neon } from "@neondatabase/serverless";
import { loadP12 } from "@dojocoding/hacienda-sdk";
import { activeHaciendaEnvironment, ensureHaciendaStorage } from "../../../lib/hacienda-storage";
import { decryptSecret, encryptSecret } from "../../../lib/secure-storage";

export const runtime = "nodejs";

function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("La base de datos no está configurada.");
  return neon(connectionString);
}

async function ensureTable() {
  const sql = getSql();
  await ensureHaciendaStorage(sql);
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo guardar la configuración de Hacienda.";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    await ensureTable();
    const sql = getSql();
    const environment = await activeHaciendaEnvironment(sql);
    const rows = await sql`SELECT environment, (api_username_enc <> '') AS "hasApiUsername", (api_password_enc <> '') AS "hasApiPassword", (certificate_enc <> '') AS "hasCertificate", (certificate_pin_enc <> '') AS "hasCertificatePin", certificate_filename AS "certificateFilename", last_sequence_fe AS "lastSequenceFE", last_sequence_te AS "lastSequenceTE", last_sequence_nc AS "lastSequenceNC", rut_system_confirmed AS "rutSystemConfirmed", sequence_confirmed AS "sequenceConfirmed", production_live_confirmed AS "productionLiveConfirmed", updated_at AS "updatedAt" FROM hacienda_credentials WHERE id = ${environment} LIMIT 1`;
    return Response.json({ environment, ...(rows[0] ?? {}) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureTable();
    const sql = getSql();
    const form = await request.formData();
    const environment = String(form.get("environment") ?? "sandbox") === "production" ? "production" : "sandbox";
    const apiUsername = String(form.get("apiUsername") ?? "").trim();
    const apiPassword = String(form.get("apiPassword") ?? "");
    const certificatePin = String(form.get("certificatePin") ?? "");
    const lastSequenceFE = Number(form.get("lastSequenceFE") ?? 0);
    const lastSequenceTE = Number(form.get("lastSequenceTE") ?? 0);
    const lastSequenceNC = Number(form.get("lastSequenceNC") ?? 0);
    const rutSystemConfirmed = environment === "production" && String(form.get("rutSystemConfirmed") ?? "") === "true";
    const sequenceConfirmed = String(form.get("sequenceConfirmed") ?? "") === "true";
    const productionLiveConfirmed = environment === "production" && String(form.get("productionLiveConfirmed") ?? "") === "true";
    const certificate = form.get("certificate");

    const sequences = [lastSequenceFE, lastSequenceTE, lastSequenceNC];
    if (sequences.some((sequence) => !Number.isSafeInteger(sequence) || sequence < 0 || sequence > 9_999_999_999)) {
      return Response.json({ error: "Cada consecutivo debe ser un entero entre 0 y 9 999 999 999." }, { status: 400 });
    }

    const existingRows = await sql`SELECT api_username_enc, api_password_enc, certificate_enc, certificate_pin_enc, certificate_filename FROM hacienda_credentials WHERE id = ${environment} LIMIT 1`;
    const existing = existingRows[0] as Record<string, string> | undefined;
    let apiUsernameEncrypted = existing?.api_username_enc || "";
    let apiPasswordEncrypted = existing?.api_password_enc || "";
    let certificateEncrypted = existing?.certificate_enc || "";
    let certificatePinEncrypted = existing?.certificate_pin_enc || "";
    let certificateFilename = existing?.certificate_filename || "";

    if (apiUsername) apiUsernameEncrypted = encryptSecret(apiUsername);
    if (apiPassword) apiPasswordEncrypted = encryptSecret(apiPassword);

    const usernameToValidate = apiUsername || (apiUsernameEncrypted ? decryptSecret(apiUsernameEncrypted).toString("utf8") : "");
    if (environment === "production" && /@stag\./i.test(usernameToValidate)) {
      return Response.json({ error: "El usuario de pruebas (@stag) no puede guardarse en producción. Genera las credenciales reales en TRIBU-CR." }, { status: 400 });
    }
    if (environment === "sandbox" && usernameToValidate && !/@stag\./i.test(usernameToValidate)) {
      return Response.json({ error: "El usuario seleccionado parece ser de producción. En sandbox utiliza el usuario que contiene @stag." }, { status: 400 });
    }

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

    await sql`INSERT INTO hacienda_credentials (id, environment, api_username_enc, api_password_enc, certificate_enc, certificate_pin_enc, certificate_filename, last_sequence, last_sequence_fe, last_sequence_te, last_sequence_nc, rut_system_confirmed, sequence_confirmed, production_live_confirmed, updated_at) VALUES (${environment}, ${environment}, ${apiUsernameEncrypted}, ${apiPasswordEncrypted}, ${certificateEncrypted}, ${certificatePinEncrypted}, ${certificateFilename}, ${lastSequenceFE}, ${lastSequenceFE}, ${lastSequenceTE}, ${lastSequenceNC}, ${rutSystemConfirmed}, ${sequenceConfirmed}, ${productionLiveConfirmed}, NOW()) ON CONFLICT (id) DO UPDATE SET environment = EXCLUDED.environment, api_username_enc = EXCLUDED.api_username_enc, api_password_enc = EXCLUDED.api_password_enc, certificate_enc = EXCLUDED.certificate_enc, certificate_pin_enc = EXCLUDED.certificate_pin_enc, certificate_filename = EXCLUDED.certificate_filename, last_sequence = EXCLUDED.last_sequence, last_sequence_fe = EXCLUDED.last_sequence_fe, last_sequence_te = EXCLUDED.last_sequence_te, last_sequence_nc = EXCLUDED.last_sequence_nc, rut_system_confirmed = EXCLUDED.rut_system_confirmed, sequence_confirmed = EXCLUDED.sequence_confirmed, production_live_confirmed = EXCLUDED.production_live_confirmed, updated_at = NOW()`;
    await sql`INSERT INTO hacienda_runtime (id, active_environment, updated_at) VALUES ('default', ${environment}, NOW()) ON CONFLICT (id) DO UPDATE SET active_environment = EXCLUDED.active_environment, updated_at = NOW()`;

    return Response.json({
      ok: true,
      environment,
      hasApiUsername: Boolean(apiUsernameEncrypted),
      hasApiPassword: Boolean(apiPasswordEncrypted),
      hasCertificate: Boolean(certificateEncrypted),
      hasCertificatePin: Boolean(certificatePinEncrypted),
      certificateFilename,
      lastSequenceFE,
      lastSequenceTE,
      lastSequenceNC,
      rutSystemConfirmed,
      sequenceConfirmed,
      productionLiveConfirmed,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
