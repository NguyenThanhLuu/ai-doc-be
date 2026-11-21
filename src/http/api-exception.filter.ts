import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  type ExceptionFilter,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import multer from "multer";
import { DocumentIndexingError } from "../features/documents/document-indexing.js";
import { ApiHttpException, type ApiErrorResponse } from "./api-http.exception.js";

function createErrorResponse(code: string, message: string): ApiErrorResponse {
  return { error: { code, message } };
}

function readMulterError(error: unknown): multer.MulterError | null {
  if (error instanceof multer.MulterError) {
    return error;
  }

  if (
    error instanceof HttpException &&
    error.cause instanceof multer.MulterError
  ) {
    return error.cause;
  }

  return null;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(HttpAdapterHost)
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const response = host.switchToHttp().getResponse<unknown>();
    const multerError = readMulterError(error);

    if (multerError !== null) {
      const isFileTooLarge = multerError.code === "LIMIT_FILE_SIZE";

      httpAdapter.reply(
        response,
        createErrorResponse(
          multerError.code,
          isFileTooLarge
            ? "The PDF file must be 10 MB or smaller."
            : "The file upload could not be processed. Please try again.",
        ),
        isFileTooLarge
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : HttpStatus.BAD_REQUEST,
      );
      return;
    }

    if (error instanceof DocumentIndexingError) {
      if (error.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
        console.error("Document indexing failed.", { code: error.code });
      }

      httpAdapter.reply(
        response,
        createErrorResponse(error.code, error.message),
        error.statusCode,
      );
      return;
    }

    if (error instanceof ApiHttpException) {
      httpAdapter.reply(response, error.getResponse(), error.getStatus());
      return;
    }

    if (
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.NOT_FOUND
    ) {
      httpAdapter.reply(
        response,
        createErrorResponse(
          "ROUTE_NOT_FOUND",
          "The requested API route does not exist.",
        ),
        HttpStatus.NOT_FOUND,
      );
      return;
    }

    console.error("Unhandled API error:", error);
    httpAdapter.reply(
      response,
      createErrorResponse(
        "INTERNAL_SERVER_ERROR",
        "The server could not complete the request. Please try again.",
      ),
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
