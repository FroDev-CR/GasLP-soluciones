import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { isAuthenticated, unauthorized } from "../../../lib/session";
import type { InvoiceHint } from "../../../lib/assistant-types";

export const runtime = "nodejs";

type StoredMessage = { id: string; role: "user" | "assistant"; content: string; draft?: Record<string, string>; invoice?: InvoiceHint; saved?: boolean };
let initialized: Promise<void> | null = null;

function database() {
  if (!process.env.DATABASE_URL) throw new Error("La base de datos no está configurada.");
  return neon(process.env.DATABASE_URL);
}

function ensureStorage() {
  if (!initialized) {
    initialized = database()`CREATE TABLE IF NOT EXISTS assistant_conversations (
      id UUID PRIMARY KEY, title TEXT NOT NULL, messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`.then(() => undefined).catch((error) => { initialized = null; throw error; });
  }
  return initialized;
}

function clean(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function cleanInvoice(value: unknown): InvoiceHint | null {
  if (!value || typeof value !== "object") return null;
  const invoice = value as Record<string, unknown>;
  const numberOrNull = (input: unknown, max: number) => typeof input === "number" && Number.isFinite(input) && input > 0 && input <= max ? input : null;
  return {
    documentType: ["FE", "TE", "commercial"].includes(String(invoice.documentType)) ? invoice.documentType as InvoiceHint["documentType"] : "unspecified",
    clientName: clean(invoice.clientName, 120),
    description: clean(invoice.description, 300),
    quantity: numberOrNull(invoice.quantity, 10000),
    unitPrice: numberOrNull(invoice.unitPrice, 1_000_000_000),
    taxTreatment: invoice.taxTreatment === "exento" || invoice.taxTreatment === "general" ? invoice.taxTreatment : "unspecified",
    reusePrevious: invoice.reusePrevious === true,
  };
}

function cleanMessage(value: unknown): StoredMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (!validId(message.id) || !["user", "assistant"].includes(String(message.role))) return null;
  const content = clean(message.content, 2000);
  if (!content) return null;
  const draft = message.draft && typeof message.draft === "object" ? message.draft as Record<string, unknown> : null;
  const invoice = cleanInvoice(message.invoice);
  return {
    id: message.id,
    role: message.role as "user" | "assistant",
    content,
    ...(draft && message.role === "assistant" ? { draft: Object.fromEntries(
      ["clientName", "title", "serviceType", "date", "time", "address", "notes"].map((key) => [key, clean(draft[key], 500)]),
    ) } : {}),
    ...(invoice && message.role === "assistant" ? { invoice } : {}),
    ...(message.saved === true ? { saved: true } : {}),
  };
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return unauthorized();
  try {
    await ensureStorage();
    const sql = database();
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      if (!validId(id)) return Response.json({ error: "Conversación inválida." }, { status: 400 });
      const rows = await sql`SELECT id, title, messages FROM assistant_conversations WHERE id = ${id}::uuid`;
      return rows.length ? Response.json({ conversation: rows[0] }) : Response.json({ error: "Conversación no encontrada." }, { status: 404 });
    }
    const rows = await sql`SELECT id, title, updated_at AS "updatedAt" FROM assistant_conversations ORDER BY updated_at DESC LIMIT 60`;
    return Response.json({ conversations: rows });
  } catch {
    return Response.json({ error: "No se pudo cargar el historial." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return unauthorized();
  try {
    const body = await request.json() as Record<string, unknown>;
    await ensureStorage();
    const sql = database();
    if (body.action === "create") {
      const id = randomUUID();
      const title = clean(body.title, 70) || "Nueva conversación";
      await sql`INSERT INTO assistant_conversations (id, title) VALUES (${id}::uuid, ${title})`;
      return Response.json({ id });
    }
    if (body.action === "append" && validId(body.id) && Array.isArray(body.messages) && body.messages.length >= 1 && body.messages.length <= 2) {
      const messages = body.messages.map(cleanMessage);
      if (messages.some((message) => !message)) return Response.json({ error: "Mensaje inválido." }, { status: 400 });
      const payload = JSON.stringify(messages);
      const rows = await sql`UPDATE assistant_conversations SET
        messages = messages || ${payload}::jsonb, updated_at = NOW()
        WHERE id = ${body.id}::uuid AND jsonb_array_length(messages) + ${messages.length} <= 200
        RETURNING id`;
      if (!rows.length) return Response.json({ error: "La conversación no existe o llegó al límite. Iniciá una nueva." }, { status: 409 });
      return Response.json({ ok: true });
    }
    if (body.action === "mark_saved" && validId(body.id) && validId(body.messageId)) {
      const rows = await sql`UPDATE assistant_conversations SET messages = (
        SELECT jsonb_agg(CASE WHEN item->>'id' = ${body.messageId} THEN item || '{"saved":true}'::jsonb ELSE item END ORDER BY ord)
        FROM jsonb_array_elements(messages) WITH ORDINALITY AS entries(item, ord)
      ) WHERE id = ${body.id}::uuid AND messages @> ${JSON.stringify([{ id: body.messageId }])}::jsonb RETURNING id`;
      return rows.length ? Response.json({ ok: true }) : Response.json({ error: "Mensaje no encontrado." }, { status: 404 });
    }
    return Response.json({ error: "Solicitud inválida." }, { status: 400 });
  } catch {
    return Response.json({ error: "No se pudo guardar la conversación." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAuthenticated())) return unauthorized();
  const id = new URL(request.url).searchParams.get("id");
  if (!validId(id)) return Response.json({ error: "Conversación inválida." }, { status: 400 });
  try {
    await ensureStorage();
    const rows = await database()`DELETE FROM assistant_conversations WHERE id = ${id}::uuid RETURNING id`;
    return rows.length ? Response.json({ ok: true }) : Response.json({ error: "Conversación no encontrada." }, { status: 404 });
  } catch {
    return Response.json({ error: "No se pudo borrar la conversación." }, { status: 500 });
  }
}
