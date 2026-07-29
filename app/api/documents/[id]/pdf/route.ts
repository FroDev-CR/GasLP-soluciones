import { neon } from "@neondatabase/serverless";
import { generateInvoicePdf, type PdfInvoice, type PdfSettings } from "../../../../lib/invoice-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("La base de datos no está configurada.");
  return neon(connectionString);
}

function safeFilename(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || "documento";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const sql = getSql();
    const [invoiceRows, lineRows, settingsRows] = await Promise.all([
      sql`SELECT id, document_type AS "documentType", invoice_number AS "invoiceNumber", issue_date AS "issueDate", client_name AS "clientName", client_identification_type AS "clientIdentificationType", client_identification_number AS "clientIdentificationNumber", client_email AS "clientEmail", client_address AS "clientAddress", observations, subtotal_cents AS "subtotalCents", tax_cents AS "taxCents", total_cents AS "totalCents", sale_condition AS "saleCondition", credit_term AS "creditTerm", payment_method AS "paymentMethod", hacienda_key AS "haciendaKey", hacienda_consecutive AS "haciendaConsecutive", hacienda_status AS "haciendaStatus", hacienda_environment AS "haciendaEnvironment", hacienda_emission_date AS "haciendaEmissionDate", reference_key AS "referenceKey", reference_reason AS "referenceReason" FROM invoices WHERE id = ${id} LIMIT 1`,
      sql`SELECT description, quantity, unit_price_cents AS "unitPriceCents", cabys_code AS "cabysCode", unit_code AS "unitCode", tax_rate AS "taxRate", tax_rate_code AS "taxRateCode", tax_cents AS "taxCents", total_cents AS "totalCents" FROM invoice_items WHERE invoice_id = ${id} ORDER BY id`,
      sql`SELECT business_name AS "businessName", taxpayer_name AS "taxpayerName", trade_name AS "tradeName", taxpayer_identification_type AS "taxpayerIdentificationType", taxpayer_identification_number AS "taxpayerIdentificationNumber", business_address AS "businessAddress", business_phone AS "businessPhone", invoice_email AS "invoiceEmail" FROM business_settings WHERE id = 'default' LIMIT 1`,
    ]);
    const rawInvoice = invoiceRows[0] as Record<string, unknown> | undefined;
    const settings = settingsRows[0] as Record<string, string> | undefined;
    if (!rawInvoice || !settings) return Response.json({ error: "El documento no existe." }, { status: 404 });
    const isElectronic = String(rawInvoice.documentType) !== "commercial";
    if (isElectronic && String(rawInvoice.haciendaStatus) !== "aceptado") {
      return Response.json({ error: "El PDF fiscal se habilita cuando Hacienda acepta el comprobante." }, { status: 409 });
    }
    const invoice = {
      ...rawInvoice,
      lines: lineRows,
    } as unknown as PdfInvoice;
    const pdf = await generateInvoicePdf(invoice, settings as unknown as PdfSettings);
    const filenameBase = isElectronic
      ? String(rawInvoice.haciendaKey)
      : safeFilename(String(rawInvoice.invoiceNumber || rawInvoice.id));
    if (isElectronic) {
      await sql`CREATE TABLE IF NOT EXISTS electronic_events (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id),
        event_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`INSERT INTO electronic_events (id, invoice_id, event_type, status, detail) VALUES (${`event-${crypto.randomUUID()}`}, ${id}, 'pdf_downloaded', ${String(rawInvoice.haciendaStatus)}, '')`;
    }
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filenameBase}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo generar el PDF.";
    return Response.json({ error: message }, { status: 500 });
  }
}
