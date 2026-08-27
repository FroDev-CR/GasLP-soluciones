"use client";

import { useEffect, useState } from "react";
import { deliveryState, type EmailDelivery, type EmailSettings } from "./lib/invoice-email";
import { invoiceOutputOptions } from "./lib/invoice-delivery";

export function InvoiceEmailPanel({ invoiceId, recipient }: { invoiceId: string; recipient: string }) {
  const [data, setData] = useState<{ settings: EmailSettings; delivery: EmailDelivery | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/documents/${encodeURIComponent(invoiceId)}/email`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo consultar el correo.");
      if (!controller.signal.aborted) setData(result);
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudo consultar el correo."); });
    return () => controller.abort();
  }, [endpoint]);

  const delivery = data?.delivery;
  const state = delivery ? deliveryState(delivery) : null;
  const ready = Boolean(data?.settings.hasPassword && data.settings.verifiedAt);
  const processing = state === "preparing" || state === "sending";
  const resend = state === "submitted" || state === "uncertain";

  async function request(send: boolean) {
    if (busy) return;
    if (send && resend && !window.confirm(`Este correo ya fue aceptado por Gmail o su resultado no está confirmado. Revisa Enviados y rebotes antes de repetirlo. ¿Reenviar a ${delivery?.recipient || recipient || "el receptor guardado en la factura"}?`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, send ? {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", expectedAttemptId: delivery?.attemptId, confirmResend: resend }),
      } : { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo procesar el correo.");
      setData(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo confirmar el envío. Actualiza el estado antes de volver a intentarlo."); }
    finally { setBusy(false); }
  }

  return <section className="invoice-delivery-panel" aria-label="Correo de la factura">
    <h3>Correo al cliente</h3>
    <p>Destino: {delivery?.recipient || recipient || "correo del receptor en el XML; si falta, no se enviará"}</p>
    {data ? <p>Desde {data.settings.senderEmail} · {invoiceOutputOptions[data.settings.format].actionLabel} + ambos XML. Automático {data.settings.enabled ? "activado" : "desactivado"}.</p> : null}
    {delivery ? <p role="status"><strong>{state === "submitted" ? "Aceptado por Gmail" : state === "uncertain" ? "Resultado sin confirmar" : state === "failed" ? "No enviado / requiere revisión" : "Procesando correo"}</strong><br />{delivery.state !== state ? "El intento anterior se interrumpió. Revisa el estado antes de reintentar." : delivery.message}<br />Intentos: {delivery.attempts}{delivery.submittedAt ? ` · ${new Date(delivery.submittedAt).toLocaleString("es-CR")}` : ""}</p> : data ? <p>Sin intentos de correo registrados para esta factura.</p> : <p>Cargando estado del correo…</p>}
    {!ready && data ? <p>Configura y verifica Gmail en Ajustes &gt; Correo. El envío manual de archivos sigue disponible arriba.</p> : null}
    <div className="email-actions">
      <button type="button" className="secondary-button" disabled={busy || !ready || processing} onClick={() => request(true)}>{busy ? "Procesando…" : resend ? "Reenviar correo…" : state === "failed" ? "Reintentar correo con PDF + XML" : "Enviar correo con PDF + XML"}</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => request(false)}>Actualizar estado del correo</button>
    </div>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    <small>«Aceptado por Gmail» no confirma entrega final ni lectura. Revisa Enviados, Spam y los rebotes en la cuenta remitente.</small>
  </section>;
}
