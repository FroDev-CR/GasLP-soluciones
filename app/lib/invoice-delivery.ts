export type InvoiceOutputFormat = "letter" | "ticket80" | "ticket58";

export const invoiceOutputOptions: Record<InvoiceOutputFormat, {
  label: string;
  actionLabel: string;
  description: string;
  query: string;
  suffix: string;
}> = {
  letter: {
    label: "PDF carta · 8.5 × 11 pulg.",
    actionLabel: "PDF carta",
    description: "Para impresoras convencionales y archivo digital.",
    query: "",
    suffix: "_carta",
  },
  ticket80: {
    label: "Ticket térmico · 80 mm",
    actionLabel: "ticket 80 mm",
    description: "Para impresoras térmicas de rollo ancho.",
    query: "?format=ticket&width=80",
    suffix: "_ticket_80mm",
  },
  ticket58: {
    label: "Ticket térmico · 58 mm",
    actionLabel: "ticket 58 mm",
    description: "Para impresoras térmicas portátiles y compactas.",
    query: "?format=ticket&width=58",
    suffix: "_ticket_58mm",
  },
};

export function invoicePdfUrl(invoiceId: string, format: InvoiceOutputFormat) {
  return `/api/documents/${encodeURIComponent(invoiceId)}/pdf${invoiceOutputOptions[format].query}`;
}

export type DeliveryInvoice = {
  id: string;
  documentType: "commercial" | "FE" | "TE" | "NC";
  invoiceNumber: string;
  clientName: string;
  haciendaKey: string;
  haciendaConsecutive: string;
  haciendaStatus: string;
};

type AttachmentKind = "pdf" | "signed" | "response";

export type PreparedInvoiceDelivery = {
  attachments: Array<{ kind: AttachmentKind; label: string; file: File }>;
  archive: File | null;
  title: string;
  text: string;
};

export class InvoiceDeliveryError extends Error {
  readonly code: "session_expired" | "incomplete";

  constructor(message: string, code: "session_expired" | "incomplete" = "incomplete") {
    super(message);
    this.name = "InvoiceDeliveryError";
    this.code = code;
  }
}

const xmlRoots = { FE: "FacturaElectronica", TE: "TiqueteElectronico", NC: "NotaCreditoElectronica" };

async function checkXml(file: File, kind: "signed" | "response", invoice: DeliveryInvoice) {
  const { XMLParser, XMLValidator } = await import("fast-xml-parser");
  const text = await file.text();
  const label = kind === "signed" ? "XML firmado" : "XML de respuesta de Hacienda";
  if (XMLValidator.validate(text) !== true) {
    throw new InvoiceDeliveryError(`El ${label} no contiene un XML válido. No se preparó el envío.`);
  }
  const parsed = new XMLParser({
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: false,
  }).parse(text) as Record<string, unknown>;
  const expectedRoot = kind === "response" ? "MensajeHacienda" : xmlRoots[invoice.documentType as keyof typeof xmlRoots];
  const root = parsed[expectedRoot] as Record<string, unknown> | undefined;
  if (!root || String(root.Clave || "") !== invoice.haciendaKey) {
    throw new InvoiceDeliveryError(`El ${label} no corresponde a la clave de esta factura. No se preparó el envío.`);
  }
  if (kind === "signed") {
    const signature = root.Signature as Record<string, unknown> | undefined;
    if (!signature?.SignedInfo || !signature.SignatureValue) {
      throw new InvoiceDeliveryError("El XML del comprobante no contiene su firma. No se preparó el envío.");
    }
  } else if (String(root.Mensaje) !== "1") {
    throw new InvoiceDeliveryError("El XML de Hacienda no es una respuesta de aceptación. Consulta de nuevo el estado.");
  }
  // Solo se comprueba estructura y correspondencia; no se vuelve a firmar ni a
  // serializar. Los bytes originales del XML firmado se entregan sin cambios.
}

