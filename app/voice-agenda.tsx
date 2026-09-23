"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type ClientOption = { id: string; name: string; address: string };
type AppointmentDraft = {
  clientName: string;
  clientId: string;
  title: string;
  serviceType: string;
  date: string;
  time: string;
  address: string;
  notes: string;
};
type AssistantResult = Omit<AppointmentDraft, "clientId"> & { intent: "agenda" | "other"; transcript: string; error?: string };

const emptyDraft: AppointmentDraft = {
  clientName: "", clientId: "", title: "", serviceType: "Visita técnica", date: "", time: "", address: "", notes: "",
};

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export function VoiceAgenda({
  clients, close, save,
}: {
  clients: ClientOption[];
  close: () => void;
  save: (draft: AppointmentDraft) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState<AppointmentDraft | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function dismiss() {
    closedRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    close();
  }

  async function analyze(audio?: Blob) {
    setBusy(true);
    setError("");
    setDraft(null);
    try {
      const form = new FormData();
      if (audio) form.append("audio", audio, "mensaje.webm");
      else form.append("text", message.trim());
      const response = await fetch("/api/assistant", { method: "POST", body: form });
      const result = await response.json() as AssistantResult;
      if (!response.ok) throw new Error(result.error || "No se pudo entender el mensaje.");
      if (result.transcript) setTranscript(result.transcript);
      if (result.intent !== "agenda") {
        setError("Por ahora puedo ayudarte a agendar trabajos. Para facturar o agregar clientes, usa los botones de la pantalla principal.");
        return;
      }
      const matches = clients.filter((client) => normalized(client.name) === normalized(result.clientName));
      const client = matches.length === 1 ? matches[0] : null;
      setDraft({
        ...emptyDraft,
        clientName: client?.name || result.clientName,
        clientId: client?.id || "",
        title: result.title,
        serviceType: result.serviceType,
        date: result.date,
        time: result.time,
        address: result.address || client?.address || "",
        notes: result.notes,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo procesar el mensaje.");
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Este navegador no permite grabar audio aquí. Puedes escribir tu pedido abajo.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (closedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setRecording(false);
        if (!closedRef.current && chunks.length) void analyze(new Blob(chunks, { type: recorder.mimeType || chunks[0].type }));
        else if (!closedRef.current) setError("No se grabó audio. Intenta otra vez.");
      };
      recorder.start();
      setRecording(true);
      timeoutRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 45_000);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setError("No pude acceder al micrófono. Revisa el permiso del navegador o escribe tu pedido.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await save(draft);
      dismiss();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar la cita.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="voice-agenda">
      <div className="sheet-title"><div><p className="eyebrow">Asistente de agenda</p><h2>Decime qué ocupás</h2><p>Grabá un mensaje corto o escribilo. Revisás todo antes de guardar.</p></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={dismiss}>×</button></div>
      <div className="voice-capture">
        <button type="button" className={`voice-record-button ${recording ? "recording" : ""}`} onClick={recording ? stopRecording : startRecording} disabled={busy} aria-label={recording ? "Detener grabación" : "Grabar audio"}>
          <span aria-hidden="true">{recording ? "■" : "🎙"}</span>{recording ? "Terminar grabación" : "Grabar pedido"}
        </button>
        <p>{recording ? "Te escucho… máximo 45 segundos." : "Ejemplo: «Agendá una entrega de gas para Juan mañana a las 10»."}</p>
      </div>
      <div className="field"><label htmlFor="assistant-message">O escribí el pedido</label><textarea id="assistant-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1500} rows={3} placeholder="Agendá una visita para…" /></div>
      <button type="button" className="secondary-button voice-analyze" onClick={() => void analyze()} disabled={busy || recording || !message.trim()}>{busy ? "Entendiendo…" : "Entender mensaje"}</button>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {transcript ? <p className="voice-transcript"><strong>Entendí:</strong> {transcript}</p> : null}
      {draft ? (
        <form className="form-grid voice-review" onSubmit={submit}>
          <div><h3>Revisá la cita</h3><p>Corregí cualquier dato antes de guardarla.</p></div>
          <div className="field"><label htmlFor="voice-client-select">Cliente guardado</label><select id="voice-client-select" value={draft.clientId} onChange={(event) => {
            const client = clients.find((item) => item.id === event.target.value);
            setDraft((current) => current && { ...current, clientId: client?.id || "", clientName: client?.name || current.clientName, address: client?.address || current.address });
          }}><option value="">No seleccionar / cliente nuevo</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></div>
          <div className="field"><label htmlFor="voice-client-name">Nombre del cliente</label><input id="voice-client-name" required value={draft.clientName} onChange={(event) => setDraft({ ...draft, clientName: event.target.value, clientId: "" })} /></div>
          <div className="field"><label htmlFor="voice-title">Trabajo</label><input id="voice-title" required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></div>
          <div className="field"><label htmlFor="voice-type">Tipo de trabajo</label><select id="voice-type" value={draft.serviceType} onChange={(event) => setDraft({ ...draft, serviceType: event.target.value })}><option>Instalación</option><option>Mantenimiento</option><option>Entrega de gas</option><option>Visita técnica</option></select></div>
          <div className="field-row"><div className="field"><label htmlFor="voice-date">Fecha</label><input id="voice-date" type="date" required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></div><div className="field"><label htmlFor="voice-time">Hora</label><input id="voice-time" type="time" required value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></div></div>
          <div className="field"><label htmlFor="voice-address">Dirección</label><input id="voice-address" value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} placeholder="Opcional" /></div>
          <div className="field"><label htmlFor="voice-notes">Notas</label><textarea id="voice-notes" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={2} /></div>
          <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setDraft(null)}>Volver</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Confirmar y guardar"}</button></div>
        </form>
      ) : null}
    </div>
  );
}
