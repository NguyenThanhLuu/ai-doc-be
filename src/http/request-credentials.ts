import type { Request } from "express";

export function readCookie(
  request: Request,
  cookieName: string,
): string | null {
  const cookie = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));

  return cookie?.slice(cookieName.length + 1).trim() || null;
}

export function readBearerToken(request: Request): string | null {
  const authorization = request.headers.authorization;
  const prefix = "Bearer ";

  if (!authorization?.startsWith(prefix)) {
    return null;
  }

  return authorization.slice(prefix.length).trim() || null;
}
