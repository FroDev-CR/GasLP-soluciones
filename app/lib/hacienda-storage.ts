import "server-only";

import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

export type HaciendaEnvironment = "sandbox" | "production";

export async function ensureHaciendaStorage(sql: Sql) {
  await sql`CREATE TABLE IF NOT EXISTS hacienda_credentials (
    id TEXT PRIMARY KEY,
    environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
    api_username_enc TEXT NOT NULL DEFAULT '',
    api_password_enc TEXT NOT NULL DEFAULT '',
    certificate_enc TEXT NOT NULL DEFAULT '',
    certificate_pin_enc TEXT NOT NULL DEFAULT '',
    certificate_filename TEXT NOT NULL DEFAULT '',
    last_sequence BIGINT NOT NULL DEFAULT 0,
    last_sequence_fe BIGINT NOT NULL DEFAULT 0,
    last_sequence_te BIGINT NOT NULL DEFAULT 0,
    last_sequence_nc BIGINT NOT NULL DEFAULT 0,
    rut_system_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    sequence_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    production_live_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE hacienda_credentials ADD COLUMN IF NOT EXISTS last_sequence BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE hacienda_credentials ADD COLUMN IF NOT EXISTS last_sequence_fe BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE hacienda_credentials ADD COLUMN IF NOT EXISTS last_sequence_te BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE hacienda_credentials ADD COLUMN IF NOT EXISTS last_sequence_nc BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE hacienda_credentials ADD COLUMN IF NOT EXISTS sequence_confirmed BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE hacienda_credentials ADD COLUMN IF NOT EXISTS production_live_confirmed BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`CREATE TABLE IF NOT EXISTS hacienda_runtime (
    id TEXT PRIMARY KEY,
    active_environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (active_environment IN ('sandbox', 'production')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

  const legacyRows = await sql`SELECT environment FROM hacienda_credentials WHERE id = 'default' LIMIT 1`;
  const legacyEnvironment = String(legacyRows[0]?.environment || "sandbox") === "production" ? "production" : "sandbox";
  await sql`INSERT INTO hacienda_runtime (id, active_environment, updated_at) VALUES ('default', ${legacyEnvironment}, NOW()) ON CONFLICT (id) DO NOTHING`;

  await sql`
    INSERT INTO hacienda_credentials (
      id, environment, api_username_enc, api_password_enc, certificate_enc,
      certificate_pin_enc, certificate_filename, last_sequence, last_sequence_fe,
      last_sequence_te, last_sequence_nc, rut_system_confirmed, sequence_confirmed,
      production_live_confirmed, updated_at
    )
    SELECT
      environment, environment, api_username_enc, api_password_enc, certificate_enc,
      certificate_pin_enc, certificate_filename, last_sequence, last_sequence,
      0, 0, rut_system_confirmed, sequence_confirmed, FALSE, updated_at
    FROM hacienda_credentials
    WHERE id = 'default'
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`DELETE FROM hacienda_credentials WHERE id = 'default'`;

  await sql`INSERT INTO hacienda_credentials (id, environment) VALUES ('sandbox', 'sandbox') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO hacienda_credentials (id, environment) VALUES ('production', 'production') ON CONFLICT (id) DO NOTHING`;
  await sql`UPDATE hacienda_credentials SET last_sequence_fe = last_sequence WHERE last_sequence_fe = 0 AND last_sequence > 0`;
  await sql`UPDATE hacienda_credentials SET rut_system_confirmed = FALSE, production_live_confirmed = FALSE WHERE environment = 'sandbox'`;
}

export async function activeHaciendaEnvironment(sql: Sql): Promise<HaciendaEnvironment> {
  await ensureHaciendaStorage(sql);
  const rows = await sql`SELECT active_environment FROM hacienda_runtime WHERE id = 'default' LIMIT 1`;
  return String(rows[0]?.active_environment || "sandbox") === "production" ? "production" : "sandbox";
}
