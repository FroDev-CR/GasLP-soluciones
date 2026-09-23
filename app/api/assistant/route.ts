import { isAuthenticated, unauthorized } from "../../lib/session";

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
    if (!text && !(audio instanceof File)) {
      return Response.json({ error: "Escribe un mensaje o graba un audio." }, { status: 400 });
    }

    const parts: Array<Record<string, unknown>> = [{ text: `Hoy en Costa Rica es ${costaRicaToday()}. Interpreta la solicitud en español costarricense. Solo preparas citas de agenda, nunca facturas ni otras operaciones. Si la solicitud no es para agendar un trabajo, devuelve intent=other. Extrae únicamente datos dichos claramente; no inventes cliente, fecha, hora ni dirección. Convierte fechas relativas según hoy y horas a formato 24h. Si no se indicó tipo de servicio, usa "Visita técnica". Para entrega de gas, usa "Entrega de gas". Devuelve fecha YYYY-MM-DD y hora HH:MM; si falta un dato, devuelve cadena vacía. En title escribe el trabajo concreto, por ejemplo "Entrega de cilindro de 20 libras". Mensaje escrito: ${text}` }];

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
              intent: { type: "STRING", enum: ["agenda", "other"] },
              transcript: { type: "STRING" },
              clientName: { type: "STRING" },
              title: { type: "STRING" },
              serviceType: { type: "STRING" },
              date: { type: "STRING" },
              time: { type: "STRING" },
              address: { type: "STRING" },
              notes: { type: "STRING" },
            },
            required: ["intent", "transcript", "clientName", "title", "serviceType", "date", "time", "address", "notes"],
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
    return Response.json({
      intent: result.intent === "agenda" ? "agenda" : "other",
      transcript: clean(result.transcript, 1500) || text,
      clientName: clean(result.clientName, 120),
      title: clean(result.title, 160),
      serviceType,
      date: validDate ? date : "",
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "",
      address: clean(result.address, 300),
      notes: clean(result.notes, 500),
    });
  } catch {
    return Response.json({ error: "No se pudo procesar el audio o mensaje. Intenta de nuevo." }, { status: 500 });
  }
}
