import { cookies } from "next/headers";
import {
  createSessionToken,
  expiredSessionCookie,
  isAuthenticated,
  isValidAccessPassword,
  sessionCookie,
} from "../../lib/session";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ authenticated: await isAuthenticated() });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as { password?: string };
  if (!isValidAccessPassword(String(payload.password ?? ""))) {
    return Response.json({ error: "Clave incorrecta." }, { status: 401 });
  }
  const cookieStore = await cookies();
  cookieStore.set(sessionCookie(createSessionToken()));
  return Response.json({ authenticated: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.set(expiredSessionCookie());
  return Response.json({ authenticated: false });
}
