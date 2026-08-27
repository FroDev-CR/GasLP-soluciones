import { neon } from "@neondatabase/serverless";
import {
  generateInvoicePdf,
  generateInvoiceTicketPdf,
  type TicketWidth,
} from "../../../../lib/invoice-pdf";
import { readInvoiceDocument } from "../../../../lib/invoice-document";
import { isAuthenticated, unauthorized } from "../../../../lib/session";

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
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthenticated())) return unauthorized();
  try {
    const { id } = await context.params;
    const sql = getSql();
    const document = await readInvoiceDocument(sql, id);
    if (!document) return Response.json({ error: "El documento no existe." }, { status: 404 });
    const { invoice, settings } = document;
    const isElectronic = invoice.documentType !== "commercial";
    if (isElectronic && invoice.haciendaStatus !== "aceptado") {
      return Response.json({ error: "El PDF fiscal se habilita cuando Hacienda acepta el comprobante." }, { status: 409 });
    }
    const searchParams = new URL(request.url).searchParams;
    const format = searchParams.get("format") === "ticket" ? "ticket" : "letter";
    const ticketWidth: TicketWidth = searchParams.get("width") === "58" ? 58 : 80;
    const pdf = format === "ticket"
      ? await generateInvoiceTicketPdf(invoice, settings, ticketWidth)
      : await generateInvoicePdf(invoice, settings);
    const filenameBase = isElectronic
      ? invoice.haciendaKey
      : safeFilename(invoice.invoiceNumber || invoice.id);
    const filenameSuffix = format === "ticket" ? `_ticket_${ticketWidth}mm` : "_carta";
    if (isElectronic) {
      await sql`CREATE TABLE IF NOT EXISTS electronic_events (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id),
        event_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`INSERT INTO electronic_events (id, invoice_id, event_type, status, detail) VALUES (${`event-${crypto.randomUUID()}`}, ${id}, 'pdf_downloaded', ${invoice.haciendaStatus}, ${format === "ticket" ? `ticket_${ticketWidth}mm` : "carta"})`;
    }
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filenameBase}${filenameSuffix}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo generar el PDF.";
    return Response.json({ error: message }, { status: 500 });
  }
}
