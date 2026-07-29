import { neon } from "@neondatabase/serverless";
import { ensureHaciendaStorage } from "../../lib/hacienda-storage";
import { isAuthenticated, readAccount, unauthorized } from "../../lib/session";

export const runtime = "nodejs";

type InvoiceLinePayload = {
  catalogId?: string;
  description?: string;
  quantity?: number;
  unitPriceCents?: number;
  cabysCode?: string;
  unitCode?: string;
  taxRate?: number;
  taxRateCode?: string;
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

const taxRatesByCode: Record<string, number> = {
  "01": 0,
  "02": 1,
  "03": 2,
  "04": 4,
  "08": 13,
  "09": 0.5,
  "10": 0,
  "11": 0,
};

function locationError(province: string, canton: string, district: string, address: string) {
  if (!/^[1-7]$/.test(province)) return "Selecciona una provincia válida.";
  if (!/^\d{2}$/.test(canton)) return "El cantón debe contener 2 dígitos.";
  if (!/^\d{2}$/.test(district)) return "El distrito debe contener 2 dígitos.";
  if (address.length < 5) return "Escribe las otras señas de la dirección.";
  return "";
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
      province_code TEXT NOT NULL DEFAULT '',
      canton_code TEXT NOT NULL DEFAULT '',
      district_code TEXT NOT NULL DEFAULT '',
      economic_activity_code TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS province_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS canton_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS district_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS economic_activity_code TEXT NOT NULL DEFAULT ''`;
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
      client_email TEXT NOT NULL DEFAULT '',
      client_province_code TEXT NOT NULL DEFAULT '',
      client_canton_code TEXT NOT NULL DEFAULT '',
      client_district_code TEXT NOT NULL DEFAULT '',
      client_address TEXT NOT NULL DEFAULT '',
      receiver_activity_code TEXT NOT NULL DEFAULT '',
      invoice_number TEXT NOT NULL DEFAULT '',
      issue_date TEXT NOT NULL DEFAULT '',
      observations TEXT NOT NULL DEFAULT '',
      document_type TEXT NOT NULL DEFAULT 'commercial',
      currency TEXT NOT NULL DEFAULT 'CRC',
      subtotal_cents INTEGER NOT NULL,
      tax_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'certified', 'cancelled')),
      hacienda_key TEXT,
      hacienda_consecutive TEXT,
      hacienda_status TEXT,
      hacienda_environment TEXT NOT NULL DEFAULT '',
      economic_activity_code TEXT NOT NULL DEFAULT '',
      sale_condition TEXT NOT NULL DEFAULT '01',
      credit_term TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT '04',
      hacienda_signed_xml_enc TEXT NOT NULL DEFAULT '',
      hacienda_response_xml_enc TEXT NOT NULL DEFAULT '',
      hacienda_error TEXT NOT NULL DEFAULT '',
      hacienda_emission_date TEXT NOT NULL DEFAULT '',
      reference_invoice_id TEXT REFERENCES invoices(id),
      reference_key TEXT NOT NULL DEFAULT '',
      reference_document_type TEXT NOT NULL DEFAULT '',
      reference_date TEXT NOT NULL DEFAULT '',
      reference_code TEXT NOT NULL DEFAULT '',
      reference_reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS identification_type TEXT NOT NULL DEFAULT '01'`;
    await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS identification_number TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE clients DROP COLUMN IF EXISTS nit`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_identification_type TEXT NOT NULL DEFAULT '01'`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_identification_number TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_email TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_province_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_canton_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_district_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_address TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receiver_activity_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issue_date TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS observations TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CRC'`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_key TEXT`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_consecutive TEXT`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_status TEXT`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_environment TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS economic_activity_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sale_condition TEXT NOT NULL DEFAULT '01'`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credit_term TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT '04'`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_signed_xml_enc TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_response_xml_enc TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_error TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hacienda_emission_date TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference_invoice_id TEXT REFERENCES invoices(id)`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference_key TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference_document_type TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference_date TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference_reason TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoices ALTER COLUMN client_id DROP NOT NULL`;
    await sql`ALTER TABLE invoices ALTER COLUMN document_type SET DEFAULT 'commercial'`;
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
      tax_rate_code TEXT NOT NULL DEFAULT '08',
      tax_cents INTEGER NOT NULL DEFAULT 0,
      is_service BOOLEAN NOT NULL DEFAULT FALSE
    )`;
    await sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cabys_code TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit_code TEXT NOT NULL DEFAULT 'Unid'`;
    await sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 13`;
    await sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tax_rate_code TEXT NOT NULL DEFAULT '08'`;
    await sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tax_cents INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`UPDATE invoice_items SET tax_rate_code = CASE
      WHEN tax_rate = 13 THEN '08'
      WHEN tax_rate = 4 THEN '04'
      WHEN tax_rate = 2 THEN '03'
      WHEN tax_rate = 1 THEN '02'
      WHEN tax_rate = 0.5 THEN '09'
      WHEN tax_rate = 0 THEN '11'
      ELSE tax_rate_code
    END WHERE tax_rate_code = '' OR tax_rate_code IS NULL`;
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
    await ensureHaciendaStorage(sql);
    await sql`CREATE TABLE IF NOT EXISTS electronic_events (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS appointments_date_idx ON appointments(date, time)`;
    await sql`CREATE INDEX IF NOT EXISTS invoices_created_idx ON invoices(created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON invoice_items(invoice_id)`;
    await sql`CREATE INDEX IF NOT EXISTS electronic_events_invoice_idx ON electronic_events(invoice_id, created_at)`;
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
    const [clients, catalog, appointments, invoices, invoiceItems, settingsRows, activities, credentialRows, runtimeRows] = await Promise.all([
      sql`SELECT id, name, identification_type AS "identificationType", identification_number AS "identificationNumber", phone, email, address, province_code AS "provinceCode", canton_code AS "cantonCode", district_code AS "districtCode", economic_activity_code AS "economicActivityCode" FROM clients ORDER BY name`,
      sql`SELECT id, kind, category, name, unit, price_cents AS "priceCents", stock, min_stock AS "minStock" FROM catalog_items WHERE active = TRUE ORDER BY kind, category, name`,
      sql`SELECT id, client_id AS "clientId", client_name AS "clientName", title, service_type AS "serviceType", date, time, address, status, notes FROM appointments ORDER BY date, time`,
      sql`SELECT i.id, i.client_id AS "clientId", i.client_name AS "clientName", i.client_identification_type AS "clientIdentificationType", i.client_identification_number AS "clientIdentificationNumber", COALESCE(NULLIF(i.client_email, ''), c.email, '') AS "clientEmail", COALESCE(NULLIF(i.client_province_code, ''), c.province_code, '') AS "clientProvinceCode", COALESCE(NULLIF(i.client_canton_code, ''), c.canton_code, '') AS "clientCantonCode", COALESCE(NULLIF(i.client_district_code, ''), c.district_code, '') AS "clientDistrictCode", COALESCE(NULLIF(i.client_address, ''), c.address, '') AS "clientAddress", i.receiver_activity_code AS "receiverActivityCode", i.invoice_number AS "invoiceNumber", i.issue_date AS "issueDate", i.observations, i.document_type AS "documentType", i.currency, i.subtotal_cents AS "subtotalCents", i.tax_cents AS "taxCents", i.total_cents AS "totalCents", i.status, i.economic_activity_code AS "economicActivityCode", i.sale_condition AS "saleCondition", i.credit_term AS "creditTerm", i.payment_method AS "paymentMethod", i.hacienda_key AS "haciendaKey", i.hacienda_consecutive AS "haciendaConsecutive", i.hacienda_status AS "haciendaStatus", i.hacienda_environment AS "haciendaEnvironment", i.hacienda_error AS "haciendaError", i.hacienda_emission_date AS "haciendaEmissionDate", i.reference_invoice_id AS "referenceInvoiceId", i.reference_key AS "referenceKey", i.reference_document_type AS "referenceDocumentType", i.reference_date AS "referenceDate", i.reference_code AS "referenceCode", i.reference_reason AS "referenceReason", i.created_at AS "createdAt" FROM invoices i LEFT JOIN clients c ON c.id = i.client_id ORDER BY i.created_at DESC LIMIT 100`,
      sql`SELECT invoice_id AS "invoiceId", description, quantity, unit_price_cents AS "unitPriceCents", total_cents AS "totalCents", cabys_code AS "cabysCode", unit_code AS "unitCode", tax_rate AS "taxRate", tax_rate_code AS "taxRateCode", tax_cents AS "taxCents", is_service AS "isService" FROM invoice_items ORDER BY id`,
      sql`SELECT business_name AS "businessName", business_email AS "businessEmail", business_phone AS "businessPhone", business_address AS "businessAddress", taxpayer_role AS "taxpayerRole", taxpayer_identification_type AS "taxpayerIdentificationType", taxpayer_identification_number AS "taxpayerIdentificationNumber", taxpayer_name AS "taxpayerName", trade_name AS "tradeName", economic_activity_code AS "economicActivityCode", tax_regime AS "taxRegime", invoice_email AS "invoiceEmail", associate_identification_type AS "associateIdentificationType", associate_identification_number AS "associateIdentificationNumber", associate_name AS "associateName", establishment_code AS "establishmentCode", terminal_code AS "terminalCode", provider_system_identification AS "providerSystemIdentification", province_code AS "provinceCode", canton_code AS "cantonCode", district_code AS "districtCode", postal_code AS "postalCode", rut_status AS "rutStatus", rut_omiso AS "rutOmiso", rut_moroso AS "rutMoroso", rut_checked_at AS "rutCheckedAt" FROM business_settings WHERE id = 'default' LIMIT 1`,
      sql`SELECT code, source_code AS "sourceCode", description, status, activity_type AS "activityType" FROM economic_activities ORDER BY code`,
      sql`SELECT id, environment, (api_username_enc <> '') AS "hasApiUsername", (api_password_enc <> '') AS "hasApiPassword", (certificate_enc <> '') AS "hasCertificate", (certificate_pin_enc <> '') AS "hasCertificatePin", certificate_filename AS "certificateFilename", last_sequence_fe AS "lastSequenceFE", last_sequence_te AS "lastSequenceTE", last_sequence_nc AS "lastSequenceNC", rut_system_confirmed AS "rutSystemConfirmed", sequence_confirmed AS "sequenceConfirmed", production_live_confirmed AS "productionLiveConfirmed", updated_at AS "updatedAt" FROM hacienda_credentials WHERE id IN ('sandbox', 'production')`,
      sql`SELECT active_environment AS "activeEnvironment" FROM hacienda_runtime WHERE id = 'default' LIMIT 1`,
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
        taxRateCode: item.taxRateCode,
        taxCents: item.taxCents,
        isService: item.isService,
      });
      return acc;
    }, {});
    const emptyCredentialProfile = {
      hasApiUsername: false,
      hasApiPassword: false,
      hasCertificate: false,
      hasCertificatePin: false,
      certificateFilename: "",
      lastSequenceFE: 0,
      lastSequenceTE: 0,
      lastSequenceNC: 0,
      rutSystemConfirmed: false,
      sequenceConfirmed: false,
      productionLiveConfirmed: false,
      updatedAt: null,
    };
    const profiles = Object.fromEntries(
      (credentialRows as Array<Record<string, unknown>>).map((row) => [String(row.environment), {
        ...emptyCredentialProfile,
        ...row,
      }]),
    ) as Record<string, Record<string, unknown>>;
    profiles.sandbox ??= { ...emptyCredentialProfile };
    profiles.production ??= { ...emptyCredentialProfile };
    const activeEnvironment = String(runtimeRows[0]?.activeEnvironment || "sandbox") === "production" ? "production" : "sandbox";
    const activeProfile = profiles[activeEnvironment] || emptyCredentialProfile;

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
      account: { username: (await readAccount()).username },
      hacienda: {
        environment: activeEnvironment,
        ...activeProfile,
        profiles,
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
      const provinceCode = value(payload, "provinceCode");
      const cantonCode = value(payload, "cantonCode");
      const districtCode = value(payload, "districtCode");
      const address = value(payload, "address");
      const economicActivityCode = value(payload, "economicActivityCode");
      const hasLocation = Boolean(provinceCode || cantonCode || districtCode);
      if (hasLocation) {
        const formatError = locationError(provinceCode, cantonCode, districtCode, address);
        if (formatError) return Response.json({ error: formatError }, { status: 400 });
      }
      if (economicActivityCode && !/^\d{6}$/.test(economicActivityCode)) {
        return Response.json({ error: "La actividad económica del cliente debe contener 6 dígitos." }, { status: 400 });
      }
      const clientId = id("client");
      await sql`INSERT INTO clients (id, name, identification_type, identification_number, phone, email, address, province_code, canton_code, district_code, economic_activity_code) VALUES (${clientId}, ${name}, ${identificationNumber ? identificationType : ""}, ${identificationNumber}, ${value(payload, "phone")}, ${value(payload, "email")}, ${address}, ${provinceCode}, ${cantonCode}, ${districtCode}, ${economicActivityCode})`;
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
      const provinceCode = value(payload, "provinceCode");
      const cantonCode = value(payload, "cantonCode");
      const districtCode = value(payload, "districtCode");
      const businessAddress = value(payload, "businessAddress");
      const postalCode = value(payload, "postalCode");
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
      const hasLocation = Boolean(provinceCode || cantonCode || districtCode || businessAddress);
      if (hasLocation) {
        const formatError = locationError(provinceCode, cantonCode, districtCode, businessAddress);
        if (formatError) return Response.json({ error: `Emisor: ${formatError}` }, { status: 400 });
      }
      if (postalCode && !/^\d{5}$/.test(postalCode)) return Response.json({ error: "El código postal debe contener 5 dígitos." }, { status: 400 });
      await sql`INSERT INTO business_settings (id, business_name, business_email, business_phone, business_address, taxpayer_role, taxpayer_identification_type, taxpayer_identification_number, taxpayer_name, trade_name, economic_activity_code, tax_regime, invoice_email, associate_identification_type, associate_identification_number, associate_name, establishment_code, terminal_code, provider_system_identification, province_code, canton_code, district_code, postal_code, updated_at) VALUES ('default', ${value(payload, "businessName") || "GAS LP SOLUCIONES"}, ${value(payload, "businessEmail")}, ${value(payload, "businessPhone")}, ${businessAddress}, ${taxpayerRole}, ${taxpayerIdentificationType}, ${taxpayerIdentificationNumber}, ${value(payload, "taxpayerName")}, ${value(payload, "tradeName")}, ${economicActivityCode}, ${value(payload, "taxRegime")}, ${value(payload, "invoiceEmail")}, ${associateIdentificationType}, ${associateIdentificationNumber}, ${value(payload, "associateName")}, ${establishmentCode}, ${terminalCode}, ${value(payload, "providerSystemIdentification")}, ${provinceCode}, ${cantonCode}, ${districtCode}, ${postalCode}, NOW()) ON CONFLICT (id) DO UPDATE SET business_name = EXCLUDED.business_name, business_email = EXCLUDED.business_email, business_phone = EXCLUDED.business_phone, business_address = EXCLUDED.business_address, taxpayer_role = EXCLUDED.taxpayer_role, taxpayer_identification_type = EXCLUDED.taxpayer_identification_type, taxpayer_identification_number = EXCLUDED.taxpayer_identification_number, taxpayer_name = EXCLUDED.taxpayer_name, trade_name = EXCLUDED.trade_name, economic_activity_code = EXCLUDED.economic_activity_code, tax_regime = EXCLUDED.tax_regime, invoice_email = EXCLUDED.invoice_email, associate_identification_type = EXCLUDED.associate_identification_type, associate_identification_number = EXCLUDED.associate_identification_number, associate_name = EXCLUDED.associate_name, establishment_code = EXCLUDED.establishment_code, terminal_code = EXCLUDED.terminal_code, provider_system_identification = EXCLUDED.provider_system_identification, province_code = EXCLUDED.province_code, canton_code = EXCLUDED.canton_code, district_code = EXCLUDED.district_code, postal_code = EXCLUDED.postal_code, updated_at = NOW()`;
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
        ? await sql`SELECT name, identification_type AS "identificationType", identification_number AS "identificationNumber", email, address, province_code AS "provinceCode", canton_code AS "cantonCode", district_code AS "districtCode", economic_activity_code AS "economicActivityCode" FROM clients WHERE id = ${clientId} LIMIT 1`
        : [];
      const client = clientRows[0] as {
        name?: string;
        identificationType?: string;
        identificationNumber?: string;
        email?: string;
        address?: string;
        provinceCode?: string;
        cantonCode?: string;
        districtCode?: string;
        economicActivityCode?: string;
      } | undefined;
      const requestedDocumentType = value(payload, "documentType");
      const documentType = requestedDocumentType === "FE" || requestedDocumentType === "TE"
        ? requestedDocumentType
        : "commercial";
      const isElectronic = documentType !== "commercial";
      const clientName = value(payload, "clientName") || client?.name || "";
      const clientIdentificationType = value(payload, "clientIdentificationType") || client?.identificationType || "";
      const clientIdentificationNumber = (value(payload, "clientIdentificationNumber") || client?.identificationNumber || "").replace(/[\s-]/g, "");
      const clientEmail = value(payload, "clientEmail") || client?.email || "";
      const clientProvinceCode = value(payload, "clientProvinceCode") || client?.provinceCode || "";
      const clientCantonCode = value(payload, "clientCantonCode") || client?.cantonCode || "";
      const clientDistrictCode = value(payload, "clientDistrictCode") || client?.districtCode || "";
      const clientAddress = value(payload, "clientAddress") || client?.address || "";
      const receiverActivityCode = value(payload, "receiverActivityCode") || client?.economicActivityCode || "";
      const invoiceNumber = isElectronic ? "" : value(payload, "invoiceNumber");
      const issueDate = isElectronic ? "" : value(payload, "issueDate");
      const observations = value(payload, "observations");
      const economicActivityCode = value(payload, "economicActivityCode");
      const saleCondition = value(payload, "saleCondition") || "01";
      const creditTerm = value(payload, "creditTerm");
      const paymentMethod = value(payload, "paymentMethod") || "04";
      const lines = Array.isArray(payload.lines) ? (payload.lines as InvoiceLinePayload[]) : [];

      if (!clientName || lines.length === 0) {
        return Response.json({ error: "Completa el cliente y al menos una línea." }, { status: 400 });
      }
      if (!isElectronic && (!invoiceNumber || !issueDate)) {
        return Response.json({ error: "Completa el número y la fecha del documento comercial." }, { status: 400 });
      }
      if (clientIdentificationNumber) {
        const formatError = identificationError(clientIdentificationType, clientIdentificationNumber);
        if (formatError) return Response.json({ error: formatError }, { status: 400 });
      }
      if (documentType === "FE") {
        if (!clientIdentificationNumber || !clientIdentificationType) {
          return Response.json({ error: "La factura electrónica requiere el tipo y número de identificación del receptor." }, { status: 400 });
        }
        if (clientIdentificationType === "05") {
          return Response.json({ error: "La identificación extranjera no domiciliada requiere una operación especial que este formulario no permite." }, { status: 400 });
        }
        const formatError = locationError(clientProvinceCode, clientCantonCode, clientDistrictCode, clientAddress);
        if (formatError) return Response.json({ error: `Receptor: ${formatError}` }, { status: 400 });
      }
      if (receiverActivityCode && !/^\d{6}$/.test(receiverActivityCode)) {
        return Response.json({ error: "La actividad económica del receptor debe contener 6 dígitos." }, { status: 400 });
      }
      if (isElectronic && !/^\d{6}$/.test(economicActivityCode)) {
        return Response.json({ error: "Selecciona la actividad económica del emisor relacionada con la venta." }, { status: 400 });
      }
      if (saleCondition === "02" && (!/^\d{1,5}$/.test(creditTerm) || Number(creditTerm) < 1)) {
        return Response.json({ error: "Indica un plazo de crédito válido en días." }, { status: 400 });
      }

      const safeLines = lines.map((line) => ({
        catalogId: String(line.catalogId ?? ""),
        description: String(line.description ?? "").trim(),
        quantity: Number(line.quantity),
        unitPriceCents: Math.round(Number(line.unitPriceCents)),
        cabysCode: String(line.cabysCode ?? "").replace(/\D/g, ""),
        unitCode: String(line.unitCode ?? "Unid"),
        taxRateCode: isElectronic ? String(line.taxRateCode ?? "") : "",
        taxRate: isElectronic ? taxRatesByCode[String(line.taxRateCode ?? "")] : 0,
        isService: Boolean(line.isService),
      })).filter((line) => line.description && line.quantity > 0 && line.unitPriceCents >= 0);
      if (safeLines.length === 0) return Response.json({ error: "Las líneas de la factura no son válidas." }, { status: 400 });
      if (isElectronic && safeLines.some((line) => line.unitPriceCents <= 0)) {
        return Response.json({ error: "Hacienda requiere precios unitarios mayores que cero." }, { status: 400 });
      }
      if (isElectronic && safeLines.some((line) => !/^\d{13}$/.test(line.cabysCode))) {
        return Response.json({ error: "Cada línea electrónica necesita un CAByS válido de 13 dígitos." }, { status: 400 });
      }
      if (isElectronic && safeLines.some((line) => !(line.taxRateCode in taxRatesByCode))) {
        return Response.json({ error: "Selecciona un tratamiento de IVA válido para cada línea." }, { status: 400 });
      }

      const invoiceId = id("invoice");
      const subtotalCents = safeLines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPriceCents), 0);
      const taxCents = safeLines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPriceCents * line.taxRate / 100), 0);
      const totalCents = subtotalCents + taxCents;
      await sql`INSERT INTO invoices (id, client_id, client_name, client_identification_type, client_identification_number, client_email, client_province_code, client_canton_code, client_district_code, client_address, receiver_activity_code, invoice_number, issue_date, observations, document_type, currency, subtotal_cents, tax_cents, total_cents, status, economic_activity_code, sale_condition, credit_term, payment_method) VALUES (${invoiceId}, ${client?.name ? clientId : null}, ${clientName}, ${clientIdentificationType}, ${clientIdentificationNumber}, ${clientEmail}, ${clientProvinceCode}, ${clientCantonCode}, ${clientDistrictCode}, ${clientAddress}, ${receiverActivityCode}, ${invoiceNumber}, ${issueDate}, ${observations}, ${documentType}, 'CRC', ${subtotalCents}, ${taxCents}, ${totalCents}, 'draft', ${economicActivityCode}, ${saleCondition}, ${creditTerm}, ${paymentMethod})`;
      for (const line of safeLines) {
        const lineSubtotalCents = Math.round(line.quantity * line.unitPriceCents);
        const lineTaxCents = Math.round(lineSubtotalCents * line.taxRate / 100);
        await sql`INSERT INTO invoice_items (id, invoice_id, catalog_id, description, quantity, unit_price_cents, total_cents, cabys_code, unit_code, tax_rate, tax_rate_code, tax_cents, is_service) VALUES (${id("line")}, ${invoiceId}, ${line.catalogId || null}, ${line.description}, ${line.quantity}, ${line.unitPriceCents}, ${lineSubtotalCents + lineTaxCents}, ${line.cabysCode}, ${line.unitCode}, ${line.taxRate}, ${line.taxRateCode}, ${lineTaxCents}, ${line.isService})`;
      }
      if (isElectronic) {
        await sql`INSERT INTO electronic_events (id, invoice_id, event_type, status, detail) VALUES (${id("event")}, ${invoiceId}, 'draft_created', 'draft', ${documentType})`;
      }
      return Response.json({
        invoice: {
          id: invoiceId,
          documentType,
          invoiceNumber,
          issueDate,
          clientName,
          clientIdentificationType,
          clientIdentificationNumber,
          clientEmail,
          clientProvinceCode,
          clientCantonCode,
          clientDistrictCode,
          clientAddress,
          receiverActivityCode,
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
          haciendaEnvironment: "",
          haciendaError: "",
          haciendaEmissionDate: "",
          referenceInvoiceId: "",
          referenceKey: "",
          referenceDocumentType: "",
          referenceDate: "",
          referenceCode: "",
          referenceReason: "",
          createdAt: new Date().toISOString(),
          lines: safeLines.map((line) => {
            const lineSubtotalCents = Math.round(line.quantity * line.unitPriceCents);
            const lineTaxCents = Math.round(lineSubtotalCents * line.taxRate / 100);
            return { ...line, taxCents: lineTaxCents, totalCents: lineSubtotalCents + lineTaxCents };
          }),
        },
      }, { status: 201 });
    }

    if (action === "create_credit_note") {
      const originalInvoiceId = value(payload, "invoiceId");
      const reason = value(payload, "reason");
      if (!originalInvoiceId || reason.length < 3) {
        return Response.json({ error: "Selecciona el comprobante y explica el motivo de la nota de crédito." }, { status: 400 });
      }
      const originalRows = await sql`SELECT * FROM invoices WHERE id = ${originalInvoiceId} LIMIT 1`;
      const original = originalRows[0] as Record<string, unknown> | undefined;
      if (!original || !["FE", "TE"].includes(String(original.document_type)) || String(original.hacienda_status) !== "aceptado") {
        return Response.json({ error: "Solo se puede acreditar una factura o tiquete aceptado por Hacienda." }, { status: 400 });
      }
      const existingRows = await sql`SELECT id FROM invoices WHERE reference_invoice_id = ${originalInvoiceId} AND document_type = 'NC' AND COALESCE(hacienda_status, '') <> 'rechazado' LIMIT 1`;
      if (existingRows.length) {
        return Response.json({ error: "Este comprobante ya tiene una nota de crédito pendiente o aceptada." }, { status: 400 });
      }
      const originalLines = await sql`SELECT * FROM invoice_items WHERE invoice_id = ${originalInvoiceId} ORDER BY id`;
      if (!originalLines.length) return Response.json({ error: "El comprobante original no tiene líneas." }, { status: 400 });

      const creditNoteId = id("invoice");
      await sql`
        INSERT INTO invoices (
          id, client_id, client_name, client_identification_type, client_identification_number,
          client_email, client_province_code, client_canton_code, client_district_code,
          client_address, receiver_activity_code, invoice_number, issue_date, observations,
          document_type, currency, subtotal_cents, tax_cents, total_cents, status,
          economic_activity_code, sale_condition, credit_term, payment_method,
          reference_invoice_id, reference_key, reference_document_type, reference_date,
          reference_code, reference_reason
        ) VALUES (
          ${creditNoteId}, ${original.client_id || null}, ${String(original.client_name || "")},
          ${String(original.client_identification_type || "")}, ${String(original.client_identification_number || "")},
          ${String(original.client_email || "")}, ${String(original.client_province_code || "")},
          ${String(original.client_canton_code || "")}, ${String(original.client_district_code || "")},
          ${String(original.client_address || "")}, ${String(original.receiver_activity_code || "")},
          '', '', ${reason}, 'NC', ${String(original.currency || "CRC")},
          ${Number(original.subtotal_cents)}, ${Number(original.tax_cents)}, ${Number(original.total_cents)},
          'draft', ${String(original.economic_activity_code || "")}, ${String(original.sale_condition || "01")},
          ${String(original.credit_term || "")}, ${String(original.payment_method || "04")},
          ${originalInvoiceId}, ${String(original.hacienda_key || "")}, ${String(original.document_type || "")},
          ${String(original.hacienda_emission_date || "")}, '01', ${reason}
        )
      `;
      for (const line of originalLines as Array<Record<string, unknown>>) {
        await sql`INSERT INTO invoice_items (id, invoice_id, catalog_id, description, quantity, unit_price_cents, total_cents, cabys_code, unit_code, tax_rate, tax_rate_code, tax_cents, is_service) VALUES (${id("line")}, ${creditNoteId}, ${line.catalog_id || null}, ${String(line.description || "")}, ${Number(line.quantity)}, ${Number(line.unit_price_cents)}, ${Number(line.total_cents)}, ${String(line.cabys_code || "")}, ${String(line.unit_code || "Unid")}, ${Number(line.tax_rate)}, ${String(line.tax_rate_code || "08")}, ${Number(line.tax_cents)}, ${Boolean(line.is_service)})`;
      }
      await sql`INSERT INTO electronic_events (id, invoice_id, event_type, status, detail) VALUES (${id("event")}, ${creditNoteId}, 'credit_note_draft_created', 'draft', ${`Referencia ${String(original.hacienda_key || "")}`})`;
      return Response.json({ ok: true, invoiceId: creditNoteId }, { status: 201 });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return routeError(error);
  }
}
