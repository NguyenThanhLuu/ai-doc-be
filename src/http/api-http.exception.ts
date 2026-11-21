import { HttpException } from "@nestjs/common";

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export class ApiHttpException extends HttpException {
  constructor(statusCode: number, code: string, message: string) {
    super({ error: { code, message } } satisfies ApiErrorResponse, statusCode);
  }
}
