import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nit: text("nit").notNull().default("CF"),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  address: text("address").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const catalogItems = sqliteTable("catalog_items", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["product", "service"] }).notNull(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("unidad"),
  priceCents: integer("price_cents").notNull(),
  stock: real("stock").notNull().default(0),
  minStock: real("min_stock").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appointments = sqliteTable("appointments", {
  id: text("id").primaryKey(),
  clientId: text("client_id").references(() => clients.id),
  clientName: text("client_name").notNull(),
  title: text("title").notNull(),
  serviceType: text("service_type").notNull(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  address: text("address").notNull().default(""),
  status: text("status", { enum: ["pending", "confirmed", "done"] }).notNull().default("pending"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => clients.id),
  clientName: text("client_name").notNull(),
  clientNit: text("client_nit").notNull(),
  documentType: text("document_type").notNull().default("FACT"),
  subtotalCents: integer("subtotal_cents").notNull(),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  status: text("status", { enum: ["draft", "certified", "cancelled"] }).notNull().default("draft"),
  felUuid: text("fel_uuid"),
  felSeries: text("fel_series"),
  felNumber: text("fel_number"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const invoiceItems = sqliteTable("invoice_items", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  catalogId: text("catalog_id").references(() => catalogItems.id),
  description: text("description").notNull(),
  quantity: real("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
});
