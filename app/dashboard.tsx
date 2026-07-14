"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";

type View = "home" | "agenda" | "clients" | "catalog";
type Modal = "client" | "catalog" | "appointment" | "invoice" | "fel" | "receipt" | null;

type Client = {
  id: string;
  name: string;
  nit: string;
  phone: string;
  email: string;
  address: string;
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
  quantity: number;
};

type SavedInvoice = {
  id: string;
  clientName: string;
  clientNit: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  status: "draft" | "certified";
  createdAt: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
};

type AppData = {
  clients: Client[];
  catalog: CatalogItem[];
  appointments: Appointment[];
  invoices: SavedInvoice[];
};

const nav: Array<{ id: View | "invoice"; label: string; icon: string }> = [
  { id: "home", label: "Inicio", icon: "⌂" },
  { id: "agenda", label: "Agenda", icon: "▤" },
  { id: "invoice", label: "Facturar", icon: "+" },
  { id: "clients", label: "Clientes", icon: "♙" },
  { id: "catalog", label: "Catálogo", icon: "□" },
];

const money = new Intl.NumberFormat("es-GT", {
  style: "currency",
  currency: "GTQ",
  minimumFractionDigits: 2,
});

function getTodayKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Guatemala",
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
  const [view, setView] = useState<View>("home");
  const [modal, setModal] = useState<Modal>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([
    { catalogId: "", quantity: 1 },
  ]);
  const [receipt, setReceipt] = useState<SavedInvoice | null>(null);

  async function loadData() {
    try {
      const response = await fetch("/api/business", { cache: "no-store" });
      const payload = (await response.json()) as AppData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudieron cargar los datos");
      setData(payload);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ocurrió un error");
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const upcoming = useMemo(() => {
    return [...(data?.appointments ?? [])]
      .filter((item) => item.status !== "done")
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }, [data]);

  const lowStock = useMemo(
    () => (data?.catalog ?? []).filter((item) => item.kind === "product" && item.stock <= item.minStock),
    [data],
  );

  const selectedLines = useMemo(() => {
    return invoiceLines
      .map((line) => ({ ...line, item: data?.catalog.find((item) => item.id === line.catalogId) }))
      .filter((line): line is InvoiceLine & { item: CatalogItem } => Boolean(line.item));
  }, [data, invoiceLines]);

  const invoiceSubtotal = selectedLines.reduce(
    (sum, line) => sum + Math.round(line.item.priceCents * line.quantity),
    0,
  );

  function navigate(id: View | "invoice") {
    if (id === "invoice") {
      setModal("invoice");
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
      const result = (await response.json()) as { error?: string; invoice?: SavedInvoice };
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
        nit: form.get("nit"),
        phone: form.get("phone"),
        email: form.get("email"),
        address: form.get("address"),
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
    try {
      await postAction({
        action: "create_appointment",
        clientId: client?.id || null,
        clientName: client?.name || form.get("clientName"),
        title: form.get("title"),
        serviceType: form.get("serviceType"),
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
    const client = data?.clients.find((item) => item.id === selectedClientId);
    if (!client || selectedLines.length === 0) {
      setError("Selecciona un cliente y al menos un producto o servicio.");
      return;
    }
    try {
      const result = await postAction({
        action: "create_invoice",
        clientId: client.id,
        lines: selectedLines.map((line) => ({
          catalogId: line.item.id,
          description: line.item.name,
          quantity: line.quantity,
          unitPriceCents: line.item.priceCents,
        })),
      });
      if (result.invoice) {
        setReceipt(result.invoice);
        setModal("receipt");
        setSelectedClientId("");
        setInvoiceLines([{ catalogId: "", quantity: 1 }]);
      }
    } catch {}
  }

  async function updateAppointmentStatus(item: Appointment) {
    try {
      await postAction({
        action: "update_appointment_status",
        id: item.id,
        status: item.status === "done" ? "confirmed" : "done",
      });
    } catch {}
  }

  function shareInvoice() {
    if (!receipt) return;
    const detail = receipt.lines
      .map((line) => `${line.quantity} × ${line.description} — ${formatMoney(line.totalCents)}`)
      .join("\n");
    const message = `GAS LP SOLUCIONES\nComprobante ${receipt.id.slice(0, 8).toUpperCase()}\nCliente: ${receipt.clientName}\n${detail}\nTotal: ${formatMoney(receipt.totalCents)}\n\nDocumento en borrador, pendiente de certificación FEL.`;
    if (navigator.share) {
      void navigator.share({ title: "Comprobante GAS LP SOLUCIONES", text: message });
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  const filteredClients = (data?.clients ?? []).filter((client) =>
    `${client.name} ${client.nit} ${client.phone}`.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredCatalog = (data?.catalog ?? []).filter((item) =>
    `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="app-shell">
      <DesktopRail view={view} navigate={navigate} openFel={() => setModal("fel")} />

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
            openInvoice={() => setModal("invoice")}
            openAppointment={() => setModal("appointment")}
            openFel={() => setModal("fel")}
            navigate={navigate}
          />
        ) : null}

        {view === "agenda" ? (
          <AgendaView
            appointments={upcoming}
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
          <section className="sheet" role="dialog" aria-modal="true" aria-label="Formulario">
            <div className="sheet-handle" />
            {modal === "client" ? <ClientForm close={() => setModal(null)} submit={createClient} busy={busy} /> : null}
            {modal === "catalog" ? <CatalogForm close={() => setModal(null)} submit={createCatalogItem} busy={busy} /> : null}
            {modal === "appointment" ? <AppointmentForm clients={data?.clients ?? []} close={() => setModal(null)} submit={createAppointment} busy={busy} /> : null}
            {modal === "invoice" ? (
              <InvoiceForm
                clients={data?.clients ?? []}
                catalog={data?.catalog ?? []}
                selectedClientId={selectedClientId}
                setSelectedClientId={setSelectedClientId}
                lines={invoiceLines}
                setLines={setInvoiceLines}
                subtotal={invoiceSubtotal}
                close={() => setModal(null)}
                submit={createInvoice}
                busy={busy}
              />
            ) : null}
            {modal === "fel" ? <FelPanel close={() => setModal(null)} /> : null}
            {modal === "receipt" && receipt ? (
              <ReceiptPanel invoice={receipt} close={() => setModal(null)} share={shareInvoice} />
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function DesktopRail({
  view,
  navigate,
  openFel,
}: {
  view: View;
  navigate: (id: View | "invoice") => void;
  openFel: () => void;
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
      <button className="rail-fel" onClick={openFel}>
        <strong>● FEL por conectar</strong>
        Configura el certificador antes de emitir documentos tributarios.
      </button>
    </aside>
  );
}

function HomeView({
  data,
  upcoming,
  lowStock,
  openInvoice,
  openAppointment,
  openFel,
  navigate,
}: {
  data: AppData | null;
  upcoming: Appointment[];
  lowStock: CatalogItem[];
  openInvoice: () => void;
  openAppointment: () => void;
  openFel: () => void;
  navigate: (id: View) => void;
}) {
  const today = getTodayKey();
  const dateLabel = new Intl.DateTimeFormat("es-GT", {
    timeZone: "America/Guatemala",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const todayCount = upcoming.filter((item) => item.date === today).length;
  const draftTotal = (data?.invoices ?? []).filter((item) => item.status === "draft").reduce((sum, item) => sum + item.totalCents, 0);
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
        <button className="fel-banner full-button" onClick={openFel}>
          <span className="status-dot" aria-hidden="true" />
          <span>
            <strong>Facturación FEL pendiente de conectar</strong>
            <span>Los comprobantes se guardan como borrador hasta configurar el certificador autorizado.</span>
          </span>
        </button>
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
          <div className="section-heading"><div><h2>Resumen</h2><p>Lo importante de hoy</p></div></div>
          <div className="metric-grid">
            <div className="metric"><strong>{todayCount}</strong><span>trabajos hoy</span></div>
            <div className="metric"><strong>{data?.invoices.filter((item) => item.status === "draft").length ?? "—"}</strong><span>borradores</span></div>
            <div className="metric"><strong>{formatMoney(draftTotal).replace("GTQ", "Q")}</strong><span>por certificar</span></div>
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
        <div><p className="eyebrow">Agenda de trabajo</p><h1>Próximas visitas</h1><p>Instalaciones, mantenimientos y entregas.</p></div>
        <button className="primary-button" onClick={openAppointment}>＋ Agendar</button>
      </div>
      <div className="notebook">
        {loading ? <div className="loading-card" /> : null}
        {Object.entries(groups).map(([date, items]) => (
          <div key={date}>
            <div className="notebook-date"><strong>{new Intl.DateTimeFormat("es-GT", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00`))}</strong><span className="count-pill">{items.length}</span></div>
            {items.map((item) => (
              <button className="notebook-entry full-button" key={item.id} onClick={() => updateStatus(item)}>
                <time>{item.time}</time>
                <span><strong>{item.title}</strong><span>{item.clientName} • {item.address}</span></span>
                <span className={`status-pill ${item.status}`}>{item.status === "confirmed" ? "Confirmado" : "Pendiente"}</span>
              </button>
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
      <div className="view-header view-title"><div><p className="eyebrow">Directorio</p><h1>Clientes</h1><p>NIT, teléfonos y direcciones siempre a mano.</p></div><button className="primary-button" onClick={openClient}>＋ Nuevo</button></div>
      <div className="list-toolbar"><input className="search-input" type="search" placeholder="Buscar por nombre, NIT o teléfono" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar clientes" /></div>
      <div className="data-list">
        {loading ? <><div className="loading-card" /><div className="loading-card" /></> : null}
        {clients.map((client) => (
          <a className="data-card" href={`tel:${client.phone}`} key={client.id}>
            <div className="data-icon">{initials(client.name)}</div>
            <div className="data-copy"><strong>{client.name}</strong><span>NIT {client.nit || "CF"} • {client.phone}</span><span>{client.address}</span></div>
            <span className="text-button">Llamar</span>
          </a>
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

function SheetTitle({ title, subtitle, close }: { title: string; subtitle: string; close: () => void }) {
  return <div className="sheet-title"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={close} aria-label="Cerrar">×</button></div>;
}

function ClientForm({ close, submit, busy }: { close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  return (
    <><SheetTitle title="Nuevo cliente" subtitle="Guarda sus datos una sola vez para facturar más rápido." close={close} />
      <form className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="client-name">Nombre o empresa</label><input id="client-name" name="name" required placeholder="Ej. Restaurante El Fogón" autoFocus /></div>
        <div className="field-row"><div className="field"><label htmlFor="client-nit">NIT</label><input id="client-nit" name="nit" placeholder="CF o NIT" /></div><div className="field"><label htmlFor="client-phone">Teléfono</label><input id="client-phone" name="phone" type="tel" required placeholder="5555 5555" /></div></div>
        <div className="field"><label htmlFor="client-email">Correo</label><input id="client-email" name="email" type="email" placeholder="compras@empresa.com" /></div>
        <div className="field"><label htmlFor="client-address">Dirección</label><textarea id="client-address" name="address" placeholder="Dirección de facturación o del servicio" /></div>
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
        <div className="field-row"><div className="field"><label htmlFor="item-price">Precio (Q)</label><input id="item-price" name="price" required type="number" min="0" step="0.01" placeholder="0.00" /></div><div className="field"><label htmlFor="item-unit">Unidad</label><input id="item-unit" name="unit" required defaultValue="unidad" /></div></div>
        <div className="field-row"><div className="field"><label htmlFor="item-stock">Existencia</label><input id="item-stock" name="stock" type="number" min="0" step="0.01" defaultValue="0" /></div><div className="field"><label htmlFor="item-min">Mínimo</label><input id="item-min" name="minStock" type="number" min="0" step="0.01" defaultValue="2" /></div></div>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={close}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button></div>
      </form></>
  );
}

function AppointmentForm({ clients, close, submit, busy }: { clients: Client[]; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  return (
    <><SheetTitle title="Agendar trabajo" subtitle="Anota una instalación, revisión o entrega." close={close} />
      <form className="form-grid" onSubmit={submit}>
        <div className="field"><label htmlFor="appointment-client">Cliente guardado</label><select id="appointment-client" name="clientId" defaultValue=""><option value="">Cliente nuevo / sin guardar</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select></div>
        <div className="field"><label htmlFor="appointment-client-name">Nombre del cliente (si no está guardado)</label><input id="appointment-client-name" name="clientName" placeholder="Nombre o empresa" /></div>
        <div className="field"><label htmlFor="appointment-title">Trabajo</label><input id="appointment-title" name="title" required placeholder="Instalación de cocina industrial" autoFocus /></div>
        <div className="field"><label htmlFor="appointment-type">Tipo</label><select id="appointment-type" name="serviceType"><option>Instalación</option><option>Mantenimiento</option><option>Entrega de gas</option><option>Visita técnica</option></select></div>
        <div className="field-row"><div className="field"><label htmlFor="appointment-date">Fecha</label><input id="appointment-date" name="date" type="date" required defaultValue={getTodayKey()} /></div><div className="field"><label htmlFor="appointment-time">Hora</label><input id="appointment-time" name="time" type="time" required defaultValue="09:00" /></div></div>
        <div className="field"><label htmlFor="appointment-address">Dirección</label><input id="appointment-address" name="address" placeholder="Lugar del trabajo" /></div>
        <div className="field"><label htmlFor="appointment-notes">Notas</label><textarea id="appointment-notes" name="notes" placeholder="Materiales, contacto, referencia…" /></div>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={close}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Agendar"}</button></div>
      </form></>
  );
}

function InvoiceForm({ clients, catalog, selectedClientId, setSelectedClientId, lines, setLines, subtotal, close, submit, busy }: { clients: Client[]; catalog: CatalogItem[]; selectedClientId: string; setSelectedClientId: (value: string) => void; lines: InvoiceLine[]; setLines: (lines: InvoiceLine[]) => void; subtotal: number; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  function updateLine(index: number, patch: Partial<InvoiceLine>) {
    setLines(lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }
  return (
    <><SheetTitle title="Nueva factura" subtitle="Se guardará como borrador hasta conectar FEL." close={close} />
      <form className="form-grid" onSubmit={submit}>
        <div className="notice">El documento todavía no será un DTE válido ante SAT. Al conectar el certificador, aquí aparecerá el botón “Certificar FEL”.</div>
        <div className="field"><label htmlFor="invoice-client">Cliente</label><select id="invoice-client" required value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}><option value="">Selecciona un cliente</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name} • NIT {client.nit || "CF"}</option>)}</select></div>
        <div className="field"><label>Productos y servicios</label><div className="invoice-lines">{lines.map((line, index) => {
          const item = catalog.find((entry) => entry.id === line.catalogId);
          return <div className="invoice-line" key={index}><div className="invoice-line-grid"><select aria-label={`Producto o servicio ${index + 1}`} value={line.catalogId} onChange={(event) => updateLine(index, { catalogId: event.target.value })}><option value="">Seleccionar</option>{catalog.map((entry) => <option value={entry.id} key={entry.id}>{entry.name} — {formatMoney(entry.priceCents)}</option>)}</select><input aria-label={`Cantidad ${index + 1}`} type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /></div><div className="invoice-line-total"><button className="text-button" type="button" onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))}>Quitar</button><strong>{formatMoney((item?.priceCents ?? 0) * line.quantity)}</strong></div></div>;
        })}</div><button className="text-button" type="button" onClick={() => setLines([...lines, { catalogId: "", quantity: 1 }])}>＋ Agregar otra línea</button></div>
        <div className="invoice-summary"><div className="summary-row"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div><div className="summary-row"><span>Impuestos</span><span>Incluidos según régimen FEL</span></div><div className="summary-row total"><span>Total</span><span>{formatMoney(subtotal)}</span></div></div>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={close}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar borrador"}</button></div>
      </form></>
  );
}

function FelPanel({ close }: { close: () => void }) {
  return (
    <><SheetTitle title="Conexión FEL" subtitle="La parte fiscal se activa con un certificador autorizado." close={close} />
      <ol className="fel-steps">
        <li><div><strong>Confirmar el régimen tributario</strong><span>General, pequeño contribuyente u otro, según el RTU.</span></div></li>
        <li><div><strong>Identificar el certificador actual</strong><span>El que hoy usa tu papá o uno acreditado por SAT con acceso para sistemas propios.</span></div></li>
        <li><div><strong>Conectar sus credenciales por API</strong><span>Se almacenarán como secretos del servidor, nunca en el teléfono.</span></div></li>
        <li><div><strong>Hacer pruebas y activar</strong><span>Solo después de validar XML, certificación, anulación y PDF.</span></div></li>
      </ol>
      <div className="notice">SAT también ofrece emisión gratuita en su Agencia Virtual y App FEL, pero para automatizar desde esta app se debe integrar el servicio permitido por el certificador seleccionado.</div>
      <a className="primary-button dark full-button" style={{ display: "grid", placeItems: "center", marginTop: 14, textDecoration: "none" }} href="https://portal.sat.gob.gt/portal/certificador-de-dte/" target="_blank" rel="noreferrer">Ver certificadores autorizados por SAT</a>
    </>
  );
}

function ReceiptPanel({ invoice, close, share }: { invoice: SavedInvoice; close: () => void; share: () => void }) {
  return (
    <><SheetTitle title="Comprobante guardado" subtitle="Borrador listo para revisar, compartir o imprimir." close={close} />
      <div className="receipt" id="printable-invoice">
        <div className="receipt-head"><strong>GAS LP SOLUCIONES</strong><span>Instalaciones de cocinas y equipos de gas LP</span><span>Venta y entrega de cilindros</span></div>
        <div className="receipt-title"><div><h2>Comprobante</h2><div className="receipt-meta">No. {invoice.id.slice(0, 8).toUpperCase()}<br />{new Date(invoice.createdAt).toLocaleString("es-GT")}</div></div><span className="status-pill draft">BORRADOR</span></div>
        <div className="receipt-meta"><strong>Cliente:</strong> {invoice.clientName}<br /><strong>NIT:</strong> {invoice.clientNit || "CF"}</div>
        <table className="receipt-table"><thead><tr><th>Descripción</th><th>Cant.</th><th>Total</th></tr></thead><tbody>{invoice.lines.map((line, index) => <tr key={index}><td>{line.description}</td><td>{line.quantity}</td><td>{formatMoney(line.totalCents)}</td></tr>)}</tbody></table>
        <div className="receipt-total"><span>Total</span><span>{formatMoney(invoice.totalCents)}</span></div>
        <p className="receipt-note">Documento de control interno. No es un DTE certificado ni sustituye la factura electrónica FEL.</p>
      </div>
      <div className="receipt-actions"><button className="secondary-button" onClick={() => window.print()}>Imprimir</button><button className="primary-button" onClick={share}>Compartir</button></div>
    </>
  );
}
