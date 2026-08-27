"use client";

import { useEffect, useState, type FormEvent } from "react";
import { invoiceOutputOptions } from "./lib/invoice-delivery";
import type { EmailSettings } from "./lib/invoice-email";

export function EmailSettingsPanel() {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/email/settings", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No se pudo cargar el correo.");
        if (!controller.signal.aborted) setSettings(result.settings);
      })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudo cargar el correo."); });
    return () => controller.abort();
  }, []);

  async function action(payload: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/email/settings", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, version: settings?.version }),
      });
      const result = await response.json();
      if (result.settings) setSettings(result.settings);
      if (!response.ok) throw new Error(result.error || "No se pudo actualizar el correo.");
      setNotice(result.message || "Configuración actualizada.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No se pudo confirmar la operación. Recarga el estado antes de repetirla.");
    } finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/email/settings", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo cargar el correo.");
      setSettings(result.settings);
      setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo cargar el correo."); }
    finally { setBusy(false); }
  }

  return <div className="settings-card form-grid email-settings-panel">
    <div className="settings-intro"><strong>Correo de facturas con Gmail</strong><span>PDF + XML firmado + respuesta XML de Hacienda, desde tu cuenta de Gmail.</span></div>
    <div className="notice">Primero guarda la configuración y verifica la conexión. Después puedes enviar una prueba a tu propia cuenta y activar el automático. No pegues contraseñas en el chat.</div>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    {notice ? <div className="notice" role="status">{notice}</div> : null}
    {settings ? <EmailSettingsForm key={settings.version} settings={settings} busy={busy} action={action} /> : !error ? <p role="status">Cargando configuración…</p> : null}
    <button className="text-button" type="button" disabled={busy} onClick={refresh}>Recargar estado del correo</button>
    <small>Google puede aplicar límites de envío y filtros de seguridad. «Aceptado por Gmail» no confirma recepción ni lectura; revisa también los correos de rebote.</small>
  </div>;
}

function EmailSettingsForm({ settings, busy, action }: { settings: EmailSettings; busy: boolean; action: (payload: Record<string, unknown>) => Promise<void> }) {
  const [dirty, setDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void action({ action: "save", senderEmail: data.get("senderEmail"), senderName: data.get("senderName"), format: data.get("format"), appPassword: data.get("appPassword") });
  }
  return <>
    <div className="notice"><strong>{settings.enabled ? "Automático activado" : "Automático desactivado"}</strong><br />{settings.verifiedAt ? "Conexión verificada con Gmail." : "Conexión pendiente de verificar."}</div>
    <form className="form-grid" onSubmit={submit} onChange={() => setDirty(true)}>
      <div className="field"><label htmlFor="mail-sender">Correo remitente de Gmail</label><input id="mail-sender" name="senderEmail" type="email" autoComplete="email" defaultValue={settings.senderEmail} required /></div>
      <div className="field"><label htmlFor="mail-name">Nombre del remitente</label><input id="mail-name" name="senderName" defaultValue={settings.senderName} maxLength={120} required /></div>
      <div className="field"><label htmlFor="mail-password">Contraseña de aplicación de Google</label><input id="mail-password" name="appPassword" type="password" autoComplete="new-password" maxLength={32} placeholder={settings.hasPassword ? "Guardada; deja vacío para conservarla con el mismo correo" : "Contraseña de aplicación de 16 caracteres"} /><span className="field-help standalone">Activa la verificación en dos pasos de Google y crea una contraseña de aplicación. No uses tu contraseña habitual. Se guarda cifrada y no se vuelve a mostrar.</span></div>
      <a className="text-button" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">Abrir contraseñas de aplicación de Google</a>
      <div className="field"><label htmlFor="mail-format">Formato del PDF adjunto al correo</label><select id="mail-format" name="format" defaultValue={settings.format}>{Object.entries(invoiceOutputOptions).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}</select><span className="field-help standalone">Los dos XML originales se adjuntan siempre, sin modificarlos.</span></div>
      <button className="primary-button" disabled={busy}>{busy ? "Procesando…" : "Guardar configuración de correo"}</button>
      <small>Guardar desactiva el automático y exige verificar de nuevo. Si cambias de cuenta, también debes cargar su contraseña de aplicación.</small>
    </form>
    <div className="email-actions">
      <button className="secondary-button" type="button" disabled={busy || dirty || !settings.hasPassword} onClick={() => action({ action: "verify" })}>Verificar conexión sin enviar</button>
      <button className="secondary-button" type="button" disabled={busy || dirty || !settings.verifiedAt} onClick={() => {
        if (window.confirm(`Se enviará un correo de prueba sin facturas a ${settings.senderEmail}. ¿Enviar la prueba?`)) void action({ action: "test" });
      }}>Enviar prueba a mi Gmail</button>
    </div>
    {dirty ? <p className="field-help standalone">Guarda los cambios antes de verificar, probar o activar.</p> : null}
    {!settings.enabled ? <label className="confirmation-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Autorizo enviar automáticamente los comprobantes de producción al correo guardado en cada factura cuando la app confirme su aceptación por Hacienda.</span></label> : null}
    <button className={settings.enabled ? "secondary-button" : "primary-button"} type="button" disabled={busy || (!settings.enabled && (dirty || !settings.verifiedAt || !confirmed))} onClick={() => action({ action: settings.enabled ? "disable" : "enable" })}>{settings.enabled ? "Desactivar envío automático" : "Activar envío automático"}</button>
    <p className="field-help standalone">Se dispara al usar «Consultar estado» y obtener la aceptación, incluso si la factura ya estaba aceptada y aún no tiene un intento de correo. No consulta Hacienda por sí solo ni envía todas las facturas al activar. Los reintentos se hacen desde cada factura.</p>
  </>;
}
