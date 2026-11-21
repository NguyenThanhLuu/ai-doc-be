import { Module } from "@nestjs/common";
import { AuthenticationController } from "./authentication.controller.js";
import { AuthenticationRepository } from "./authentication.repository.js";
import { AuthenticationService } from "./authentication.service.js";

@Module({
  controllers: [AuthenticationController],
  providers: [AuthenticationRepository, AuthenticationService],
})
export class AuthenticationModule {}
