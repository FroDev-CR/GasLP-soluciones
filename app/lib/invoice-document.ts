import "server-only";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { toPdfSettings, type PdfInvoice } from "./invoice-pdf";

/** La descarga y el correo generan el mismo PDF, a partir del mismo registro. */
export async function readInvoiceDocument(sql: NeonQueryFunction<false, false>, id: string) {
  const [invoiceRows, lineRows, settingsRows] = await Promise.all([
    sql`SELECT id, document_type AS "documentType", invoice_number AS "invoiceNumber", issue_date AS "issueDate", client_name AS "clientName", client_identification_type AS "clientIdentificationType", client_identification_number AS "clientIdentificationNumber", client_email AS "clientEmail", client_address AS "clientAddress", observations, subtotal_cents AS "subtotalCents", tax_cents AS "taxCents", total_cents AS "totalCents", sale_condition AS "saleCondition", credit_term AS "creditTerm", payment_method AS "paymentMethod", hacienda_key AS "haciendaKey", hacienda_consecutive AS "haciendaConsecutive", hacienda_status AS "haciendaStatus", hacienda_environment AS "haciendaEnvironment", hacienda_emission_date AS "haciendaEmissionDate", reference_key AS "referenceKey", reference_reason AS "referenceReason" FROM invoices WHERE id = ${id} LIMIT 1`,
    sql`SELECT description, quantity, unit_price_cents AS "unitPriceCents", cabys_code AS "cabysCode", unit_code AS "unitCode", tax_rate AS "taxRate", tax_rate_code AS "taxRateCode", tax_cents AS "taxCents", total_cents AS "totalCents" FROM invoice_items WHERE invoice_id = ${id} ORDER BY id`,
    sql`SELECT business_name AS "businessName", taxpayer_name AS "taxpayerName", trade_name AS "tradeName", taxpayer_identification_type AS "taxpayerIdentificationType", taxpayer_identification_number AS "taxpayerIdentificationNumber", business_address AS "businessAddress", business_phone AS "businessPhone", invoice_email AS "invoiceEmail" FROM business_settings WHERE id = 'default' LIMIT 1`,
  ]);
  if (!invoiceRows[0]) return null;
  return {
    invoice: { ...invoiceRows[0], lines: lineRows } as unknown as PdfInvoice,
    settings: toPdfSettings(settingsRows[0] as Record<string, unknown> | undefined),
  };
}
