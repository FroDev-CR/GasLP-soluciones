import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  InvoiceDeliveryError,
  invoiceFilesToShare,
  invoicePdfUrl,
  prepareInvoiceDelivery,
} from "../app/lib/invoice-delivery.ts";

const key = `506${"0".repeat(47)}`;
const invoice = {
  id: "invoice/id",
  documentType: "FE",
  invoiceNumber: "FE-42",
  haciendaConsecutive: "00100001010000000042",
  haciendaKey: key,
  haciendaStatus: "aceptado",
  clientName: "Cliente de prueba",
};
const pdf = "%PDF-1.3\nFixture PDF bytes for attachment transport tests\n%%EOF";
const signedXml = (root = "FacturaElectronica", clave = key) => `<?xml version="1.0" encoding="utf-8"?>\r\n<${root} xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><Clave>${clave}</Clave><ds:Signature><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="fixture"/></ds:SignedInfo><ds:SignatureValue>dGVzdA==</ds:SignatureValue></ds:Signature></${root}>`;
const responseXml = (clave = key, message = "1") => `<?xml version="1.0" encoding="utf-8"?>\r\n<MensajeHacienda><Clave>${clave}</Clave><Mensaje>${message}</Mensaje></MensajeHacienda>`;

function mockFetch(overrides = {}, roots = "FacturaElectronica") {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    options?.signal?.throwIfAborted();
    const kind = url.includes("kind=signed") ? "signed" : url.includes("kind=response") ? "response" : "pdf";
    if (overrides[kind]) return overrides[kind]();
    return new Response(kind === "pdf" ? pdf : kind === "signed" ? signedXml(roots) : responseXml(), {
      headers: { "content-type": kind === "pdf" ? "application/pdf" : "application/xml; charset=utf-8" },
    });
  };
  return { fetcher, calls };
}

test("prepares PDF + signed XML + acceptance XML, preserving every byte in the ZIP", async () => {
  const { fetcher, calls } = mockFetch();
  const delivery = await prepareInvoiceDelivery(invoice, "letter", { fetcher });
  assert.deepEqual(calls.map(({ url }) => url), [
    "/api/documents/invoice%2Fid/pdf",
    "/api/documents/invoice%2Fid/xml?kind=signed",
    "/api/documents/invoice%2Fid/xml?kind=response",
  ]);
  assert.ok(calls.every(({ options }) => options.cache === "no-store"));
  assert.deepEqual(delivery.attachments.map(({ file }) => file.name), [
    `${key}_carta.pdf`, `${key}.xml`, `${key}_respuesta.xml`,
  ]);
  assert.equal(await delivery.attachments[1].file.text(), signedXml());
  assert.equal(await delivery.attachments[2].file.text(), responseXml());
  assert.equal(delivery.archive.name, `${key}_completo.zip`);
  const zip = await JSZip.loadAsync(await delivery.archive.arrayBuffer());
  assert.equal(Object.keys(zip.files).length, 3);
  assert.equal(await zip.file(`${key}.xml`).async("string"), signedXml());
  assert.equal(await zip.file(`${key}_respuesta.xml`).async("string"), responseXml());
  assert.equal(await zip.file(`${key}_carta.pdf`).async("string"), pdf);
});

for (const width of [58, 80]) {
  test(`keeps the ${width} mm ticket alongside both original XML files`, async () => {
    const format = `ticket${width}`;
    const { fetcher, calls } = mockFetch();
    const delivery = await prepareInvoiceDelivery(invoice, format, { fetcher });
    assert.equal(calls[0].url, `/api/documents/invoice%2Fid/pdf?format=ticket&width=${width}`);
    assert.equal(delivery.attachments[0].file.name, `${key}_ticket_${width}mm.pdf`);
    assert.equal(delivery.attachments.length, 3);
  });
}

for (const [type, root] of [["TE", "TiqueteElectronico"], ["NC", "NotaCreditoElectronica"]]) {
  test(`supports accepted ${type} documents with the matching XML root`, async () => {
    const { fetcher } = mockFetch({}, root);
    const delivery = await prepareInvoiceDelivery({ ...invoice, documentType: type }, "letter", { fetcher });
    assert.equal(delivery.attachments.length, 3);
  });
}

test("commercial documents share only their PDF and never fabricate fiscal XML", async () => {
  const { fetcher, calls } = mockFetch();
  const delivery = await prepareInvoiceDelivery({ ...invoice, documentType: "commercial", haciendaStatus: "", haciendaKey: "", invoiceNumber: "DOC/42" }, "letter", { fetcher });
  assert.equal(calls.length, 1);
  assert.equal(delivery.attachments[0].file.name, "DOC_42_carta.pdf");
  assert.equal(delivery.archive, null);
  assert.match(delivery.text, /No es un comprobante electrónico/);
});

