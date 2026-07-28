import { neon } from "@neondatabase/serverless";
import { isAuthenticated, unauthorized } from "../../lib/session";

export const runtime = "nodejs";

type InvoiceLinePayload = {
  catalogId?: string;
  description?: string;
  quantity?: number;
  unitPriceCents?: number;
  cabysCode?: string;
  unitCode?: string;
  taxRate?: number;
  isService?: boolean;
};

const electronicActivityCodes: Record<string, string> = {
  "4330.0": "454001",
  "4773.0": "523915",
  "3520.0": "402001",
  "4923.9": "602001",
};

function electronicActivityCode(sourceCode: string) {
  return electronicActivityCodes[sourceCode] || "";
}

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
      client_id TEXT REFERENCES clients(id),
      client_name TEXT NOT NULL,
      client_identification_type TEXT NOT NULL,
      client_identification_number TEXT NOT NULL,
      invoice_number TEXT NOT NULL DEFAULT '',
      issue_date TEXT NOT NULL DEFAULT '',
      observations TEXT NOT NULL DEFAULT '',
      document_type TEXT NOT NULL DEFAULT 'FE',
      currency TEXT NOT NULL DEFAULT 'CRC',
      subtotal_cents INTEGER NOT NULL,
      tax_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'certified', 'cancelled')),
      hacienda_key TEXT,
      hacienda_consecutive TEXT,
      hacienda_status TEXT,
      economic_activity_code TEXT NOT NULL DEFAULT '',
      sale_condition TEXT NOT NULL DEFAULT '01',
      credit_term TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT '04',
      hacienda_signed_xml_enc TEXT NOT NULL DEFAULT '',
      hacienda_response_xml_enc TEXT NOT NULL DEFAULT '',
      hacienda_error TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS identification_type TEXT NOT NULL DEFAULT '01'`;
    await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS identification_number TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE clients DROP COLUMN IF EXISTS nit`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_identification_type TEXT NOT NULL DEFAULT '01'`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_identification_number TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issue_date TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS observations TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CRC'`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_key TEXT`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_consecutive TEXT`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_status TEXT`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS economic_activity_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sale_condition TEXT NOT NULL DEFAULT '01'`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credit_term TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT '04'`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_signed_xml_enc TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_response_xml_enc TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_error TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ALTER COLUMN client_id DROP NOT NULL`;
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
      total_cents INTEGER NOT NULL,
      cabys_code TEXT NOT NULL DEFAULT '',
      unit_code TEXT NOT NULL DEFAULT 'Unid',
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 13,
      tax_cents INTEGER NOT NULL DEFAULT 0,
      is_service BOOLEAN NOT NULL DEFAULT FALSE
    )`;
    await sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cabys_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit_code TEXT NOT NULL DEFAULT 'Unid'`;
    await sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 13`;
    await sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tax_cents INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`CREATE TABLE IF NOT EXISTS business_settings (
      id TEXT PRIMARY KEY,
      business_name TEXT NOT NULL DEFAULT 'GAS LP SOLUCIONES',
      business_email TEXT NOT NULL DEFAULT '',
      business_phone TEXT NOT NULL DEFAULT '',
      business_address TEXT NOT NULL DEFAULT '',
      taxpayer_role TEXT NOT NULL DEFAULT 'taxpayer' CHECK (taxpayer_role IN ('taxpayer', 'associate')),
      taxpayer_identification_type TEXT NOT NULL DEFAULT '01',
      taxpayer_identification_number TEXT NOT NULL DEFAULT '',
      taxpayer_name TEXT NOT NULL DEFAULT '',
      trade_name TEXT NOT NULL DEFAULT '',
      economic_activity_code TEXT NOT NULL DEFAULT '',
      tax_regime TEXT NOT NULL DEFAULT '',
      invoice_email TEXT NOT NULL DEFAULT '',
      associate_identification_type TEXT NOT NULL DEFAULT '01',
      associate_identification_number TEXT NOT NULL DEFAULT '',
      associate_name TEXT NOT NULL DEFAULT '',
      establishment_code TEXT NOT NULL DEFAULT '001',
      terminal_code TEXT NOT NULL DEFAULT '00001',
      provider_system_identification TEXT NOT NULL DEFAULT '',
      province_code TEXT NOT NULL DEFAULT '',
      canton_code TEXT NOT NULL DEFAULT '',
      district_code TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      rut_status TEXT NOT NULL DEFAULT '',
      rut_omiso TEXT NOT NULL DEFAULT '',
      rut_moroso TEXT NOT NULL DEFAULT '',
      rut_checked_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS province_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS canton_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS district_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS postal_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS rut_status TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS rut_omiso TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS rut_moroso TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS rut_checked_at TIMESTAMPTZ`;
    await sql`CREATE TABLE IF NOT EXISTS economic_activities (
      code TEXT PRIMARY KEY,
      source_code TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'A',
      activity_type TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    for (const [sourceCode, code] of Object.entries(electronicActivityCodes)) {
      const previousCode = sourceCode.replace(".", "").padEnd(6, "0").slice(0, 6);
      await sql`
        INSERT INTO economic_activities (code, source_code, description, status, activity_type, updated_at)
        SELECT ${code}, source_code, description, status, activity_type, NOW()
        FROM economic_activities
        WHERE source_code = ${sourceCode}
        ORDER BY updated_at DESC
        LIMIT 1
        ON CONFLICT (code) DO UPDATE SET
          source_code = EXCLUDED.source_code,
          description = EXCLUDED.description,
          status = EXCLUDED.status,
          activity_type = EXCLUDED.activity_type,
          updated_at = NOW()
      `;
      await sql`DELETE FROM economic_activities WHERE source_code = ${sourceCode} AND code <> ${code}`;
      await sql`UPDATE business_settings SET economic_activity_code = ${code}, updated_at = NOW() WHERE economic_activity_code = ${previousCode}`;
    }
    await sql`CREATE TABLE IF NOT EXISTS hacienda_credentials (
      id TEXT PRIMARY KEY,
      environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
      api_username_enc TEXT NOT NULL DEFAULT '',
      api_password_enc TEXT NOT NULL DEFAULT '',
      certificate_enc TEXT NOT NULL DEFAULT '',
      certificate_pin_enc TEXT NOT NULL DEFAULT '',
      certificate_filename TEXT NOT NULL DEFAULT '',
      last_sequence BIGINT NOT NULL DEFAULT 0,
      rut_system_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      sequence_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`ALTER TABLE hacienda_credentials ADD COLUMN IF NOT EXISTS sequence_confirmed BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`UPDATE hacienda_credentials SET rut_system_confirmed = FALSE WHERE environment = 'sandbox' AND rut_system_confirmed = TRUE`;
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
    if (!(await isAuthenticated())) return unauthorized();
    const sql = getSql();
    const [clients, catalog, appointments, invoices, invoiceItems, settingsRows, activities, credentialRows] = await Promise.all([
      sql`SELECT id, name, identification_type AS "identificationType", identification_number AS "identificationNumber", phone, email, address FROM clients ORDER BY name`,
      sql`SELECT id, kind, category, name, unit, price_cents AS "priceCents", stock, min_stock AS "minStock" FROM catalog_items WHERE active = TRUE ORDER BY kind, category, name`,
      sql`SELECT id, client_id AS "clientId", client_name AS "clientName", title, service_type AS "serviceType", date, time, address, status, notes FROM appointments ORDER BY date, time`,
      sql`SELECT id, client_id AS "clientId", client_name AS "clientName", client_identification_type AS "clientIdentificationType", client_identification_number AS "clientIdentificationNumber", invoice_number AS "invoiceNumber", issue_date AS "issueDate", observations, currency, subtotal_cents AS "subtotalCents", tax_cents AS "taxCents", total_cents AS "totalCents", status, economic_activity_code AS "economicActivityCode", sale_condition AS "saleCondition", credit_term AS "creditTerm", payment_method AS "paymentMethod", hacienda_key AS "haciendaKey", hacienda_consecutive AS "haciendaConsecutive", hacienda_status AS "haciendaStatus", hacienda_error AS "haciendaError", created_at AS "createdAt" FROM invoices ORDER BY created_at DESC LIMIT 50`,
      sql`SELECT invoice_id AS "invoiceId", description, quantity, unit_price_cents AS "unitPriceCents", total_cents AS "totalCents", cabys_code AS "cabysCode", unit_code AS "unitCode", tax_rate AS "taxRate", tax_cents AS "taxCents", is_service AS "isService" FROM invoice_items ORDER BY id`,
      sql`SELECT business_name AS "businessName", business_email AS "businessEmail", business_phone AS "businessPhone", business_address AS "businessAddress", taxpayer_role AS "taxpayerRole", taxpayer_identification_type AS "taxpayerIdentificationType", taxpayer_identification_number AS "taxpayerIdentificationNumber", taxpayer_name AS "taxpayerName", trade_name AS "tradeName", economic_activity_code AS "economicActivityCode", tax_regime AS "taxRegime", invoice_email AS "invoiceEmail", associate_identification_type AS "associateIdentificationType", associate_identification_number AS "associateIdentificationNumber", associate_name AS "associateName", establishment_code AS "establishmentCode", terminal_code AS "terminalCode", provider_system_identification AS "providerSystemIdentification", province_code AS "provinceCode", canton_code AS "cantonCode", district_code AS "districtCode", postal_code AS "postalCode", rut_status AS "rutStatus", rut_omiso AS "rutOmiso", rut_moroso AS "rutMoroso", rut_checked_at AS "rutCheckedAt" FROM business_settings WHERE id = 'default' LIMIT 1`,
      sql`SELECT code, source_code AS "sourceCode", description, status, activity_type AS "activityType" FROM economic_activities ORDER BY code`,
      sql`SELECT environment, (api_username_enc <> '') AS "hasApiUsername", (api_password_enc <> '') AS "hasApiPassword", (certificate_enc <> '') AS "hasCertificate", (certificate_pin_enc <> '') AS "hasCertificatePin", certificate_filename AS "certificateFilename", last_sequence AS "lastSequence", rut_system_confirmed AS "rutSystemConfirmed", sequence_confirmed AS "sequenceConfirmed", updated_at AS "updatedAt" FROM hacienda_credentials WHERE id = 'default' LIMIT 1`,
    ]);
    const linesByInvoice = (invoiceItems as Array<Record<string, unknown>>).reduce<Record<string, Array<Record<string, unknown>>>>((acc, item) => {
      const invoiceId = String(item.invoiceId);
      (acc[invoiceId] ??= []).push({
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        totalCents: item.totalCents,
        cabysCode: item.cabysCode,
        unitCode: item.unitCode,
        taxRate: Number(item.taxRate),
        taxCents: item.taxCents,
        isService: item.isService,
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
      settings: settingsRows[0] ?? {
        businessName: "GAS LP SOLUCIONES",
        businessEmail: "",
        businessPhone: "",
        businessAddress: "",
        taxpayerRole: "taxpayer",
        taxpayerIdentificationType: "01",
        taxpayerIdentificationNumber: "",
        taxpayerName: "",
        tradeName: "GAS LP SOLUCIONES",
        economicActivityCode: "",
        taxRegime: "",
        invoiceEmail: "",
        associateIdentificationType: "01",
        associateIdentificationNumber: "",
        associateName: "",
        establishmentCode: "001",
        terminalCode: "00001",
        providerSystemIdentification: "",
        provinceCode: "",
        cantonCode: "",
        districtCode: "",
        postalCode: "",
        rutStatus: "",
        rutOmiso: "",
        rutMoroso: "",
        rutCheckedAt: null,
      },
      economicActivities: activities,
      hacienda: credentialRows[0] ?? {
        environment: "sandbox",
        hasApiUsername: false,
        hasApiPassword: false,
        hasCertificate: false,
        hasCertificatePin: false,
        certificateFilename: "",
        lastSequence: 0,
        rutSystemConfirmed: false,
        sequenceConfirmed: false,
        updatedAt: null,
      },
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    if (!(await isAuthenticated())) return unauthorized();
    const sql = getSql();
    const payload = (await request.json()) as Record<string, unknown>;
    const action = value(payload, "action");

    if (action === "create_client") {
      const name = value(payload, "name");
      const identificationType = value(payload, "identificationType");
      const identificationNumber = value(payload, "identificationNumber").replace(/[\s-]/g, "");
      if (!name) return Response.json({ error: "El nombre del cliente es obligatorio." }, { status: 400 });
      if (identificationNumber) {
        const formatError = identificationError(identificationType, identificationNumber);
        if (formatError) return Response.json({ error: formatError }, { status: 400 });
      }
      const clientId = id("client");
      await sql`INSERT INTO clients (id, name, identification_type, identification_number, phone, email, address) VALUES (${clientId}, ${name}, ${identificationNumber ? identificationType : ""}, ${identificationNumber}, ${value(payload, "phone")}, ${value(payload, "email")}, ${value(payload, "address")})`;
      return Response.json({ id: clientId }, { status: 201 });
    }

    if (action === "save_settings") {
      const taxpayerRole = value(payload, "taxpayerRole") === "associate" ? "associate" : "taxpayer";
      const taxpayerIdentificationType = value(payload, "taxpayerIdentificationType") || "01";
      const taxpayerIdentificationNumber = value(payload, "taxpayerIdentificationNumber").replace(/[\s-]/g, "");
      const associateIdentificationType = value(payload, "associateIdentificationType") || "01";
      const associateIdentificationNumber = value(payload, "associateIdentificationNumber").replace(/[\s-]/g, "");
      const economicActivityCode = value(payload, "economicActivityCode");
      const establishmentCode = value(payload, "establishmentCode") || "001";
      const terminalCode = value(payload, "terminalCode") || "00001";
      if (taxpayerIdentificationNumber) {
        const formatError = identificationError(taxpayerIdentificationType, taxpayerIdentificationNumber);
        if (formatError) return Response.json({ error: formatError }, { status: 400 });
      }
      if (taxpayerRole === "associate" && associateIdentificationNumber) {
        const formatError = identificationError(associateIdentificationType, associateIdentificationNumber);
        if (formatError) return Response.json({ error: `Asociado: ${formatError}` }, { status: 400 });
      }
      if (economicActivityCode && !/^\d{6}$/.test(economicActivityCode)) return Response.json({ error: "La actividad económica debe contener 6 dígitos." }, { status: 400 });
      if (!/^\d{3}$/.test(establishmentCode)) return Response.json({ error: "La sucursal debe contener 3 dígitos." }, { status: 400 });
      if (!/^\d{5}$/.test(terminalCode)) return Response.json({ error: "La terminal debe contener 5 dígitos." }, { status: 400 });
      await sql`INSERT INTO business_settings (id, business_name, business_email, business_phone, business_address, taxpayer_role, taxpayer_identification_type, taxpayer_identification_number, taxpayer_name, trade_name, economic_activity_code, tax_regime, invoice_email, associate_identification_type, associate_identification_number, associate_name, establishment_code, terminal_code, provider_system_identification, province_code, canton_code, district_code, postal_code, updated_at) VALUES ('default', ${value(payload, "businessName") || "GAS LP SOLUCIONES"}, ${value(payload, "businessEmail")}, ${value(payload, "businessPhone")}, ${value(payload, "businessAddress")}, ${taxpayerRole}, ${taxpayerIdentificationType}, ${taxpayerIdentificationNumber}, ${value(payload, "taxpayerName")}, ${value(payload, "tradeName")}, ${economicActivityCode}, ${value(payload, "taxRegime")}, ${value(payload, "invoiceEmail")}, ${associateIdentificationType}, ${associateIdentificationNumber}, ${value(payload, "associateName")}, ${establishmentCode}, ${terminalCode}, ${value(payload, "providerSystemIdentification")}, ${value(payload, "provinceCode")}, ${value(payload, "cantonCode")}, ${value(payload, "districtCode")}, ${value(payload, "postalCode")}, NOW()) ON CONFLICT (id) DO UPDATE SET business_name = EXCLUDED.business_name, business_email = EXCLUDED.business_email, business_phone = EXCLUDED.business_phone, business_address = EXCLUDED.business_address, taxpayer_role = EXCLUDED.taxpayer_role, taxpayer_identification_type = EXCLUDED.taxpayer_identification_type, taxpayer_identification_number = EXCLUDED.taxpayer_identification_number, taxpayer_name = EXCLUDED.taxpayer_name, trade_name = EXCLUDED.trade_name, economic_activity_code = EXCLUDED.economic_activity_code, tax_regime = EXCLUDED.tax_regime, invoice_email = EXCLUDED.invoice_email, associate_identification_type = EXCLUDED.associate_identification_type, associate_identification_number = EXCLUDED.associate_identification_number, associate_name = EXCLUDED.associate_name, establishment_code = EXCLUDED.establishment_code, terminal_code = EXCLUDED.terminal_code, provider_system_identification = EXCLUDED.provider_system_identification, province_code = EXCLUDED.province_code, canton_code = EXCLUDED.canton_code, district_code = EXCLUDED.district_code, postal_code = EXCLUDED.postal_code, updated_at = NOW()`;
      return Response.json({ ok: true });
    }

    if (action === "sync_taxpayer") {
      const identification = value(payload, "identification").replace(/\D/g, "");
      if (!/^\d{9,12}$/.test(identification)) {
        return Response.json({ error: "La identificación para consultar Hacienda no es válida." }, { status: 400 });
      }
      const response = await fetch(`https://api.hacienda.go.cr/fe/ae?identificacion=${encodeURIComponent(identification)}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        return Response.json({ error: "Hacienda no devolvió información para esa identificación." }, { status: response.status });
      }
      const taxpayer = (await response.json()) as {
        nombre?: string;
        tipoIdentificacion?: string;
        regimen?: { descripcion?: string };
        situacion?: { estado?: string; omiso?: string; moroso?: string };
        actividades?: Array<{ codigo?: string; descripcion?: string; estado?: string; tipo?: string }>;
      };
      await sql`INSERT INTO business_settings (id, taxpayer_identification_type, taxpayer_identification_number, taxpayer_name, tax_regime, provider_system_identification, rut_status, rut_omiso, rut_moroso, rut_checked_at, updated_at) VALUES ('default', ${taxpayer.tipoIdentificacion || "01"}, ${identification}, ${taxpayer.nombre || ""}, ${taxpayer.regimen?.descripcion || ""}, ${identification}, ${taxpayer.situacion?.estado || ""}, ${taxpayer.situacion?.omiso || ""}, ${taxpayer.situacion?.moroso || ""}, NOW(), NOW()) ON CONFLICT (id) DO UPDATE SET taxpayer_identification_type = EXCLUDED.taxpayer_identification_type, taxpayer_identification_number = EXCLUDED.taxpayer_identification_number, taxpayer_name = EXCLUDED.taxpayer_name, tax_regime = EXCLUDED.tax_regime, provider_system_identification = EXCLUDED.provider_system_identification, rut_status = EXCLUDED.rut_status, rut_omiso = EXCLUDED.rut_omiso, rut_moroso = EXCLUDED.rut_moroso, rut_checked_at = NOW(), updated_at = NOW()`;
      for (const activity of taxpayer.actividades ?? []) {
        const sourceCode = String(activity.codigo ?? "");
        const code = electronicActivityCode(sourceCode);
        if (!/^\d{6}$/.test(code)) continue;
        await sql`INSERT INTO economic_activities (code, source_code, description, status, activity_type, updated_at) VALUES (${code}, ${sourceCode}, ${String(activity.descripcion ?? "")}, ${String(activity.estado ?? "")}, ${String(activity.tipo ?? "")}, NOW()) ON CONFLICT (code) DO UPDATE SET source_code = EXCLUDED.source_code, description = EXCLUDED.description, status = EXCLUDED.status, activity_type = EXCLUDED.activity_type, updated_at = NOW()`;
      }
      return Response.json({ ok: true });
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
      const clientRows = clientId
        ? await sql`SELECT name, identification_type AS "identificationType", identification_number AS "identificationNumber" FROM clients WHERE id = ${clientId} LIMIT 1`
        : [];
      const client = clientRows[0] as { name?: string; identificationType?: string; identificationNumber?: string } | undefined;
      const clientName = value(payload, "clientName") || client?.name || "";
      const clientIdentificationType = value(payload, "clientIdentificationType") || client?.identificationType || "";
      const clientIdentificationNumber = value(payload, "clientIdentificationNumber") || client?.identificationNumber || "";
      const invoiceNumber = value(payload, "invoiceNumber");
      const issueDate = value(payload, "issueDate");
      const observations = value(payload, "observations");
      const economicActivityCode = value(payload, "economicActivityCode");
      const saleCondition = value(payload, "saleCondition") || "01";
      const creditTerm = value(payload, "creditTerm");
      const paymentMethod = value(payload, "paymentMethod") || "04";
      const lines = Array.isArray(payload.lines) ? (payload.lines as InvoiceLinePayload[]) : [];
      if (!clientName || !invoiceNumber || !issueDate || lines.length === 0) return Response.json({ error: "Completa cliente, número, fecha y al menos una línea." }, { status: 400 });
      const safeLines = lines.map((line) => ({
        catalogId: String(line.catalogId ?? ""),
        description: String(line.description ?? "").trim(),
        quantity: Number(line.quantity),
        unitPriceCents: Math.round(Number(line.unitPriceCents)),
        cabysCode: String(line.cabysCode ?? "").replace(/\D/g, ""),
        unitCode: String(line.unitCode ?? "Unid"),
        taxRate: Number(line.taxRate ?? 13),
        isService: Boolean(line.isService),
      })).filter((line) => line.description && line.quantity > 0 && line.unitPriceCents >= 0);
      if (safeLines.length === 0) return Response.json({ error: "Las líneas de la factura no son válidas." }, { status: 400 });
      const invoiceId = id("invoice");
      const subtotalCents = safeLines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPriceCents), 0);
      const taxCents = safeLines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPriceCents * line.taxRate / 100), 0);
      const totalCents = subtotalCents + taxCents;
      await sql`INSERT INTO invoices (id, client_id, client_name, client_identification_type, client_identification_number, invoice_number, issue_date, observations, currency, subtotal_cents, tax_cents, total_cents, status, economic_activity_code, sale_condition, credit_term, payment_method) VALUES (${invoiceId}, ${client?.name ? clientId : null}, ${clientName}, ${clientIdentificationType}, ${clientIdentificationNumber}, ${invoiceNumber}, ${issueDate}, ${observations}, 'CRC', ${subtotalCents}, ${taxCents}, ${totalCents}, 'draft', ${economicActivityCode}, ${saleCondition}, ${creditTerm}, ${paymentMethod})`;
      for (const line of safeLines) {
        const lineSubtotalCents = Math.round(line.quantity * line.unitPriceCents);
        const lineTaxCents = Math.round(lineSubtotalCents * line.taxRate / 100);
        await sql`INSERT INTO invoice_items (id, invoice_id, catalog_id, description, quantity, unit_price_cents, total_cents, cabys_code, unit_code, tax_rate, tax_cents, is_service) VALUES (${id("line")}, ${invoiceId}, ${line.catalogId || null}, ${line.description}, ${line.quantity}, ${line.unitPriceCents}, ${lineSubtotalCents + lineTaxCents}, ${line.cabysCode}, ${line.unitCode}, ${line.taxRate}, ${lineTaxCents}, ${line.isService})`;
      }
      return Response.json({
        invoice: {
          id: invoiceId,
          invoiceNumber,
          issueDate,
          clientName,
          clientIdentificationType,
          clientIdentificationNumber,
          observations,
          currency: "CRC",
          subtotalCents,
          taxCents,
          totalCents,
          status: "draft",
          economicActivityCode,
          saleCondition,
          creditTerm,
          paymentMethod,
          haciendaKey: "",
          haciendaConsecutive: "",
          haciendaStatus: "",
          haciendaError: "",
          createdAt: new Date().toISOString(),
          lines: safeLines.map((line) => {
            const lineSubtotalCents = Math.round(line.quantity * line.unitPriceCents);
            const lineTaxCents = Math.round(lineSubtotalCents * line.taxRate / 100);
            return { ...line, taxCents: lineTaxCents, totalCents: lineSubtotalCents + lineTaxCents };
          }),
        },
      }, { status: 201 });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return routeError(error);
  }
}
