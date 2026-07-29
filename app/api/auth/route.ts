import { cookies } from "next/headers";
import {
  createSessionToken,
  expiredSessionCookie,
  hashPassword,
  isAuthenticated,
  readAccount,
  sessionCookie,
  unauthorized,
  updateAccount,
  verifyAccountPassword,
} from "../../lib/session";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; firstAt: number }>();

function attemptKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "desconocido";
}

function isBlocked(key: string) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function registerFailure(key: string) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  entry.count += 1;
}

function passwordError(password: string) {
  if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "La contraseña debe combinar letras y números.";
  }
  return "";
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return Response.json({ authenticated: false });
  }
  const account = await readAccount();
  return Response.json({ authenticated: true, username: account.username });
}

export async function POST(request: Request) {
  const key = attemptKey(request);
  if (isBlocked(key)) {
    return Response.json(
      { error: "Demasiados intentos fallidos. Espera unos minutos antes de volver a intentar." },
      { status: 429 },
    );
  }
  const payload = (await request.json()) as { username?: string; password?: string };
  const username = String(payload.username ?? "").trim();
  const password = String(payload.password ?? "");
  const account = await readAccount();
  if (username !== account.username || !verifyAccountPassword(account, password)) {
    registerFailure(key);
    return Response.json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
  }
  attempts.delete(key);
  const cookieStore = await cookies();
  cookieStore.set(sessionCookie(createSessionToken(account)));
  return Response.json({ authenticated: true, username: account.username });
}

/** Cambia el usuario y/o la contraseña desde Configuración. */
export async function PUT(request: Request) {
  if (!(await isAuthenticated())) return unauthorized();
  const payload = (await request.json()) as {
    username?: string;
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  };
  const account = await readAccount();
  const currentPassword = String(payload.currentPassword ?? "");
  if (!verifyAccountPassword(account, currentPassword)) {
    return Response.json({ error: "La contraseña actual no es correcta." }, { status: 401 });
  }

  const username = String(payload.username ?? "").trim() || account.username;
  if (username.length < 4) {
    return Response.json({ error: "El usuario debe tener al menos 4 caracteres." }, { status: 400 });
  }
  if (/\s/.test(username)) {
    return Response.json({ error: "El usuario no puede contener espacios." }, { status: 400 });
  }

  const newPassword = String(payload.newPassword ?? "");
  let passwordHash = account.passwordHash;
  if (newPassword) {
    const invalid = passwordError(newPassword);
    if (invalid) return Response.json({ error: invalid }, { status: 400 });
    if (newPassword !== String(payload.confirmPassword ?? "")) {
      return Response.json({ error: "La confirmación no coincide con la nueva contraseña." }, { status: 400 });
    }
    passwordHash = hashPassword(newPassword);
  }

  await updateAccount(username, passwordHash);
  const cookieStore = await cookies();
  // La sesión se vuelve a firmar porque el hash de la contraseña cambió.
  cookieStore.set(sessionCookie(createSessionToken({ ...account, username, passwordHash })));
  return Response.json({ authenticated: true, username });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.set(expiredSessionCookie());
  return Response.json({ authenticated: false });
}
