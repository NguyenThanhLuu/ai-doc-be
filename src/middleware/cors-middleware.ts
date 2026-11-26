import type { RequestHandler } from "express";

export const corsMiddleware: RequestHandler = (request, response, next) => {
  const requestOrigin = request.get("Origin");

  if (requestOrigin) {
    response.vary("Origin");
    response.set({
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS, DELETE",
      "Access-Control-Allow-Origin": requestOrigin,
    });
  }

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
};
