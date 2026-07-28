import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const encoded = process.env.HACIENDA_ENCRYPTION_KEY;
  if (!encoded && process.env.NODE_ENV !== "production") {
    return Buffer.alloc(32, 7);
  }
  const decoded = Buffer.from(encoded || "", "base64");
  if (decoded.length !== 32) {
    throw new Error("HACIENDA_ENCRYPTION_KEY debe ser una clave Base64 de 32 bytes.");
  }
  return decoded;
}

export function encryptSecret(value: string | Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(value: string) {
  const packed = Buffer.from(value, "base64");
  if (packed.length < 29) throw new Error("El secreto cifrado no es válido.");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const encrypted = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