for (const status of ["", "recibido", "procesando", "rechazado", "error"]) {
  test(`does not prepare a fiscal delivery in status ${status || "draft"}`, async () => {
    const { fetcher, calls } = mockFetch();
    await assert.rejects(prepareInvoiceDelivery({ ...invoice, haciendaStatus: status }, "letter", { fetcher }), /aceptación/);
    assert.equal(calls.length, 0);
  });
}

test("rejects a missing fiscal key before fetching attachments", async () => {
  const { fetcher, calls } = mockFetch();
  await assert.rejects(prepareInvoiceDelivery({ ...invoice, haciendaKey: "" }, "letter", { fetcher }), /clave fiscal/);
  assert.equal(calls.length, 0);
});

for (const kind of ["pdf", "signed", "response"]) {
  test(`a failed ${kind} download aborts the entire package`, async () => {
    const { fetcher } = mockFetch({ [kind]: () => Response.json({ error: "Archivo no disponible" }, { status: 409 }) });
    await assert.rejects(prepareInvoiceDelivery(invoice, "letter", { fetcher }), (error) => error instanceof InvoiceDeliveryError && /No se preparó el envío/.test(error.message));
  });
}

test("session expiration is reported explicitly instead of sharing only the PDF", async () => {
  const { fetcher } = mockFetch({ signed: () => Response.json({ error: "Unauthorized" }, { status: 401 }) });
  await assert.rejects(prepareInvoiceDelivery(invoice, "letter", { fetcher }), (error) => error.code === "session_expired");
});

for (const [name, kind, body, mime] of [
  ["HTML error returned as XML", "signed", "<html><p>Error</p></html>", "text/html"],
  ["malformed XML", "signed", "<FacturaElectronica>", "application/xml"],
  ["XML from another invoice", "signed", signedXml("FacturaElectronica", `506${"1".repeat(47)}`), "application/xml"],
  ["wrong document type", "signed", signedXml("TiqueteElectronico"), "application/xml"],
  ["unsigned invoice XML", "signed", `<FacturaElectronica><Clave>${key}</Clave></FacturaElectronica>`, "application/xml"],
  ["acceptance for another invoice", "response", responseXml(`506${"1".repeat(47)}`), "application/xml"],
  ["rejection XML", "response", responseXml(key, "3"), "application/xml"],
  ["empty PDF", "pdf", "", "application/pdf"],
  ["HTML disguised as a PDF", "pdf", "<html>Error</html>", "application/pdf"],
]) {
  test(`rejects ${name}`, async () => {
    const { fetcher } = mockFetch({ [kind]: () => new Response(body, { headers: { "content-type": mime } }) });
    await assert.rejects(prepareInvoiceDelivery(invoice, "letter", { fetcher }), InvoiceDeliveryError);
  });
}

test("passes the abort signal through every fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  const { fetcher } = mockFetch();
  await assert.rejects(prepareInvoiceDelivery(invoice, "letter", { fetcher, signal: controller.signal }), { name: "AbortError" });
});

test("native sharing always gets all attachments or the complete ZIP", async () => {
  const delivery = await prepareInvoiceDelivery(invoice, "letter", mockFetch());
  const share = async () => {};
  const complete = invoiceFilesToShare(delivery, { share, canShare: () => true });
  assert.deepEqual(complete, delivery.attachments.map(({ file }) => file));
  const zipOnly = invoiceFilesToShare(delivery, { share, canShare: ({ files }) => files.length === 1 && files[0].type === "application/zip" });
  assert.deepEqual(zipOnly, [delivery.archive]);
  const xmlThrows = invoiceFilesToShare(delivery, { share, canShare: ({ files }) => {
    if (files.some((file) => file.type === "application/xml")) throw new Error("XML unsupported");
    return files[0].type === "application/zip";
  } });
  assert.deepEqual(xmlThrows, [delivery.archive]);
  const pdfOnly = invoiceFilesToShare(delivery, { share, canShare: ({ files }) => files.every((file) => file.type === "application/pdf") });
  assert.equal(pdfOnly, null, "must never silently fall back to sharing only the PDF");
  assert.equal(invoiceFilesToShare(delivery, { share }), null);
  assert.equal(invoiceFilesToShare(delivery, {}), null);
  assert.equal(invoiceFilesToShare(delivery, { share, canShare: () => { throw new Error("unsupported"); } }), null);
});

test("encodes the invoice id in PDF URLs", () => {
  assert.equal(invoicePdfUrl("invoice/1?unsafe", "ticket58"), "/api/documents/invoice%2F1%3Funsafe/pdf?format=ticket&width=58");
});
