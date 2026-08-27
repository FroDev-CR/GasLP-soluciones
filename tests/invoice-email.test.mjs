import test from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { canRetryEmail, defaultInvoiceSender, deliverInvoiceEmail, deliveryState, emailAddress, emailSettingsInput, invoiceEmailMessage, InvoiceEmailError, smtpFailure } from "../app/lib/invoice-email.ts";
import { validateInvoiceXml } from "../app/lib/invoice-delivery.ts";

const settings = { senderEmail: "sender@gmail.com", senderName: "Negocio de prueba", format: "letter", enabled: true, hasPassword: true, verifiedAt: new Date().toISOString(), lastTestAt: null, version: 1 };
const key = `506${"0".repeat(47)}`;
const invoice = { documentType: "FE", haciendaEnvironment: "production", haciendaStatus: "aceptado", haciendaKey: key, haciendaConsecutive: "00100001010000000042", clientName: "Cliente ficticio", clientEmail: "client@example.com" };
const signedXml = Buffer.from(`<?xml version="1.0"?><FacturaElectronica xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><Clave>${key}</Clave><Receptor><CorreoElectronico>client@example.com</CorreoElectronico></Receptor><ds:Signature><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="fixture"/></ds:SignedInfo><ds:SignatureValue>dGVzdA==</ds:SignatureValue></ds:Signature></FacturaElectronica>`);
const responseXml = Buffer.from(`<?xml version="1.0"?><MensajeHacienda><Clave>${key}</Clave><Mensaje>1</Mensaje></MensajeHacienda>`);
const inputs = { settings, invoice, pdf: Buffer.from("%PDF-1.3\nfixture"), signedXml, responseXml, attemptId: "fictitious-attempt" };
const message = () => invoiceEmailMessage(inputs);

test("uses the requested default Gmail without a password or automatic activation", () => {
  assert.equal(defaultInvoiceSender, "garitafernandez4@gmail.com");
  const input = emailSettingsInput({ senderEmail: " NEW@GMAIL.COM ", senderName: "Negocio", format: "letter", appPassword: "abcd efgh ijkl mnop" });
  assert.equal(input.senderEmail, "new@gmail.com");
  assert.equal(input.appPassword, "abcdefghijklmnop");
  assert.equal("enabled" in input, false);
});

for (const address of ["", "bad", "a@example.com,b@example.com", "A <a@example.com>", "a@example.com\r\nBcc: b@example.com", ["a@example.com"]]) {
  test(`rejects invalid or multiple recipient: ${JSON.stringify(address)}`, () => assert.throws(() => emailAddress(address), InvoiceEmailError));
}

test("validates settings without accepting arbitrary SMTP options", () => {
  for (const change of [{ senderName: "A\r\nBcc:x" }, { format: "a4" }, { appPassword: "usual-password" }]) {
    assert.throws(() => emailSettingsInput({ ...settings, ...change }), InvoiceEmailError);
  }
  assert.equal("host" in emailSettingsInput({ ...settings, host: "127.0.0.1" }), false);
});

test("original XML validation exposes the saved receiver without reserializing", async () => {
  const root = await validateInvoiceXml(signedXml.toString(), "signed", invoice);
  assert.equal(root.Receptor.CorreoElectronico, invoice.clientEmail);
  await validateInvoiceXml(responseXml.toString(), "response", invoice);
});

for (const format of ["letter", "ticket58", "ticket80"]) {
  test(`mail contains PDF ${format} and both unchanged XML attachments`, () => {
    const mail = invoiceEmailMessage({ ...inputs, settings: { ...settings, format } });
    assert.equal(mail.attachments.length, 3);
    assert.equal(mail.to, invoice.clientEmail);
    assert.equal(mail.from.address, settings.senderEmail);
    assert.deepEqual(mail.attachments[1].content, signedXml);
    assert.deepEqual(mail.attachments[2].content, responseXml);
    assert.match(mail.attachments[0].filename, new RegExp(format === "letter" ? "_carta.pdf$" : `_${format.replace("ticket", "ticket_")}mm.pdf$`));
  });
}