export async function prepareInvoiceDelivery(
  invoice: DeliveryInvoice,
  format: InvoiceOutputFormat,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<PreparedInvoiceDelivery> {
  const electronic = invoice.documentType !== "commercial";
  if (electronic && invoice.haciendaStatus !== "aceptado") {
    throw new InvoiceDeliveryError("Espera la aceptación de Hacienda antes de preparar el paquete fiscal para el cliente.");
  }
  if (electronic && !/^\d{50}$/.test(invoice.haciendaKey)) {
    throw new InvoiceDeliveryError("La factura no tiene una clave fiscal válida. Revisa su estado en Hacienda.");
  }
  const fetcher = options.fetcher ?? fetch;
  const base = electronic
    ? invoice.haciendaKey
    : invoice.invoiceNumber.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || "documento";
  const endpoint = `/api/documents/${encodeURIComponent(invoice.id)}`;
  const requests: Array<{ kind: AttachmentKind; label: string; url: string; filename: string; type: string }> = [
    { kind: "pdf", label: invoiceOutputOptions[format].label, url: invoicePdfUrl(invoice.id, format), filename: `${base}${invoiceOutputOptions[format].suffix}.pdf`, type: "application/pdf" },
  ];
  if (electronic) {
    requests.push(
      { kind: "signed", label: "XML firmado del comprobante", url: `${endpoint}/xml?kind=signed`, filename: `${base}.xml`, type: "application/xml" },
      { kind: "response", label: "XML de aceptación de Hacienda", url: `${endpoint}/xml?kind=response`, filename: `${base}_respuesta.xml`, type: "application/xml" },
    );
  }

  const attachments = await Promise.all(requests.map(async ({ kind, label, url, filename, type }) => {
    const response = await fetcher(url, { cache: "no-store", signal: options.signal });
    if (response.status === 401) {
      throw new InvoiceDeliveryError("La sesión expiró. Vuelve a iniciar sesión.", "session_expired");
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      const hint = kind === "response" ? " Usa «Consultar respuesta de Hacienda» y vuelve a preparar el paquete." : "";
      throw new InvoiceDeliveryError(`${label}: ${body.error || "no se pudo descargar el archivo"}.${hint} No se preparó el envío.`);
    }
    const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    const validType = kind === "pdf" ? contentType === type : [type, "text/xml"].includes(contentType);
    const blob = await response.blob();
    if (!validType || blob.size === 0) {
      throw new InvoiceDeliveryError(`${label}: el servidor no devolvió un archivo válido. No se preparó el envío.`);
    }
    const file = new File([blob], filename, { type });
    if (kind === "pdf") {
      if (await file.slice(0, 5).text() !== "%PDF-") {
        throw new InvoiceDeliveryError("El PDF no contiene un documento válido. No se preparó el envío.");
      }
    } else {
      await checkXml(file, kind, invoice);
    }
    return { kind, label, file };
  }));

  let archive: File | null = null;
  if (electronic) {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const { file } of attachments) zip.file(file.name, await file.arrayBuffer());
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    archive = new File([new Uint8Array(bytes)], `${base}_completo.zip`, { type: "application/zip" });
  }
  options.signal?.throwIfAborted();
  const title = `${invoice.documentType === "NC" ? "Nota de crédito" : electronic ? "Comprobante electrónico" : "Documento comercial"} ${invoice.haciendaConsecutive || invoice.invoiceNumber}`;
  return {
    attachments,
    archive,
    title,
    text: `${title}\nCliente: ${invoice.clientName}\n${electronic ? "Adjuntos: PDF, XML firmado y respuesta XML de Hacienda." : "Adjunto: PDF comercial. No es un comprobante electrónico ni incluye XML fiscal."}`,
  };
}

export function invoiceFilesToShare(
  delivery: PreparedInvoiceDelivery,
  platform: { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean },
): File[] | null {
  if (!platform.share || !platform.canShare) return null;
  const candidates = [delivery.attachments.map(({ file }) => file)];
  if (delivery.archive) candidates.push([delivery.archive]);
  for (const files of candidates) {
    try {
      if (platform.canShare({ files })) return files;
    } catch {
      // Algunos navegadores rechazan XML o ZIP. Nunca enviar solo el PDF en ese caso.
    }
  }
  return null;
}
