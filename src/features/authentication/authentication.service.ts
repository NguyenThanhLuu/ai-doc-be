import { randomBytes } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { SignJWT, jwtVerify } from "jose";
import {
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
} from "../../config/environment.js";
import { ApiHttpException } from "../../http/api-http.exception.js";
import { AuthenticationRepository } from "./authentication.repository.js";
import { REFRESH_TOKEN_DURATION_SECONDS } from "./authentication.cookie.js";
import {
  hashPassword,
  verifyPassword,
} from "./authentication.password.js";
import type { LoginInput } from "./authentication.schema.js";
import type {
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from "./authentication.types.js";

const ACCESS_TOKEN_DURATION_SECONDS = 60 * 60;
const INVALID_PASSWORD_HASH_PROMISE = hashPassword(
  randomBytes(32).toString("base64url"),
);

const JWT_ALGORITHM = "HS256";
const JWT_ISSUER = "ai-doc-api";
const JWT_AUDIENCE = "ai-doc-web";

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
    const hasMatchingPassword = await verifyPassword(
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
      accessToken: await this.issueAccessToken(authenticatedUser),
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
      accessToken: await this.issueAccessToken(user),
    };
  }

  async getCurrentUser(
    accessToken: string | null,
  ): Promise<AuthenticatedPrincipal> {
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
        typeof payload.exp !== "number" ||
        (payload.role !== "admin" && payload.role !== "user")
      ) {
        throw this.createAuthenticationRequiredError();
      }

      return {
        id: payload.sub,
        username: payload.username,
        email: payload.email,
        role: payload.role,
        accessTokenExpiresAt: payload.exp,
      };
    } catch {
      throw this.createAuthenticationRequiredError();
    }
  }

  issueAccessToken(user: AuthenticatedUser): Promise<string> {
    return this.createAccessToken(
      user,
      `${ACCESS_TOKEN_DURATION_SECONDS}s`,
    );
  }

  issueReplacementAccessToken(
    user: AuthenticatedUser,
    accessTokenExpiresAt: number,
  ): Promise<string> {
    return this.createAccessToken(user, accessTokenExpiresAt);
  }

  private createAccessToken(
    user: AuthenticatedUser,
    expirationTime: string | number,
  ): Promise<string> {
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
      .setExpirationTime(expirationTime)
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
