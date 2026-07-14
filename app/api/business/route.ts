import { env } from "cloudflare:workers";
import { ensureDatabase } from "../../../db/runtime";

type InvoiceLinePayload = {
  catalogId?: string;
  description?: string;
  quantity?: number;
  unitPriceCents?: number;
};

function value(payload: Record<string, unknown>, key: string) {
  return String(payload[key] ?? "").trim();
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Ocurrió un error inesperado";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    await ensureDatabase();
    const db = env.DB;
    const [clients, catalog, appointments, invoices, invoiceItems] = await Promise.all([
      db.prepare("SELECT id, name, nit, phone, email, address FROM clients ORDER BY name").all(),
      db.prepare("SELECT id, kind, category, name, unit, price_cents AS priceCents, stock, min_stock AS minStock FROM catalog_items WHERE active = 1 ORDER BY kind, category, name").all(),
      db.prepare("SELECT id, client_id AS clientId, client_name AS clientName, title, service_type AS serviceType, date, time, address, status, notes FROM appointments ORDER BY date, time").all(),
      db.prepare("SELECT id, client_id AS clientId, client_name AS clientName, client_nit AS clientNit, subtotal_cents AS subtotalCents, tax_cents AS taxCents, total_cents AS totalCents, status, created_at AS createdAt FROM invoices ORDER BY created_at DESC LIMIT 50").all(),
      db.prepare("SELECT invoice_id AS invoiceId, description, quantity, unit_price_cents AS unitPriceCents, total_cents AS totalCents FROM invoice_items ORDER BY rowid").all(),
    ]);
    const linesByInvoice = (invoiceItems.results as Array<Record<string, unknown>>).reduce<Record<string, Array<Record<string, unknown>>>>((acc, item) => {
      const invoiceId = String(item.invoiceId);
      (acc[invoiceId] ??= []).push({
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        totalCents: item.totalCents,
      });
      return acc;
    }, {});
    return Response.json({
      clients: clients.results,
      catalog: catalog.results,
      appointments: appointments.results,
      invoices: (invoices.results as Array<Record<string, unknown>>).map((invoice) => ({
        ...invoice,
        lines: linesByInvoice[String(invoice.id)] ?? [],
      })),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const db = env.DB;
    const payload = (await request.json()) as Record<string, unknown>;
    const action = value(payload, "action");

    if (action === "create_client") {
      const name = value(payload, "name");
      const phone = value(payload, "phone");
      if (!name || !phone) return Response.json({ error: "Nombre y teléfono son obligatorios." }, { status: 400 });
      const clientId = id("client");
      await db.prepare("INSERT INTO clients (id, name, nit, phone, email, address) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(clientId, name, value(payload, "nit") || "CF", phone, value(payload, "email"), value(payload, "address"))
        .run();
      return Response.json({ id: clientId }, { status: 201 });
    }

    if (action === "create_catalog_item") {
      const name = value(payload, "name");
      const category = value(payload, "category");
      const kind = value(payload, "kind") === "service" ? "service" : "product";
      const priceCents = Math.round(Number(payload.price) * 100);
      if (!name || !category || !Number.isFinite(priceCents) || priceCents < 0) return Response.json({ error: "Completa el nombre, categoría y precio." }, { status: 400 });
      const itemId = id("item");
      await db.prepare("INSERT INTO catalog_items (id, kind, category, name, unit, price_cents, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(itemId, kind, category, name, value(payload, "unit") || "unidad", priceCents, Number(payload.stock) || 0, Number(payload.minStock) || 0)
        .run();
      return Response.json({ id: itemId }, { status: 201 });
    }

    if (action === "create_appointment") {
      const title = value(payload, "title");
      const clientName = value(payload, "clientName");
      const date = value(payload, "date");
      const time = value(payload, "time");
      if (!title || !clientName || !date || !time) return Response.json({ error: "Cliente, trabajo, fecha y hora son obligatorios." }, { status: 400 });
      const appointmentId = id("appointment");
      await db.prepare("INSERT INTO appointments (id, client_id, client_name, title, service_type, date, time, address, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
        .bind(appointmentId, payload.clientId || null, clientName, title, value(payload, "serviceType") || "Instalación", date, time, value(payload, "address"), value(payload, "notes"))
        .run();
      return Response.json({ id: appointmentId }, { status: 201 });
    }

    if (action === "update_appointment_status") {
      const status = value(payload, "status");
      if (!['pending', 'confirmed', 'done'].includes(status)) return Response.json({ error: "Estado inválido." }, { status: 400 });
      await db.prepare("UPDATE appointments SET status = ? WHERE id = ?").bind(status, value(payload, "id")).run();
      return Response.json({ ok: true });
    }

    if (action === "create_invoice") {
      const clientId = value(payload, "clientId");
      const client = await db.prepare("SELECT name, nit FROM clients WHERE id = ?").bind(clientId).first<{ name: string; nit: string }>();
      const lines = Array.isArray(payload.lines) ? (payload.lines as InvoiceLinePayload[]) : [];
      if (!client || lines.length === 0) return Response.json({ error: "Selecciona un cliente y al menos una línea." }, { status: 400 });
      const safeLines = lines.map((line) => ({
        catalogId: String(line.catalogId ?? ""),
        description: String(line.description ?? "").trim(),
        quantity: Number(line.quantity),
        unitPriceCents: Math.round(Number(line.unitPriceCents)),
      })).filter((line) => line.description && line.quantity > 0 && line.unitPriceCents >= 0);
      if (safeLines.length === 0) return Response.json({ error: "Las líneas de la factura no son válidas." }, { status: 400 });
      const invoiceId = id("invoice");
      const subtotalCents = safeLines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPriceCents), 0);
      await db.batch([
        db.prepare("INSERT INTO invoices (id, client_id, client_name, client_nit, subtotal_cents, tax_cents, total_cents, status) VALUES (?, ?, ?, ?, ?, 0, ?, 'draft')")
          .bind(invoiceId, clientId, client.name, client.nit || "CF", subtotalCents, subtotalCents),
        ...safeLines.map((line) => db.prepare("INSERT INTO invoice_items (id, invoice_id, catalog_id, description, quantity, unit_price_cents, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(id("line"), invoiceId, line.catalogId || null, line.description, line.quantity, line.unitPriceCents, Math.round(line.quantity * line.unitPriceCents))),
      ]);
      const createdAt = new Date().toISOString();
      return Response.json({
        invoice: {
          id: invoiceId,
          clientName: client.name,
          clientNit: client.nit || "CF",
          subtotalCents,
          taxCents: 0,
          totalCents: subtotalCents,
          status: "draft",
          createdAt,
          lines: safeLines.map((line) => ({ ...line, totalCents: Math.round(line.quantity * line.unitPriceCents) })),
        },
      }, { status: 201 });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return routeError(error);
  }
}
