"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

export type ChatThread = { id: string; title: string; updatedAt: string };
type Draft = { clientName: string; clientId: string; title: string; serviceType: string; date: string; time: string; address: string; notes: string };
type Message = { id: string; role: "user" | "assistant"; content: string; draft?: Omit<Draft, "clientId">; saved?: boolean };
type Analysis = Omit<Draft, "clientId"> & { intent: "agenda" | "other"; transcript: string; error?: string };
type Client = { id: string; name: string; address: string };

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export function AssistantChat({ selectedId, selectThread, refreshThreads, clients, saveAppointment, openInvoice, openAgenda }: {
  selectedId: string | null;
  selectThread: (id: string | null) => void;
  refreshThreads: () => Promise<void>;
  clients: Client[];
  saveAppointment: (draft: Draft) => Promise<void>;
  openInvoice: () => void;
  openAgenda: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<string | null>(selectedId);

  useEffect(() => {
    activeRef.current = selectedId;
    // La selección de otro hilo descarta cualquier revisión pendiente del anterior.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditingId(null);
    setDraft(null);
    if (!selectedId) {
      setMessages([]);
      return;
    }
    setMessages([]);
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/assistant/conversations?id=${encodeURIComponent(selectedId)}`, { cache: "no-store" });
        const result = await response.json() as { conversation?: { messages: Message[] }; error?: string };
        if (!response.ok) throw new Error(result.error || "No se pudo cargar la conversación.");
        if (live) setMessages(Array.isArray(result.conversation?.messages) ? result.conversation.messages : []);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : "No se pudo cargar la conversación.");
      }
    })();
    return () => { live = false; };
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, editingId]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function processMessage(audio?: Blob) {
    const written = input.trim();
    if ((!written && !audio) || busy) return;
    const originId = activeRef.current;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      if (audio) form.append("audio", audio, "mensaje.webm");
      else form.append("text", written);
      const response = await fetch("/api/assistant", { method: "POST", body: form });
      const result = await response.json() as Analysis;
      if (!response.ok) throw new Error(result.error || "No pude entender el mensaje.");
      const userText = audio ? result.transcript || "Mensaje de voz" : written;
      const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: userText };
      const assistantMessage: Message = result.intent === "agenda"
        ? { id: crypto.randomUUID(), role: "assistant", content: "Preparé esta cita. Revisá los datos y confirmá antes de guardarla.", draft: {
          clientName: result.clientName, title: result.title, serviceType: result.serviceType, date: result.date,
          time: result.time, address: result.address, notes: result.notes,
        } }
        : { id: crypto.randomUUID(), role: "assistant", content: "Por ahora puedo ayudarte a agendar trabajos. Para facturar, clientes y otras tareas, usá el menú lateral." };
      let id = originId;
      if (!id) {
        const create = await fetch("/api/assistant/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", title: userText.slice(0, 70) }) });
        const created = await create.json() as { id?: string; error?: string };
        if (!create.ok || !created.id) throw new Error(created.error || "No se pudo iniciar la conversación.");
        id = created.id;
      }
      const append = await fetch("/api/assistant/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "append", id, messages: [userMessage, assistantMessage] }) });
      const appended = await append.json() as { error?: string };
      if (!append.ok) throw new Error(appended.error || "No se pudo guardar el mensaje.");
      if (activeRef.current === originId) {
        setMessages((current) => [...current, userMessage, assistantMessage]);
        setInput("");
        if (originId === null) {
          activeRef.current = id;
          selectThread(id);
        }
      }
      await refreshThreads();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo procesar el mensaje.");
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Este navegador no permite grabar. Podés escribir el mensaje.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        if (chunks.length) void processMessage(new Blob(chunks, { type: recorder.mimeType || chunks[0].type }));
        else setError("No se grabó audio. Intentá otra vez.");
      };
      recorder.start();
      setRecording(true);
      timeoutRef.current = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 45_000);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setError("No pude acceder al micrófono. Revisá el permiso o escribí tu pedido.");
    }
  }

  function editDraft(message: Message) {
    if (!message.draft) return;
    const matches = clients.filter((client) => normalized(client.name) === normalized(message.draft?.clientName || ""));
    const client = matches.length === 1 ? matches[0] : null;
    setDraft({ ...message.draft, clientName: client?.name || message.draft.clientName, clientId: client?.id || "", address: message.draft.address || client?.address || "" });
    setEditingId(message.id);
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !editingId || !selectedId || savingId) return;
    setSavingId(editingId);
    setError("");
    try {
      await saveAppointment(draft);
      const response = await fetch("/api/assistant/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mark_saved", id: selectedId, messageId: editingId }) });
      if (!response.ok) throw new Error("La cita se guardó, pero no pude marcarla en el historial. No la guardés de nuevo; revisá la agenda.");
      setMessages((current) => current.map((item) => item.id === editingId ? { ...item, saved: true } : item));
      setEditingId(null);
      setDraft(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar la cita.");
    } finally {
      setSavingId(null);
    }
  }

  return <section className="chat-home" aria-label="Asistente">
    <div className="chat-heading"><div><span className="chat-status-dot" /> Asistente de GAS LP</div><small>Agenda con voz o texto · confirmás antes de guardar</small></div>
    <div className="chat-scroll">
      {messages.length === 0 ? <div className="chat-welcome">
        <div className="chat-welcome-icon">✦</div><h1>Hola, ¿en qué te ayudo?</h1>
        <p>Contame qué trabajo querés agendar. También podés grabar un audio.</p>
        <div className="chat-suggestions">
          <button type="button" onClick={() => setInput("Agendá una entrega de gas para ")}>▤ Agendar entrega</button>
          <button type="button" onClick={openInvoice}>＋ Hacer factura</button>
          <button type="button" onClick={openAgenda}>◷ Ver agenda</button>
        </div><small>Por ahora el chat solo prepara citas. Para facturas, usá Facturar.</small>
      </div> : <div className="chat-messages">{messages.map((message) => <div className={`chat-message ${message.role}`} key={message.id}>
        <div className="chat-message-avatar">{message.role === "assistant" ? "✦" : "Tú"}</div>
        <div className="chat-message-body"><div className="chat-bubble">{message.content}</div>
          {message.draft ? <div className="chat-draft-summary"><strong>{message.saved ? "✓ Cita guardada" : "Cita pendiente de confirmación"}</strong>
            <span>{message.draft.title || "Trabajo sin título"} · {message.draft.clientName || "Cliente pendiente"}</span>
            <span>{message.draft.date || "Fecha pendiente"} {message.draft.time || ""}</span>
            {!message.saved ? <button className="secondary-button" type="button" onClick={() => editDraft(message)}>Revisar y guardar</button> : null}
          </div> : null}
        </div>
      </div>)}<div ref={bottomRef} /></div>}
    </div>
    {editingId && draft ? <div className="chat-review"><form className="form-grid" onSubmit={submitDraft}>
      <div className="chat-review-heading"><div><h2>Revisá la cita</h2><p>Confirmá los datos antes de crearla en la agenda.</p></div><button type="button" className="icon-button" aria-label="Cerrar revisión" onClick={() => setEditingId(null)}>×</button></div>
      <div className="field"><label htmlFor="chat-client-select">Cliente guardado</label><select id="chat-client-select" value={draft.clientId} onChange={(event) => { const client = clients.find((item) => item.id === event.target.value); setDraft({ ...draft, clientId: client?.id || "", clientName: client?.name || draft.clientName, address: client?.address || draft.address }); }}><option value="">Cliente nuevo / sin seleccionar</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></div>
      <div className="field"><label htmlFor="chat-client-name">Cliente</label><input id="chat-client-name" required value={draft.clientName} onChange={(event) => setDraft({ ...draft, clientName: event.target.value, clientId: "" })} /></div>
      <div className="field"><label htmlFor="chat-title">Trabajo</label><input id="chat-title" required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></div>
      <div className="field"><label htmlFor="chat-type">Tipo</label><select id="chat-type" value={draft.serviceType} onChange={(event) => setDraft({ ...draft, serviceType: event.target.value })}><option>Instalación</option><option>Mantenimiento</option><option>Entrega de gas</option><option>Visita técnica</option></select></div>
      <div className="field-row"><div className="field"><label htmlFor="chat-date">Fecha</label><input id="chat-date" type="date" required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></div><div className="field"><label htmlFor="chat-time">Hora</label><input id="chat-time" type="time" required value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></div></div>
      <div className="field"><label htmlFor="chat-address">Dirección</label><input id="chat-address" value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} /></div>
      <div className="field"><label htmlFor="chat-notes">Notas</label><textarea id="chat-notes" rows={2} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></div>
      <button className="primary-button" disabled={Boolean(savingId)}>{savingId ? "Guardando…" : "Confirmar y guardar"}</button>
    </form></div> : null}
    <div className="chat-composer-wrap">
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void processMessage(); }}>
        <textarea aria-label="Escribí tu mensaje" value={input} onChange={(event) => setInput(event.target.value)} maxLength={1500} rows={2} placeholder="Escribí lo que ocupás…" disabled={busy || recording} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void processMessage(); } }} />
        <div className="chat-composer-actions"><span>{recording ? "Grabando… tocá para terminar" : busy ? "Entendiendo tu pedido…" : "Podés escribir o grabar un audio"}</span><div><button type="button" className={`chat-mic ${recording ? "recording" : ""}`} onClick={recording ? () => recorderRef.current?.stop() : () => void startRecording()} disabled={busy} aria-label={recording ? "Detener grabación" : "Grabar mensaje"}>{recording ? "■" : "🎙"}</button><button type="submit" className="chat-send" disabled={busy || recording || !input.trim()} aria-label="Enviar mensaje">↑</button></div></div>
      </form>
      <small>El asistente puede equivocarse. Revisá los datos antes de guardar.</small>
    </div>
  </section>;
}
