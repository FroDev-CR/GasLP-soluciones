export function invoiceRequestFromCurrentMessage(message: string) {
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const asksForInvoice = /\b(factur\w*|tiquete\w*|comprobante\w*)\b/.test(normalized)
    && /\b(hac\w*|prepar\w*|cre\w*|emit\w*|copi\w*|necesit\w*|ocup\w*|quier\w*|dar\w*|pas\w*|igual\w*|mism\w*|datos)\b/.test(normalized);
  return {
    asksForInvoice,
    previousInvoiceRequested: asksForInvoice && /\b(ayer|anterior|pasada|ultima|mism\w*|igual\w*)\b/.test(normalized),
    documentTypeHint: /factura electronica/.test(normalized) ? "FE" as const
      : /tiquete electronico/.test(normalized) ? "TE" as const : "unspecified" as const,
  };
}
