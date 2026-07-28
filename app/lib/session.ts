import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "gaslp_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET no está configurado.");
  }
  return value || "gas-lp-local-session-secret";
}

function configuredPassword() {
  const value = process.env.APP_ACCESS_PASSWORD;
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error("APP_ACCESS_PASSWORD no está configurado.");
  }
  return value || "gaslp-local";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function isValidAccessPassword(password: string) {
  return safeEqual(password, configuredPassword());
}

export function createSessionToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${signature(payload)}`;
}

export function verifySessionToken(token: string | undefined) {
  if (!token) return false;
  const [version, expiresAtText, receivedSignature] = token.split(".");
  if (version !== "v1" || !expiresAtText || !receivedSignature) return false;
  const expiresAt = Number(expiresAtText);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const payload = `${version}.${expiresAtText}`;
  return safeEqual(receivedSignature, signature(payload));
}

export async function isAuthenticated() {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
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
