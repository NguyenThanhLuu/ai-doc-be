import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiHttpException } from "../../http/api-http.exception.js";
import { readCookie } from "../../http/request-credentials.js";
import { loginSchema } from "./authentication.schema.js";
import {
  AuthenticationService,
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_DURATION_MS,
} from "./authentication.service.js";
import type { AuthenticatedUser } from "./authentication.types.js";

interface AuthenticationResponse {
  readonly user: AuthenticatedUser;
  readonly accessToken: string;
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth",
} as const;

@Controller("api/auth")
export class AuthenticationController {
  constructor(
    @Inject(AuthenticationService)
    private readonly authenticationService: AuthenticationService,
  ) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticationResponse> {
    const validationResult = loginSchema.safeParse(body);

    if (!validationResult.success) {
      throw new ApiHttpException(
        HttpStatus.BAD_REQUEST,
        "LOGIN_VALIDATION_FAILED",
        validationResult.error.issues[0]?.message ??
          "Check the credentials and try again.",
      );
    }

    const loginResult = await this.authenticationService.login(
      validationResult.data,
    );
    response.cookie(REFRESH_TOKEN_COOKIE_NAME, loginResult.refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_TOKEN_DURATION_MS,
    });

    return {
      user: loginResult.user,
      accessToken: loginResult.accessToken,
    };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticationResponse> {
    try {
      return await this.authenticationService.refresh(
        readCookie(request, REFRESH_TOKEN_COOKIE_NAME),
      );
    } catch (error: unknown) {
      response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, COOKIE_OPTIONS);
      throw error;
    }
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("Cache-Control", "no-store")
  async logout(@Res({ passthrough: true }) response: Response): Promise<void> {
    response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, COOKIE_OPTIONS);
  }
}
