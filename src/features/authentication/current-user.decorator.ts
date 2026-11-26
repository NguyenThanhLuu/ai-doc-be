import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthenticatedRequest } from "./authenticated-request.js";
import type { AuthenticatedPrincipal } from "./authentication.types.js";

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().authenticatedUser,
);
