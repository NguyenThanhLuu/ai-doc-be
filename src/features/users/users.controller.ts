import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiHttpException } from "../../http/api-http.exception.js";
import {
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_OPTIONS,
} from "../authentication/authentication.cookie.js";
import { CurrentUser } from "../authentication/current-user.decorator.js";
import { Roles } from "../authentication/roles.decorator.js";
import { RolesGuard } from "../authentication/roles.guard.js";
import type {
  AuthenticatedPrincipal,
  AuthenticatedUser,
} from "../authentication/authentication.types.js";
import {
  createUserSchema,
  updatePasswordSchema,
  updateUsernameSchema,
} from "./users.schema.js";
import { UsersService } from "./users.service.js";
import type { UserSummary } from "./users.types.js";

interface CreateUserResponse {
  readonly message: string;
  readonly user: AuthenticatedUser;
}

interface UpdateUsernameResponse {
  readonly message: string;
  readonly user: AuthenticatedUser;
  readonly accessToken: string;
}

interface UpdatePasswordResponse {
  readonly message: string;
}

interface UserListResponse {
  readonly users: readonly UserSummary[];
}

@Controller("api/users")
@UseGuards(RolesGuard)
export class UsersController {
  constructor(
    @Inject(UsersService)
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @Roles("admin")
  @Header("Cache-Control", "no-store")
  async listUsers(): Promise<UserListResponse> {
    return { users: await this.usersService.listUsers() };
  }

  @Post()
  @Roles("admin")
  async createUser(
    @Body() body: unknown,
    @CurrentUser() currentUser: AuthenticatedPrincipal,
  ): Promise<CreateUserResponse> {
    const validationResult = createUserSchema.safeParse(body);
    if (!validationResult.success) {
      throw this.createValidationError(
        "CREATE_USER_VALIDATION_FAILED",
        validationResult.error.issues[0]?.message,
      );
    }

    const user = await this.usersService.createUser(
      validationResult.data,
      currentUser.id,
    );

    return { message: "Account created successfully.", user };
  }

  @Patch("me/username")
  @Header("Cache-Control", "no-store")
  async updateUsername(
    @Body() body: unknown,
    @CurrentUser() currentUser: AuthenticatedPrincipal,
  ): Promise<UpdateUsernameResponse> {
    const validationResult = updateUsernameSchema.safeParse(body);
    if (!validationResult.success) {
      throw this.createValidationError(
        "UPDATE_USERNAME_VALIDATION_FAILED",
        validationResult.error.issues[0]?.message,
      );
    }

    const result = await this.usersService.updateUsername(
      validationResult.data,
      currentUser,
    );

    return { message: "Username updated successfully.", ...result };
  }

  @Patch("me/password")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async updatePassword(
    @Body() body: unknown,
    @CurrentUser() currentUser: AuthenticatedPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UpdatePasswordResponse> {
    const validationResult = updatePasswordSchema.safeParse(body);
    if (!validationResult.success) {
      throw this.createValidationError(
        "UPDATE_PASSWORD_VALIDATION_FAILED",
        validationResult.error.issues[0]?.message,
      );
    }

    await this.usersService.updatePassword(
      validationResult.data,
      currentUser.id,
    );
    response.clearCookie(
      REFRESH_TOKEN_COOKIE_NAME,
      REFRESH_TOKEN_COOKIE_OPTIONS,
    );

    return {
      message: "Password updated. Sign in again with your new password.",
    };
  }

  private createValidationError(
    code: string,
    message: string | undefined,
  ): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.BAD_REQUEST,
      code,
      message ?? "Check the account details and try again.",
    );
  }
}
