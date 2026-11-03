import type { ErrorRequestHandler } from "express";
import multer from "multer";

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  if (error instanceof multer.MulterError) {
    const isFileTooLarge = error.code === "LIMIT_FILE_SIZE";

    response.status(isFileTooLarge ? 413 : 400).json({
      error: {
        code: error.code,
        message: isFileTooLarge
          ? "The PDF file must be 10 MB or smaller."
          : "The file upload could not be processed. Please try again.",
      },
    });
    return;
  }

  console.error("Unhandled API error:", error);
  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "The server could not complete the request. Please try again.",
    },
  });
};
