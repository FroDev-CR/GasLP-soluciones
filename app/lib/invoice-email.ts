import type { InvoiceOutputFormat } from "./invoice-delivery";

export const defaultInvoiceSender = "garitafernandez4@gmail.com";
export type EmailSettings = {
  senderEmail: string;
  senderName: string;
  format: InvoiceOutputFormat;
  enabled: boolean;
  hasPassword: boolean;
  verifiedAt: string | null;
  lastTestAt: string | null;
  version: number;
};
export type EmailDeliveryState = "preparing" | "sending" | "submitted" | "failed" | "uncertain";
export type EmailDelivery = {
  attemptId: string;
  state: EmailDeliveryState;
  recipient: string;
  sender: string;
  message: string;
  messageId: string;
  attempts: number;
  updatedAt: string;
  submittedAt: string | null;
};
export type InvoiceMailMessage = {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  messageId: string;
  attachments: Array<{ filename: string; content: Uint8Array; contentType: string }>;
};

export class InvoiceEmailError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "InvoiceEmailError";
    this.status = status;
  }
}

export function emailAddress(value: unknown) {
  const email = typeof value === "string" ? value.trim() : "";
  if (email.length > 254 || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email)) {
    throw new InvoiceEmailError("Escribe una sola dirección de correo válida, sin nombres ni destinatarios adicionales.");
  }
  return email;
}

export function emailSettingsInput(payload: Record<string, unknown>) {
  const senderEmail = emailAddress(payload.senderEmail).toLowerCase();
  const senderName = String(payload.senderName ?? "").trim();
  if (!senderName || senderName.length > 120 || /[\r\n\x00-\x1f]/.test(senderName)) {
    throw new InvoiceEmailError("El nombre del remitente debe tener entre 1 y 120 caracteres, en una sola línea.");
  }
  const format = payload.format;
  if (format !== "letter" && format !== "ticket58" && format !== "ticket80") {
    throw new InvoiceEmailError("Selecciona PDF carta o ticket de 58/80 mm.");
  }
  const appPassword = String(payload.appPassword ?? "").replace(/ /g, "");
  if (appPassword && !/^[a-zA-Z0-9]{16}$/.test(appPassword)) {
    throw new InvoiceEmailError("Utiliza la contraseña de aplicación de Google de 16 caracteres, no tu contraseña habitual.");
  }
  return { senderEmail, senderName, format, appPassword };
}

export function assertMailReady(settings: EmailSettings) {
  if (!settings.hasPassword || !settings.verifiedAt) {
    throw new InvoiceEmailError("Guarda la contraseña de aplicación y verifica la conexión en Ajustes > Correo.", 409);
  }
}

export function deliveryState(delivery: EmailDelivery, now = Date.now()): EmailDeliveryState {
  if (now - new Date(delivery.updatedAt).getTime() > 5 * 60_000) {
    if (delivery.state === "sending") return "uncertain";
    if (delivery.state === "preparing") return "failed";
  }
  return delivery.state;
}

export function canRetryEmail(delivery: EmailDelivery, confirmResend: boolean, now = Date.now()) {
  const state = deliveryState(delivery, now);
  return state === "failed" || (confirmResend && (state === "submitted" || state === "uncertain"));
}

export function smtpFailure(error: unknown, sending = false): { state: "failed" | "uncertain"; message: string } {
  const details = error as { code?: string; responseCode?: number } | null;
  if (error instanceof InvoiceEmailError) return { state: "failed", message: error.message };
  if (details?.code === "EAUTH") return { state: "failed", message: "Gmail rechazó las credenciales. Revisa la contraseña de aplicación en Ajustes > Correo." };
  if (Number(details?.responseCode) >= 400 && Number(details?.responseCode) < 600) {
    return { state: "failed", message: "Gmail rechazó el envío. Revisa destinatario, límites de envío y avisos de seguridad en tu cuenta antes de reintentar." };
  }
  return sending
    ? { state: "uncertain", message: "No se pudo confirmar si Gmail aceptó el correo. Revisa Enviados y los rebotes antes de reenviar para evitar duplicados." }
    : { state: "failed", message: "No se pudo preparar el correo o conectar con Gmail. No se envió ningún mensaje. Revisa la configuración y vuelve a intentarlo." };
}

