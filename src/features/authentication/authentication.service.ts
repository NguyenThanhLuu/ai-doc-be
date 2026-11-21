import { randomBytes } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcrypt";
import { SignJWT, jwtVerify } from "jose";
import {
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
} from "../../config/environment.js";
import { ApiHttpException } from "../../http/api-http.exception.js";
import { AuthenticationRepository } from "./authentication.repository.js";
import type { LoginInput } from "./authentication.schema.js";
import type { AuthenticatedUser } from "./authentication.types.js";

const BCRYPT_WORK_FACTOR = 12;
const ACCESS_TOKEN_DURATION_SECONDS = 60 * 60;
const REFRESH_TOKEN_DURATION_SECONDS = 7 * 24 * 60 * 60;
const INVALID_PASSWORD_HASH_PROMISE = bcrypt.hash(
  randomBytes(32).toString("base64url"),
  BCRYPT_WORK_FACTOR,
);

const JWT_ALGORITHM = "HS256";
const JWT_ISSUER = "ai-doc-api";
const JWT_AUDIENCE = "ai-doc-web";

export const REFRESH_TOKEN_COOKIE_NAME = "ai_doc_refresh_token";
export const REFRESH_TOKEN_DURATION_MS =
  REFRESH_TOKEN_DURATION_SECONDS * 1_000;

export interface LoginResult {
  readonly user: AuthenticatedUser;
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface RefreshResult {
  readonly user: AuthenticatedUser;
  readonly accessToken: string;
}

@Injectable()
export class AuthenticationService {
  constructor(
    @Inject(AuthenticationRepository)
    private readonly authenticationRepository: AuthenticationRepository,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.authenticationRepository.findUserByEmail(
      input.email,
    );
    const passwordHash =
      user?.passwordHash ?? (await INVALID_PASSWORD_HASH_PROMISE);
    const hasMatchingPassword = await bcrypt.compare(
      input.password,
      passwordHash,
    );

    if (!user || !hasMatchingPassword) {
      throw new ApiHttpException(
        HttpStatus.UNAUTHORIZED,
        "INVALID_CREDENTIALS",
        "The email or password is incorrect. Please try again.",
      );
    }

    const authenticatedUser = this.toAuthenticatedUser(user);

    return {
      user: authenticatedUser,
      accessToken: await this.createAccessToken(authenticatedUser),
      refreshToken: await this.createRefreshToken(authenticatedUser.id),
    };
  }

  async refresh(refreshToken: string | null): Promise<RefreshResult> {
    if (refreshToken === null) {
      throw this.createInvalidRefreshTokenError();
    }

    const userId = await this.verifyRefreshToken(refreshToken);
    const user = await this.authenticationRepository.findUserById(userId);

    if (user === null) {
      throw this.createInvalidRefreshTokenError();
    }

    return {
      user,
      accessToken: await this.createAccessToken(user),
    };
  }

  async getCurrentUser(accessToken: string | null): Promise<AuthenticatedUser> {
    if (accessToken === null) {
      throw this.createAuthenticationRequiredError();
    }

    try {
      const { payload } = await jwtVerify(accessToken, ACCESS_TOKEN_SECRET, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });

      if (
        payload.tokenType !== "access" ||
        typeof payload.sub !== "string" ||
        typeof payload.username !== "string" ||
        typeof payload.email !== "string" ||
        (payload.role !== "admin" && payload.role !== "user")
      ) {
        throw this.createAuthenticationRequiredError();
      }

      return {
        id: payload.sub,
        username: payload.username,
        email: payload.email,
        role: payload.role,
      };
    } catch {
      throw this.createAuthenticationRequiredError();
    }
  }

  private createAccessToken(user: AuthenticatedUser): Promise<string> {
    return new SignJWT({
      tokenType: "access",
      username: user.username,
      email: user.email,
      role: user.role,
    })
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: "JWT" })
      .setSubject(user.id)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_DURATION_SECONDS}s`)
      .sign(ACCESS_TOKEN_SECRET);
  }

  private createRefreshToken(userId: string): Promise<string> {
    return new SignJWT({ tokenType: "refresh" })
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: "JWT" })
      .setSubject(userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TOKEN_DURATION_SECONDS}s`)
      .sign(REFRESH_TOKEN_SECRET);
  }

  private async verifyRefreshToken(refreshToken: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(
        refreshToken,
        REFRESH_TOKEN_SECRET,
        {
          algorithms: [JWT_ALGORITHM],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
      );

      if (payload.tokenType !== "refresh" || typeof payload.sub !== "string") {
        throw this.createInvalidRefreshTokenError();
      }

      return payload.sub;
    } catch {
      throw this.createInvalidRefreshTokenError();
    }
  }

  private toAuthenticatedUser(user: AuthenticatedUser): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };
  }

  private createAuthenticationRequiredError(): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.UNAUTHORIZED,
      "AUTHENTICATION_REQUIRED",
      "Sign in to continue.",
    );
  }

  private createInvalidRefreshTokenError(): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.UNAUTHORIZED,
      "INVALID_REFRESH_TOKEN",
      "Your sign-in has expired. Sign in again.",
    );
  }
}
