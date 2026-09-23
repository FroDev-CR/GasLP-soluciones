export type InvoiceHint = {
  documentType: "FE" | "TE" | "commercial" | "unspecified";
  clientName: string;
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  taxTreatment: "exento" | "general" | "unspecified";
  reusePrevious: boolean;
};

export type AssistantAnalysis = {
  intent: "agenda" | "invoice" | "help" | "other";
  transcript: string;
  reply: string;
  clientName: string;
  title: string;
  serviceType: string;
  date: string;
  time: string;
  address: string;
  notes: string;
  invoice: InvoiceHint;
  error?: string;
};
