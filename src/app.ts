import express from "express";
import { documentRouter } from "./features/documents/document.routes.js";
import { corsMiddleware } from "./middleware/cors-middleware.js";
import { errorHandler } from "./middleware/error-handler.js";

export const app = express();

app.disable("x-powered-by");
app.use(corsMiddleware);
app.use("/api/documents", documentRouter);

app.use((_request, response) => {
  response.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "The requested API route does not exist.",
    },
  });
});

app.use(errorHandler);