for (const change of [{ haciendaEnvironment: "sandbox" }, { haciendaEnvironment: "" }, { documentType: "commercial" }, { haciendaStatus: "recibido" }, { haciendaStatus: "rechazado" }, { clientEmail: "" }, { haciendaKey: "wrong" }]) {
  test(`blocks non-sendable invoice ${JSON.stringify(change)}`, () => assert.throws(() => invoiceEmailMessage({ ...inputs, invoice: { ...invoice, ...change } }), InvoiceEmailError));
}

test("never changes the recipient using a live client directory or another XML", () => {
  assert.throws(() => invoiceEmailMessage({ ...inputs, signedReceiverEmail: "other@example.com" }), /no coinciden/);
  assert.equal(invoiceEmailMessage({ ...inputs, invoice: { ...invoice, clientEmail: "" }, signedReceiverEmail: "client@example.com" }).to, "client@example.com");
});

test("rejects missing, invalid or oversized attachments", () => {
  for (const change of [{ pdf: Buffer.from("<html>error</html>") }, { signedXml: Buffer.alloc(0) }, { responseXml: Buffer.alloc(0) }, { responseXml: Buffer.alloc(15 * 1024 * 1024) }]) {
    assert.throws(() => invoiceEmailMessage({ ...inputs, ...change }), InvoiceEmailError);
  }
});

test("compiles a real MIME email locally with all three attachments, without SMTP", async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows", disableFileAccess: true, disableUrlAccess: true });
  const result = await transport.sendMail(message());
  const mime = result.message.toString();
  assert.match(mime, /To: client@example.com/);
  assert.match(mime, /Content-Type: application\/pdf/);
  assert.equal((mime.match(/Content-Type: application\/xml/g) || []).length, 2);
  const collapsed = mime.replace(/\r?\n/g, "");
  assert.ok(collapsed.includes(signedXml.toString("base64")));
  assert.ok(collapsed.includes(responseXml.toString("base64")));
  assert.match(mime, /Message-ID: <invoice-fictitious-attempt@gmail.com>/i);
});

function fakeDependencies(overrides = {}) {
  let current = null;
  let sends = 0;
  const dependencies = {
    settings: async () => settings,
    claim: async (attemptId, options) => {
      if (current && (options.automatic || current.attemptId !== options.expectedAttemptId || !canRetryEmail(current, options.confirmResend))) return false;
      current = { attemptId, state: "preparing", recipient: "", sender: "", message: "", messageId: "", attempts: (current?.attempts || 0) + 1, updatedAt: new Date().toISOString(), submittedAt: null };
      return true;
    },
    prepare: async () => message(),
    stillConfigured: async () => true,
    markSending: async (_id, mail) => { Object.assign(current, { state: "sending", recipient: mail.to, sender: mail.from.address, messageId: mail.messageId }); },
    send: async () => { sends++; },
    finish: async (_id, state, message) => { Object.assign(current, { state, message }); },
    current: async () => current,
    ...overrides,
  };
  return { dependencies, getCurrent: () => current, count: () => sends };
}

test("disabled automatic mail does not claim, prepare or send", async () => {
  const fake = fakeDependencies({ settings: async () => ({ ...settings, enabled: false }) });
  assert.equal(await deliverInvoiceEmail({ automatic: true }, fake.dependencies), null);
  assert.equal(fake.getCurrent(), null);
  assert.equal(fake.count(), 0);
});

for (const change of [{ verifiedAt: null }, { hasPassword: false }]) {
  test(`unverified credentials block manual and automatic mail ${JSON.stringify(change)}`, async () => {
    const fake = fakeDependencies({ settings: async () => ({ ...settings, ...change }) });
    for (const automatic of [false, true]) await assert.rejects(deliverInvoiceEmail({ automatic }, fake.dependencies), InvoiceEmailError);
    assert.equal(fake.count(), 0);
  });
}

