export const REFRESH_TOKEN_COOKIE_NAME = "ai_doc_refresh_token";

export const REFRESH_TOKEN_DURATION_SECONDS = 7 * 24 * 60 * 60;

export const REFRESH_TOKEN_DURATION_MS = REFRESH_TOKEN_DURATION_SECONDS * 1_000;

export const REFRESH_TOKEN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "none",
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth",
} as const;
