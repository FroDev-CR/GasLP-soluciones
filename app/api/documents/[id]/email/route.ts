import { isAuthenticated, unauthorized } from "../../../../lib/session";
import { emailApiError, emailPayload, emailSql, readEmailDelivery, readEmailSettings } from "../../../../lib/email-storage";
import { InvoiceEmailError } from "../../../../lib/invoice-email";
import { sendInvoiceEmail } from "../../../../lib/send-invoice-email";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "cache-control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };

async function invoiceExists(id: string) {
  const sql = emailSql();
  const rows = await sql`SELECT id FROM invoices WHERE id = ${id} LIMIT 1`;
  if (!rows.length) throw new InvoiceEmailError("La factura no existe.", 404);
}

export async function GET(_request: Request, context: Context) {
  if (!await isAuthenticated()) return unauthorized();
  try {
    const { id } = await context.params;
    await invoiceExists(id);
    const settings = await readEmailSettings();
    return Response.json({ settings, delivery: await readEmailDelivery(id) }, { headers });
  } catch (error) { return emailApiError(error); }
}

export async function POST(request: Request, context: Context) {
  if (!await isAuthenticated()) return unauthorized();
  try {
    const payload = await emailPayload(request);
    if (payload.action !== "send") throw new InvoiceEmailError("Acción no reconocida.");
    const { id } = await context.params;
    await invoiceExists(id);
    const delivery = await sendInvoiceEmail(id, {
      automatic: false,
      expectedAttemptId: typeof payload.expectedAttemptId === "string" ? payload.expectedAttemptId : undefined,
      confirmResend: payload.confirmResend === true,
    });
    return Response.json({ delivery, settings: await readEmailSettings() }, { headers });
  } catch (error) { return emailApiError(error); }
}
