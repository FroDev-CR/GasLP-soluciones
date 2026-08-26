"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Image from "next/image";

type View = "home" | "agenda" | "clients" | "catalog" | "settings";
type Modal = "client" | "catalog" | "appointment" | "billing" | "commercial" | "electronic" | "creditNote" | "drafts" | "receipt" | null;
type InvoiceOutputFormat = "letter" | "ticket80" | "ticket58";

type Client = {
  id: string;
  name: string;
  identificationType: IdentificationType | "";
  identificationNumber: string;
  phone: string;
  email: string;
  address: string;
  provinceCode: string;
  cantonCode: string;
  districtCode: string;
  economicActivityCode: string;
};

type CatalogItem = {
  id: string;
  kind: "product" | "service";
  category: string;
  name: string;
  unit: string;
  priceCents: number;
  stock: number;
  minStock: number;
};

type Appointment = {
  id: string;
  clientId: string | null;
  clientName: string;
  title: string;
  serviceType: string;
  date: string;
  time: string;
  address: string;
  status: "pending" | "confirmed" | "done";
  notes: string;
};

type InvoiceLine = {
  catalogId: string;
  description: string;
  quantity: number | "";
  unitPrice: number | "";
  cabysCode: string;
  unitCode: string;
  taxRate: number;
  taxRateCode: string;
  isService: boolean;
};

type SavedInvoice = {
  id: string;
  documentType: "commercial" | "FE" | "TE" | "NC";
  invoiceNumber: string;
  issueDate: string;
  clientName: string;
  clientIdentificationType: IdentificationType | "";
  clientIdentificationNumber: string;
  clientEmail: string;
  clientProvinceCode: string;
  clientCantonCode: string;
  clientDistrictCode: string;
  clientAddress: string;
  receiverActivityCode: string;
  observations: string;
  currency: "CRC";
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  status: "draft" | "certified" | "cancelled";
  economicActivityCode: string;
  saleCondition: string;
  creditTerm: string;
  paymentMethod: string;
  haciendaKey: string;
  haciendaConsecutive: string;
  haciendaStatus: string;
  haciendaEnvironment: string;
  haciendaError: string;
  haciendaEmissionDate: string;
  referenceInvoiceId: string;
  referenceKey: string;
  referenceDocumentType: string;
  referenceDate: string;
  referenceCode: string;
  referenceReason: string;
  createdAt: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    cabysCode: string;
    unitCode: string;
    taxRate: number;
    taxRateCode: string;
    taxCents: number;
    isService: boolean;
    totalCents: number;
  }>;
};

type AppData = {
  clients: Client[];
  catalog: CatalogItem[];
  appointments: Appointment[];
  invoices: SavedInvoice[];
  settings: BusinessSettings;
  economicActivities: EconomicActivity[];
  account: { username: string };
  hacienda: HaciendaConfiguration;
};

type BusinessSettings = {
  businessName: string;
  businessEmail: string;
  businessPhone: string;
  businessAddress: string;
  taxpayerRole: "taxpayer" | "associate";
  taxpayerIdentificationType: IdentificationType;
  taxpayerIdentificationNumber: string;
  taxpayerName: string;
  tradeName: string;
  economicActivityCode: string;
  taxRegime: string;
  invoiceEmail: string;
  associateIdentificationType: IdentificationType;
  associateIdentificationNumber: string;
  associateName: string;
  establishmentCode: string;
  terminalCode: string;
  providerSystemIdentification: string;
  provinceCode: string;
  cantonCode: string;
  districtCode: string;
  postalCode: string;
  rutStatus: string;
  rutOmiso: string;
  rutMoroso: string;
  rutCheckedAt: string | null;
};

type EconomicActivity = {
  code: string;
  sourceCode: string;
  description: string;
  status: string;
  activityType: string;
};

type HaciendaCredentialProfile = {
  hasApiUsername: boolean;
  hasApiPassword: boolean;
  hasCertificate: boolean;
  hasCertificatePin: boolean;
  certificateFilename: string;
  lastSequenceFE: number;
  lastSequenceTE: number;
  lastSequenceNC: number;
  rutSystemConfirmed: boolean;
  sequenceConfirmed: boolean;
  productionLiveConfirmed: boolean;
  updatedAt: string | null;
};

type HaciendaConfiguration = HaciendaCredentialProfile & {
  environment: "sandbox" | "production";
  profiles: Record<"sandbox" | "production", HaciendaCredentialProfile>;
};

type IdentificationType = "01" | "02" | "03" | "04" | "05";

const identificationTypes: Array<{ value: IdentificationType; label: string; help: string; pattern: string; maxLength: number }> = [
  { value: "01", label: "Cédula física", help: "9 dígitos, sin cero inicial ni guiones.", pattern: "[1-9][0-9]{8}", maxLength: 9 },
  { value: "02", label: "Cédula jurídica", help: "10 caracteres, sin guiones.", pattern: "[A-Za-z0-9]{10}", maxLength: 10 },
  { value: "03", label: "DIMEX", help: "11 o 12 dígitos, sin cero inicial ni guiones.", pattern: "[1-9][0-9]{10,11}", maxLength: 12 },
  { value: "04", label: "NITE", help: "10 dígitos, sin guiones.", pattern: "[0-9]{10}", maxLength: 10 },
  { value: "05", label: "Extranjero no domiciliado", help: "Hasta 20 letras o números, según el caso permitido por Hacienda.", pattern: "[A-Za-z0-9]{1,20}", maxLength: 20 },
];

const identificationLabel = (type: IdentificationType | "") => identificationTypes.find((item) => item.value === type)?.label ?? "Identificación";

const taxTreatments = [
  { code: "08", rate: 13, label: "IVA general 13%" },
  { code: "04", rate: 4, label: "IVA reducido 4%" },
  { code: "03", rate: 2, label: "IVA reducido 2%" },
  { code: "02", rate: 1, label: "IVA reducido 1%" },
  { code: "09", rate: 0.5, label: "IVA reducido 0,5%" },
  { code: "10", rate: 0, label: "Exento" },
  { code: "11", rate: 0, label: "No sujeto / sin derecho a crédito" },
  { code: "01", rate: 0, label: "Tarifa 0% art. 32 RLIVA" },
] as const;

function taxTreatmentForRate(rate: number) {
  return taxTreatments.find((item) => item.rate === rate && item.code !== "10" && item.code !== "01")
    ?? taxTreatments[0];
}

function documentLabel(documentType: SavedInvoice["documentType"]) {
  if (documentType === "FE") return "Factura electrónica";
  if (documentType === "TE") return "Tiquete electrónico";
  if (documentType === "NC") return "Nota de crédito electrónica";
  return "Documento comercial";
}

const clientIdentification = (client: Pick<Client, "identificationType" | "identificationNumber">) => client.identificationNumber
  ? `${identificationLabel(client.identificationType)} ${client.identificationNumber}`
  : "Sin identificación registrada";

const nav: Array<{ id: View | "invoice"; label: string; icon: string }> = [
  { id: "home", label: "Inicio", icon: "⌂" },
  { id: "agenda", label: "Agenda", icon: "▤" },
  { id: "invoice", label: "Facturar", icon: "+" },
  { id: "clients", label: "Clientes", icon: "♙" },
  { id: "catalog", label: "Catálogo", icon: "□" },
  { id: "settings", label: "Ajustes", icon: "⚙" },
];

const money = new Intl.NumberFormat("es-CR", {
  style: "currency",
  currency: "CRC",
  minimumFractionDigits: 2,
});

const invoiceNumber = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function getTodayKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatMoney(cents: number) {
  return money.format(cents / 100);
}

function formatInvoiceMoney(cents: number) {
  return `₡${invoiceNumber.format(cents / 100)}`;
}

function getTodayLongDate() {
  const [year, month, day] = getTodayKey().split("-").map(Number);
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "America/Costa_Rica",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 18)));
}

function getSavedInvoiceNumber(invoice: SavedInvoice) {
  return invoice.haciendaConsecutive || invoice.invoiceNumber || `BORRADOR-${invoice.id.slice(-8).toUpperCase()}`;
}

function getSavedInvoiceDate(invoice: SavedInvoice) {
  if (invoice.issueDate) return invoice.issueDate;
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "America/Costa_Rica",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(invoice.createdAt));
}

function getSavedInvoiceObservations(invoice: SavedInvoice) {
  return invoice.observations || "Precios expresados en colones costarricenses.";
}

function underHundredToWords(value: number) {
  const direct = [
    "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
    "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
    "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
    "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
  ];
  if (value < direct.length) return direct[value];
  const tens = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const ten = Math.floor(value / 10);
  const unit = value % 10;
  return unit ? `${tens[ten]} y ${direct[unit]}` : tens[ten];
}

function underThousandToWords(value: number) {
  if (value < 100) return underHundredToWords(value);
  if (value === 100) return "cien";
  const hundreds = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  return rest ? `${hundreds[hundred]} ${underHundredToWords(rest)}` : hundreds[hundred];
}

function apocopate(value: string) {
  return value
    .replace(/veintiuno$/u, "veintiún")
    .replace(/ y uno$/u, " y un")
    .replace(/uno$/u, "un");
}

function numberToSpanish(value: number) {
  const amount = Math.max(0, Math.floor(value));
  if (amount === 0) return "cero";
  const parts: string[] = [];
  const millions = Math.floor(amount / 1_000_000);
  const thousands = Math.floor((amount % 1_000_000) / 1_000);
  const remainder = amount % 1_000;
  if (millions) {
    parts.push(millions === 1 ? "un millón" : `${apocopate(underThousandToWords(millions))} millones`);
  }
  if (thousands) {
    parts.push(thousands === 1 ? "mil" : `${apocopate(underThousandToWords(thousands))} mil`);
  }
  if (remainder) parts.push(underThousandToWords(remainder));
  return parts.join(" ");
}

function totalInWords(cents: number) {
  const colones = Math.round(cents / 100);
  const words = apocopate(numberToSpanish(colones));
  return `${words} ${colones === 1 ? "colón exacto" : "colones exactos"}.`;
}