/** Solo datos originales del comprobante: nunca adjuntos recibidos del navegador. */
export function invoiceEmailMessage(input: {
  settings: EmailSettings;
  invoice: { documentType: string; haciendaEnvironment: string; haciendaStatus: string; haciendaKey: string; haciendaConsecutive: string; clientName: string; clientEmail: string };
  signedReceiverEmail?: string;
  pdf: Uint8Array;
  signedXml: Uint8Array;
  responseXml: Uint8Array;
  attemptId: string;
}): InvoiceMailMessage {
  const { settings, invoice } = input;
  if (!["FE", "TE", "NC"].includes(invoice.documentType) || invoice.haciendaStatus !== "aceptado" || invoice.haciendaEnvironment !== "production") {
    throw new InvoiceEmailError("Solo se envían por correo comprobantes aceptados de producción. No se envían borradores, documentos comerciales ni facturas de sandbox.", 409);
  }
  if (!/^\d{50}$/.test(invoice.haciendaKey)) throw new InvoiceEmailError("La factura no tiene una clave fiscal válida.", 409);
  const saved = invoice.clientEmail.trim();
  const signed = input.signedReceiverEmail?.trim() || "";
  if (saved && signed && saved.toLowerCase() !== signed.toLowerCase()) {
    throw new InvoiceEmailError("El correo guardado y el receptor del XML no coinciden. Revisa la factura antes de enviarla.", 409);
  }
  const recipient = emailAddress(signed || saved);
  const sender = emailAddress(settings.senderEmail);
  if (!input.pdf.length || !input.signedXml.length || !input.responseXml.length || new TextDecoder().decode(input.pdf.slice(0, 5)) !== "%PDF-") {
    throw new InvoiceEmailError("Falta un adjunto válido. Se necesitan el PDF y ambos XML; no se envió el correo.", 409);
  }
  if (input.pdf.length + input.signedXml.length + input.responseXml.length > 15 * 1024 * 1024) {
    throw new InvoiceEmailError("El paquete excede el límite de 15 MB para envío automático. Descárgalo y compártelo manualmente.", 409);
  }
  const clean = (text: string) => text.replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 200);
  const label = invoice.documentType === "NC" ? "Nota de crédito electrónica" : invoice.documentType === "TE" ? "Tiquete electrónico" : "Factura electrónica";
  const number = clean(invoice.haciendaConsecutive || invoice.haciendaKey);
  const suffix = settings.format === "letter" ? "carta" : settings.format === "ticket58" ? "ticket_58mm" : "ticket_80mm";
  return {
    from: { name: clean(settings.senderName), address: sender },
    to: recipient,
    subject: `${label} ${number} · ${clean(settings.senderName)}`,
    text: `Hola ${clean(invoice.clientName)},\n\nAdjuntamos su ${label.toLowerCase()} ${number}, aceptada por Hacienda.\n\nIncluye el PDF, el XML firmado del comprobante y la respuesta XML de aceptación de Hacienda.\nClave: ${invoice.haciendaKey}\n\nGracias por su preferencia.\n${clean(settings.senderName)}`,
    messageId: `<invoice-${input.attemptId}@${sender.split("@")[1]}>`,
    attachments: [
      { filename: `${invoice.haciendaKey}_${suffix}.pdf`, content: input.pdf, contentType: "application/pdf" },
      { filename: `${invoice.haciendaKey}.xml`, content: input.signedXml, contentType: "application/xml" },
      { filename: `${invoice.haciendaKey}_respuesta.xml`, content: input.responseXml, contentType: "application/xml" },
    ],
  };
}

export type EmailSendOptions = { automatic: boolean; expectedAttemptId?: string; confirmResend?: boolean };
export type EmailDeliveryDependencies = {
  settings: () => Promise<EmailSettings>;
  claim: (attemptId: string, options: EmailSendOptions) => Promise<boolean>;
  prepare: (settings: EmailSettings, attemptId: string) => Promise<InvoiceMailMessage>;
  stillConfigured: (settings: EmailSettings, automatic: boolean) => Promise<boolean>;
  markSending: (attemptId: string, message: InvoiceMailMessage) => Promise<void>;
  send: (message: InvoiceMailMessage, settings: EmailSettings) => Promise<void>;
  finish: (attemptId: string, state: EmailDeliveryState, message: string) => Promise<void>;
  current: () => Promise<EmailDelivery | null>;
};

/** Un único intento automático; SMTP no ofrece idempotencia de entrega. */
export async function deliverInvoiceEmail(options: EmailSendOptions, dependencies: EmailDeliveryDependencies) {
  const settings = await dependencies.settings();
  if (options.automatic && !settings.enabled) return null;
  assertMailReady(settings);
  const attemptId = crypto.randomUUID();
  if (!await dependencies.claim(attemptId, options)) return dependencies.current();
  let stage: "preparing" | "sending" | "submitted" = "preparing";
  try {
    const message = await dependencies.prepare(settings, attemptId);
    if (!await dependencies.stillConfigured(settings, options.automatic)) {
      throw new InvoiceEmailError("La configuración del correo cambió. Revisa Ajustes > Correo antes de volver a enviar.", 409);
    }
    await dependencies.markSending(attemptId, message);
    stage = "sending";
    await dependencies.send(message, settings);
    stage = "submitted";
    await dependencies.finish(attemptId, "submitted", "Aceptado por Gmail para su envío. Esto no confirma la entrega final ni la lectura; revisa los rebotes en la cuenta remitente.");
  } catch (error) {
    const failure = stage === "submitted"
      ? { state: "uncertain" as const, message: "Gmail aceptó el correo, pero no se pudo guardar la confirmación. Revisa Enviados antes de reenviar." }
      : smtpFailure(error, stage === "sending");
    await dependencies.finish(attemptId, failure.state, failure.message);
  }
  return dependencies.current();
}
