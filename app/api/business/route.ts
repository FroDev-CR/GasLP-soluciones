import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";

type InvoiceLinePayload = {
  catalogId?: string;
  description?: string;
  quantity?: number;
  unitPriceCents?: number;
};

let initialized: Promise<void> | null = null;

function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("La base de datos todavía no está configurada en Vercel.");
  }
  return neon(connectionString);
}

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

function guatemalaDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function ensureDatabase() {
  if (initialized) return initialized;
  initialized = (async () => {
    const sql = getSql();
    await sql`CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nit TEXT NOT NULL DEFAULT 'CF',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS catalog_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('product', 'service')),
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'unidad',
      price_cents INTEGER NOT NULL,
      stock DOUBLE PRECISION NOT NULL DEFAULT 0,
      min_stock DOUBLE PRECISION NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      client_id TEXT REFERENCES clients(id),
      client_name TEXT NOT NULL,
      title TEXT NOT NULL,
      service_type TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'done')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id),
      client_name TEXT NOT NULL,
      client_nit TEXT NOT NULL,
      document_type TEXT NOT NULL DEFAULT 'FACT',
      subtotal_cents INTEGER NOT NULL,
      tax_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'certified', 'cancelled')),
      fel_uuid TEXT,
      fel_series TEXT,
      fel_number TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      catalog_id TEXT REFERENCES catalog_items(id),
      description TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL
    )`;
    await sql`CREATE INDEX IF NOT EXISTS appointments_date_idx ON appointments(date, time)`;
    await sql`CREATE INDEX IF NOT EXISTS invoices_created_idx ON invoices(created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON invoice_items(invoice_id)`;

    const countRows = await sql`SELECT COUNT(*)::int AS count FROM clients`;
    if (Number(countRows[0]?.count ?? 0) > 0) return;

    const today = guatemalaDate();
    const tomorrow = guatemalaDate(1);
    await sql`INSERT INTO clients (id, name, nit, phone, email, address) VALUES
      ('client-restaurante', 'Restaurante El Fogón, S.A.', '8473921-5', '5555-2180', 'compras@elfogon.gt', 'Zona 10, Ciudad de Guatemala'),
      ('client-panaderia', 'Panadería San Martín', '3928174-2', '5512-8804', 'administracion@panaderia.gt', 'Zona 1, Mixco'),
      ('client-marta', 'Marta López', 'CF', '4789-3201', '', 'Colonia Las Flores, Villa Nueva')
      ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO catalog_items (id, kind, category, name, unit, price_cents, stock, min_stock) VALUES
      ('item-cylinder-25', 'product', 'Cilindros', 'Cilindro de gas 25 lb', 'unidad', 39500, 4, 3),
      ('item-cylinder-100', 'product', 'Cilindros', 'Cilindro de gas 100 lb', 'unidad', 128500, 1, 2),
      ('item-regulator', 'product', 'Repuestos', 'Regulador industrial', 'unidad', 47500, 2, 2),
      ('service-kitchen', 'service', 'Instalaciones', 'Instalación de cocina industrial', 'servicio', 185000, 0, 0),
      ('service-review', 'service', 'Mantenimiento', 'Revisión de fuga y mantenimiento', 'servicio', 45000, 0, 0)
      ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO appointments (id, client_id, client_name, title, service_type, date, time, address, status, notes) VALUES
      ('appointment-1', 'client-restaurante', 'Restaurante El Fogón, S.A.', 'Instalación de cocina industrial', 'Instalación', ${today}, '09:00', 'Zona 10, Ciudad de Guatemala', 'confirmed', 'Llevar regulador industrial'),
      ('appointment-2', 'client-marta', 'Marta López', 'Entrega de cilindro 25 lb', 'Entrega de gas', ${today}, '14:30', 'Colonia Las Flores, Villa Nueva', 'pending', 'Cobro contra entrega'),
      ('appointment-3', 'client-panaderia', 'Panadería San Martín', 'Revisión de línea de gas', 'Mantenimiento', ${tomorrow}, '08:30', 'Zona 1, Mixco', 'confirmed', 'Solicitar acceso al área de hornos')
      ON CONFLICT (id) DO NOTHING`;
  })().catch((error) => {
    initialized = null;
    throw error;
  });
  return initialized;
}

