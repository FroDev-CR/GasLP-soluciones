import { neon } from "@neondatabase/serverless";
import { decryptSecret } from "../../../../lib/secure-storage";
import { isAuthenticated, unauthorized } from "../../../../lib/session";

export const runtime = "nodejs";

function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("La base de datos no está configurada.");
  return neon(connectionString);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) return unauthorized();
  try {
    const { id } = await context.params;
    const kind = new URL(request.url).searchParams.get("kind") === "response" ? "response" : "signed";
    const sql = getSql();
    const rows = await sql`SELECT document_type, hacienda_key, hacienda_signed_xml_enc, hacienda_response_xml_enc, hacienda_status FROM invoices WHERE id = ${id} LIMIT 1`;
    const invoice = rows[0] as Record<string, string> | undefined;
    if (!invoice || !["FE", "TE", "NC"].includes(String(invoice.document_type))) {
      return Response.json({ error: "El comprobante electrónico no existe." }, { status: 404 });
    }
    const encrypted = kind === "response"
      ? String(invoice.hacienda_response_xml_enc || "")
      : String(invoice.hacienda_signed_xml_enc || "");
    if (!encrypted) {
      return Response.json({
        error: kind === "response"
          ? "La respuesta XML estará disponible después de consultar el estado."
          : "El XML firmado estará disponible después de firmar el comprobante.",
      }, { status: 409 });
    }
    const decrypted = decryptSecret(encrypted);
    const xml = kind === "response"
      ? decrypted
      : Buffer.from(decrypted.toString("utf8"), "base64");
    const key = String(invoice.hacienda_key || id);
    const filename = kind === "response" ? `${key}_respuesta.xml` : `${key}.xml`;
    await sql`CREATE TABLE IF NOT EXISTS electronic_events (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`INSERT INTO electronic_events (id, invoice_id, event_type, status, detail) VALUES (${`event-${crypto.randomUUID()}`}, ${id}, 'xml_downloaded', ${String(invoice.hacienda_status || "")}, ${kind})`;
    return new Response(new Uint8Array(xml), {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo descargar el XML.";
    return Response.json({ error: message }, { status: 500 });
  }
}
