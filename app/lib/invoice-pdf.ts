import "server-only";

import { existsSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export type PdfSettings = {
  businessName: string;
  taxpayerName: string;
  tradeName: string;
  taxpayerIdentificationType: string;
  taxpayerIdentificationNumber: string;
  businessAddress: string;
  businessPhone: string;
  invoiceEmail: string;
};

const fallbackSettings: PdfSettings = {
  businessName: "GAS LP SOLUCIONES",
  taxpayerName: "",
  tradeName: "GAS LP SOLUCIONES",
  taxpayerIdentificationType: "01",
  taxpayerIdentificationNumber: "",
  businessAddress: "",
  businessPhone: "",
  invoiceEmail: "",
};

/**
 * La fila de business_settings solo existe después de guardar Ajustes, así que
 * el documento se arma con valores por defecto en lugar de fallar.
 */
export function toPdfSettings(row: Record<string, unknown> | undefined): PdfSettings {
  const settings = { ...fallbackSettings };
  for (const key of Object.keys(fallbackSettings) as Array<keyof PdfSettings>) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) settings[key] = value;
  }
  return settings;
}

type PdfLine = {
  description: string;
  quantity: number;
  unitPriceCents: number;
  cabysCode: string;
  unitCode: string;
  taxRate: number;
  taxRateCode: string;
  taxCents: number;
  totalCents: number;
};

export type PdfInvoice = {
  id: string;
  documentType: string;
  invoiceNumber: string;
  issueDate: string;
  clientName: string;
  clientIdentificationType: string;
  clientIdentificationNumber: string;
  clientEmail: string;
  clientAddress: string;
  observations: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  saleCondition: string;
  creditTerm: string;
  paymentMethod: string;
  haciendaKey: string;
  haciendaConsecutive: string;
  haciendaStatus: string;
  haciendaEnvironment: string;
  haciendaEmissionDate: string;
  referenceKey: string;
  referenceReason: string;
  lines: PdfLine[];
};

const colors = {
  navy: "#073B72",
  deep: "#052B55",
  blue: "#DDEEFF",
  pale: "#F4F8FC",
  orange: "#FF7A00",
  ink: "#12243A",
  muted: "#5D6C7D",
  line: "#C8D6E5",
  green: "#14804A",
  red: "#B42318",
};

const identificationLabels: Record<string, string> = {
  "01": "Cédula física",
  "02": "Cédula jurídica",
  "03": "DIMEX",
  "04": "NITE",
  "05": "Extranjero no domiciliado",
};

const paymentLabels: Record<string, string> = {
  "01": "Efectivo",
  "02": "Tarjeta",
  "03": "Cheque",
  "04": "Transferencia / depósito",
  "05": "Recaudado por terceros",
  "06": "SINPE Móvil",
  "07": "Plataforma digital",
  "99": "Otro",
};

const taxLabels: Record<string, string> = {
  "01": "0%",
  "02": "1%",
  "03": "2%",
  "04": "4%",
  "08": "13%",
  "09": "0,5%",
  "10": "Exento",
  "11": "No sujeto",
};

function crcAmount(cents: number) {
  return new Intl.NumberFormat("es-CR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function crc(cents: number) {
  return `CRC ${crcAmount(cents)}`;
}

function documentTitle(type: string) {
  if (type === "FE") return "FACTURA ELECTRÓNICA";
  if (type === "TE") return "TIQUETE ELECTRÓNICO";
  if (type === "NC") return "NOTA DE CRÉDITO ELECTRÓNICA";
  return "DOCUMENTO COMERCIAL";
}

function displayDate(invoice: PdfInvoice) {
  if (invoice.haciendaEmissionDate) {
    return new Intl.DateTimeFormat("es-CR", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Costa_Rica",
    }).format(new Date(invoice.haciendaEmissionDate));
  }
  return invoice.issueDate;
}