test("concurrent acceptance checks and repeated automatic calls send only once", async () => {
  const fake = fakeDependencies();
  await Promise.all(Array.from({ length: 10 }, () => deliverInvoiceEmail({ automatic: true }, fake.dependencies)));
  assert.equal(fake.count(), 1);
  assert.equal(fake.getCurrent().state, "submitted");
  assert.match(fake.getCurrent().message, /no confirma/);
});

test("missing XML fails before SMTP and is not automatically retried", async () => {
  const fake = fakeDependencies({ prepare: async () => { throw new InvoiceEmailError("Falta XML"); } });
  await deliverInvoiceEmail({ automatic: true }, fake.dependencies);
  await deliverInvoiceEmail({ automatic: true }, fake.dependencies);
  assert.equal(fake.getCurrent().state, "failed");
  assert.equal(fake.getCurrent().attempts, 1);
  assert.equal(fake.count(), 0);
});

test("a configuration change before sending cancels the attempt", async () => {
  const fake = fakeDependencies({ stillConfigured: async () => false });
  await deliverInvoiceEmail({ automatic: true }, fake.dependencies);
  assert.equal(fake.count(), 0);
  assert.equal(fake.getCurrent().state, "failed");
});

test("unknown SMTP results require explicit resend confirmation and a matching attempt", async () => {
  const fake = fakeDependencies({ send: async () => { throw new Error("secret smtp response"); } });
  await deliverInvoiceEmail({ automatic: true }, fake.dependencies);
  assert.equal(fake.getCurrent().state, "uncertain");
  assert.doesNotMatch(fake.getCurrent().message, /secret/);
  const attemptId = fake.getCurrent().attemptId;
  await deliverInvoiceEmail({ automatic: false, expectedAttemptId: attemptId }, fake.dependencies);
  assert.equal(fake.getCurrent().attempts, 1);
  await deliverInvoiceEmail({ automatic: false, expectedAttemptId: "stale", confirmResend: true }, fake.dependencies);
  assert.equal(fake.getCurrent().attempts, 1);
  await deliverInvoiceEmail({ automatic: false, expectedAttemptId: attemptId, confirmResend: true }, fake.dependencies);
  assert.equal(fake.getCurrent().attempts, 2);
});

test("a Gmail acceptance followed by a DB failure is marked uncertain, never auto resent", async () => {
  const fake = fakeDependencies();
  const finish = fake.dependencies.finish;
  fake.dependencies.finish = async (id, state, message) => {
    if (state === "submitted") throw new Error("database unavailable");
    return finish(id, state, message);
  };
  await deliverInvoiceEmail({ automatic: true }, fake.dependencies);
  assert.equal(fake.getCurrent().state, "uncertain");
  await deliverInvoiceEmail({ automatic: true }, fake.dependencies);
  assert.equal(fake.count(), 1);
});

test("interrupted preparing/sending attempts are classified conservatively", () => {
  const old = { state: "sending", updatedAt: new Date(Date.now() - 6 * 60_000).toISOString() };
  assert.equal(deliveryState(old), "uncertain");
  assert.equal(canRetryEmail(old, false), false);
  assert.equal(canRetryEmail(old, true), true);
  assert.equal(deliveryState({ ...old, state: "preparing" }), "failed");
  assert.equal(canRetryEmail({ ...old, updatedAt: new Date().toISOString() }, true), false);
});

test("SMTP failures expose safe messages without credentials", () => {
  const secret = "secret-password";
  for (const error of [{ code: "EAUTH", message: secret }, { responseCode: 550, message: secret }, new Error(secret)]) {
    assert.doesNotMatch(smtpFailure(error, true).message, /secret-password/);
  }
  assert.equal(smtpFailure({ responseCode: 550 }, true).state, "failed");
  assert.equal(smtpFailure(new Error("timeout"), true).state, "uncertain");
});
