import test from "node:test";
import assert from "node:assert/strict";
import { invoiceRequestFromCurrentMessage } from "../app/lib/assistant-intent.ts";

test("a general app question remains help rather than an invoice request", () => {
  assert.equal(invoiceRequestFromCurrentMessage("Hola, ¿qué puedo hacer en esta aplicación?").asksForInvoice, false);
});

test("the spoken invoice request in production opens invoice preparation", () => {
  assert.deepEqual(invoiceRequestFromCurrentMessage("Si te doy los datos de una factura electrónica, ¿me ayudás a prepararla?"), {
    asksForInvoice: true,
    previousInvoiceRequested: false,
    documentTypeHint: "FE",
  });
});

test("copying yesterday's invoice requires selecting the actual prior document", () => {
  assert.deepEqual(invoiceRequestFromCurrentMessage("Puedes hacer una factura igual a la de ayer con los datos de hoy"), {
    asksForInvoice: true,
    previousInvoiceRequested: true,
    documentTypeHint: "unspecified",
  });
});