function buildDocument(
  invoice: PdfInvoice,
  settings: PdfSettings,
  qrBuffer: Buffer | null,
): Promise<Buffer> {
  const isElectronic = invoice.documentType !== "commercial";
  const isSandbox = invoice.haciendaEnvironment === "sandbox";
  const doc = new PDFDocument({
    size: "A4",
    margin: 36,
    bufferPages: true,
    info: {
      Title: `${documentTitle(invoice.documentType)} ${invoice.haciendaKey || invoice.invoiceNumber}`,
      Author: settings.taxpayerName || settings.businessName,
      Subject: isElectronic ? "Representación gráfica de comprobante electrónico" : "Documento comercial",
    },
  });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = 36;
  const width = 523;
  const bottomLimit = 760;
  let y = 36;

  const drawWatermark = () => {
    if (!isSandbox) return;
    doc.save();
    doc.fillColor(colors.red).opacity(0.07);
    doc.font("Helvetica-Bold").fontSize(50);
    doc.rotate(-32, { origin: [297, 421] });
    doc.text("PRUEBA - SIN VALIDEZ", 65, 390, { width: 520, align: "center" });
    doc.restore();
    doc.opacity(1);
  };

  const addPage = (continuation = false) => {
    if (continuation) doc.addPage();
    drawWatermark();
    if (continuation) {
      doc.fillColor(colors.deep).font("Helvetica-Bold").fontSize(12)
        .text(`${documentTitle(invoice.documentType)} - continuación`, left, 34);
      doc.strokeColor(colors.orange).lineWidth(2).moveTo(left, 54).lineTo(left + width, 54).stroke();
      y = 68;
    }
  };

  const ensureSpace = (height: number) => {
    if (y + height <= bottomLimit) return;
    addPage(true);
  };

  addPage();

  const logoPath = join(process.cwd(), "public", "gas-lp-logo.png");
  if (existsSync(logoPath)) {
    doc.image(logoPath, left, y, { fit: [70, 70], align: "center", valign: "center" });
  }
  doc.fillColor(colors.deep).font("Helvetica-Bold").fontSize(17)
    .text(settings.tradeName || settings.businessName || "GAS LP SOLUCIONES", left + 80, y + 4, { width: 260 });
  doc.fillColor(colors.muted).font("Helvetica").fontSize(8.5)
    .text(settings.taxpayerName || "", left + 80, y + 27, { width: 260 })
    .text(`${identificationLabels[settings.taxpayerIdentificationType] || "Identificación"}: ${settings.taxpayerIdentificationNumber}`, left + 80, y + 39, { width: 260 })
    .text(settings.invoiceEmail || "", left + 80, y + 51, { width: 260 });

  const boxX = left + 347;
  const identifierBoxHeight = invoice.haciendaKey ? 102 : 78;
  doc.roundedRect(boxX, y, 176, identifierBoxHeight, 8).fill(colors.deep);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(9)
    .text(documentTitle(invoice.documentType), boxX + 10, y + 8, { width: 156, align: "right" });
  doc.font("Helvetica").fontSize(7.4)
    .text(
      isElectronic
        ? invoice.haciendaConsecutive || invoice.invoiceNumber || "BORRADOR"
        : `Consecutivo ${invoice.invoiceNumber || "BORRADOR"}`,
      boxX + 10,
      y + 25,
      { width: 156, align: "right" },
    )
    .text(displayDate(invoice), boxX + 10, y + 43, { width: 156, align: "right" });
  if (invoice.haciendaKey) {
    const keyLines = invoice.haciendaKey.match(/.{1,25}/g)?.join("\n") || invoice.haciendaKey;
    doc.font("Helvetica-Bold").fontSize(5.8).text("CLAVE NUMÉRICA", boxX + 10, y + 62, { width: 156, align: "right" });
    doc.font("Courier").fontSize(5.4).text(keyLines, boxX + 10, y + 73, {
      width: 156,
      align: "right",
      lineGap: 0,
    });
  }
  y += identifierBoxHeight + 13;

  doc.strokeColor(colors.orange).lineWidth(3).moveTo(left, y).lineTo(left + width, y).stroke();
  y += 13;

  if (!isElectronic) {
    doc.roundedRect(left, y, width, 28, 6).fill("#FFF3E8");
    doc.fillColor(colors.red).font("Helvetica-Bold").fontSize(8.5)
      .text("DOCUMENTO COMERCIAL - NO ES UN COMPROBANTE ELECTRÓNICO", left + 10, y + 9, {
        width: width - 20,
        align: "center",
      });
    y += 39;
  } else {
    const accepted = invoice.haciendaStatus === "aceptado";
    doc.roundedRect(left, y, width, 28, 6).fill(accepted ? "#E7F7EF" : "#FFF3E8");
    doc.fillColor(accepted ? colors.green : colors.red).font("Helvetica-Bold").fontSize(8.5)
      .text(
        isSandbox
          ? `AMBIENTE DE PRUEBAS - ${invoice.haciendaStatus.toUpperCase()} - SIN VALIDEZ FISCAL`
          : `ESTADO HACIENDA: ${invoice.haciendaStatus.toUpperCase()}`,
        left + 10,
        y + 9,
        { width: width - 20, align: "center" },
      );
    y += 39;
  }

  const cardGap = 10;
  const cardWidth = (width - cardGap) / 2;
  const receptorIdentification = invoice.clientIdentificationNumber
    ? `${identificationLabels[invoice.clientIdentificationType] || "Identificación"}: ${invoice.clientIdentificationNumber}`
    : "Sin identificación";
  const issuerLines = [
    settings.businessAddress,
    settings.businessPhone ? `Teléfono: ${settings.businessPhone}` : "",
  ].filter(Boolean);
  const receiverLines = [
    receptorIdentification,
    invoice.clientEmail,
    invoice.clientAddress,
  ].filter(Boolean);
  const issuerHeight = Math.max(70, 38 + issuerLines.length * 11);
  const receiverHeight = Math.max(70, 38 + receiverLines.length * 11);
  const cardsHeight = Math.max(issuerHeight, receiverHeight);

  doc.roundedRect(left, y, cardWidth, cardsHeight, 7).fill(colors.pale);
  doc.roundedRect(left + cardWidth + cardGap, y, cardWidth, cardsHeight, 7).fill(colors.blue);
  doc.fillColor(colors.navy).font("Helvetica-Bold").fontSize(7)
    .text("EMISOR", left + 10, y + 10)
    .text("RECEPTOR", left + cardWidth + cardGap + 10, y + 10);
  doc.fillColor(colors.ink).font("Helvetica-Bold").fontSize(10)
    .text(settings.taxpayerName || settings.businessName, left + 10, y + 23, { width: cardWidth - 20 })
    .text(invoice.clientName, left + cardWidth + cardGap + 10, y + 23, { width: cardWidth - 20 });
  doc.fillColor(colors.muted).font("Helvetica").fontSize(7.4);
  issuerLines.forEach((line, index) => doc.text(line, left + 10, y + 39 + index * 11, { width: cardWidth - 20 }));
  receiverLines.forEach((line, index) => doc.text(line, left + cardWidth + cardGap + 10, y + 39 + index * 11, { width: cardWidth - 20 }));
  y += cardsHeight + 15;

  if (invoice.referenceKey) {
    doc.fillColor(colors.navy).font("Helvetica-Bold").fontSize(7).text("DOCUMENTO DE REFERENCIA", left, y);
    doc.fillColor(colors.ink).font("Courier").fontSize(7).text(invoice.referenceKey, left, y + 11, { width });
    doc.fillColor(colors.muted).font("Helvetica").fontSize(7.2).text(invoice.referenceReason, left, y + 22, { width });
    y += 42;
  }
  if (isElectronic) {
    const condition = invoice.saleCondition === "02"
      ? `Crédito${invoice.creditTerm ? ` · ${invoice.creditTerm} días` : ""}`
      : "Contado";
    doc.fillColor(colors.navy).font("Helvetica-Bold").fontSize(7)
      .text("CONDICIÓN DE VENTA", left, y, { width: 110 })
      .text("MEDIO DE PAGO", left + 190, y, { width: 110 });
    doc.fillColor(colors.ink).font("Helvetica").fontSize(7.5)
      .text(condition, left, y + 11, { width: 175 })
      .text(paymentLabels[invoice.paymentMethod] || invoice.paymentMethod || "No indicado", left + 190, y + 11, { width: width - 190 });
    y += 32;
  }

  const columns = [
    { label: "CANT.", x: left, width: 31, align: "center" as const },
    { label: "DESCRIPCIÓN", x: left + 31, width: 185, align: "left" as const },
    { label: "CABYS", x: left + 216, width: 84, align: "center" as const },
    { label: "UND.", x: left + 300, width: 38, align: "center" as const },
    { label: "PRECIO CRC", x: left + 338, width: 64, align: "right" as const },
    { label: "IVA", x: left + 402, width: 42, align: "center" as const },
    { label: "TOTAL CRC", x: left + 444, width: 79, align: "right" as const },
  ];
  const drawTableHeader = () => {
    doc.rect(left, y, width, 24).fill(colors.navy);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(6.8);
    columns.forEach((column) => doc.text(column.label, column.x + 4, y + 8, {
      width: column.width - 8,
      align: column.align,
    }));
    y += 24;
  };
  drawTableHeader();

  invoice.lines.forEach((line, index) => {
    const descriptionHeight = doc.font("Helvetica").fontSize(7.4)
      .heightOfString(line.description, { width: columns[1].width - 10 });
    const rowHeight = Math.max(31, descriptionHeight + 14);
    if (y + rowHeight > bottomLimit) {
      addPage(true);
      drawTableHeader();
    }
    if (index % 2 === 0) doc.rect(left, y, width, rowHeight).fill("#F8FAFD");
    doc.strokeColor(colors.line).lineWidth(0.4).rect(left, y, width, rowHeight).stroke();
    doc.fillColor(colors.ink).font("Helvetica").fontSize(7.4);
    const values = [
      String(line.quantity),
      line.description,
      line.cabysCode || "—",
      line.unitCode || "—",
      crcAmount(line.unitPriceCents),
      taxLabels[line.taxRateCode] || `${line.taxRate}%`,
      crcAmount(line.totalCents),
    ];
    columns.forEach((column, columnIndex) => {
      doc.text(values[columnIndex], column.x + 5, y + 8, {
        width: column.width - 10,
        align: column.align,
      });
    });
    y += rowHeight;
  });
  y += 15;

  ensureSpace(150);
  const summaryX = left + 310;
  const summaryWidth = 213;
  const observationsWidth = 295;
  const notes = invoice.observations || "Precios expresados en colones costarricenses.";
  const notesHeight = Math.max(92, doc.font("Helvetica").fontSize(7.5).heightOfString(notes, { width: observationsWidth - 20 }) + 36);
  doc.roundedRect(left, y, observationsWidth, notesHeight, 7).fill(colors.pale);
  doc.fillColor(colors.navy).font("Helvetica-Bold").fontSize(7).text("OBSERVACIONES", left + 10, y + 10);
  doc.fillColor(colors.muted).font("Helvetica").fontSize(7.5).text(notes, left + 10, y + 26, {
    width: observationsWidth - 20,
  });

  doc.roundedRect(summaryX, y, summaryWidth, notesHeight, 7).fill(colors.deep);
  const summaryRows = [
    ["Subtotal", crc(invoice.subtotalCents)],
    ["IVA", crc(invoice.taxCents)],
    ["TOTAL", crc(invoice.totalCents)],
  ];
  summaryRows.forEach(([label, amount], index) => {
    const rowY = y + 13 + index * 24;
    doc.fillColor(index === 2 ? colors.orange : "#DDE9F7")
      .font(index === 2 ? "Helvetica-Bold" : "Helvetica")
      .fontSize(index === 2 ? 9 : 7.5)
      .text(label, summaryX + 12, rowY, { width: 70 });
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(index === 2 ? 11 : 8)
      .text(amount, summaryX + 82, rowY - 1, { width: summaryWidth - 94, align: "right" });
    if (index < 2) {
      doc.strokeColor("#37638F").lineWidth(0.5)
        .moveTo(summaryX + 12, rowY + 16)
        .lineTo(summaryX + summaryWidth - 12, rowY + 16)
        .stroke();
    }
  });
  y += notesHeight + 18;

  if (isElectronic && qrBuffer) {
    ensureSpace(76);
    y = Math.max(y, 675);
    const qrSize = 76;
    doc.image(qrBuffer, left + width - qrSize, y, { width: qrSize, height: qrSize });
    doc.fillColor(colors.navy).font("Helvetica-Bold").fontSize(8)
      .text("Código QR del comprobante", left, y + 8, { width: width - qrSize - 12 });
    doc.fillColor(colors.muted).font("Helvetica").fontSize(7.2)
      .text("El código contiene la clave numérica utilizada para consultar e identificar este comprobante electrónico.", left, y + 24, {
        width: width - qrSize - 12,
      });
    y += qrSize + 8;
  }

  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(index);
    doc.strokeColor(colors.line).lineWidth(0.5).moveTo(left, 788).lineTo(left + width, 788).stroke();
    doc.fillColor(colors.muted).font("Helvetica").fontSize(6.5)
      .text(
        isElectronic
          ? "Representación gráfica del comprobante electrónico v4.4"
          : "Documento comercial sin validez como comprobante electrónico",
        left,
        796,
        { width: 400, lineBreak: false },
      )
      .text(`Página ${index + 1} de ${range.count}`, left + 420, 796, { width: 103, align: "right", lineBreak: false });
  }

  doc.end();
  return result;
}

export async function generateInvoicePdf(invoice: PdfInvoice, settings: PdfSettings) {
  const qrBuffer = invoice.haciendaKey
    ? await QRCode.toBuffer(invoice.haciendaKey, {
      type: "png",
      width: 360,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: colors.deep, light: "#FFFFFF" },
    })
    : null;
  return buildDocument(invoice, settings, qrBuffer);
}
