import { neon } from "@neondatabase/serverless";
import JSZip from "jszip";
import { generateInvoicePdf, toPdfSettings, type PdfInvoice } from "../../../lib/invoice-pdf";
import { decryptSecret } from "../../../lib/secure-storage";
import { isAuthenticated, unauthorized } from "../../../lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("La base de datos no está configurada.");
  return neon(connectionString);
}

export async function GET() {
  if (!(await isAuthenticated())) return unauthorized();
  try {
    const sql = getSql();
    await sql`CREATE TABLE IF NOT EXISTS electronic_events (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    const [invoiceRows, lineRows, settingsRows, eventRows] = await Promise.all([
      sql`SELECT id, document_type AS "documentType", invoice_number AS "invoiceNumber", issue_date AS "issueDate", client_name AS "clientName", client_identification_type AS "clientIdentificationType", client_identification_number AS "clientIdentificationNumber", client_email AS "clientEmail", client_address AS "clientAddress", observations, subtotal_cents AS "subtotalCents", tax_cents AS "taxCents", total_cents AS "totalCents", sale_condition AS "saleCondition", credit_term AS "creditTerm", payment_method AS "paymentMethod", hacienda_key AS "haciendaKey", hacienda_consecutive AS "haciendaConsecutive", hacienda_status AS "haciendaStatus", hacienda_environment AS "haciendaEnvironment", hacienda_emission_date AS "haciendaEmissionDate", reference_key AS "referenceKey", reference_reason AS "referenceReason", hacienda_signed_xml_enc AS "signedXmlEncrypted", hacienda_response_xml_enc AS "responseXmlEncrypted", created_at AS "createdAt" FROM invoices WHERE document_type IN ('FE', 'TE', 'NC') AND hacienda_key IS NOT NULL ORDER BY created_at`,
      sql`SELECT invoice_id AS "invoiceId", description, quantity, unit_price_cents AS "unitPriceCents", cabys_code AS "cabysCode", unit_code AS "unitCode", tax_rate AS "taxRate", tax_rate_code AS "taxRateCode", tax_cents AS "taxCents", total_cents AS "totalCents" FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE document_type IN ('FE', 'TE', 'NC') AND hacienda_key IS NOT NULL) ORDER BY id`,
      sql`SELECT business_name AS "businessName", taxpayer_name AS "taxpayerName", trade_name AS "tradeName", taxpayer_identification_type AS "taxpayerIdentificationType", taxpayer_identification_number AS "taxpayerIdentificationNumber", business_address AS "businessAddress", business_phone AS "businessPhone", invoice_email AS "invoiceEmail" FROM business_settings WHERE id = 'default' LIMIT 1`,
      sql`SELECT invoice_id AS "invoiceId", event_type AS "eventType", status, detail, created_at AS "createdAt" FROM electronic_events ORDER BY created_at`,
    ]);
    const settings = toPdfSettings(settingsRows[0] as Record<string, unknown> | undefined);

    const linesByInvoice = new Map<string, Array<Record<string, unknown>>>();
    for (const line of lineRows as Array<Record<string, unknown>>) {
      const invoiceId = String(line.invoiceId);
      const group = linesByInvoice.get(invoiceId) ?? [];
      group.push(line);
      linesByInvoice.set(invoiceId, group);
    }

    const zip = new JSZip();
    const manifest: Array<Record<string, unknown>> = [];
    for (const raw of invoiceRows as Array<Record<string, unknown>>) {
      const key = String(raw.haciendaKey);
      const folder = zip.folder(`comprobantes/${key}`);
      if (!folder) throw new Error("No se pudo crear el respaldo.");

      const signedXmlEncrypted = String(raw.signedXmlEncrypted || "");
      if (signedXmlEncrypted) {
        const signedBase64 = decryptSecret(signedXmlEncrypted).toString("utf8");
        folder.file(`${key}.xml`, Buffer.from(signedBase64, "base64"));
      }
      const responseXmlEncrypted = String(raw.responseXmlEncrypted || "");
      if (responseXmlEncrypted) {
        folder.file(`${key}_respuesta.xml`, decryptSecret(responseXmlEncrypted));
      }
      if (String(raw.haciendaStatus) === "aceptado") {
        const invoice = {
          ...raw,
          lines: linesByInvoice.get(String(raw.id)) ?? [],
        } as unknown as PdfInvoice;
        folder.file(`${key}.pdf`, await generateInvoicePdf(invoice, settings));
      }
      manifest.push({
        clave: key,
        consecutivo: raw.haciendaConsecutive,
        tipo: raw.documentType,
        estado: raw.haciendaStatus,
        ambiente: raw.haciendaEnvironment,
        fechaEmision: raw.haciendaEmissionDate,
        receptor: raw.clientName,
        totalCRC: Number(raw.totalCents) / 100,
      });
    }

    zip.file("manifest.json", JSON.stringify({
      generadoEn: new Date().toISOString(),
      cantidad: manifest.length,
      comprobantes: manifest,
    }, null, 2));
    zip.file("bitacora.json", JSON.stringify(eventRows, null, 2));
    const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(archive), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="respaldo-fiscal-${date}.zip"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo preparar el respaldo fiscal.";
    return Response.json({ error: message }, { status: 500 });
  }
}
