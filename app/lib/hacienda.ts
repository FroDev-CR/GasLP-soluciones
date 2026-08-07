import "server-only";

import { randomInt } from "node:crypto";
import { signAndEncode } from "@dojocoding/hacienda-sdk";
import { XMLBuilder } from "fast-xml-parser";

export type HaciendaEnvironment = "sandbox" | "production";
export type ElectronicDocumentType = "FE" | "TE" | "NC";

type ElectronicLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  cabysCode: string;
  unitCode: string;
  taxRate: number;
  taxRateCode: string;
  isService: boolean;
};

export type ElectronicInvoiceInput = {
  documentType: ElectronicDocumentType;
  sequence: number;
  branch: string;
  terminal: string;
  activityCode: string;
  providerIdentification: string;
  saleCondition: string;
  creditTerm: string;
  paymentMethod: string;
  observations: string;
  issuer: {
    name: string;
    identificationType: string;
    identificationNumber: string;
    tradeName: string;
    province: string;
    canton: string;
    district: string;
    address: string;
    phone: string;
    email: string;
  };
  receiver: {
    name: string;
    identificationType: string;
    identificationNumber: string;
    email: string;
    activityCode: string;
    province: string;
    canton: string;
    district: string;
    address: string;
  };
  reference?: {
    documentType: string;
    key: string;
    emissionDate: string;
    code: string;
    reason: string;
  };
  lines: ElectronicLine[];
};

const electronicDocumentMetadata: Record<ElectronicDocumentType, {
  code: string;
  root: string;
  namespace: string;
}> = {
  FE: {
    code: "01",
    root: "FacturaElectronica",
    namespace: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica",
  },
  TE: {
    code: "04",
    root: "TiqueteElectronico",
    namespace: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico",
  },
  NC: {
    code: "03",
    root: "NotaCreditoElectronica",
    namespace: "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaCreditoElectronica",
  },
};

function money(value: number) {
  return Number(value.toFixed(5));
}

function costaRicaParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function emissionDate(date: Date) {
  const parts = costaRicaParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}-06:00`;
}

function buildConsecutive(branch: string, terminal: string, documentCode: string, sequence: number) {
  if (!/^\d{3}$/.test(branch) || !/^\d{5}$/.test(terminal)) {
    throw new Error("La sucursal debe tener 3 dígitos y la terminal 5 dígitos.");
  }
  if (!/^\d{2}$/.test(documentCode) || !Number.isSafeInteger(sequence) || sequence < 1 || sequence > 9_999_999_999) {
    throw new Error("El consecutivo fiscal no tiene un valor válido.");
  }
  return `${branch}${terminal}${documentCode}${String(sequence).padStart(10, "0")}`;
}

function buildKey(date: Date, taxpayerId: string, consecutive: string) {
  const parts = costaRicaParts(date);
  const securityCode = String(randomInt(0, 100_000_000)).padStart(8, "0");
  return `506${parts.day}${parts.month}${parts.year.slice(-2)}${taxpayerId.padStart(12, "0")}${consecutive}1${securityCode}`;
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "").slice(-8);
}

function calculatedLines(lines: ElectronicLine[]) {
  return lines.map((line, index) => {
    const subtotal = money(line.quantity * line.unitPrice);
    const tax = money(subtotal * line.taxRate / 100);
    return {
      ...line,
      lineNumber: index + 1,
      subtotal,
      tax,
      total: money(subtotal + tax),
    };
  });
}

export async function buildAndSignDocument(
  input: ElectronicInvoiceInput,
  certificate: Buffer,
  certificatePin: string,
) {
  const now = new Date();
  const metadata = electronicDocumentMetadata[input.documentType];
  const fecha = emissionDate(now);
  const numeroConsecutivo = buildConsecutive(input.branch, input.terminal, metadata.code, input.sequence);
  const clave = buildKey(now, input.issuer.identificationNumber, numeroConsecutivo);
  const lines = calculatedLines(input.lines);
  const isExempt = (line: (typeof lines)[number]) => line.taxRateCode === "10";
  const isNotSubject = (line: (typeof lines)[number]) => line.taxRateCode === "11";
  const isTaxed = (line: (typeof lines)[number]) => !isExempt(line) && !isNotSubject(line);
  const serviceTaxed = money(lines.filter((line) => line.isService && isTaxed(line)).reduce((sum, line) => sum + line.subtotal, 0));
  const serviceExempt = money(lines.filter((line) => line.isService && isExempt(line)).reduce((sum, line) => sum + line.subtotal, 0));
  const serviceNotSubject = money(lines.filter((line) => line.isService && isNotSubject(line)).reduce((sum, line) => sum + line.subtotal, 0));
  const goodsTaxed = money(lines.filter((line) => !line.isService && isTaxed(line)).reduce((sum, line) => sum + line.subtotal, 0));
  const goodsExempt = money(lines.filter((line) => !line.isService && isExempt(line)).reduce((sum, line) => sum + line.subtotal, 0));
  const goodsNotSubject = money(lines.filter((line) => !line.isService && isNotSubject(line)).reduce((sum, line) => sum + line.subtotal, 0));
  const totalTaxed = money(serviceTaxed + goodsTaxed);
  const totalExempt = money(serviceExempt + goodsExempt);
  const totalNotSubject = money(serviceNotSubject + goodsNotSubject);
  const totalSale = money(totalTaxed + totalExempt + totalNotSubject);
  const totalTax = money(lines.reduce((sum, line) => sum + line.tax, 0));
  const totalInvoice = money(totalSale + totalTax);
  const taxBreakdown = Object.entries(
    lines.reduce<Record<string, number>>((acc, line) => {
      const key = `${line.taxRateCode}:${line.taxRate}`;
      acc[key] = money((acc[key] || 0) + line.tax);
      return acc;
    }, {}),
  ).map(([key, amount]) => {
    const [rateCode] = key.split(":");
    return {
      Codigo: "01",
      CodigoTarifaIVA: rateCode,
      TotalMontoImpuesto: amount,
    };
  });
  const issuerPhone = phoneDigits(input.issuer.phone);
  const includeReceiver = input.documentType !== "TE" || Boolean(input.receiver.identificationNumber);
  const receiverLocation = input.receiver.province && input.receiver.canton && input.receiver.district && input.receiver.address
    ? {
      Ubicacion: {
        Provincia: input.receiver.province,
        Canton: input.receiver.canton,
        Distrito: input.receiver.district,
        OtrasSenas: input.receiver.address,
      },
    }
    : {};
  const root = {
    "@_xmlns": metadata.namespace,
    "@_xmlns:ds": "http://www.w3.org/2000/09/xmldsig#",
    "@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    Clave: clave,
    ProveedorSistemas: input.providerIdentification,
    CodigoActividadEmisor: input.activityCode,
    ...(input.documentType !== "TE" && input.receiver.activityCode ? { CodigoActividadReceptor: input.receiver.activityCode } : {}),
    NumeroConsecutivo: numeroConsecutivo,
    FechaEmision: fecha,
    Emisor: {
      Nombre: input.issuer.name,
      Identificacion: {
        Tipo: input.issuer.identificationType,
        Numero: input.issuer.identificationNumber,
      },
      ...(input.issuer.tradeName ? { NombreComercial: input.issuer.tradeName } : {}),
      Ubicacion: {
        Provincia: input.issuer.province,
        Canton: input.issuer.canton,
        Distrito: input.issuer.district,
        OtrasSenas: input.issuer.address,
      },
      ...(issuerPhone ? { Telefono: { CodigoPais: 506, NumTelefono: issuerPhone } } : {}),
      CorreoElectronico: input.issuer.email,
    },
    ...(includeReceiver ? {
      Receptor: {
        Nombre: input.receiver.name,
        Identificacion: {
          Tipo: input.receiver.identificationType,
          Numero: input.receiver.identificationNumber,
        },
        ...receiverLocation,
        ...(input.receiver.email ? { CorreoElectronico: input.receiver.email } : {}),
      },
    } : {}),
    CondicionVenta: input.saleCondition,
    ...(input.saleCondition === "02" ? { PlazoCredito: input.creditTerm || "30" } : {}),
    DetalleServicio: {
      LineaDetalle: lines.map((line) => ({
        NumeroLinea: line.lineNumber,
        CodigoCABYS: line.cabysCode,
        Cantidad: line.quantity,
        UnidadMedida: line.unitCode,
        Detalle: line.description.slice(0, 200),
        PrecioUnitario: money(line.unitPrice),
        MontoTotal: line.subtotal,
        SubTotal: line.subtotal,
        BaseImponible: line.subtotal,
        Impuesto: {
          Codigo: "01",
          CodigoTarifaIVA: line.taxRateCode,
          Tarifa: line.taxRate,
          Monto: line.tax,
        },
        ImpuestoAsumidoEmisorFabrica: 0,
        ImpuestoNeto: line.tax,
        MontoTotalLinea: line.total,
      })),
    },
    ResumenFactura: {
      CodigoTipoMoneda: {
        CodigoMoneda: "CRC",
        TipoCambio: 1,
      },
      ...(serviceTaxed ? { TotalServGravados: serviceTaxed } : {}),
      ...(serviceExempt ? { TotalServExentos: serviceExempt } : {}),
      ...(serviceNotSubject ? { TotalServNoSujeto: serviceNotSubject } : {}),
      ...(goodsTaxed ? { TotalMercanciasGravadas: goodsTaxed } : {}),
      ...(goodsExempt ? { TotalMercanciasExentas: goodsExempt } : {}),
      ...(goodsNotSubject ? { TotalMercNoSujeta: goodsNotSubject } : {}),
      ...(totalTaxed ? { TotalGravado: totalTaxed } : {}),
      ...(totalExempt ? { TotalExento: totalExempt } : {}),
      ...(totalNotSubject ? { TotalNoSujeto: totalNotSubject } : {}),
      TotalVenta: totalSale,
      TotalVentaNeta: totalSale,
      TotalDesgloseImpuesto: taxBreakdown,
      TotalImpuesto: totalTax,
      ...(input.saleCondition !== "02" ? {
        MedioPago: {
          TipoMedioPago: input.paymentMethod,
        },
      } : {}),
      TotalComprobante: totalInvoice,
    },
    ...(input.reference ? {
      InformacionReferencia: {
        TipoDocIR: input.reference.documentType,
        Numero: input.reference.key,
        FechaEmisionIR: input.reference.emissionDate,
        Codigo: input.reference.code,
        Razon: input.reference.reason.slice(0, 180),
      },
    } : {}),
    ...(input.observations ? { Otros: { OtroTexto: input.observations.slice(0, 300) } } : {}),
  };
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: false,
    suppressEmptyNode: true,
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>${builder.build({ [metadata.root]: root })}`;
  const signedBase64 = await signAndEncode(xml, certificate, certificatePin);
  return { clave, numeroConsecutivo, fecha, xml, signedBase64, totalInvoice };
}

