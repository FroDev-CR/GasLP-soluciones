import "server-only";
import nodemailer from "nodemailer";
import { InvoiceEmailError, type InvoiceMailMessage } from "./invoice-email";

export function gmailTransport(senderEmail: string, password: string) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: senderEmail, pass: password },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000, dnsTimeout: 10_000,
    disableFileAccess: true, disableUrlAccess: true,
    logger: false, debug: false,
  });
}

export async function sendGmail(message: InvoiceMailMessage, password: string) {
  const transport = gmailTransport(message.from.address, password);
  try {
    const info = await transport.sendMail({
      ...message,
      attachments: message.attachments.map((file) => ({ ...file, content: Buffer.from(file.content) })),
      disableFileAccess: true, disableUrlAccess: true,
    });
    if (!info.accepted.some((address) => String(address).toLowerCase() === message.to.toLowerCase()) || info.rejected.length) {
      throw new InvoiceEmailError("Gmail no aceptó al destinatario. Revisa la dirección de correo.", 409);
    }
  } finally {
    transport.close();
  }
}
