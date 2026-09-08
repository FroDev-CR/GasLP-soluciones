import "server-only";
import { InvoiceEmailError, type InvoiceMailMessage } from "./invoice-email";

function resendApiKey() {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) throw new InvoiceEmailError("Falta RESEND_API_KEY en las variables del servidor. Créala en Resend y guárdala en Coolify.", 503);
  return key;
}

export async function verifyResendSender(senderEmail: string) {
  const domain = senderEmail.split("@")[1]?.toLowerCase();
  if (!domain) throw new InvoiceEmailError("RESEND_FROM_EMAIL no contiene un dominio válido.", 503);
  const response = await fetch("https://api.resend.com/domains", {
    headers: { authorization: `Bearer ${resendApiKey()}` },
    signal: AbortSignal.timeout(15_000),
  });
  let result: { data?: Array<{ name?: string; status?: string }>; message?: string } = {};
  try { result = await response.json() as typeof result; } catch { /* handled below */ }
  if (!response.ok) throw new InvoiceEmailError(typeof result.message === "string" ? result.message.slice(0, 500) : "No se pudo consultar los dominios de Resend.", 502);
  const match = (result.data || []).find((item) => String(item.name || "").toLowerCase() === domain && String(item.status || "").toLowerCase() === "verified");
  if (!match) throw new InvoiceEmailError(`El dominio ${domain} aún no está verificado en Resend. Verifícalo en Resend y espera a que sus DNS estén activos.`, 409);
}

function resendFrom(message: InvoiceMailMessage) {
  const address = String(process.env.RESEND_FROM_EMAIL || message.from.address).trim();
  const name = String(process.env.RESEND_FROM_NAME || message.from.name).replace(/[\r\n\x00-\x1f]/g, " ").trim();
  if (!address || !name) throw new InvoiceEmailError("Configura RESEND_FROM_EMAIL y RESEND_FROM_NAME en el servidor.", 503);
  return `${name} <${address}>`;
}

export async function sendResend(message: InvoiceMailMessage) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${resendApiKey()}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: resendFrom(message),
      to: [message.to],
      subject: message.subject,
      text: message.text,
      headers: { "Message-ID": message.messageId },
      attachments: message.attachments.map((file) => ({
        filename: file.filename,
        content: Buffer.from(file.content).toString("base64"),
      })),
    }),
    signal: AbortSignal.timeout(30_000),
  });

  let result: { id?: string; message?: string; name?: string } = {};
  try { result = await response.json() as typeof result; } catch { /* handled below */ }
  if (!response.ok) {
    const detail = typeof result.message === "string" ? result.message : "Resend rechazó el correo.";
    throw new InvoiceEmailError(detail.slice(0, 500), response.status >= 400 && response.status < 500 ? 409 : 502);
  }
  if (!result.id) throw new InvoiceEmailError("Resend no devolvió un identificador de envío. Revisa el panel de Resend antes de reenviar.", 502);
}
