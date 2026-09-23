import { isAuthenticated, unauthorized } from "../../lib/session";
import type { InvoiceHint } from "../../lib/assistant-types";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ALLOWED_AUDIO = new Set(["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg"]);

function costaRicaToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Costa_Rica", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function historyText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "";
  try {
    const messages = JSON.parse(value) as unknown;
    if (!Array.isArray(messages)) return "";
    return messages.slice(-8).map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const message = entry as Record<string, unknown>;
      const role = message.role === "assistant" ? "Asistente" : message.role === "user" ? "Usuario" : "";
      return role ? `${role}: ${clean(message.content, 500)}` : "";
    }).filter(Boolean).join("\n").slice(0, 3500);
  } catch {
    return "";
  }
}

function positiveNumber(value: unknown, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= maximum ? number : null;
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return unauthorized();

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_AUDIO_BYTES + 512_000) {
    return Response.json({ error: "El mensaje es demasiado grande (máximo 8 MB de audio)." }, { status: 413 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "El asistente todavía no está configurado. Agrega GEMINI_API_KEY al servidor." }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const text = clean(form.get("text"), 1500);
    const audio = form.get("audio");
    const history = historyText(form.get("history"));
    if (!text && !(audio instanceof File)) {
      return Response.json({ error: "Escribe un mensaje o graba un audio." }, { status: 400 });
    }

    const parts: Array<Record<string, unknown>> = [{ text: `Sos el asistente de GAS LP SOLUCIONES. Hoy en Costa Rica es ${costaRicaToday()}. Respondé en español costarricense claro y breve. La app permite agendar trabajos, gestionar clientes y catálogo, preparar documentos comerciales y borradores de factura o tiquete electrónicos. Nunca digás que ya guardaste, firmaste, emitiste, enviaste o cobraste algo: toda operación requiere revisión y confirmación en la interfaz.
Clasificá la intención del mensaje actual usando el historial solo como contexto: agenda para agendar trabajos, invoice para preparar o consultar una factura, help para preguntar qué hace la app o qué podés hacer, other para saludos y otras consultas. Si piden "igual que ayer", "la misma factura" o similar, marcá reusePrevious=true: no inventés cuál documento era ni copies datos que no aparecen en el historial. Si preguntan si podés hacer una factura pero aún no dan datos, es intent=invoice con campos vacíos. Si un mensaje posterior completa datos de un pedido previo, extraé el conjunto de datos explícitos de los mensajes del usuario, nunca datos inventados en respuestas del asistente.
Para agenda: extraé solo cliente, trabajo, servicio, fecha, hora, dirección y notas claramente indicados. Convertí fechas relativas según hoy y horas a 24h. Si no se indicó tipo, usá "Visita técnica"; para entrega de gas, "Entrega de gas". Fecha YYYY-MM-DD y hora HH:MM, vacío si falta.
Para factura: extraé tipo FE si dicen factura electrónica, TE si tiquete electrónico, commercial si documento comercial; unspecified si no lo dicen. Extraé nombre del cliente, descripción del producto/servicio, cantidad y precio unitario en colones, 0 si faltan. Si solo indican precio total para varias unidades, no lo trates como precio unitario: devolvé 0 y pedí aclaración. No calculés impuestos ni los infieras del producto. taxTreatment=exento solo si dicen expresamente "exento"; general solo si dicen expresamente 13% o IVA general; unspecified para "sin IVA", "exonerado" ambiguo o si no indican. No inventés datos tributarios ni usés una factura anterior sin que la elijan.
En reply respondé a la pregunta concreta de forma útil, sin prometer acciones automáticas. En transcript copiá fielmente lo dicho en el audio; para texto copiá el mensaje escrito. Si falta información, preguntá por ella. Historial reciente:\n${history || "(sin historial)"}\nMensaje actual escrito: ${text}` }];

    if (audio instanceof File) {
      const mimeType = audio.type.split(";")[0].toLowerCase();
      if (!ALLOWED_AUDIO.has(mimeType) || !audio.size || audio.size > MAX_AUDIO_BYTES) {
        return Response.json({ error: "El audio debe durar poco y ser WebM, MP4, OGG, WAV o MP3 (máximo 8 MB)." }, { status: 400 });
      }
      parts.push({ inline_data: { mime_type: mimeType, data: Buffer.from(await audio.arrayBuffer()).toString("base64") } });
    }

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              intent: { type: "STRING", enum: ["agenda", "invoice", "help", "other"] },
              transcript: { type: "STRING" },
              reply: { type: "STRING" },
              clientName: { type: "STRING" },
              title: { type: "STRING" },
              serviceType: { type: "STRING" },
              date: { type: "STRING" },
              time: { type: "STRING" },
              address: { type: "STRING" },
              notes: { type: "STRING" },
              invoiceDocumentType: { type: "STRING", enum: ["FE", "TE", "commercial", "unspecified"] },
              invoiceClientName: { type: "STRING" },
              invoiceDescription: { type: "STRING" },
              invoiceQuantity: { type: "NUMBER" },
              invoiceUnitPrice: { type: "NUMBER" },
              invoiceTaxTreatment: { type: "STRING", enum: ["exento", "general", "unspecified"] },
              reusePrevious: { type: "BOOLEAN" },
            },
            required: ["intent", "transcript", "reply", "clientName", "title", "serviceType", "date", "time", "address", "notes", "invoiceDocumentType", "invoiceClientName", "invoiceDescription", "invoiceQuantity", "invoiceUnitPrice", "invoiceTaxTreatment", "reusePrevious"],
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return Response.json({ error: response.status === 429 ? "Gemini alcanzó su límite. Intenta más tarde o usa la agenda manual." : "No se pudo analizar el mensaje. Intenta de nuevo." }, { status: 502 });
    }
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = body.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
    if (!raw) return Response.json({ error: "No se pudo entender el mensaje. Intenta de nuevo." }, { status: 502 });
    const result = JSON.parse(raw) as Record<string, unknown>;
    const date = clean(result.date, 10);
    const time = clean(result.time, 5);
    const proposedServiceType = clean(result.serviceType, 80);
    const serviceType = ["Instalación", "Mantenimiento", "Entrega de gas", "Visita técnica"].includes(proposedServiceType)
      ? proposedServiceType : "Visita técnica";
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : null;
    const validDate = parsedDate && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date;
    const intent = ["agenda", "invoice", "help"].includes(String(result.intent)) ? result.intent : "other";
    const invoice: InvoiceHint = {
      documentType: ["FE", "TE", "commercial"].includes(String(result.invoiceDocumentType)) ? result.invoiceDocumentType as InvoiceHint["documentType"] : "unspecified",
      clientName: clean(result.invoiceClientName, 120),
      description: clean(result.invoiceDescription, 300),
      quantity: positiveNumber(result.invoiceQuantity, 10000),
      unitPrice: positiveNumber(result.invoiceUnitPrice, 1_000_000_000),
      taxTreatment: result.invoiceTaxTreatment === "exento" || result.invoiceTaxTreatment === "general" ? result.invoiceTaxTreatment : "unspecified",
      reusePrevious: result.reusePrevious === true,
    };
    const invoiceReply = invoice.reusePrevious
      ? "Puedo preparar un borrador usando una factura anterior. Elegí cuál querés tomar como base; no la voy a emitir ni enviar sin tu revisión."
      : invoice.clientName && invoice.description && invoice.unitPrice !== null
        ? "Ya tengo datos para empezar el borrador. Abrilo y revisá cliente, producto, precio, tipo de comprobante e IVA antes de guardarlo."
        : "Sí, puedo ayudarte a preparar la factura. Decime el cliente, producto o servicio, cantidad, precio y si querés factura electrónica, tiquete o documento comercial.";
    return Response.json({
      intent,
      transcript: clean(result.transcript, 1500) || text,
      reply: intent === "help"
        ? "Puedo ayudarte a agendar trabajos y a preparar borradores de factura con voz o texto. También podés consultar clientes, catálogo y documentos desde el menú. Antes de guardar, firmar o enviar, siempre revisás y confirmás los datos."
        : intent === "invoice" ? invoiceReply : clean(result.reply, 500) || "Contame qué necesitás hacer y te ayudo a dar el siguiente paso.",
      clientName: clean(result.clientName, 120),
      title: clean(result.title, 160),
      serviceType,
      date: validDate ? date : "",
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "",
      address: clean(result.address, 300),
      notes: clean(result.notes, 500),
      invoice,
    });
  } catch {
    return Response.json({ error: "No se pudo procesar el audio o mensaje. Intenta de nuevo." }, { status: 500 });
  }
}
