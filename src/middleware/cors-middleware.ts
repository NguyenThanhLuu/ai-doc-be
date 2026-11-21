import type { RequestHandler } from "express";
import { FRONTEND_ORIGIN } from "../config/environment.js";

export const corsMiddleware: RequestHandler = (request, response, next) => {
  const requestOrigin = request.get("Origin");

  if (requestOrigin === FRONTEND_ORIGIN) {
    response.vary("Origin");
    response.set({
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
    });
  }

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
};
