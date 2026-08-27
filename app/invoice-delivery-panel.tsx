"use client";

import { useEffect, useRef, useState } from "react";
import {
  InvoiceDeliveryError,
  invoiceFilesToShare,
  prepareInvoiceDelivery,
  type DeliveryInvoice,
  type InvoiceOutputFormat,
  type PreparedInvoiceDelivery,
} from "./lib/invoice-delivery";

export function InvoiceDeliveryPanel({ invoice, format, busy, onSessionExpired, onRefreshHacienda }: {
  invoice: DeliveryInvoice;
  format: InvoiceOutputFormat;
  busy: boolean;
  onSessionExpired: () => void;
  onRefreshHacienda: () => void;
}) {
  const electronic = invoice.documentType !== "commercial";
  const [prepared, setPrepared] = useState<PreparedInvoiceDelivery | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  async function prepare() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPreparing(true);
    setPrepared(null);
    setError("");
    setNotice("");
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 60_000);
    try {
      const delivery = await prepareInvoiceDelivery(invoice, format, { signal: controller.signal });
      if (!controller.signal.aborted) setPrepared(delivery);
    } catch (failure) {
      if (!controller.signal.aborted || timedOut) {
        setError(timedOut
          ? "La preparación tardó demasiado. Revisa la conexión y vuelve a intentarlo. No se envió ningún archivo."
          : failure instanceof Error ? failure.message : "No se pudo preparar el paquete. No se envió ningún archivo.");
        if (failure instanceof InvoiceDeliveryError && failure.code === "session_expired") onSessionExpired();
      }
      controller.abort();
    } finally {
      clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        setPreparing(false);
      }
    }
  }

  const shareFiles = prepared && typeof navigator !== "undefined" ? invoiceFilesToShare(prepared, navigator) : null;

  async function share() {
    if (!prepared || sharing) return;
    const files = invoiceFilesToShare(prepared, navigator);
    if (!files) {
      setNotice("Este navegador no permite compartir todos los adjuntos. Descarga el paquete y adjúntalo al correo o chat del cliente.");
      return;
    }
    setSharing(true);
    setError("");
    setNotice("");
    try {
      // El segundo clic mantiene la activación del usuario. No hay descargas ni
      // esperas de red antes de abrir el menú nativo de compartir.
      await navigator.share({ title: prepared.title, text: prepared.text, files });
      setNotice("Completa el envío en la aplicación elegida. Abrir el menú de compartir no confirma que el cliente lo haya recibido.");
    } catch (failure) {
      if (failure instanceof Error && failure.name === "AbortError") {
        setNotice("No se completó el envío. Los archivos siguen listos para compartir o descargar.");
      } else {
        setError("El dispositivo no pudo compartir los adjuntos. Descarga el paquete y adjúntalo manualmente al correo o chat del cliente.");
      }
    } finally {
      setSharing(false);
    }
  }

  function download() {
    if (!prepared) return;
    const file = prepared.archive ?? prepared.attachments[0].file;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
    setNotice(electronic
      ? "Adjunta el ZIP descargado al correo o chat del cliente. Contiene el PDF y los dos XML; descargarlo no lo envía automáticamente."
      : "Adjunta el PDF descargado al correo o chat del cliente. Descargarlo no lo envía automáticamente.");
  }

  return <section className="invoice-delivery-panel" aria-label="Envío al cliente" aria-busy={preparing}>
    <div>
      <h3>{electronic ? "Enviar factura con sus XML" : "Compartir documento comercial"}</h3>
      <p>{electronic
        ? "Para el cliente: PDF en el formato elegido, XML firmado y XML de aceptación de Hacienda."
        : "Este documento solo incluye PDF; no tiene XML fiscal ni reemplaza una factura electrónica."}</p>
    </div>
    {!prepared ? <button className="secondary-button" type="button" disabled={busy || preparing} onClick={prepare}>
      {preparing ? "Preparando archivos…" : electronic ? "Preparar envío PDF + XML" : "Preparar PDF para compartir"}
    </button> : <>
      <p className="invoice-delivery-ready" role="status">{prepared.attachments.length} {prepared.attachments.length === 1 ? "archivo listo" : "archivos listos"} para adjuntar</p>
      <ul className="invoice-delivery-files">
        {prepared.attachments.map(({ kind, label }) => <li key={kind}>{label}</li>)}
      </ul>
      <div className="invoice-delivery-actions">
        {shareFiles ? <button className="primary-button" type="button" disabled={busy || sharing} onClick={share}>
          {sharing ? "Abriendo…" : shareFiles[0] === prepared.archive ? "Compartir paquete ZIP" : electronic ? "Compartir PDF + XML" : "Compartir PDF"}
        </button> : null}
        <button className="secondary-button" type="button" disabled={busy || sharing} onClick={download}>
          {electronic ? "Descargar ZIP (PDF + XML)" : "Descargar PDF"}
        </button>
      </div>
      {!shareFiles ? <p>Este navegador no permite adjuntar {electronic ? "los XML" : "el PDF"} directamente. Descarga {electronic ? "el ZIP completo" : "el PDF"} y adjúntalo al correo o chat del cliente.</p> : null}
    </>}
    {error ? <div className="error-banner" role="alert">
      {error}
      {electronic && !prepared ? <button className="text-button" type="button" disabled={busy || preparing} onClick={onRefreshHacienda}>Consultar respuesta de Hacienda</button> : null}
    </div> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <small>Este menú prepara archivos para compartir desde otra aplicación. El envío automático por Gmail se configura por separado en Ajustes &gt; Correo.</small>
  </section>;
}
