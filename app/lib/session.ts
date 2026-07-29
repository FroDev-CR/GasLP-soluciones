import "server-only";

import { neon } from "@neondatabase/serverless";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "gaslp_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const ACCOUNT_ID = "primary";
const DEFAULT_USERNAME = "adminGASLP";
const DEFAULT_PASSWORD = "Admin123";

export type Account = {
  username: string;
  passwordHash: string;
  sessionSecret: string;
};

let initialized: Promise<void> | null = null;

function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("La base de datos todavía no está configurada en Vercel.");
  }
  return neon(connectionString);
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function passwordMatches(password: string, stored: string) {
  const [scheme, saltText, hashText] = stored.split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64");
  const derived = scryptSync(password.normalize("NFKC"), Buffer.from(saltText, "base64"), expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

/** La cuenta vive en la base de datos para poder cambiarse desde Configuración. */
async function ensureAccountStorage() {
  if (initialized) return initialized;
  initialized = (async () => {
    const sql = getSql();
    await sql`CREATE TABLE IF NOT EXISTS app_account (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      session_secret TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`
      INSERT INTO app_account (id, username, password_hash, session_secret)
      VALUES (
        ${ACCOUNT_ID},
        ${DEFAULT_USERNAME},
        ${hashPassword(DEFAULT_PASSWORD)},
        ${randomBytes(32).toString("base64url")}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  })().catch((error) => {
    initialized = null;
    throw error;
  });
  return initialized;
}

export async function readAccount(): Promise<Account> {
  await ensureAccountStorage();
  const sql = getSql();
  const rows = await sql`
    SELECT username, password_hash AS "passwordHash", session_secret AS "sessionSecret"
    FROM app_account
    WHERE id = ${ACCOUNT_ID}
  `;
  const account = rows[0] as Account | undefined;
  if (!account) throw new Error("La cuenta de acceso no está disponible.");
  return account;
}

export async function updateAccount(username: string, passwordHash: string) {
  await ensureAccountStorage();
  const sql = getSql();
  await sql`
    UPDATE app_account
    SET username = ${username}, password_hash = ${passwordHash}, updated_at = NOW()
    WHERE id = ${ACCOUNT_ID}
  `;
}

export function verifyAccountPassword(account: Account, password: string) {
  return passwordMatches(password, account.passwordHash);
}

/**
 * La firma incluye el hash de la contraseña: al cambiarla, las sesiones
 * abiertas en otros dispositivos dejan de ser válidas.
 */
function signature(payload: string, account: Account) {
  return createHmac("sha256", `${account.sessionSecret}.${account.passwordHash}`)
    .update(payload)
    .digest("base64url");
}

export function createSessionToken(account: Account) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `v2.${expiresAt}`;
  return `${payload}.${signature(payload, account)}`;
}

export async function verifySessionToken(token: string | undefined) {
  if (!token) return false;
  const [version, expiresAtText, receivedSignature] = token.split(".");
  if (version !== "v2" || !expiresAtText || !receivedSignature) return false;
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const account = await readAccount();
  return safeEqual(receivedSignature, signature(`${version}.${expiresAtText}`, account));
}

export async function isAuthenticated() {
  try {
    const cookieStore = await cookies();
    return await verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
  } catch {
    return false;
  }
}

export function sessionCookie(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    maxAge: SESSION_SECONDS,
    path: "/",
  };
}

export function expiredSessionCookie() {
  return {
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    maxAge: 0,
    path: "/",
  };
}

export function unauthorized() {
  return Response.json({ error: "Debes iniciar sesión." }, { status: 401 });
}
