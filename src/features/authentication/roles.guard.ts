import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiHttpException } from "../../http/api-http.exception.js";
import type { AuthenticatedRequest } from "./authenticated-request.js";
import { REQUIRED_ROLES_METADATA_KEY } from "./roles.decorator.js";
import type { UserRole } from "./authentication.types.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<readonly UserRole[]>(
      REQUIRED_ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    if (!requiredRoles.includes(request.authenticatedUser.role)) {
      throw new ApiHttpException(
        HttpStatus.FORBIDDEN,
        "ADMIN_ROLE_REQUIRED",
        "Administrator access is required.",
      );
    }

    return true;
  }
}
