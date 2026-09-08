export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = Boolean(process.env.DATABASE_URL && process.env.HACIENDA_ENCRYPTION_KEY);
  return Response.json(
    { status: configured ? "ok" : "misconfigured" },
    { status: configured ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