function endpoints(environment: HaciendaEnvironment) {
  return environment === "production"
    ? {
      token: "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token",
      clientId: "api-prod",
      api: "https://api.comprobanteselectronicos.go.cr/recepcion/v1",
    }
    : {
      token: "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token",
      clientId: "api-stag",
      api: "https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1",
    };
}

export async function authenticateHacienda(environment: HaciendaEnvironment, username: string, password: string) {
  const endpoint = endpoints(environment);
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: endpoint.clientId,
    username,
    password,
  });
  const response = await fetch(endpoint.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || "Hacienda rechazó el usuario o la contraseña del API.");
  }
  return { token: result.access_token, api: endpoint.api };
}

export async function submitToHacienda(input: {
  environment: HaciendaEnvironment;
  username: string;
  password: string;
  clave: string;
  fecha: string;
  issuerType: string;
  issuerNumber: string;
  receiverType?: string;
  receiverNumber?: string;
  signedBase64: string;
}) {
  const session = await authenticateHacienda(input.environment, input.username, input.password);
  const response = await fetch(`${session.api}/recepcion`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      clave: input.clave,
      fecha: input.fecha,
      emisor: {
        tipoIdentificacion: input.issuerType,
        numeroIdentificacion: input.issuerNumber,
      },
      ...(input.receiverType && input.receiverNumber ? {
        receptor: {
          tipoIdentificacion: input.receiverType,
          numeroIdentificacion: input.receiverNumber,
        },
      } : {}),
      comprobanteXml: input.signedBase64,
    }),
    cache: "no-store",
  });
  const responseBody = await response.text();
  if (![201, 202].includes(response.status)) {
    throw new Error(`Hacienda no recibió el comprobante (${response.status}): ${responseBody.slice(0, 400)}`);
  }
  return { status: "recibido", location: response.headers.get("location") || "" };
}

export async function checkHaciendaStatus(input: {
  environment: HaciendaEnvironment;
  username: string;
  password: string;
  clave: string;
}) {
  const session = await authenticateHacienda(input.environment, input.username, input.password);
  const response = await fetch(`${session.api}/recepcion/${input.clave}`, {
    headers: { authorization: `Bearer ${session.token}`, accept: "application/json" },
    cache: "no-store",
  });
  const result = (await response.json().catch(() => ({}))) as {
    "ind-estado"?: string;
    "respuesta-xml"?: string;
  };
  if (!response.ok) throw new Error(`No se pudo consultar el estado en Hacienda (${response.status}).`);
  const responseXml = result["respuesta-xml"]
    ? Buffer.from(result["respuesta-xml"], "base64").toString("utf8")
    : "";
  return {
    status: result["ind-estado"] || "desconocido",
    responseXml,
  };
}
