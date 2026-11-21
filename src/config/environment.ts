import { Buffer } from "node:buffer";

const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173";
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

function readRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

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

export const GEMINI_API_KEY = readRequiredEnvironmentVariable("GEMINI_API_KEY");

export const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL?.trim() ||
  DEFAULT_GEMINI_EMBEDDING_MODEL;

export const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