function filenameFromResponse(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

const invoiceOutputOptions: Record<InvoiceOutputFormat, {
  label: string;
  actionLabel: string;
  description: string;
  query: string;
  suffix: string;
}> = {
  letter: {
    label: "PDF carta · 8.5 × 11 pulg.",
    actionLabel: "PDF carta",
    description: "Para impresoras convencionales y archivo digital.",
    query: "",
    suffix: "_carta",
  },
  ticket80: {
    label: "Ticket térmico · 80 mm",
    actionLabel: "ticket 80 mm",
    description: "Para impresoras térmicas de rollo ancho.",
    query: "?format=ticket&width=80",
    suffix: "_ticket_80mm",
  },
  ticket58: {
    label: "Ticket térmico · 58 mm",
    actionLabel: "ticket 58 mm",
    description: "Para impresoras térmicas portátiles y compactas.",
    query: "?format=ticket&width=58",
    suffix: "_ticket_58mm",
  },
};

function invoicePdfUrl(invoiceId: string, format: InvoiceOutputFormat) {
  return `/api/documents/${encodeURIComponent(invoiceId)}/pdf${invoiceOutputOptions[format].query}`;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function Dashboard() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("home");
  const [modal, setModal] = useState<Modal>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [electronicDocumentType, setElectronicDocumentType] = useState<"FE" | "TE">("FE");
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([
    { catalogId: "", description: "", quantity: 1, unitPrice: 0, cabysCode: "", unitCode: "Unid", taxRate: 13, taxRateCode: "08", isService: false },
  ]);
  const [receipt, setReceipt] = useState<SavedInvoice | null>(null);
  const [receiptOrigin, setReceiptOrigin] = useState<"invoice" | "drafts" | null>(null);

  async function loadData() {
    try {
      const response = await fetch("/api/business", { cache: "no-store" });
      if (response.status === 401) {
        setAuthenticated(false);
        setData(null);
        return;
      }
      const payload = (await response.json()) as AppData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudieron cargar los datos");
      setData(payload);
      setAuthenticated(true);
      setError("");
      return payload;
    } catch (requestError) {
      setAuthenticated((current) => current ?? false);
      setError(requestError instanceof Error ? requestError.message : "Ocurrió un error");
    }
  }

  useEffect(() => {
    // La carga inicial ocurre después de la respuesta de red; no hay estado derivado sincrónico.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo iniciar sesión.");
      setAuthenticated(true);
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    setAuthenticated(false);
    setData(null);
    setView("home");
    setError("");
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: values.get("username"),
          currentPassword: values.get("currentPassword"),
          newPassword: values.get("newPassword"),
          confirmPassword: values.get("confirmPassword"),
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudieron actualizar los datos de acceso.");
      form.reset();
      await loadData();
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudieron actualizar los datos de acceso.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const upcoming = useMemo(() => {
    return [...(data?.appointments ?? [])]
      .filter((item) => item.status !== "done")
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [data]);

  const agendaAppointments = useMemo(() => {
    return [...(data?.appointments ?? [])]
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [data]);

  const lowStock = useMemo(
    () => (data?.catalog ?? []).filter((item) => item.kind === "product" && item.stock <= item.minStock),
    [data],
  );

  const invoiceSubtotal = invoiceLines.reduce(
    (sum, line) => sum + Math.round(Number(line.unitPrice) * 100 * Number(line.quantity)),
    0,
  );
  const invoiceTax = invoiceLines.reduce(
    (sum, line) => sum + Math.round(Number(line.unitPrice) * 100 * Number(line.quantity) * line.taxRate / 100),
    0,
  );
  const haciendaReady = Boolean(
    data &&
    data.settings.taxpayerName &&
    data.settings.taxpayerIdentificationNumber &&
    data.settings.economicActivityCode &&
    data.settings.invoiceEmail &&
    data.settings.businessAddress &&
    data.settings.provinceCode &&
    data.settings.cantonCode &&
    data.settings.districtCode &&
    data.settings.providerSystemIdentification &&
    (data.hacienda.environment === "sandbox" || (data.hacienda.rutSystemConfirmed && data.hacienda.productionLiveConfirmed)) &&
    data.hacienda.sequenceConfirmed &&
    data.hacienda.hasApiUsername &&
    data.hacienda.hasApiPassword &&
    data.hacienda.hasCertificate &&
    data.hacienda.hasCertificatePin,
  );

  function navigate(id: View | "invoice") {
    if (id === "invoice") {
      setModal("billing");
      return;
    }
    setView(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function postAction(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/business", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setAuthenticated(false);
        setData(null);
      }
      const result = (await response.json()) as { error?: string; invoice?: SavedInvoice; invoiceId?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo guardar");
      await loadData();
      return result;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ocurrió un error");
      throw requestError;
    } finally {
      setBusy(false);
    }
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await postAction({
        action: "create_client",
        name: form.get("name"),
        identificationType: form.get("identificationType"),
        identificationNumber: form.get("identificationNumber"),
        phone: form.get("phone"),
        email: form.get("email"),
        address: form.get("address"),
        provinceCode: form.get("provinceCode"),
        cantonCode: form.get("cantonCode"),
        districtCode: form.get("districtCode"),
        economicActivityCode: form.get("economicActivityCode"),
      });
      setModal(null);
    } catch {}
  }

  async function createCatalogItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await postAction({
        action: "create_catalog_item",
        kind: form.get("kind"),
        category: form.get("category"),
        name: form.get("name"),
        unit: form.get("unit"),
        price: Number(form.get("price")),
        stock: Number(form.get("stock") || 0),
        minStock: Number(form.get("minStock") || 0),
      });
      setModal(null);
    } catch {}
  }

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const clientId = String(form.get("clientId") || "");
    const client = data?.clients.find((item) => item.id === clientId);
    const serviceType = String(form.get("serviceType") || "Instalación");
    const gasProduct = data?.catalog.find((item) => item.id === String(form.get("gasProductId") || ""));
    const title = serviceType === "Entrega de gas" ? (gasProduct ? `Entrega de ${gasProduct.name}` : "") : form.get("title");
    try {
      await postAction({
        action: "create_appointment",
        clientId: client?.id || null,
        clientName: client?.name || form.get("clientName"),
        title,
        serviceType,
        date: form.get("date"),
        time: form.get("time"),
        address: form.get("address") || client?.address,
        notes: form.get("notes"),
      });
      setModal(null);
    } catch {}
  }

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const clientName = String(form.get("clientName") || "").trim();
    const validLines = invoiceLines.filter((line) =>
      line.description.trim() && Number(line.quantity) > 0 && Number.isFinite(Number(line.unitPrice)) && Number(line.unitPrice) >= 0,
    );
    if (!clientName || validLines.length === 0) {
      setError("Escribe el cliente y completa al menos una línea con descripción, cantidad y precio.");
      return;
    }
    try {
      const result = await postAction({
        action: "create_invoice",
        documentType: form.get("documentType"),
        clientId: selectedClientId || null,
        clientName,
        clientIdentificationType: form.get("clientIdentificationType"),
        clientIdentificationNumber: form.get("clientIdentificationNumber"),
        clientEmail: form.get("clientEmail"),
        clientProvinceCode: form.get("clientProvinceCode"),
        clientCantonCode: form.get("clientCantonCode"),
        clientDistrictCode: form.get("clientDistrictCode"),
        clientAddress: form.get("clientAddress"),
        receiverActivityCode: form.get("receiverActivityCode"),
        invoiceNumber: form.get("invoiceNumber"),
        issueDate: form.get("issueDate"),
        observations: form.get("observations"),
        economicActivityCode: form.get("economicActivityCode"),
        saleCondition: form.get("saleCondition"),
        creditTerm: form.get("creditTerm"),
        paymentMethod: form.get("paymentMethod"),
        lines: validLines.map((line) => ({
          catalogId: line.catalogId || null,
          description: line.description,
          quantity: Number(line.quantity),
          unitPriceCents: Math.round(Number(line.unitPrice) * 100),
          cabysCode: line.cabysCode,
          unitCode: line.unitCode,
          taxRate: line.taxRate,
          taxRateCode: line.taxRateCode,
          isService: line.isService,
        })),
      });
      if (result.invoice) {
        setReceipt(result.invoice);
        setReceiptOrigin("invoice");
        setModal("receipt");
        setSelectedClientId("");
        setInvoiceLines([{ catalogId: "", description: "", quantity: 1, unitPrice: 0, cabysCode: "", unitCode: "Unid", taxRate: 13, taxRateCode: "08", isService: false }]);
      }
    } catch {}
  }

  async function createCreditNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receipt) return;
    const form = new FormData(event.currentTarget);
    try {
      const result = await postAction({
        action: "create_credit_note",
        invoiceId: receipt.id,
        reason: form.get("reason"),
      });
      const refreshed = await loadData();
      const note = refreshed?.invoices.find((invoice) => invoice.id === result.invoiceId);
      if (note) {
        setReceipt(note);
        setReceiptOrigin("invoice");
        setModal("receipt");
      } else {
        setModal("drafts");
      }
    } catch {}
  }

  async function updateAppointmentStatus(item: Appointment) {
    const nextStatus = item.status === "pending" ? "confirmed" : item.status === "confirmed" ? "done" : "pending";
    try {
      await postAction({
        action: "update_appointment_status",
        id: item.id,
        status: nextStatus,
      });
    } catch {}
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await postAction({
        action: "save_settings",
        businessName: form.get("businessName"),
        businessEmail: form.get("businessEmail"),
        businessPhone: form.get("businessPhone"),
        businessAddress: form.get("businessAddress"),
        taxpayerRole: form.get("taxpayerRole"),
        taxpayerIdentificationType: form.get("taxpayerIdentificationType"),
        taxpayerIdentificationNumber: form.get("taxpayerIdentificationNumber"),
        taxpayerName: form.get("taxpayerName"),
        tradeName: form.get("tradeName"),
        economicActivityCode: form.get("economicActivityCode"),
        taxRegime: form.get("taxRegime"),
        invoiceEmail: form.get("invoiceEmail"),
        associateIdentificationType: form.get("associateIdentificationType"),
        associateIdentificationNumber: form.get("associateIdentificationNumber"),
        associateName: form.get("associateName"),
        establishmentCode: form.get("establishmentCode"),
        terminalCode: form.get("terminalCode"),
        providerSystemIdentification: form.get("providerSystemIdentification"),
        provinceCode: form.get("provinceCode"),
        cantonCode: form.get("cantonCode"),
        districtCode: form.get("districtCode"),
        postalCode: form.get("postalCode"),
      });
    } catch {}
  }

  async function syncTaxpayer() {
    const identification = data?.settings.taxpayerIdentificationNumber;
    if (!identification) {
      setError("Guarda primero la identificación del tributario.");
      return;
    }
    try {
      await postAction({ action: "sync_taxpayer", identification });
    } catch {}
  }

  async function saveHaciendaCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      form.set("rutSystemConfirmed", form.get("rutSystemConfirmed") ? "true" : "false");
      form.set("sequenceConfirmed", form.get("sequenceConfirmed") ? "true" : "false");
      form.set("productionLiveConfirmed", form.get("productionLiveConfirmed") ? "true" : "false");
      const response = await fetch("/api/hacienda/credentials", { method: "POST", body: form });
      const result = (await response.json()) as { error?: string };
      if (response.status === 401) {
        setAuthenticated(false);
        setData(null);
      }
      if (!response.ok) throw new Error(result.error || "No se pudo guardar la conexión con Hacienda.");
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo guardar la conexión con Hacienda.");
    } finally {
      setBusy(false);
    }
  }

  async function haciendaInvoiceAction(invoice: SavedInvoice, action: "submit" | "status") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/hacienda/invoice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, invoiceId: invoice.id }),
      });
      const result = (await response.json()) as {
        error?: string;
        status?: string;
        clave?: string;
        numeroConsecutivo?: string;
        haciendaError?: string;
        environment?: string;
      };
      if (response.status === 401) {
        setAuthenticated(false);
        setData(null);
      }
      if (!response.ok) throw new Error(result.error || "Hacienda no pudo procesar la factura.");
      setReceipt((current) => current?.id === invoice.id ? {
        ...current,
        haciendaStatus: result.status || current.haciendaStatus,
        haciendaKey: result.clave || current.haciendaKey,
        haciendaConsecutive: result.numeroConsecutivo || current.haciendaConsecutive,
        haciendaEnvironment: result.environment || current.haciendaEnvironment,
        haciendaError: result.haciendaError || "",
        status: result.status === "aceptado" ? "certified" : current.status,
      } : current);
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo contactar Hacienda.");
    } finally {
      setBusy(false);
    }
  }

  async function submitInvoiceToHacienda(invoice: SavedInvoice) {
    await haciendaInvoiceAction(invoice, "submit");
  }

  async function checkInvoiceStatus(invoice: SavedInvoice) {
    await haciendaInvoiceAction(invoice, "status");
  }

  async function deleteInvoice(invoice: SavedInvoice) {
    try {
      await postAction({ action: "delete_invoice", invoiceId: invoice.id });
      setReceipt((current) => (current?.id === invoice.id ? null : current));
    } catch {}
  }

  /**
   * Las descargas pasan por fetch para poder leer el error del API. Con un
   * enlace directo, una respuesta de error se guardaba como un archivo .json
   * ilegible en lugar de mostrarse.
   */
  async function downloadDocument(url: string, fallbackName: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.status === 401) {
        setAuthenticated(false);
        setData(null);
        throw new Error("La sesión expiró. Vuelve a iniciar sesión.");
      }
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error || "No se pudo descargar el archivo.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filenameFromResponse(response, fallbackName);
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "No se pudo descargar el archivo.");
    } finally {
      setBusy(false);
    }
  }

  async function shareInvoice(format: InvoiceOutputFormat) {
    if (!receipt) return;
    const displayNumber = getSavedInvoiceNumber(receipt);
    const displayDate = getSavedInvoiceDate(receipt);
    const output = invoiceOutputOptions[format];
    const detail = receipt.lines
      .map((line) => `${line.quantity} × ${line.description} — ${formatMoney(line.totalCents)}`)
      .join("\n");
    const message = `GAS LP SOLUCIONES\n${documentLabel(receipt.documentType)} ${displayNumber}\nFecha: ${displayDate}\nCliente: ${receipt.clientName}\n${detail}\nTotal: ${formatInvoiceMoney(receipt.totalCents)}`;
    try {
      const response = await fetch(invoicePdfUrl(receipt.id, format), { cache: "no-store" });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error || "No se pudo preparar el PDF.");
      }
      const blob = await response.blob();
      const filename = `${receipt.haciendaKey || displayNumber.replace(/[^A-Za-z0-9_-]/g, "_")}${output.suffix}.pdf`;
      const files = [new File([blob], filename, { type: "application/pdf" })];
      if (receipt.documentType !== "commercial" && receipt.haciendaStatus === "aceptado") {
        const xmlResponse = await fetch(`/api/documents/${encodeURIComponent(receipt.id)}/xml?kind=signed`, { cache: "no-store" });
        if (xmlResponse.ok) {
          files.push(new File([await xmlResponse.blob()], `${receipt.haciendaKey}.xml`, { type: "application/xml" }));
        }
      }
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files }))) {
        await navigator.share({ title: `${documentLabel(receipt.documentType)} ${displayNumber} · ${output.actionLabel}`, text: message, files });
        return;
      }
      files.forEach((file) => {
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 15_000);
      });
      window.open(`https://wa.me/?text=${encodeURIComponent(`${message}\n\nLos archivos se descargaron para adjuntarlos en este chat.`)}`, "_blank", "noopener,noreferrer");
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "No se pudo compartir el PDF.");
    }
  }

  const filteredClients = (data?.clients ?? []).filter((client) =>
    `${client.name} ${client.identificationNumber} ${client.phone}`.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredCatalog = (data?.catalog ?? []).filter((item) =>
    `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase()),
  );

  if (authenticated === null) {
    return <div className="auth-screen"><div className="auth-loading">Cargando GAS LP SOLUCIONES…</div></div>;
  }

  if (!authenticated) {
    return <LoginScreen submit={login} busy={busy} error={error} />;
  }

  return (
    <div className="app-shell">
      <DesktopRail view={view} navigate={navigate} />

      <main className="main-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark"><Image src="/gas-lp-logo.png" alt="Logo GAS LP SOLUCIONES" width={78} height={78} priority /></div>
            <div className="brand-copy">
              <strong>GAS LP SOLUCIONES</strong>
              <span>Gas LP • cocinas • instalaciones</span>
            </div>
          </div>
          <div className="avatar" aria-label="Perfil del negocio">GL</div>
        </header>

        {error ? <div className="error-banner" role="alert">{error}</div> : null}

        {view === "home" ? (
          <HomeView
            data={data}
            upcoming={upcoming}
            lowStock={lowStock}
            openInvoice={() => setModal("billing")}
            openDrafts={() => setModal("drafts")}
            openAppointment={() => setModal("appointment")}
            navigate={navigate}
          />
        ) : null}

        {view === "agenda" ? (
          <AgendaView
            appointments={agendaAppointments}
            loading={!data}
            openAppointment={() => setModal("appointment")}
            updateStatus={updateAppointmentStatus}
          />
        ) : null}

        {view === "clients" ? (
          <ClientsView
            clients={filteredClients}
            loading={!data}
            query={query}
            setQuery={setQuery}
            openClient={() => setModal("client")}
          />
        ) : null}

        {view === "catalog" ? (
          <CatalogView
            catalog={filteredCatalog}
            loading={!data}
            query={query}
            setQuery={setQuery}
            openCatalog={() => setModal("catalog")}
          />
        ) : null}

        {view === "settings" && data ? (
          <SettingsView
            settings={data.settings}
            activities={data.economicActivities}
            hacienda={data.hacienda}
            submit={saveSettings}
            saveCredentials={saveHaciendaCredentials}
            syncTaxpayer={syncTaxpayer}
            account={data.account}
            saveAccount={saveAccount}
            download={downloadDocument}
            logout={logout}
            busy={busy}
          />
        ) : null}
      </main>

      <nav className="bottom-nav" aria-label="Navegación principal">
        {nav.map((item) => (
          <button
            className={`nav-button ${item.id === "invoice" ? "invoice-nav" : ""} ${view === item.id ? "active" : ""}`}
            key={item.id}
            onClick={() => navigate(item.id)}
            aria-label={item.label}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.id === "invoice" ? null : item.label}
          </button>
        ))}
      </nav>

      {modal ? (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setModal(null);
        }}>
          <section className={`sheet ${modal === "receipt" ? "receipt-sheet" : ""}`} role="dialog" aria-modal="true" aria-label="Formulario">
            <div className="sheet-handle" />
            {/* El panel cubre la banda de error del shell, así que se repite aquí. */}
            {error ? <div className="error-banner" role="alert">{error}</div> : null}
            {modal === "client" ? <ClientForm close={() => setModal(null)} submit={createClient} busy={busy} /> : null}
            {modal === "catalog" ? <CatalogForm close={() => setModal(null)} submit={createCatalogItem} busy={busy} /> : null}
            {modal === "appointment" ? <AppointmentForm clients={data?.clients ?? []} catalog={data?.catalog ?? []} close={() => setModal(null)} submit={createAppointment} busy={busy} /> : null}
            {modal === "billing" ? (
              <BillingChoice
                close={() => setModal(null)}
                chooseCommercial={() => {
                  setSelectedClientId("");
                  setInvoiceLines([{ catalogId: "", description: "", quantity: 1, unitPrice: 0, cabysCode: "", unitCode: "Unid", taxRate: 0, taxRateCode: "", isService: false }]);
                  setModal("commercial");
                }}
                chooseElectronic={(documentType) => {
                  setSelectedClientId("");
                  setInvoiceLines([{ catalogId: "", description: "", quantity: 1, unitPrice: 0, cabysCode: "", unitCode: "Unid", taxRate: 13, taxRateCode: "08", isService: false }]);
                  setElectronicDocumentType(documentType);
                  setModal("electronic");
                }}
              />
            ) : null}
            {modal === "commercial" ? (
              <CommercialInvoiceForm
                clients={data?.clients ?? []}
                catalog={data?.catalog ?? []}
                selectedClientId={selectedClientId}
                setSelectedClientId={setSelectedClientId}
                lines={invoiceLines}
                setLines={setInvoiceLines}
                subtotal={invoiceSubtotal}
                close={() => setModal("billing")}
                submit={createInvoice}
                busy={busy}
              />
            ) : null}
            {modal === "electronic" ? (
              <ElectronicInvoiceForm
                documentType={electronicDocumentType}
                clients={data?.clients ?? []}
                catalog={data?.catalog ?? []}
                selectedClientId={selectedClientId}
                setSelectedClientId={setSelectedClientId}
                lines={invoiceLines}
                setLines={setInvoiceLines}
                subtotal={invoiceSubtotal}
                tax={invoiceTax}
                activities={data?.economicActivities ?? []}
                defaultActivity={data?.settings.economicActivityCode ?? ""}
                close={() => setModal("billing")}
                submit={createInvoice}
                busy={busy}
              />
            ) : null}
            {modal === "drafts" ? (
              <DraftInvoicesPanel
                invoices={data?.invoices ?? []}
                close={() => setModal(null)}
                openInvoice={(invoice) => {
                  setReceipt(invoice);
                  setReceiptOrigin("drafts");
                  setModal("receipt");
                }}
                remove={deleteInvoice}
                busy={busy}
              />
            ) : null}
            {modal === "receipt" && receipt ? (
              <ReceiptPanel
                invoice={receipt}
                close={() => {
                  setModal(receiptOrigin === "drafts" ? "drafts" : null);
                  if (receiptOrigin !== "drafts") setReceiptOrigin(null);
                }}
                share={shareInvoice}
                download={downloadDocument}
                canSubmit={haciendaReady}
                submitHacienda={() => submitInvoiceToHacienda(receipt)}
                checkHacienda={() => checkInvoiceStatus(receipt)}
                createCreditNote={() => setModal("creditNote")}
                busy={busy}
              />
            ) : null}
            {modal === "creditNote" && receipt ? (
              <CreditNoteForm
                invoice={receipt}
                close={() => setModal("receipt")}
                submit={createCreditNote}
                busy={busy}
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function LoginScreen({ submit, busy, error }: { submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; error: string }) {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <Image src="/gas-lp-logo.png" alt="Logo GAS LP SOLUCIONES" width={128} height={128} priority />
        <p className="eyebrow">Acceso privado</p>
        <h1>GAS LP SOLUCIONES</h1>
        <p>Clientes, facturas y credenciales de Hacienda están protegidos.</p>
        {error ? <div className="error-banner" role="alert">{error}</div> : null}
        <form className="form-grid" onSubmit={submit}>
          <div className="field">
            <label htmlFor="access-username">Usuario</label>
            <input id="access-username" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="access-password">Contraseña</label>
            <input id="access-password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button className="primary-button" disabled={busy}>{busy ? "Ingresando…" : "Entrar"}</button>
        </form>
      </section>
    </main>
  );
}

function DesktopRail({
  view,
  navigate,
}: {
  view: View;
  navigate: (id: View | "invoice") => void;
}) {
  return (
    <aside className="desktop-rail">
      <div className="brand-lockup">
        <div className="brand-mark"><Image src="/gas-lp-logo.png" alt="Logo GAS LP SOLUCIONES" width={88} height={88} priority /></div>
        <div className="brand-copy">
          <strong>GAS LP<br />SOLUCIONES</strong>
          <span>Panel de trabajo</span>
        </div>
      </div>
      <nav className="rail-nav" aria-label="Navegación principal">
        {nav.map((item) => (
          <button className={`rail-button ${view === item.id ? "active" : ""}`} key={item.id} onClick={() => navigate(item.id)}>
            <span aria-hidden="true">{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function HomeView({
  data,
  upcoming,
  lowStock,
  openInvoice,
  openDrafts,
  openAppointment,
  navigate,
}: {
  data: AppData | null;
  upcoming: Appointment[];
  lowStock: CatalogItem[];
  openInvoice: () => void;
  openDrafts: () => void;
  openAppointment: () => void;
  navigate: (id: View) => void;
}) {
  const today = getTodayKey();
  const dateLabel = new Intl.DateTimeFormat("es-CR", {
    timeZone: "America/Costa_Rica",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const todayCount = upcoming.filter((item) => item.date === today).length;
  const draftInvoices = (data?.invoices ?? []).filter((item) => item.status === "draft");
  const draftTotal = draftInvoices.reduce((sum, item) => sum + item.totalCents, 0);
  return (
    <>
      <section className="hero">
        <p className="eyebrow">{dateLabel}</p>
        <h1>Todo el trabajo, bajo control.</h1>
        <p className="hero-subtitle">Factura, agenda instalaciones y revisa el inventario desde el teléfono, sin perder tiempo entre servicios.</p>
        <div className="hero-actions">
          <button className="primary-button" onClick={openInvoice}>＋ Nueva factura</button>
          <button className="secondary-button" onClick={openAppointment}>Agendar trabajo</button>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="section-card schedule-card">
          <div className="section-heading">
            <div><h2>Próximos trabajos</h2><p>Tu ruta de instalaciones y entregas</p></div>
            <button className="text-button" onClick={() => navigate("agenda")}>Ver agenda</button>
          </div>
          <div className="schedule-list">
            {!data ? <><div className="loading-card" /><div className="loading-card" /></> : null}
            {data && upcoming.slice(0, 4).map((item) => (
              <div className="schedule-item" key={item.id}>
                <time className="schedule-time">{item.date === today ? "HOY" : item.date.slice(5)}<br />{item.time}</time>
                <div className="schedule-copy"><strong>{item.title}</strong><span>{item.clientName} • {item.address}</span></div>
                <span className={`status-pill ${item.status}`}>{item.status === "confirmed" ? "Confirmado" : "Pendiente"}</span>
              </div>
            ))}
            {data && upcoming.length === 0 ? <div className="empty-state"><strong>Agenda libre</strong>No hay trabajos pendientes.</div> : null}
          </div>
        </section>

        <section className="section-card">
          <div className="section-heading"><div><h2>Resumen</h2><p>Lo importante de hoy</p></div><button className="text-button" type="button" onClick={openDrafts} disabled={!data || data.invoices.length === 0}>Ver documentos</button></div>
          <div className="metric-grid">
            <div className="metric"><strong>{todayCount}</strong><span>trabajos hoy</span></div>
            <button className="metric metric-button" type="button" onClick={openDrafts} disabled={!data || draftInvoices.length === 0} aria-label="Ver facturas en borrador"><strong>{data ? draftInvoices.length : "—"}</strong><span>borradores · ver</span></button>
            <button className="metric metric-button metric-total" type="button" onClick={openDrafts} disabled={!data || draftInvoices.length === 0} aria-label="Ver monto y facturas en borrador"><strong>{formatMoney(draftTotal)}</strong><span>en borradores · ver</span></button>
          </div>
        </section>

        <section className="section-card">
          <div className="section-heading">
            <div><h2>Existencias bajas</h2><p>Productos para reponer</p></div>
            <button className="text-button" onClick={() => navigate("catalog")}>Inventario</button>
          </div>
          <div className="stock-list">
            {!data ? <div className="loading-card" /> : null}
            {lowStock.slice(0, 3).map((item) => (
              <div className="stock-row" key={item.id}>
                <div className="stock-icon">◒</div>
                <div className="stock-copy"><strong>{item.name}</strong><span>Mínimo: {item.minStock} {item.unit}</span></div>
                <span className="status-pill low">{item.stock} disp.</span>
              </div>
            ))}
            {data && lowStock.length === 0 ? <div className="empty-state"><strong>Todo abastecido</strong>No hay productos por debajo del mínimo.</div> : null}
          </div>
        </section>
      </div>
    </>
  );
}

function AgendaView({ appointments, loading, openAppointment, updateStatus }: { appointments: Appointment[]; loading: boolean; openAppointment: () => void; updateStatus: (item: Appointment) => void }) {
  const groups = appointments.reduce<Record<string, Appointment[]>>((acc, item) => {
    (acc[item.date] ??= []).push(item);
    return acc;
  }, {});
  return (
    <section>
      <div className="view-header view-title">
        <div><p className="eyebrow">Agenda de trabajo</p><h1>Todos los trabajos</h1><p>Pendientes, confirmados y completados.</p></div>
        <button className="primary-button" onClick={openAppointment}>＋ Agendar</button>
      </div>
      <div className="notebook">
        {loading ? <div className="loading-card" /> : null}
        {Object.entries(groups).map(([date, items]) => (
          <div key={date}>
            <div className="notebook-date"><strong>{new Intl.DateTimeFormat("es-CR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Costa_Rica" }).format(new Date(`${date}T12:00:00-06:00`))}</strong><span className="count-pill">{items.length}</span></div>
            {items.map((item) => (
              <article className="notebook-entry" key={item.id}>
                <time>{item.time}</time>
                <div className="notebook-copy"><strong>{item.title}</strong><span>{item.clientName}{item.address ? ` • ${item.address}` : ""}</span></div>
                <button type="button" className={`status-pill status-control ${item.status}`} onClick={() => updateStatus(item)} aria-label={`Cambiar estado de ${item.title}`}>{item.status === "confirmed" ? "Confirmado" : item.status === "done" ? "Completado" : "Pendiente"}</button>
              </article>
            ))}
          </div>
        ))}
        {!loading && appointments.length === 0 ? <div className="empty-state"><strong>La agenda está libre</strong>Agrega una instalación o una entrega.</div> : null}
      </div>
    </section>
  );
}

function ClientsView({ clients, loading, query, setQuery, openClient }: { clients: Client[]; loading: boolean; query: string; setQuery: (value: string) => void; openClient: () => void }) {
  return (
    <section>
      <div className="view-header view-title"><div><p className="eyebrow">Directorio</p><h1>Clientes</h1><p>Identificación, teléfonos y direcciones siempre a mano.</p></div><button className="primary-button" onClick={openClient}>＋ Nuevo</button></div>
      <div className="list-toolbar"><input className="search-input" type="search" placeholder="Buscar por nombre, identificación o teléfono" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar clientes" /></div>
      <div className="data-list">
        {loading ? <><div className="loading-card" /><div className="loading-card" /></> : null}
        {clients.map((client) => (
          <article className="data-card" key={client.id}>
            <div className="data-icon">{initials(client.name)}</div>
            <div className="data-copy"><strong>{client.name}</strong><span>{clientIdentification(client)}{client.phone ? ` • ${client.phone}` : ""}</span><span>{client.address || "Sin dirección registrada"}</span></div>
            {client.phone ? <a className="text-button" href={`tel:${client.phone}`}>Llamar</a> : null}
          </article>
        ))}
        {!loading && clients.length === 0 ? <div className="empty-state"><strong>No encontramos clientes</strong>Prueba otra búsqueda o agrega uno nuevo.</div> : null}
      </div>
    </section>
  );
}

function CatalogView({ catalog, loading, query, setQuery, openCatalog }: { catalog: CatalogItem[]; loading: boolean; query: string; setQuery: (value: string) => void; openCatalog: () => void }) {
  return (
    <section>
      <div className="view-header view-title"><div><p className="eyebrow">Productos y servicios</p><h1>Catálogo</h1><p>Precios, existencias y tipos de instalación.</p></div><button className="primary-button" onClick={openCatalog}>＋ Agregar</button></div>
      <div className="list-toolbar"><input className="search-input" type="search" placeholder="Buscar cilindro, repuesto o servicio" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar catálogo" /></div>
      <div className="data-list catalog-grid">
        {loading ? <><div className="loading-card" /><div className="loading-card" /></> : null}
        {catalog.map((item) => (
          <article className="data-card" key={item.id}>
            <div className="data-icon">{item.kind === "product" ? "◒" : "⌁"}</div>
            <div className="data-copy"><strong>{item.name}</strong><span>{item.category} • {item.kind === "product" ? `${item.stock} ${item.unit}` : item.unit}</span></div>
            <div className="data-price"><strong>{formatMoney(item.priceCents)}</strong><span>por {item.unit}</span></div>
          </article>
        ))}
        {!loading && catalog.length === 0 ? <div className="empty-state"><strong>Sin resultados</strong>Agrega un producto o servicio al catálogo.</div> : null}
      </div>
    </section>
  );
}

function SettingsView({
  settings,
  activities,
  hacienda,
  submit,
  saveCredentials,
  syncTaxpayer,
  account,
  saveAccount,
  download,
  logout,
  busy,
}: {
  settings: BusinessSettings;
  activities: EconomicActivity[];
  hacienda: HaciendaConfiguration;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  saveCredentials: (event: FormEvent<HTMLFormElement>) => void;
  syncTaxpayer: () => void;
  account: { username: string };
  saveAccount: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  download: (url: string, fallbackName: string) => void;
  logout: () => void;
  busy: boolean;
}) {
  const [tab, setTab] = useState<"business" | "hacienda" | "access">("business");
  const [accountSaved, setAccountSaved] = useState(false);
  const [taxpayerRole, setTaxpayerRole] = useState<"taxpayer" | "associate">(settings.taxpayerRole);
  const [environment, setEnvironment] = useState<"sandbox" | "production">(hacienda.environment);
  const profile = hacienda.profiles?.[environment] ?? hacienda;
  const profileReady = Boolean(
    settings.taxpayerName &&
    settings.taxpayerIdentificationNumber &&
    settings.economicActivityCode &&
    settings.invoiceEmail &&
    settings.businessAddress &&
    settings.provinceCode &&
    settings.cantonCode &&
    settings.districtCode &&
    settings.providerSystemIdentification,
  );
  const credentialsReady = profile.hasApiUsername && profile.hasApiPassword && profile.hasCertificate && profile.hasCertificatePin;
  const rutReady = environment === "sandbox" || profile.rutSystemConfirmed;
  const liveReady = environment === "sandbox" || profile.productionLiveConfirmed;
  const readySteps = [profileReady, rutReady, profile.sequenceConfirmed, credentialsReady, liveReady].filter(Boolean).length;
  return (
    <section>
      <div className="view-header view-title"><div><p className="eyebrow">Administración</p><h1>Configuración</h1><p>Datos del negocio y conexión segura con Hacienda.</p></div><button className="text-button" type="button" onClick={logout}>Cerrar sesión</button></div>
      <div className="settings-tabs" role="tablist" aria-label="Secciones de configuración">
        <button type="button" role="tab" aria-selected={tab === "business"} className={tab === "business" ? "active" : ""} onClick={() => setTab("business")}>Negocio</button>
        <button type="button" role="tab" aria-selected={tab === "hacienda"} className={tab === "hacienda" ? "active" : ""} onClick={() => setTab("hacienda")}>Hacienda y facturación</button>
        <button type="button" role="tab" aria-selected={tab === "access"} className={tab === "access" ? "active" : ""} onClick={() => setTab("access")}>Acceso</button>
      </div>
      {tab === "access" ? (
        <form className="settings-card form-grid" key={account.username} onSubmit={async (event) => { setAccountSaved(await saveAccount(event)); }}>
          <div className="settings-intro"><strong>Usuario y contraseña</strong><span>Datos con los que se entra a la aplicación. Al cambiar la contraseña se cierra la sesión en los demás dispositivos.</span></div>
          {accountSaved ? <div className="notice">Datos de acceso actualizados.</div> : null}
          <div className="field"><label htmlFor="account-username">Usuario</label><input id="account-username" name="username" defaultValue={account.username} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} minLength={4} required /></div>
          <div className="field"><label htmlFor="account-current-password">Contraseña actual</label><input id="account-current-password" name="currentPassword" type="password" autoComplete="current-password" required /></div>
          <div className="field-row"><div className="field"><label htmlFor="account-new-password">Nueva contraseña</label><input id="account-new-password" name="newPassword" type="password" autoComplete="new-password" minLength={8} placeholder="Dejar vacío para no cambiarla" /></div><div className="field"><label htmlFor="account-confirm-password">Confirmar nueva contraseña</label><input id="account-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} /></div></div>
          <div className="notice">El usuario se escribe sin espacios. La contraseña debe tener al menos 8 caracteres, con letras y números.</div>
          <div className="settings-actions"><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Actualizar acceso"}</button></div>
        </form>
      ) : null}
      {tab === "access" ? null : (
      <form className="settings-card form-grid" onSubmit={submit}>
        <div className={`settings-pane ${tab === "business" ? "active" : ""}`}>
          <div className="settings-intro"><strong>Información del negocio</strong><span>Estos datos se usarán en encabezados, comprobantes y contacto.</span></div>
          <div className="field"><label htmlFor="settings-business-name">Nombre del negocio</label><input id="settings-business-name" name="businessName" required defaultValue={settings.businessName} /></div>
          <div className="field-row"><div className="field"><label htmlFor="settings-business-phone">Teléfono</label><input id="settings-business-phone" name="businessPhone" type="tel" defaultValue={settings.businessPhone} /></div><div className="field"><label htmlFor="settings-business-email">Correo</label><input id="settings-business-email" name="businessEmail" type="email" defaultValue={settings.businessEmail} /></div></div>
          <div className="field"><label htmlFor="settings-business-address">Dirección principal</label><textarea id="settings-business-address" name="businessAddress" defaultValue={settings.businessAddress} /></div>
          <div className="field-row"><div className="field"><label htmlFor="settings-province">Provincia</label><input id="settings-province" name="provinceCode" inputMode="numeric" maxLength={1} defaultValue={settings.provinceCode} /></div><div className="field"><label htmlFor="settings-canton">Cantón</label><input id="settings-canton" name="cantonCode" inputMode="numeric" maxLength={2} defaultValue={settings.cantonCode} /></div></div>
          <div className="field-row"><div className="field"><label htmlFor="settings-district">Distrito</label><input id="settings-district" name="districtCode" inputMode="numeric" maxLength={2} defaultValue={settings.districtCode} /></div><div className="field"><label htmlFor="settings-postal">Código postal</label><input id="settings-postal" name="postalCode" inputMode="numeric" maxLength={5} defaultValue={settings.postalCode} /></div></div>
        </div>

        <div className={`settings-pane ${tab === "hacienda" ? "active" : ""}`}>
          <div className="settings-intro"><strong>Perfil tributario</strong><span>Datos que aparecerán como emisor en el XML v4.4.</span></div>
          <div className="rut-status-card">
            <div><span>Estado RUT</span><strong>{settings.rutStatus || "Sin consultar"}</strong></div>
            <div><span>Omiso</span><strong className={settings.rutOmiso === "SI" ? "warning-text" : ""}>{settings.rutOmiso || "—"}</strong></div>
            <div><span>Moroso</span><strong className={settings.rutMoroso === "SI" ? "warning-text" : ""}>{settings.rutMoroso || "—"}</strong></div>
          </div>
          {settings.rutMoroso === "SI" ? <div className="notice warning">La consulta oficial marca “moroso: SI”. Conviene revisar la deuda en TRIBU‑CR o con el contador antes de pasar a producción.</div> : null}
          <button className="secondary-button" type="button" disabled={busy || !settings.taxpayerIdentificationNumber} onClick={syncTaxpayer}>Actualizar desde Hacienda</button>
          <div className="field"><label htmlFor="settings-taxpayer-role">Perfil que administra la facturación</label><select id="settings-taxpayer-role" name="taxpayerRole" value={taxpayerRole} onChange={(event) => setTaxpayerRole(event.target.value as "taxpayer" | "associate")}><option value="taxpayer">Tributario</option><option value="associate">Asociado autorizado</option></select></div>
          <div className="field"><label htmlFor="settings-taxpayer-name">Nombre o razón social del tributario</label><input id="settings-taxpayer-name" name="taxpayerName" defaultValue={settings.taxpayerName} /></div>
          <div className="field"><label htmlFor="settings-trade-name">Nombre comercial</label><input id="settings-trade-name" name="tradeName" defaultValue={settings.tradeName} /></div>
          <div className="field-row"><div className="field"><label htmlFor="settings-taxpayer-id-type">Tipo de identificación</label><select id="settings-taxpayer-id-type" name="taxpayerIdentificationType" defaultValue={settings.taxpayerIdentificationType}>{identificationTypes.map((item) => <option value={item.value} key={item.value}>{item.value} · {item.label}</option>)}</select></div><div className="field"><label htmlFor="settings-taxpayer-id">Identificación del tributario</label><input id="settings-taxpayer-id" name="taxpayerIdentificationNumber" defaultValue={settings.taxpayerIdentificationNumber} placeholder="Sin guiones" /></div></div>
          <div className="field-row"><div className="field"><label htmlFor="settings-activity">Actividad predeterminada</label><select id="settings-activity" name="economicActivityCode" defaultValue={settings.economicActivityCode}><option value="">Selecciona una actividad</option>{activities.map((activity) => <option value={activity.code} key={activity.code}>{activity.sourceCode} · {activity.description}</option>)}</select></div><div className="field"><label htmlFor="settings-regime">Régimen tributario</label><input id="settings-regime" name="taxRegime" defaultValue={settings.taxRegime} placeholder="Ej. Régimen general" /></div></div>
          {activities.length ? <div className="activity-list">{activities.map((activity) => <div key={activity.code}><strong>{activity.sourceCode}</strong><span>{activity.description}</span><i>{activity.status === "A" ? "Activa" : activity.status}</i></div>)}</div> : null}
          <div className="field"><label htmlFor="settings-invoice-email">Correo para comprobantes</label><input id="settings-invoice-email" name="invoiceEmail" type="email" defaultValue={settings.invoiceEmail} /></div>
          <div className="field-row"><div className="field"><label htmlFor="settings-establishment">Sucursal</label><input id="settings-establishment" name="establishmentCode" inputMode="numeric" maxLength={3} pattern="[0-9]{3}" defaultValue={settings.establishmentCode} /></div><div className="field"><label htmlFor="settings-terminal">Terminal</label><input id="settings-terminal" name="terminalCode" inputMode="numeric" maxLength={5} pattern="[0-9]{5}" defaultValue={settings.terminalCode} /></div></div>
          <div className="field"><label htmlFor="settings-provider">Identificación del proveedor del sistema</label><input id="settings-provider" name="providerSystemIdentification" defaultValue={settings.providerSystemIdentification} placeholder="Identificación del proveedor o del tributario si es desarrollo propio" /></div>
          {taxpayerRole === "associate" ? <div className="associate-fields"><div className="settings-intro compact"><strong>Datos del asociado autorizado</strong><span>Persona que administra la facturación en nombre del tributario.</span></div><div className="field"><label htmlFor="settings-associate-name">Nombre del asociado</label><input id="settings-associate-name" name="associateName" defaultValue={settings.associateName} /></div><div className="field-row"><div className="field"><label htmlFor="settings-associate-id-type">Tipo de identificación</label><select id="settings-associate-id-type" name="associateIdentificationType" defaultValue={settings.associateIdentificationType}>{identificationTypes.map((item) => <option value={item.value} key={item.value}>{item.value} · {item.label}</option>)}</select></div><div className="field"><label htmlFor="settings-associate-id">Identificación</label><input id="settings-associate-id" name="associateIdentificationNumber" defaultValue={settings.associateIdentificationNumber} placeholder="Sin guiones" /></div></div></div> : <><input type="hidden" name="associateName" value={settings.associateName} /><input type="hidden" name="associateIdentificationType" value={settings.associateIdentificationType} /><input type="hidden" name="associateIdentificationNumber" value={settings.associateIdentificationNumber} /></>}
        </div>
        <div className="settings-actions"><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar configuración"}</button></div>
      </form>
      )}
      {tab === "hacienda" ? (
        <>
          <div className="hacienda-progress">
            <div><strong>{readySteps}/5 pasos listos</strong><span>{readySteps === 5 ? (environment === "sandbox" ? "Configuración completa para validar en sandbox." : "Configuración completa para emitir comprobantes reales.") : "Completa los puntos pendientes antes de emitir."}</span></div>
            <div className="progress-track"><i style={{ width: `${readySteps * 20}%` }} /></div>
            <div className="readiness-grid">
              <span className={profileReady ? "ready" : ""}>Datos tributarios</span>
              <span className={rutReady ? "ready" : ""}>{environment === "sandbox" ? "Sandbox activo" : "Sistema en RUT"}</span>
              <span className={profile.sequenceConfirmed ? "ready" : ""}>Consecutivos</span>
              <span className={credentialsReady ? "ready" : ""}>Firma y API</span>
              <span className={liveReady ? "ready" : ""}>Emisión real confirmada</span>
            </div>
          </div>
          <form key={`hacienda-${environment}`} className="settings-card form-grid hacienda-secret-form" onSubmit={saveCredentials}>
            <div className="settings-intro"><strong>Conexión privada con Hacienda</strong><span>El certificado y las credenciales se cifran en el servidor y nunca regresan al navegador.</span></div>
            <div className="notice">No pegues estas claves en el chat. Cárgalas únicamente en este formulario privado.</div>
            <div className="field"><label htmlFor="hacienda-environment">Ambiente</label><select id="hacienda-environment" name="environment" value={environment} onChange={(event) => setEnvironment(event.target.value as "sandbox" | "production")}><option value="sandbox">Pruebas (sandbox)</option><option value="production">Producción — facturas reales</option></select></div>
            {environment === "production" ? <div className="notice warning production-warning"><strong>Atención: este ambiente emite documentos tributarios reales.</strong> Usa únicamente credenciales y certificado de producción; los datos de pruebas permanecen guardados por separado.</div> : null}
            <div className="field"><label htmlFor="hacienda-api-user">Usuario API</label><input id="hacienda-api-user" name="apiUsername" autoComplete="off" placeholder={profile.hasApiUsername ? "Ya está guardado en este ambiente; deja vacío para conservarlo" : "Usuario generado por Hacienda"} /></div>
            <div className="field"><label htmlFor="hacienda-api-password">Contraseña API</label><input id="hacienda-api-password" name="apiPassword" type="password" autoComplete="new-password" placeholder={profile.hasApiPassword ? "Ya está guardada en este ambiente; deja vacío para conservarla" : "Contraseña del API de comprobantes"} /></div>
            <div className="field"><label htmlFor="hacienda-certificate">Certificado de firma .p12</label><input id="hacienda-certificate" name="certificate" type="file" accept=".p12,application/x-pkcs12" /><span className="field-help standalone">{profile.hasCertificate ? `Guardado en ${environment === "sandbox" ? "pruebas" : "producción"}: ${profile.certificateFilename}` : "Pendiente de cargar en este ambiente"}</span></div>
            <div className="field"><label htmlFor="hacienda-certificate-pin">PIN del certificado</label><input id="hacienda-certificate-pin" name="certificatePin" type="password" autoComplete="new-password" placeholder={profile.hasCertificatePin ? "Ya está guardado en este ambiente; deja vacío para conservarlo" : "PIN del .p12"} /></div>
            <div className="field-row sequence-fields">
              <div className="field"><label htmlFor="hacienda-last-sequence-fe">Último consecutivo FE</label><input id="hacienda-last-sequence-fe" name="lastSequenceFE" type="number" min="0" max="9999999999" step="1" defaultValue={profile.lastSequenceFE} /></div>
              <div className="field"><label htmlFor="hacienda-last-sequence-te">Último consecutivo TE</label><input id="hacienda-last-sequence-te" name="lastSequenceTE" type="number" min="0" max="9999999999" step="1" defaultValue={profile.lastSequenceTE} /></div>
              <div className="field"><label htmlFor="hacienda-last-sequence-nc">Último consecutivo NC</label><input id="hacienda-last-sequence-nc" name="lastSequenceNC" type="number" min="0" max="9999999999" step="1" defaultValue={profile.lastSequenceNC} /></div>
            </div>
            <span className="field-help standalone">Escribe la parte final de 10 dígitos del último consecutivo usado para cada tipo. El sistema tomará el siguiente sin reutilizar números.</span>
            <label className="confirmation-check"><input type="checkbox" name="sequenceConfirmed" defaultChecked={profile.sequenceConfirmed} /><span>Confirmé los tres últimos consecutivos de esta sucursal y terminal.</span></label>
            {environment === "production"
              ? <>
                <label className="confirmation-check"><input type="checkbox" name="rutSystemConfirmed" defaultChecked={profile.rutSystemConfirmed} /><span>Confirmé en TRIBU‑CR que el método cambió de “Sistema gratuito del Ministerio” a desarrollo propio/interno.</span></label>
                <label className="confirmation-check danger-confirmation"><input type="checkbox" name="productionLiveConfirmed" defaultChecked={profile.productionLiveConfirmed} /><span>Entiendo que al guardar producción y firmar, los comprobantes serán reales; una factura aceptada solo se corrige con nota de crédito.</span></label>
              </>
              : <div className="notice">En sandbox no es necesario cambiar el método de facturación registrado en TRIBU‑CR.</div>}
            <button className="primary-button" disabled={busy}>{busy ? "Protegiendo datos…" : "Guardar conexión segura"}</button>
          </form>
          <div className="settings-card fiscal-backup-card">
            <div className="settings-intro"><strong>Respaldo fiscal</strong><span>Descarga en un ZIP los XML firmados, respuestas de Hacienda, PDF aceptados, manifiesto y bitácora.</span></div>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => download("/api/documents/export", "respaldo-fiscal.zip")}>{busy ? "Preparando…" : "Descargar respaldo completo"}</button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function SheetTitle({ title, subtitle, close }: { title: string; subtitle: string; close: () => void }) {
  return <div className="sheet-title"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={close} aria-label="Cerrar">×</button></div>;
}

function ClientForm({ close, submit, busy }: { close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  const [identificationType, setIdentificationType] = useState<IdentificationType>("01");
  const identification = identificationTypes.find((item) => item.value === identificationType) ?? identificationTypes[0];
  return (
    <><SheetTitle title="Nuevo cliente" subtitle="Guarda sus datos una sola vez para facturar más rápido." close={close} />
      <form className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="client-name">Nombre o razón social</label><input id="client-name" name="name" required placeholder="Ej. Restaurante La Esquina S.A." autoFocus /></div>
        <div className="field-row"><div className="field"><label htmlFor="client-identification-type">Tipo de identificación <span className="optional-label">Opcional</span></label><select id="client-identification-type" name="identificationType" value={identificationType} onChange={(event) => setIdentificationType(event.target.value as IdentificationType)}>{identificationTypes.map((item) => <option value={item.value} key={item.value}>{item.value} · {item.label}</option>)}</select></div><div className="field"><label htmlFor="client-identification-number">Número de identificación <span className="optional-label">Opcional</span></label><input id="client-identification-number" name="identificationNumber" inputMode={identificationType === "02" || identificationType === "05" ? "text" : "numeric"} pattern={identification.pattern} maxLength={identification.maxLength} placeholder="Sin guiones" aria-describedby="identification-help" /></div></div>
        <p className="field-help" id="identification-help">Si agregas una identificación: {identification.help}</p>
        <div className="field"><label htmlFor="client-phone">Teléfono <span className="optional-label">Opcional</span></label><input id="client-phone" name="phone" type="tel" placeholder="8888-8888" /></div>
        <div className="field"><label htmlFor="client-email">Correo <span className="optional-label">Opcional</span></label><input id="client-email" name="email" type="email" placeholder="compras@empresa.com" /></div>
        <div className="field"><label htmlFor="client-address">Otras señas <span className="optional-label">Opcional</span></label><textarea id="client-address" name="address" placeholder="Dirección de facturación o del servicio" /></div>
        <div className="field-row">
          <div className="field"><label htmlFor="client-province">Provincia <span className="optional-label">Opcional</span></label><input id="client-province" name="provinceCode" inputMode="numeric" pattern="[1-7]" maxLength={1} placeholder="1" /></div>
          <div className="field"><label htmlFor="client-canton">Cantón <span className="optional-label">Opcional</span></label><input id="client-canton" name="cantonCode" inputMode="numeric" pattern="[0-9]{2}" maxLength={2} placeholder="01" /></div>
          <div className="field"><label htmlFor="client-district">Distrito <span className="optional-label">Opcional</span></label><input id="client-district" name="districtCode" inputMode="numeric" pattern="[0-9]{2}" maxLength={2} placeholder="01" /></div>
        </div>
        <div className="field"><label htmlFor="client-activity">Actividad económica del receptor <span className="optional-label">Opcional</span></label><input id="client-activity" name="economicActivityCode" pattern="[0-9]{4}\.[0-9]" maxLength={6} placeholder="Ej. 2823.0" /><span className="field-help standalone">Código CIIU 4 inscrito en el RUT del cliente, con punto. Se puede dejar vacío.</span></div>
        <p className="field-help">Provincia, cantón, distrito y otras señas se exigirán únicamente cuando uses este cliente en una factura electrónica.</p>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={close}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar cliente"}</button></div>
      </form></>
  );
}

function CatalogForm({ close, submit, busy }: { close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  return (
    <><SheetTitle title="Agregar al catálogo" subtitle="Puede ser un cilindro, repuesto o tipo de instalación." close={close} />
      <form className="form-grid" onSubmit={submit}>
        <div className="field-row"><div className="field"><label htmlFor="item-kind">Tipo</label><select id="item-kind" name="kind"><option value="product">Producto</option><option value="service">Servicio</option></select></div><div className="field"><label htmlFor="item-category">Categoría</label><input id="item-category" name="category" required placeholder="Cilindros" /></div></div>
        <div className="field"><label htmlFor="item-name">Nombre</label><input id="item-name" name="name" required placeholder="Cilindro de gas 25 lb" autoFocus /></div>
        <div className="field-row"><div className="field"><label htmlFor="item-price">Precio (₡)</label><input id="item-price" name="price" required type="number" min="0" step="0.01" placeholder="0.00" /></div><div className="field"><label htmlFor="item-unit">Unidad</label><input id="item-unit" name="unit" required defaultValue="unidad" /></div></div>
        <div className="field-row"><div className="field"><label htmlFor="item-stock">Existencia</label><input id="item-stock" name="stock" type="number" min="0" step="0.01" defaultValue="0" /></div><div className="field"><label htmlFor="item-min">Mínimo</label><input id="item-min" name="minStock" type="number" min="0" step="0.01" defaultValue="2" /></div></div>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={close}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button></div>
      </form></>
  );
}

function AppointmentForm({ clients, catalog, close, submit, busy }: { clients: Client[]; catalog: CatalogItem[]; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  const [clientId, setClientId] = useState("");
  const [serviceType, setServiceType] = useState("Instalación");
  const selectedClient = clients.find((client) => client.id === clientId);
  const cylinderProducts = catalog.filter((item) => item.kind === "product" && /cilindro|gas/i.test(`${item.name} ${item.category}`));
  return (
    <><SheetTitle title="Agendar trabajo" subtitle="Anota una instalación, revisión o entrega." close={close} />
      <form className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="appointment-client">Cliente guardado <span className="optional-label">Opcional</span></label><select id="appointment-client" name="clientId" value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Cliente nuevo / sin guardar</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select></div>
        {selectedClient ? <div className="selected-client"><strong>{selectedClient.name}</strong><span>{selectedClient.address || "Sin dirección registrada"}</span></div> : <><div className="field"><label htmlFor="appointment-client-name">Nombre del cliente</label><input id="appointment-client-name" name="clientName" required placeholder="Nombre o empresa" /></div><div className="field"><label htmlFor="appointment-address">Dirección</label><input id="appointment-address" name="address" required placeholder="Lugar del trabajo" /></div></>}
        <div className="field"><label htmlFor="appointment-type">Tipo</label><select id="appointment-type" name="serviceType" value={serviceType} onChange={(event) => setServiceType(event.target.value)}><option>Instalación</option><option>Mantenimiento</option><option>Entrega de gas</option><option>Visita técnica</option></select></div>
        {serviceType === "Entrega de gas" ? <div className="field"><label htmlFor="appointment-gas-product">Tamaño de cilindro</label><select id="appointment-gas-product" name="gasProductId" required defaultValue=""><option value="">Selecciona del inventario</option>{cylinderProducts.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.stock} disponibles</option>)}</select>{cylinderProducts.length === 0 ? <p className="field-help standalone">Primero agrega al inventario un producto cuyo nombre o categoría incluya “cilindro” o “gas”.</p> : null}</div> : <div className="field"><label htmlFor="appointment-title">Trabajo</label><input id="appointment-title" name="title" required placeholder={serviceType === "Mantenimiento" ? "Revisión y mantenimiento de línea" : serviceType === "Visita técnica" ? "Inspección del equipo" : "Instalación de cocina industrial"} /></div>}
        <div className="field-row"><div className="field"><label htmlFor="appointment-date">Fecha</label><input id="appointment-date" name="date" type="date" required defaultValue={getTodayKey()} /></div><div className="field"><label htmlFor="appointment-time">Hora</label><input id="appointment-time" name="time" type="time" required defaultValue="09:00" /></div></div>
        <div className="field"><label htmlFor="appointment-notes">Notas</label><textarea id="appointment-notes" name="notes" placeholder="Materiales, contacto, referencia…" /></div>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={close}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Agendar"}</button></div>
      </form></>
  );
}

function DraftInvoicesPanel({ invoices, close, openInvoice, remove, busy }: {
  invoices: SavedInvoice[];
  close: () => void;
  openInvoice: (invoice: SavedInvoice) => void;
  remove: (invoice: SavedInvoice) => void;
  busy: boolean;
}) {
  const [confirmId, setConfirmId] = useState("");
  return (
    <><SheetTitle title="Documentos recientes" subtitle="Toca uno para revisarlo, descargarlo o completar su emisión." close={close} />
      <div className="draft-invoice-list">
        {invoices.map((invoice) => {
          const state = invoice.status === "cancelled"
            ? "ANULADO"
            : invoice.haciendaStatus
              ? invoice.haciendaStatus.toUpperCase()
              : invoice.status === "certified"
                ? "ACEPTADO"
                : "BORRADOR";
          // Con clave de Hacienda el consecutivo ya se consumió: solo nota de crédito.
          const canDelete = !invoice.haciendaKey && invoice.status === "draft";
          const confirming = confirmId === invoice.id;
          return <div className="draft-invoice-row" key={invoice.id}>
            <button className="draft-invoice-card" type="button" onClick={() => openInvoice(invoice)}>
              <div className="draft-invoice-head">
                <div><strong>{getSavedInvoiceNumber(invoice)}</strong><span>{documentLabel(invoice.documentType)} · {getSavedInvoiceDate(invoice)}</span></div>
                <span className={`status-pill ${state.toLowerCase()}`}>{state}</span>
              </div>
              <div className="draft-invoice-main">
                <div><strong>{invoice.clientName}</strong><span>{invoice.lines.length} {invoice.lines.length === 1 ? "línea" : "líneas"}</span></div>
                <strong>{formatInvoiceMoney(invoice.totalCents)}</strong>
              </div>
            </button>
            {canDelete ? (
              confirming ? (
                <div className="draft-invoice-confirm">
                  <span>¿Eliminar este borrador? No se puede deshacer.</span>
                  <div>
                    <button className="danger-button" type="button" disabled={busy} onClick={() => { setConfirmId(""); remove(invoice); }}>Sí, eliminar</button>
                    <button className="text-button" type="button" onClick={() => setConfirmId("")}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <button className="draft-invoice-delete" type="button" disabled={busy} onClick={() => setConfirmId(invoice.id)} aria-label={`Eliminar ${getSavedInvoiceNumber(invoice)}`}>Eliminar</button>
              )
            ) : null}
          </div>;
        })}
        {invoices.length === 0 ? <div className="empty-state"><strong>No hay documentos</strong>Los documentos nuevos aparecerán aquí.</div> : null}
      </div>
    </>
  );
}

type CabysResult = {
  codigo: string;
  descripcion: string;
  impuesto: number;
};

function CabysPicker({ line, update }: { line: InvoiceLine; update: (patch: Partial<InvoiceLine>) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CabysResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  async function searchCabys() {
    const clean = query.trim();
    if (clean.length < 3) {
      setSearchError("Escribe al menos 3 caracteres.");
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const parameter = /^\d{13}$/.test(clean) ? `codigo=${clean}` : `q=${encodeURIComponent(clean)}`;
      const response = await fetch(`/api/hacienda/cabys?${parameter}`);
      const payload = (await response.json()) as { cabys?: CabysResult[]; error?: string } & Partial<CabysResult>;
      if (!response.ok) throw new Error(payload.error || "No se pudo consultar CABYS.");
      const found = Array.isArray(payload.cabys)
        ? payload.cabys
        : payload.codigo
          ? [{ codigo: payload.codigo, descripcion: payload.descripcion || "", impuesto: Number(payload.impuesto || 0) }]
          : [];
      setResults(found);
      if (!found.length) setSearchError("No se encontraron resultados.");
    } catch (requestError) {
      setSearchError(requestError instanceof Error ? requestError.message : "No se pudo consultar CABYS.");
    } finally {
      setSearching(false);
    }
  }

  function choose(result: CabysResult) {
    const treatment = taxTreatmentForRate(Number(result.impuesto));
    update({
      cabysCode: result.codigo,
      taxRate: treatment.rate,
      taxRateCode: treatment.code,
      description: result.descripcion,
    });
    setQuery(result.descripcion);
    setResults([]);
  }

  return (
    <div className="cabys-picker">
      <label>CABYS para Hacienda</label>
      <div className="cabys-search-row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto o servicio" />
        <button className="secondary-button" type="button" onClick={searchCabys} disabled={searching}>{searching ? "…" : "Buscar"}</button>
      </div>
      <input className="cabys-code-input" value={line.cabysCode} onChange={(event) => update({ cabysCode: event.target.value.replace(/\D/g, "").slice(0, 13) })} inputMode="numeric" maxLength={13} placeholder="Código de 13 dígitos" aria-label="Código CABYS" />
      {searchError ? <span className="field-help standalone warning-text">{searchError}</span> : null}
      {results.length ? <div className="cabys-results">{results.map((result) => <button type="button" key={result.codigo} onClick={() => choose(result)}><strong>{result.descripcion}</strong><span>{result.codigo} · IVA {result.impuesto}%</span></button>)}</div> : null}
    </div>
  );
}

function BillingChoice({
  close,
  chooseCommercial,
  chooseElectronic,
}: {
  close: () => void;
  chooseCommercial: () => void;
  chooseElectronic: (documentType: "FE" | "TE") => void;
}) {
  return (
    <>
      <SheetTitle title="¿Qué necesitas emitir?" subtitle="Elige el documento correcto antes de escribir los datos." close={close} />
      <div className="billing-choice-grid">
        <button type="button" className="billing-choice-card commercial" onClick={chooseCommercial}>
          <span className="billing-choice-icon">PDF</span>
          <strong>Documento comercial</strong>
          <p>Formato rápido y libre para cotizar, cobrar o compartir por WhatsApp. No se envía a Hacienda.</p>
          <i>Sin validez tributaria</i>
        </button>
        <button type="button" className="billing-choice-card electronic" onClick={() => chooseElectronic("FE")}>
          <span className="billing-choice-icon">FE</span>
          <strong>Factura electrónica</strong>
          <p>Para empresas o clientes identificados. Incluye CAByS, IVA, firma y validación de Hacienda.</p>
          <i>Comprobante fiscal</i>
        </button>
        <button type="button" className="billing-choice-card ticket" onClick={() => chooseElectronic("TE")}>
          <span className="billing-choice-icon">TE</span>
          <strong>Tiquete electrónico</strong>
          <p>Para consumidor final. El receptor puede quedar sin identificación.</p>
          <i>Comprobante fiscal</i>
        </button>
      </div>
    </>
  );
}

function CommercialInvoiceForm({
  clients,
  catalog,
  selectedClientId,
  setSelectedClientId,
  lines,
  setLines,
  subtotal,
  close,
  submit,
  busy,
}: {
  clients: Client[];
  catalog: CatalogItem[];
  selectedClientId: string;
  setSelectedClientId: (value: string) => void;
  lines: InvoiceLine[];
  setLines: (lines: InvoiceLine[]) => void;
  subtotal: number;
  close: () => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  const initialClient = clients.find((client) => client.id === selectedClientId);
  const [clientName, setClientName] = useState(initialClient?.name ?? "");

  function updateLine(index: number, patch: Partial<InvoiceLine>) {
    setLines(lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  function chooseClient(clientId: string) {
    setSelectedClientId(clientId);
    const client = clients.find((entry) => entry.id === clientId);
    setClientName(client?.name ?? "");
  }

  function chooseCatalogItem(index: number, catalogId: string) {
    const item = catalog.find((entry) => entry.id === catalogId);
    updateLine(index, {
      catalogId,
      description: item?.name ?? lines[index].description,
      unitPrice: item ? item.priceCents / 100 : lines[index].unitPrice,
      isService: item?.kind === "service",
    });
  }

  function removeLine(index: number) {
    if (lines.length === 1) {
      setLines([{ catalogId: "", description: "", quantity: 1, unitPrice: 0, cabysCode: "", unitCode: "Unid", taxRate: 0, taxRateCode: "", isService: false }]);
      return;
    }
    setLines(lines.filter((_, lineIndex) => lineIndex !== index));
  }

  return (
    <>
      <SheetTitle title="Nuevo documento comercial" subtitle="Rápido, editable y sin conexión con Hacienda." close={close} />
      <form className="form-grid" onSubmit={submit}>
        <input type="hidden" name="documentType" value="commercial" />
        <div className="notice commercial-notice"><strong>No es una factura electrónica.</strong> El PDF indicará que es un documento comercial sin validez tributaria.</div>
        <div className="field">
          <label htmlFor="commercial-client-helper">Autocompletar cliente <span className="optional-label">Opcional</span></label>
          <select id="commercial-client-helper" value={selectedClientId} onChange={(event) => chooseClient(event.target.value)}>
            <option value="">Escribir libremente</option>
            {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="commercial-client-name">Cliente</label><input id="commercial-client-name" name="clientName" required value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Nombre o empresa" autoFocus /></div>
        <div className="field-row">
          <div className="field"><label htmlFor="commercial-number">Consecutivo</label><input id="commercial-number" value="Se genera automáticamente" readOnly /></div>
          <div className="field"><label htmlFor="commercial-date">Fecha</label><input id="commercial-date" name="issueDate" required defaultValue={getTodayLongDate()} /></div>
        </div>
        <div className="field">
          <label>Productos, servicios o trabajos</label>
          <div className="invoice-lines">{lines.map((line, index) => (
            <div className="invoice-line compact-commercial-line" key={index}>
              <div className="field"><label htmlFor={`commercial-catalog-${index}`}>Catálogo <span className="optional-label">Opcional</span></label><select id={`commercial-catalog-${index}`} value={line.catalogId} onChange={(event) => chooseCatalogItem(index, event.target.value)}><option value="">Escribir libremente</option>{catalog.map((entry) => <option value={entry.id} key={entry.id}>{entry.name} — {formatMoney(entry.priceCents)}</option>)}</select></div>
              <div className="field"><label htmlFor={`commercial-description-${index}`}>Descripción</label><textarea id={`commercial-description-${index}`} required value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} placeholder="Trabajo realizado o producto vendido" /></div>
              <div className="invoice-line-grid">
                <div className="field"><label htmlFor={`commercial-quantity-${index}`}>Cantidad</label><input id={`commercial-quantity-${index}`} type="number" min="0.01" step="0.01" required value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value === "" ? "" : Number(event.target.value) })} /></div>
                <div className="field"><label htmlFor={`commercial-price-${index}`}>Precio (₡)</label><input id={`commercial-price-${index}`} type="number" min="0" step="0.01" required value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: event.target.value === "" ? "" : Number(event.target.value) })} /></div>
              </div>
              <div className="invoice-line-total"><button className="text-button" type="button" onClick={() => removeLine(index)}>Quitar</button><strong>{formatInvoiceMoney(Math.round(Number(line.unitPrice) * 100 * Number(line.quantity)))}</strong></div>
            </div>
          ))}</div>
          <button className="text-button add-invoice-line" type="button" onClick={() => setLines([...lines, { catalogId: "", description: "", quantity: 1, unitPrice: 0, cabysCode: "", unitCode: "Unid", taxRate: 0, taxRateCode: "", isService: false }])}>＋ Agregar otra línea</button>
        </div>
        <input type="hidden" name="clientIdentificationType" value="" />
        <input type="hidden" name="clientIdentificationNumber" value="" />
        <input type="hidden" name="economicActivityCode" value="" />
        <input type="hidden" name="saleCondition" value="01" />
        <input type="hidden" name="paymentMethod" value="04" />
        <div className="field"><label htmlFor="commercial-observations">Observaciones</label><textarea id="commercial-observations" name="observations" defaultValue="Precios expresados en colones costarricenses." /></div>
        <div className="invoice-summary"><div className="summary-row total"><span>Total</span><span>{formatInvoiceMoney(subtotal)}</span></div></div>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={close}>Atrás</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Generar documento"}</button></div>
      </form>
    </>
  );
}

function ElectronicInvoiceForm({
  documentType,
  clients,
  catalog,
  selectedClientId,
  setSelectedClientId,
  lines,
  setLines,
  subtotal,
  tax,
  activities,
  defaultActivity,
  close,
  submit,
  busy,
}: {
  documentType: "FE" | "TE";
  clients: Client[];
  catalog: CatalogItem[];
  selectedClientId: string;
  setSelectedClientId: (value: string) => void;
  lines: InvoiceLine[];
  setLines: (lines: InvoiceLine[]) => void;
  subtotal: number;
  tax: number;
  activities: EconomicActivity[];
  defaultActivity: string;
  close: () => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  const initialClient = clients.find((client) => client.id === selectedClientId);
  const [clientName, setClientName] = useState(initialClient?.name ?? (documentType === "TE" ? "Consumidor final" : ""));
  const [clientIdentificationType, setClientIdentificationType] = useState<IdentificationType | "">(initialClient?.identificationType ?? "");
  const [clientIdentificationNumber, setClientIdentificationNumber] = useState(initialClient?.identificationNumber ?? "");
  const [clientEmail, setClientEmail] = useState(initialClient?.email ?? "");
  const [clientProvinceCode, setClientProvinceCode] = useState(initialClient?.provinceCode ?? "");
  const [clientCantonCode, setClientCantonCode] = useState(initialClient?.cantonCode ?? "");
  const [clientDistrictCode, setClientDistrictCode] = useState(initialClient?.districtCode ?? "");
  const [clientAddress, setClientAddress] = useState(initialClient?.address ?? "");
  const [receiverActivityCode, setReceiverActivityCode] = useState(initialClient?.economicActivityCode ?? "");
  const [saleCondition, setSaleCondition] = useState("01");
  const receiverRequired = documentType === "FE";

  function updateLine(index: number, patch: Partial<InvoiceLine>) {
    setLines(lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  function chooseClient(clientId: string) {
    setSelectedClientId(clientId);
    const client = clients.find((entry) => entry.id === clientId);
    setClientName(client?.name ?? (documentType === "TE" ? "Consumidor final" : ""));
    setClientIdentificationType(client?.identificationType ?? "");
    setClientIdentificationNumber(client?.identificationNumber ?? "");
    setClientEmail(client?.email ?? "");
    setClientProvinceCode(client?.provinceCode ?? "");
    setClientCantonCode(client?.cantonCode ?? "");
    setClientDistrictCode(client?.districtCode ?? "");
    setClientAddress(client?.address ?? "");
    setReceiverActivityCode(client?.economicActivityCode ?? "");
  }

  function chooseCatalogItem(index: number, catalogId: string) {
    const item = catalog.find((entry) => entry.id === catalogId);
    updateLine(index, {
      catalogId,
      description: item?.name ?? lines[index].description,
      unitPrice: item ? item.priceCents / 100 : lines[index].unitPrice,
      isService: item?.kind === "service",
    });
  }

  function removeLine(index: number) {
    if (lines.length === 1) {
      setLines([{ catalogId: "", description: "", quantity: 1, unitPrice: 0, cabysCode: "", unitCode: "Unid", taxRate: 13, taxRateCode: "08", isService: false }]);
      return;
    }
    setLines(lines.filter((_, lineIndex) => lineIndex !== index));
  }

  return (
    <><SheetTitle title={documentType === "FE" ? "Nueva factura electrónica" : "Nuevo tiquete electrónico"} subtitle="La clave, consecutivo y fecha fiscal se generarán automáticamente al firmar." close={close} />
      <form className="form-grid" onSubmit={submit}>
        <input type="hidden" name="documentType" value={documentType} />
        <input type="hidden" name="invoiceNumber" value="" />
        <input type="hidden" name="issueDate" value="" />
        <div className="notice fiscal-notice"><strong>{documentType === "FE" ? "Receptor identificado obligatorio." : "Consumidor final."}</strong> Revisa CAByS, tratamiento de IVA y montos antes de firmar; un comprobante aceptado se corrige con nota de crédito.</div>
        <div className="field">
          <label htmlFor="invoice-client">Autocompletar desde la agenda <span className="optional-label">Opcional</span></label>
          <select id="invoice-client" value={selectedClientId} onChange={(event) => chooseClient(event.target.value)}>
            <option value="">Escribir cliente libremente</option>
            {clients.map((client) => <option value={client.id} key={client.id}>{client.name}{client.identificationNumber ? ` • ${clientIdentification(client)}` : ""}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="invoice-client-name">Facturar a</label><input id="invoice-client-name" name="clientName" required value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder={receiverRequired ? "Nombre o razón social exacta" : "Consumidor final"} autoFocus /></div>
        <div className="field-row">
          <div className="field"><label htmlFor="invoice-identification-type">Tipo de identificación {!receiverRequired ? <span className="optional-label">Opcional</span> : null}</label><select id="invoice-identification-type" name="clientIdentificationType" required={receiverRequired} value={clientIdentificationType} onChange={(event) => setClientIdentificationType(event.target.value as IdentificationType | "")}><option value="">Sin identificación</option>{identificationTypes.filter((type) => type.value !== "05").map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}</select></div>
          <div className="field"><label htmlFor="invoice-identification-number">Número {!receiverRequired ? <span className="optional-label">Opcional</span> : null}</label><input id="invoice-identification-number" name="clientIdentificationNumber" required={receiverRequired} value={clientIdentificationNumber} onChange={(event) => setClientIdentificationNumber(event.target.value.replace(/[\s-]/g, ""))} placeholder="Sin guiones" /></div>
        </div>
        <div className="field"><label htmlFor="invoice-client-email">Correo del receptor <span className="optional-label">Opcional</span></label><input id="invoice-client-email" name="clientEmail" type="email" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} placeholder="compras@empresa.com" /></div>
        {receiverRequired ? <>
          <div className="field-row">
            <div className="field"><label htmlFor="invoice-client-province">Provincia</label><input id="invoice-client-province" name="clientProvinceCode" required inputMode="numeric" pattern="[1-7]" maxLength={1} value={clientProvinceCode} onChange={(event) => setClientProvinceCode(event.target.value.replace(/\D/g, "").slice(0, 1))} placeholder="1" /></div>
            <div className="field"><label htmlFor="invoice-client-canton">Cantón</label><input id="invoice-client-canton" name="clientCantonCode" required inputMode="numeric" pattern="[0-9]{2}" maxLength={2} value={clientCantonCode} onChange={(event) => setClientCantonCode(event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="01" /></div>
            <div className="field"><label htmlFor="invoice-client-district">Distrito</label><input id="invoice-client-district" name="clientDistrictCode" required inputMode="numeric" pattern="[0-9]{2}" maxLength={2} value={clientDistrictCode} onChange={(event) => setClientDistrictCode(event.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="01" /></div>
          </div>
          <div className="field"><label htmlFor="invoice-client-address">Otras señas del receptor</label><textarea id="invoice-client-address" name="clientAddress" required minLength={5} value={clientAddress} onChange={(event) => setClientAddress(event.target.value)} placeholder="Dirección registrada o de facturación" /></div>
          <div className="field"><label htmlFor="invoice-receiver-activity">Actividad económica del receptor <span className="optional-label">Solo si el cliente la solicita</span></label><input id="invoice-receiver-activity" name="receiverActivityCode" pattern="[0-9]{4}\.[0-9]" maxLength={6} value={receiverActivityCode} onChange={(event) => setReceiverActivityCode(event.target.value.replace(/[^0-9.]/g, "").slice(0, 6))} placeholder="Ej. 2823.0" /><span className="field-help standalone">Código CIIU 4 del RUT del cliente, con punto. Si no estás seguro, dejalo vacío: Hacienda rechaza el comprobante si el código no está activo en su RUT.</span></div>
        </> : <>
          <input type="hidden" name="clientProvinceCode" value="" />
          <input type="hidden" name="clientCantonCode" value="" />
          <input type="hidden" name="clientDistrictCode" value="" />
          <input type="hidden" name="clientAddress" value="" />
          <input type="hidden" name="receiverActivityCode" value="" />
        </>}
        <div className="field"><label htmlFor="invoice-activity">Actividad económica</label><select id="invoice-activity" name="economicActivityCode" required defaultValue={defaultActivity}><option value="">Selecciona la actividad relacionada</option>{activities.map((activity) => <option value={activity.code} key={activity.code}>{activity.sourceCode} · {activity.description}</option>)}</select></div>
        <div className="field-row">
          <div className="field"><label htmlFor="invoice-sale-condition">Condición de venta</label><select id="invoice-sale-condition" name="saleCondition" value={saleCondition} onChange={(event) => setSaleCondition(event.target.value)}><option value="01">Contado</option><option value="02">Crédito</option></select></div>
          <div className="field"><label htmlFor="invoice-payment-method">Medio de pago</label><select id="invoice-payment-method" name="paymentMethod" defaultValue="04"><option value="01">Efectivo</option><option value="02">Tarjeta</option><option value="04">Transferencia / depósito</option><option value="06">SINPE Móvil</option><option value="07">Plataforma digital</option></select></div>
        </div>
        {saleCondition === "02" ? <div className="field"><label htmlFor="invoice-credit-term">Plazo de crédito (días)</label><input id="invoice-credit-term" name="creditTerm" type="number" min="1" max="99999" defaultValue="30" /></div> : <input type="hidden" name="creditTerm" value="" />}
        <div className="field">
          <label>Productos y servicios</label>
          <div className="invoice-lines">{lines.map((line, index) => (
            <div className="invoice-line" key={index}>
              <div className="field invoice-catalog-helper"><label htmlFor={`invoice-catalog-${index}`}>Autocompletar del catálogo <span className="optional-label">Opcional</span></label><select id={`invoice-catalog-${index}`} value={line.catalogId} onChange={(event) => chooseCatalogItem(index, event.target.value)}><option value="">Escribir libremente</option>{catalog.map((entry) => <option value={entry.id} key={entry.id}>{entry.name} — {formatMoney(entry.priceCents)}</option>)}</select></div>
              <div className="field"><label htmlFor={`invoice-description-${index}`}>Descripción</label><textarea id={`invoice-description-${index}`} required value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} placeholder="Producto, instalación o trabajo realizado" /></div>
              <CabysPicker line={line} update={(patch) => updateLine(index, patch)} />
              <div className="invoice-line-grid">
                <div className="field"><label htmlFor={`invoice-quantity-${index}`}>Cantidad</label><input id={`invoice-quantity-${index}`} type="number" min="0.01" step="0.01" required value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value === "" ? "" : Number(event.target.value) })} /></div>
                <div className="field"><label htmlFor={`invoice-price-${index}`}>Precio unitario (₡)</label><input id={`invoice-price-${index}`} type="number" min="0.01" step="0.01" required value={line.unitPrice} onChange={(event) => updateLine(index, { unitPrice: event.target.value === "" ? "" : Number(event.target.value) })} /></div>
              </div>
              <div className="invoice-line-grid">
                <div className="field"><label htmlFor={`invoice-unit-${index}`}>Unidad</label><select id={`invoice-unit-${index}`} value={line.unitCode} onChange={(event) => updateLine(index, { unitCode: event.target.value })}><option value="Unid">Unidad</option><option value="Sp">Servicio profesional</option><option value="kg">Kilogramo</option><option value="lb">Libra</option><option value="h">Hora</option><option value="Os">Otro</option></select></div>
                <div className="field"><label htmlFor={`invoice-tax-${index}`}>Tratamiento IVA</label><select id={`invoice-tax-${index}`} value={line.taxRateCode} onChange={(event) => { const treatment = taxTreatments.find((item) => item.code === event.target.value) ?? taxTreatments[0]; updateLine(index, { taxRate: treatment.rate, taxRateCode: treatment.code }); }}>{taxTreatments.map((treatment) => <option value={treatment.code} key={treatment.code}>{treatment.label}</option>)}</select></div>
              </div>
              <label className="confirmation-check compact-check"><input type="checkbox" checked={line.isService} onChange={(event) => updateLine(index, { isService: event.target.checked })} /><span>Esta línea corresponde a un servicio.</span></label>
              <div className="invoice-line-total"><button className="text-button" type="button" onClick={() => removeLine(index)}>Quitar</button><strong>{formatInvoiceMoney(Math.round(Number(line.unitPrice) * 100 * Number(line.quantity)))}</strong></div>
            </div>
          ))}</div>
          <button className="text-button add-invoice-line" type="button" onClick={() => setLines([...lines, { catalogId: "", description: "", quantity: 1, unitPrice: 0, cabysCode: "", unitCode: "Unid", taxRate: 13, taxRateCode: "08", isService: false }])}>＋ Agregar otra línea</button>
        </div>
        <div className="field"><label htmlFor="invoice-observations">Observaciones</label><textarea id="invoice-observations" name="observations" defaultValue="Precios expresados en colones costarricenses." /></div>
        <div className="invoice-summary"><div className="summary-row"><span>Subtotal</span><span>{formatInvoiceMoney(subtotal)}</span></div><div className="summary-row"><span>IVA</span><span>{formatInvoiceMoney(tax)}</span></div><div className="summary-row total"><span>Total</span><span>{formatInvoiceMoney(subtotal + tax)}</span></div></div>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={close}>Atrás</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar borrador fiscal"}</button></div>
      </form></>
  );
}

function CreditNoteForm({
  invoice,
  close,
  submit,
  busy,
}: {
  invoice: SavedInvoice;
  close: () => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  return (
    <>
      <SheetTitle title="Crear nota de crédito" subtitle="Anula por completo el comprobante aceptado y conserva su referencia fiscal." close={close} />
      <form className="form-grid" onSubmit={submit}>
        <div className="notice warning"><strong>Esta acción no borra la factura.</strong> Crea un nuevo comprobante NC por el total de {formatInvoiceMoney(invoice.totalCents)} y deberá enviarse a Hacienda.</div>
        <div className="reference-card">
          <span>Documento original</span>
          <strong>{invoice.haciendaConsecutive}</strong>
          <small>{invoice.clientName} · {invoice.haciendaKey}</small>
        </div>
        <div className="field"><label htmlFor="credit-note-reason">Motivo de la anulación</label><textarea id="credit-note-reason" name="reason" required minLength={5} maxLength={180} placeholder="Ej. Se facturó un servicio incorrecto y debe emitirse nuevamente." autoFocus /></div>
        <label className="confirmation-check danger-confirmation"><input type="checkbox" required /><span>Confirmo que deseo crear una nota de crédito por el total del comprobante.</span></label>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={close}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Creando…" : "Crear borrador de NC"}</button></div>
      </form>
    </>
  );
}

function ReceiptPanel({
  invoice,
  close,
  share,
  download,
  canSubmit,
  submitHacienda,
  checkHacienda,
  createCreditNote,
  busy,
}: {
  invoice: SavedInvoice;
  close: () => void;
  share: (format: InvoiceOutputFormat) => void;
  download: (url: string, fallbackName: string) => void;
  canSubmit: boolean;
  submitHacienda: () => void;
  checkHacienda: () => void;
  createCreditNote: () => void;
  busy: boolean;
}) {
  const isElectronic = invoice.documentType !== "commercial";
  const isAccepted = invoice.haciendaStatus === "aceptado";
  const isRejected = invoice.haciendaStatus === "rechazado";
  const isCancelled = invoice.status === "cancelled";
  const hasFiscalKey = Boolean(invoice.haciendaKey);
  const canDownloadPdf = !isElectronic || isAccepted;
  const [outputFormat, setOutputFormat] = useState<InvoiceOutputFormat>("letter");
  const selectedOutput = invoiceOutputOptions[outputFormat];
  const fiscalEnvironment = invoice.haciendaEnvironment === "production" ? "Producción" : "Pruebas";
  const lineCount = Math.max(1, invoice.lines.length);
  const displayNumber = invoice.haciendaConsecutive || getSavedInvoiceNumber(invoice);
  const displayDate = getSavedInvoiceDate(invoice);
  const displayObservations = getSavedInvoiceObservations(invoice);
  const rowHeightPoints = lineCount === 1 ? 70 : lineCount <= 3 ? 54 : Math.max(30, 160 / lineCount);
  const bottomTopPoints = Math.max(397, 246 + 32 + (lineCount * rowHeightPoints) + 10);
  const thanksTopPoints = Math.max(548, bottomTopPoints + 139);
  const receiptStyle = {
    "--invoice-row-height": `${rowHeightPoints / 5.95276}cqi`,
    "--invoice-bottom-top": `${(bottomTopPoints / 792) * 100}%`,
    "--invoice-thanks-top": `${(thanksTopPoints / 792) * 100}%`,
  } as CSSProperties;
  const lineCountClass = lineCount >= 4 ? "many-lines" : "";
  return (
    <><SheetTitle title={`${documentLabel(invoice.documentType)} ${isAccepted || !isElectronic ? "lista" : "en borrador"}`} subtitle={isAccepted ? "Comprobante aceptado por Hacienda." : isRejected ? "Hacienda rechazó este consecutivo; revisa el detalle." : isElectronic ? "Revisa todo antes de firmar y enviar." : "Documento comercial listo para descargar o compartir."} close={close} />
      {isElectronic ? <div className={`hacienda-document-status ${invoice.haciendaStatus || "draft"}`}>
        <div><span>Estado Hacienda</span><strong>{invoice.haciendaStatus ? invoice.haciendaStatus.toUpperCase() : "NO ENVIADA"}</strong></div>
        {invoice.haciendaConsecutive ? <div><span>Consecutivo</span><strong>{invoice.haciendaConsecutive}</strong></div> : null}
        {invoice.haciendaEnvironment ? <div><span>Ambiente</span><strong>{fiscalEnvironment.toUpperCase()}</strong></div> : null}
        {invoice.haciendaKey ? <p>Clave: {invoice.haciendaKey}</p> : null}
        {invoice.haciendaError ? <p className="warning-text">{invoice.haciendaError}</p> : null}
        {isCancelled ? <p className="warning-text">Este comprobante fue anulado mediante una nota de crédito aceptada.</p> : null}
      </div> : null}
      <div className="invoice-preview">
        <article className={`receipt invoice-document ${lineCountClass}`} id="printable-invoice" style={receiptStyle}>
          {isElectronic && invoice.haciendaEnvironment === "sandbox" ? <div className="invoice-preview-watermark">PRUEBA</div> : null}
          <div className="invoice-brand-rule"><span /></div>
          <header className="invoice-document-head">
            <Image className="invoice-logo" src="/gas-lp-logo.png" alt="Logo Gas LP Soluciones" width={164} height={164} priority />
            <div className="invoice-issuer"><h1>Gas LP Soluciones</h1><span>Emisor</span><p>{documentLabel(invoice.documentType)}</p></div>
          <div className={`invoice-title-card ${invoice.documentType === "commercial" ? "commercial-title-card" : ""}`}>
              <span>{invoice.documentType === "TE" ? "TIQUETE" : invoice.documentType === "NC" ? "NOTA CRÉDITO" : invoice.documentType === "commercial" ? "DOCUMENTO" : "FACTURA"}</span>
              <strong>{invoice.documentType === "commercial" ? `Consecutivo ${displayNumber}` : displayNumber}</strong>
              <i />
              <small>Fecha de emisión</small>
              <b>{displayDate}</b>
            </div>
          </header>

          <section className="invoice-customer-card">
            <div><span>FACTURAR A</span><strong className={invoice.clientName.length > 34 ? "compact" : ""}>{invoice.clientName}</strong></div>
            <p>Moneda: colón costarricense (CRC)</p>
          </section>

          <section className="invoice-items">
            <div className="invoice-items-head"><span>CANT.</span><span>DESCRIPCIÓN</span><span>PRECIO UNIT.</span><span>IMPORTE</span></div>
            <div className="invoice-items-body">
              {invoice.lines.map((line, index) => (
                <div className="invoice-item-row" key={index}>
                  <strong>{invoiceNumber.format(line.quantity)}</strong>
                  <span>{line.description}</span>
                  <span>{formatInvoiceMoney(line.unitPriceCents)}</span>
                  <strong>{formatInvoiceMoney(line.totalCents)}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="invoice-bottom-grid">
            <div className="invoice-observations">
              <strong>OBSERVACIONES</strong>
              <p>{displayObservations}</p>
              <div><b>Total en letras:</b><span>{totalInWords(invoice.totalCents)}</span></div>
            </div>
            <div className="invoice-totals">
              <div><span>Subtotal</span><strong>{formatInvoiceMoney(invoice.subtotalCents)}</strong></div>
              <div><span>IVA</span><strong>{formatInvoiceMoney(invoice.taxCents)}</strong></div>
              <i />
              <div className="grand-total"><span>TOTAL</span><strong>{formatInvoiceMoney(invoice.totalCents)}</strong></div>
            </div>
          </section>

          <section className="invoice-thanks"><strong>Gracias por su preferencia</strong><span>Gas LP Soluciones</span></section>
          <footer className="invoice-footer">
            <i />
            <div><span>Documento emitido el {displayDate}.</span><span>Página 1 de 1</span></div>
            <strong><b />GAS LP SOLUCIONES</strong>
          </footer>
        </article>
      </div>
      <div className="receipt-actions">
        {canDownloadPdf ? <div className="receipt-output-panel">
          <label className="receipt-format-field" htmlFor="invoice-output-format">
            <span>Formato de impresión</span>
            <select id="invoice-output-format" value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as InvoiceOutputFormat)}>
              {(Object.entries(invoiceOutputOptions) as Array<[InvoiceOutputFormat, typeof selectedOutput]>).map(([value, option]) => <option value={value} key={value}>{option.label}</option>)}
            </select>
            <small>{selectedOutput.description}</small>
          </label>
          <div className="receipt-output-actions">
            <button className="primary-button" type="button" disabled={busy} onClick={() => download(invoicePdfUrl(invoice.id, outputFormat), `${invoice.haciendaKey || getSavedInvoiceNumber(invoice)}${selectedOutput.suffix}.pdf`)}>Descargar {selectedOutput.actionLabel}</button>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => share(outputFormat)}>Compartir</button>
          </div>
        </div> : null}
        {isElectronic && isAccepted ? <button className="secondary-button" type="button" disabled={busy} onClick={() => download(`/api/documents/${encodeURIComponent(invoice.id)}/xml?kind=signed`, `${invoice.haciendaKey || invoice.id}.xml`)}>XML firmado</button> : null}
        {isElectronic && isAccepted ? <button className="secondary-button" type="button" disabled={busy} onClick={() => download(`/api/documents/${encodeURIComponent(invoice.id)}/xml?kind=response`, `${invoice.haciendaKey || invoice.id}_respuesta.xml`)}>Respuesta Hacienda</button> : null}
        {isElectronic && !hasFiscalKey ? <button className="primary-button" disabled={busy || !canSubmit} onClick={submitHacienda}>{busy ? "Firmando…" : invoice.documentType === "NC" ? "Firmar y enviar nota de crédito" : "Firmar y enviar a Hacienda"}</button> : null}
        {isElectronic && hasFiscalKey && !isAccepted && !isRejected ? <button className="primary-button" disabled={busy} onClick={checkHacienda}>{busy ? "Consultando…" : "Consultar estado"}</button> : null}
        {isElectronic && invoice.haciendaStatus === "error" ? <button className="secondary-button" disabled={busy || !canSubmit} onClick={submitHacienda}>Reintentar envío</button> : null}
        {isElectronic && isAccepted && !isCancelled && (invoice.documentType === "FE" || invoice.documentType === "TE") ? <button className="danger-button" disabled={busy} onClick={createCreditNote}>Anular con nota de crédito</button> : null}
      </div>
      {isElectronic && !canSubmit && !hasFiscalKey ? <p className="submission-help">Completa los 5 controles del ambiente activo en Ajustes antes de emitir.</p> : null}
      {isRejected ? <p className="submission-help warning-text">Este consecutivo no se puede reutilizar. Corrige los datos y crea un comprobante electrónico nuevo.</p> : null}
    </>
  );
}
