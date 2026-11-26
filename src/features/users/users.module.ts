import { Module } from "@nestjs/common";
import { AuthenticationModule } from "../authentication/authentication.module.js";
import { UsersController } from "./users.controller.js";
import { UsersRepository } from "./users.repository.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [AuthenticationModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService],
})
export class UsersModule {}
