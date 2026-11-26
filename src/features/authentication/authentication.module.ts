import { Module } from "@nestjs/common";
import { AccessTokenGuard } from "./access-token.guard.js";
import { AuthenticationController } from "./authentication.controller.js";
import { AuthenticationRepository } from "./authentication.repository.js";
import { AuthenticationService } from "./authentication.service.js";
import { RolesGuard } from "./roles.guard.js";

@Module({
  controllers: [AuthenticationController],
  providers: [
    AuthenticationRepository,
    AuthenticationService,
    AccessTokenGuard,
    RolesGuard,
  ],
  exports: [AuthenticationService, AccessTokenGuard, RolesGuard],
})
export class AuthenticationModule {}
