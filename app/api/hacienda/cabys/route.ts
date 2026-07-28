import { isAuthenticated, unauthorized } from "../../../lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return unauthorized();
  const { searchParams } = new URL(request.url);
  const query = String(searchParams.get("q") ?? "").trim();
  const code = String(searchParams.get("codigo") ?? "").replace(/\D/g, "");
  if (!code && query.length < 3) {
    return Response.json({ error: "Escribe al menos 3 caracteres o un CABYS de 13 dígitos." }, { status: 400 });
  }
  if (code && !/^\d{13}$/.test(code)) {
    return Response.json({ error: "El código CABYS debe contener 13 dígitos." }, { status: 400 });
  }
  const target = new URL("https://api.hacienda.go.cr/fe/cabys");
  if (code) target.searchParams.set("codigo", code);
  else {
    target.searchParams.set("q", query);
    target.searchParams.set("top", "10");
  }
  const response = await fetch(target, {
    headers: { accept: "application/json" },
    next: { revalidate: 60 * 60 * 24 },
  });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