export async function GET() {
  try {
    await ensureDatabase();
    const sql = getSql();
    const [clients, catalog, appointments, invoices, invoiceItems] = await Promise.all([
      sql`SELECT id, name, nit, phone, email, address FROM clients ORDER BY name`,
      sql`SELECT id, kind, category, name, unit, price_cents AS "priceCents", stock, min_stock AS "minStock" FROM catalog_items WHERE active = TRUE ORDER BY kind, category, name`,
      sql`SELECT id, client_id AS "clientId", client_name AS "clientName", title, service_type AS "serviceType", date, time, address, status, notes FROM appointments ORDER BY date, time`,
      sql`SELECT id, client_id AS "clientId", client_name AS "clientName", client_nit AS "clientNit", subtotal_cents AS "subtotalCents", tax_cents AS "taxCents", total_cents AS "totalCents", status, created_at AS "createdAt" FROM invoices ORDER BY created_at DESC LIMIT 50`,
      sql`SELECT invoice_id AS "invoiceId", description, quantity, unit_price_cents AS "unitPriceCents", total_cents AS "totalCents" FROM invoice_items ORDER BY id`,
    ]);
    const linesByInvoice = (invoiceItems as Array<Record<string, unknown>>).reduce<Record<string, Array<Record<string, unknown>>>>((acc, item) => {
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
      clients,
      catalog,
      appointments,
      invoices: (invoices as Array<Record<string, unknown>>).map((invoice) => ({
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
    const sql = getSql();
    const payload = (await request.json()) as Record<string, unknown>;
    const action = value(payload, "action");

    if (action === "create_client") {
      const name = value(payload, "name");
      const phone = value(payload, "phone");
      if (!name || !phone) return Response.json({ error: "Nombre y teléfono son obligatorios." }, { status: 400 });
      const clientId = id("client");
      await sql`INSERT INTO clients (id, name, nit, phone, email, address) VALUES (${clientId}, ${name}, ${value(payload, "nit") || "CF"}, ${phone}, ${value(payload, "email")}, ${value(payload, "address")})`;
      return Response.json({ id: clientId }, { status: 201 });
    }

    if (action === "create_catalog_item") {
      const name = value(payload, "name");
      const category = value(payload, "category");
      const kind = value(payload, "kind") === "service" ? "service" : "product";
      const priceCents = Math.round(Number(payload.price) * 100);
      if (!name || !category || !Number.isFinite(priceCents) || priceCents < 0) return Response.json({ error: "Completa el nombre, categoría y precio." }, { status: 400 });
      const itemId = id("item");
      await sql`INSERT INTO catalog_items (id, kind, category, name, unit, price_cents, stock, min_stock) VALUES (${itemId}, ${kind}, ${category}, ${name}, ${value(payload, "unit") || "unidad"}, ${priceCents}, ${Number(payload.stock) || 0}, ${Number(payload.minStock) || 0})`;
      return Response.json({ id: itemId }, { status: 201 });
    }

    if (action === "create_appointment") {
      const title = value(payload, "title");
      const clientName = value(payload, "clientName");
      const date = value(payload, "date");
      const time = value(payload, "time");
      if (!title || !clientName || !date || !time) return Response.json({ error: "Cliente, trabajo, fecha y hora son obligatorios." }, { status: 400 });
      const appointmentId = id("appointment");
      const clientId = payload.clientId ? String(payload.clientId) : null;
      await sql`INSERT INTO appointments (id, client_id, client_name, title, service_type, date, time, address, status, notes) VALUES (${appointmentId}, ${clientId}, ${clientName}, ${title}, ${value(payload, "serviceType") || "Instalación"}, ${date}, ${time}, ${value(payload, "address")}, 'pending', ${value(payload, "notes")})`;
      return Response.json({ id: appointmentId }, { status: 201 });
    }

    if (action === "update_appointment_status") {
      const status = value(payload, "status");
      if (!["pending", "confirmed", "done"].includes(status)) return Response.json({ error: "Estado inválido." }, { status: 400 });
      await sql`UPDATE appointments SET status = ${status} WHERE id = ${value(payload, "id")}`;
      return Response.json({ ok: true });
    }

    if (action === "create_invoice") {
      const clientId = value(payload, "clientId");
      const clientRows = await sql`SELECT name, nit FROM clients WHERE id = ${clientId} LIMIT 1`;
      const client = clientRows[0] as { name?: string; nit?: string } | undefined;
      const lines = Array.isArray(payload.lines) ? (payload.lines as InvoiceLinePayload[]) : [];
      if (!client?.name || lines.length === 0) return Response.json({ error: "Selecciona un cliente y al menos una línea." }, { status: 400 });
      const safeLines = lines.map((line) => ({
        catalogId: String(line.catalogId ?? ""),
        description: String(line.description ?? "").trim(),
        quantity: Number(line.quantity),
        unitPriceCents: Math.round(Number(line.unitPriceCents)),
      })).filter((line) => line.description && line.quantity > 0 && line.unitPriceCents >= 0);
      if (safeLines.length === 0) return Response.json({ error: "Las líneas de la factura no son válidas." }, { status: 400 });
      const invoiceId = id("invoice");
      const subtotalCents = safeLines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPriceCents), 0);
      await sql`INSERT INTO invoices (id, client_id, client_name, client_nit, subtotal_cents, tax_cents, total_cents, status) VALUES (${invoiceId}, ${clientId}, ${client.name}, ${client.nit || "CF"}, ${subtotalCents}, 0, ${subtotalCents}, 'draft')`;
      for (const line of safeLines) {
        await sql`INSERT INTO invoice_items (id, invoice_id, catalog_id, description, quantity, unit_price_cents, total_cents) VALUES (${id("line")}, ${invoiceId}, ${line.catalogId || null}, ${line.description}, ${line.quantity}, ${line.unitPriceCents}, ${Math.round(line.quantity * line.unitPriceCents)})`;
      }
      return Response.json({
        invoice: {
          id: invoiceId,
          clientName: client.name,
          clientNit: client.nit || "CF",
          subtotalCents,
          taxCents: 0,
          totalCents: subtotalCents,
          status: "draft",
          createdAt: new Date().toISOString(),
          lines: safeLines.map((line) => ({ ...line, totalCents: Math.round(line.quantity * line.unitPriceCents) })),
        },
      }, { status: 201 });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return routeError(error);
  }
}
