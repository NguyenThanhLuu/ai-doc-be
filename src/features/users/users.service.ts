import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiHttpException } from "../../http/api-http.exception.js";
import {
  hashPassword,
  verifyPassword,
} from "../authentication/authentication.password.js";
import { AuthenticationService } from "../authentication/authentication.service.js";
import type {
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from "../authentication/authentication.types.js";
import type {
  CreateUserInput,
  UpdatePasswordInput,
  UpdateUsernameInput,
} from "./users.schema.js";
import {
  UserFieldConflictError,
  UsersRepository,
} from "./users.repository.js";
import type { UserSummary } from "./users.types.js";

export interface UpdatedUsernameResult {
  readonly user: AuthenticatedUser;
  readonly accessToken: string;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(UsersRepository)
    private readonly usersRepository: UsersRepository,
    @Inject(AuthenticationService)
    private readonly authenticationService: AuthenticationService,
  ) {}

  listUsers(): Promise<readonly UserSummary[]> {
    return this.usersRepository.listUsers();
  }

  async createUser(
    input: CreateUserInput,
    createdByUserId: string,
  ): Promise<AuthenticatedUser> {
    try {
      const passwordHash = await hashPassword(input.password);
      return await this.usersRepository.createUser(
        input,
        passwordHash,
        createdByUserId,
      );
    } catch (error: unknown) {
      this.throwMappedConflict(error);
    }
  }

  async updateUsername(
    input: UpdateUsernameInput,
    currentUser: AuthenticatedPrincipal,
  ): Promise<UpdatedUsernameResult> {
    try {
      const user = await this.usersRepository.updateUsername(
        currentUser.id,
        input.username,
      );

      if (user === null) {
        throw this.createAuthenticationRequiredError();
      }

      return {
        user,
        accessToken:
          await this.authenticationService.issueReplacementAccessToken(
            user,
            currentUser.accessTokenExpiresAt,
          ),
      };
    } catch (error: unknown) {
      this.throwMappedConflict(error);
    }
  }

  async updatePassword(
    input: UpdatePasswordInput,
    userId: string,
  ): Promise<void> {
    const currentPasswordHash =
      await this.usersRepository.findPasswordHashByUserId(userId);

    if (currentPasswordHash === null) {
      throw this.createAuthenticationRequiredError();
    }

    const hasMatchingPassword = await verifyPassword(
      input.currentPassword,
      currentPasswordHash,
    );

    if (!hasMatchingPassword) {
      throw this.createIncorrectCurrentPasswordError();
    }

    const newPasswordHash = await hashPassword(input.newPassword);
    const wasUpdated = await this.usersRepository.updatePasswordHash(
      userId,
      currentPasswordHash,
      newPasswordHash,
    );

    if (!wasUpdated) {
      throw this.createIncorrectCurrentPasswordError();
    }
  }

  private throwMappedConflict(error: unknown): never {
    if (error instanceof UserFieldConflictError) {
      const isUsernameConflict = error.field === "username";
      throw new ApiHttpException(
        HttpStatus.CONFLICT,
        isUsernameConflict
          ? "USERNAME_ALREADY_EXISTS"
          : "EMAIL_ALREADY_EXISTS",
        isUsernameConflict
          ? "This username is already in use."
          : "This email is already in use.",
      );
    }

    throw error;
  }

  private createIncorrectCurrentPasswordError(): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.BAD_REQUEST,
      "CURRENT_PASSWORD_INCORRECT",
      "The current password is incorrect.",
    );
  }

  private createAuthenticationRequiredError(): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.UNAUTHORIZED,
      "AUTHENTICATION_REQUIRED",
      "Sign in to continue.",
    );
  }
}
