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

export const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN?.trim() || DEFAULT_FRONTEND_ORIGIN;

export const GEMINI_API_KEY = readRequiredEnvironmentVariable("GEMINI_API_KEY");

export const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL?.trim() ||
  DEFAULT_GEMINI_EMBEDDING_MODEL;

export const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
