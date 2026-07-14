import { env } from "cloudflare:workers";

let initialized: Promise<void> | null = null;

export function ensureDatabase() {
  if (!initialized) initialized = initializeDatabase();
  return initialized;
}

async function initializeDatabase() {
  const db = env.DB;
  if (!db) throw new Error("La base de datos del negocio no está disponible.");

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nit TEXT NOT NULL DEFAULT 'CF',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS catalog_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('product', 'service')),
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'unidad',
      price_cents INTEGER NOT NULL,
      stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      client_id TEXT,
      client_name TEXT NOT NULL,
      title TEXT NOT NULL,
      service_type TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'done')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      catalog_id TEXT,
      description TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id),
      FOREIGN KEY (catalog_id) REFERENCES catalog_items(id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS appointments_date_idx ON appointments(date, time)"),
    db.prepare("CREATE INDEX IF NOT EXISTS invoices_created_idx ON invoices(created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON invoice_items(invoice_id)"),
  ]);

  const count = await db.prepare("SELECT COUNT(*) AS count FROM clients").first<{ count: number }>();
  if ((count?.count ?? 0) > 0) return;

  await db.batch([
    db.prepare("INSERT INTO clients (id, name, nit, phone, email, address) VALUES (?, ?, ?, ?, ?, ?)").bind("client-restaurante", "Restaurante El Fogón, S.A.", "8473921-5", "5555-2180", "compras@elfogon.gt", "Zona 10, Ciudad de Guatemala"),
    db.prepare("INSERT INTO clients (id, name, nit, phone, email, address) VALUES (?, ?, ?, ?, ?, ?)").bind("client-panaderia", "Panadería San Martín", "3928174-2", "5512-8804", "administracion@panaderia.gt", "Zona 1, Mixco"),
    db.prepare("INSERT INTO clients (id, name, nit, phone, email, address) VALUES (?, ?, ?, ?, ?, ?)").bind("client-marta", "Marta López", "CF", "4789-3201", "", "Colonia Las Flores, Villa Nueva"),
    db.prepare("INSERT INTO catalog_items (id, kind, category, name, unit, price_cents, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("item-cylinder-25", "product", "Cilindros", "Cilindro de gas 25 lb", "unidad", 39500, 4, 3),
    db.prepare("INSERT INTO catalog_items (id, kind, category, name, unit, price_cents, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("item-cylinder-100", "product", "Cilindros", "Cilindro de gas 100 lb", "unidad", 128500, 1, 2),
    db.prepare("INSERT INTO catalog_items (id, kind, category, name, unit, price_cents, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("item-regulator", "product", "Repuestos", "Regulador industrial", "unidad", 47500, 2, 2),
    db.prepare("INSERT INTO catalog_items (id, kind, category, name, unit, price_cents, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("service-kitchen", "service", "Instalaciones", "Instalación de cocina industrial", "servicio", 185000, 0, 0),
    db.prepare("INSERT INTO catalog_items (id, kind, category, name, unit, price_cents, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("service-review", "service", "Mantenimiento", "Revisión de fuga y mantenimiento", "servicio", 45000, 0, 0),
    db.prepare("INSERT INTO appointments (id, client_id, client_name, title, service_type, date, time, address, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("appointment-1", "client-restaurante", "Restaurante El Fogón, S.A.", "Instalación de cocina industrial", "Instalación", "2026-07-14", "09:00", "Zona 10, Ciudad de Guatemala", "confirmed", "Llevar regulador industrial"),
    db.prepare("INSERT INTO appointments (id, client_id, client_name, title, service_type, date, time, address, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("appointment-2", "client-marta", "Marta López", "Entrega de cilindro 25 lb", "Entrega de gas", "2026-07-14", "14:30", "Colonia Las Flores, Villa Nueva", "pending", "Cobro contra entrega"),
    db.prepare("INSERT INTO appointments (id, client_id, client_name, title, service_type, date, time, address, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("appointment-3", "client-panaderia", "Panadería San Martín", "Revisión de línea de gas", "Mantenimiento", "2026-07-15", "08:30", "Zona 1, Mixco", "confirmed", "Solicitar acceso al área de hornos"),
  ]);
}
