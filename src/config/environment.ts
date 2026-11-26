import { Buffer } from "node:buffer";

const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173";
const DEFAULT_AI_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_AI_CHAT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_DOCUMENT_STORAGE_BUCKET = "documents";
const DEFAULT_DOCUMENT_STORAGE_SIGNED_URL_TTL_SECONDS = 600;

function readEnvironmentVariable(
  name: string,
  legacyName?: string,
): string | undefined {
  return (
    process.env[name]?.trim() ||
    (legacyName ? process.env[legacyName]?.trim() : undefined)
  );
}

function readRequiredEnvironmentVariable(
  name: string,
  legacyName?: string,
): string {
  const value = readEnvironmentVariable(name, legacyName);

  if (!value) {
    throw new Error(`${name} must be configured before starting the backend.`);
  }

  return value;
}

function readDatabaseUrl(): string {
  const value = readRequiredEnvironmentVariable("DATABASE_URL");
  let databaseUrl: URL;

  try {
    databaseUrl = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (
    databaseUrl.protocol !== "postgres:" &&
    databaseUrl.protocol !== "postgresql:"
  ) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const sslMode = databaseUrl.searchParams.get("sslmode");

  if (!sslMode || !["require", "verify-ca", "verify-full"].includes(sslMode)) {
    throw new Error(
      "DATABASE_URL must require SSL with sslmode=require, verify-ca, or verify-full.",
    );
  }

  return value;
}

function readJwtSecret(name: string): string {
  const secret = readRequiredEnvironmentVariable(name);

  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(`${name} must contain at least 32 bytes.`);
  }

  return secret;
}

function readStorageUrl(): string {
  const value = readRequiredEnvironmentVariable("STORAGE_URL", "SUPABASE_URL");
  let storageUrl: URL;

  try {
    storageUrl = new URL(value);
  } catch {
    throw new Error("STORAGE_URL must be a valid URL.");
  }

  if (storageUrl.protocol !== "https:") {
    throw new Error("STORAGE_URL must use HTTPS.");
  }

  return storageUrl.toString().replace(/\/$/, "");
}

function readPositiveInteger(
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
  legacyName?: string,
): number {
  const rawValue = readEnvironmentVariable(name, legacyName);

  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return value;
}

const accessTokenSecret = readJwtSecret("ACCESS_TOKEN_SECRET");
const refreshTokenSecret = readJwtSecret("REFRESH_TOKEN_SECRET");

if (accessTokenSecret === refreshTokenSecret) {
  throw new Error(
    "ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must be different.",
  );
}

export const DATABASE_URL = readDatabaseUrl();

export const ACCESS_TOKEN_SECRET = new TextEncoder().encode(accessTokenSecret);

export const REFRESH_TOKEN_SECRET = new TextEncoder().encode(
  refreshTokenSecret,
);

export const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN?.trim() || DEFAULT_FRONTEND_ORIGIN;

export const STORAGE_URL = readStorageUrl();

export const STORAGE_SECRET_KEY = readRequiredEnvironmentVariable(
  "STORAGE_SECRET_KEY",
  "SUPABASE_SECRET_KEY",
);

export const DOCUMENT_STORAGE_BUCKET =
  readEnvironmentVariable(
    "DOCUMENT_STORAGE_BUCKET",
    "SUPABASE_DOCUMENTS_BUCKET",
  ) || DEFAULT_DOCUMENT_STORAGE_BUCKET;

if (!/^[a-z0-9][a-z0-9._-]*$/.test(DOCUMENT_STORAGE_BUCKET)) {
  throw new Error(
    "DOCUMENT_STORAGE_BUCKET must be a valid lowercase bucket name.",
  );
}

export const DOCUMENT_STORAGE_SIGNED_URL_TTL_SECONDS = readPositiveInteger(
  "DOCUMENT_STORAGE_SIGNED_URL_TTL_SECONDS",
  DEFAULT_DOCUMENT_STORAGE_SIGNED_URL_TTL_SECONDS,
  60,
  3_600,
  "SUPABASE_SIGNED_URL_TTL_SECONDS",
);

export const AI_API_KEY = readRequiredEnvironmentVariable(
  "AI_API_KEY",
  "GEMINI_API_KEY",
);

export const AI_EMBEDDING_MODEL =
  readEnvironmentVariable("AI_EMBEDDING_MODEL", "GEMINI_EMBEDDING_MODEL") ||
  DEFAULT_AI_EMBEDDING_MODEL;

export const AI_CHAT_MODEL =
  readEnvironmentVariable("AI_CHAT_MODEL", "GEMINI_MODEL") ||
  DEFAULT_AI_CHAT_MODEL;
