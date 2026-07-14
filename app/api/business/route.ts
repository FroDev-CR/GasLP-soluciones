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

function identificationError(type: string, number: string) {
  const rules: Record<string, { pattern: RegExp; message: string }> = {
    "01": { pattern: /^[1-9]\d{8}$/, message: "La cédula física debe tener 9 dígitos, sin cero inicial ni guiones." },
    "02": { pattern: /^[A-Za-z0-9]{10}$/, message: "La cédula jurídica debe tener 10 caracteres y escribirse sin guiones." },
    "03": { pattern: /^[1-9]\d{10,11}$/, message: "El DIMEX debe tener 11 o 12 dígitos, sin cero inicial ni guiones." },
    "04": { pattern: /^\d{10}$/, message: "El NITE debe tener 10 dígitos y escribirse sin guiones." },
    "05": { pattern: /^[A-Za-z0-9]{1,20}$/, message: "La identificación extranjera admite hasta 20 letras o números, sin guiones." },
  };
  const rule = rules[type];
  if (!rule) return "Selecciona un tipo de identificación válido de Hacienda.";
  return rule.pattern.test(number) ? "" : rule.message;
}

async function ensureDatabase() {
  if (initialized) return initialized;
  initialized = (async () => {
    const sql = getSql();
    await sql`CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      identification_type TEXT NOT NULL,
      identification_number TEXT NOT NULL,
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
      client_identification_type TEXT NOT NULL,
      client_identification_number TEXT NOT NULL,
      document_type TEXT NOT NULL DEFAULT 'FE',
      currency TEXT NOT NULL DEFAULT 'CRC',
      subtotal_cents INTEGER NOT NULL,
      tax_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'certified', 'cancelled')),
      hacienda_key TEXT,
      hacienda_consecutive TEXT,
      hacienda_status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS identification_type TEXT NOT NULL DEFAULT '01'`;
    await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS identification_number TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE clients DROP COLUMN IF EXISTS nit`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_identification_type TEXT NOT NULL DEFAULT '01'`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_identification_number TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CRC'`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_key TEXT`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_consecutive TEXT`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_status TEXT`;
    await sql`ALTER TABLE invoices ALTER COLUMN document_type SET DEFAULT 'FE'`;
    await sql`ALTER TABLE invoices DROP COLUMN IF EXISTS client_nit`;
    await sql`ALTER TABLE invoices DROP COLUMN IF EXISTS fel_uuid`;
    await sql`ALTER TABLE invoices DROP COLUMN IF EXISTS fel_series`;
    await sql`ALTER TABLE invoices DROP COLUMN IF EXISTS fel_number`;
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
      sql`SELECT id, name, identification_type AS "identificationType", identification_number AS "identificationNumber", phone, email, address FROM clients ORDER BY name`,
      sql`SELECT id, kind, category, name, unit, price_cents AS "priceCents", stock, min_stock AS "minStock" FROM catalog_items WHERE active = TRUE ORDER BY kind, category, name`,
      sql`SELECT id, client_id AS "clientId", client_name AS "clientName", title, service_type AS "serviceType", date, time, address, status, notes FROM appointments ORDER BY date, time`,
      sql`SELECT id, client_id AS "clientId", client_name AS "clientName", client_identification_type AS "clientIdentificationType", client_identification_number AS "clientIdentificationNumber", currency, subtotal_cents AS "subtotalCents", tax_cents AS "taxCents", total_cents AS "totalCents", status, created_at AS "createdAt" FROM invoices ORDER BY created_at DESC LIMIT 50`,
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
      const identificationType = value(payload, "identificationType");
      const identificationNumber = value(payload, "identificationNumber").replace(/[\s-]/g, "");
      if (!name || !identificationNumber) return Response.json({ error: "Nombre e identificación son obligatorios." }, { status: 400 });
      const formatError = identificationError(identificationType, identificationNumber);
      if (formatError) return Response.json({ error: formatError }, { status: 400 });
      const clientId = id("client");
      await sql`INSERT INTO clients (id, name, identification_type, identification_number, phone, email, address) VALUES (${clientId}, ${name}, ${identificationType}, ${identificationNumber}, ${value(payload, "phone")}, ${value(payload, "email")}, ${value(payload, "address")})`;
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
      const clientRows = await sql`SELECT name, identification_type AS "identificationType", identification_number AS "identificationNumber" FROM clients WHERE id = ${clientId} LIMIT 1`;
      const client = clientRows[0] as { name?: string; identificationType?: string; identificationNumber?: string } | undefined;
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
      await sql`INSERT INTO invoices (id, client_id, client_name, client_identification_type, client_identification_number, currency, subtotal_cents, tax_cents, total_cents, status) VALUES (${invoiceId}, ${clientId}, ${client.name}, ${client.identificationType}, ${client.identificationNumber}, 'CRC', ${subtotalCents}, 0, ${subtotalCents}, 'draft')`;
      for (const line of safeLines) {
        await sql`INSERT INTO invoice_items (id, invoice_id, catalog_id, description, quantity, unit_price_cents, total_cents) VALUES (${id("line")}, ${invoiceId}, ${line.catalogId || null}, ${line.description}, ${line.quantity}, ${line.unitPriceCents}, ${Math.round(line.quantity * line.unitPriceCents)})`;
      }
      return Response.json({
        invoice: {
          id: invoiceId,
          clientName: client.name,
          clientIdentificationType: client.identificationType,
          clientIdentificationNumber: client.identificationNumber,
          currency: "CRC",
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
