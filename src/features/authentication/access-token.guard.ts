import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { readBearerToken } from "../../http/request-credentials.js";
import type { AuthenticatedRequest } from "./authenticated-request.js";
import { AuthenticationService } from "./authentication.service.js";
import { PUBLIC_ROUTE_METADATA_KEY } from "./public.decorator.js";

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(AuthenticationService)
    private readonly authenticationService: AuthenticationService,
    @Inject(Reflector)
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authenticatedUser = await this.authenticationService.getCurrentUser(
      readBearerToken(request),
    );

    (request as AuthenticatedRequest).authenticatedUser = authenticatedUser; // gắn thông tin user vào request để các controller và service khác có thể sử dụng
    return true;
  }
}
