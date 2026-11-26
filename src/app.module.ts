import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AiModule } from "./ai/ai.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { AuthenticationModule } from "./features/authentication/authentication.module.js";
import { AccessTokenGuard } from "./features/authentication/access-token.guard.js";
import { DocumentsModule } from "./features/documents/documents.module.js";
import { UsersModule } from "./features/users/users.module.js";
import { ApiExceptionFilter } from "./http/api-exception.filter.js";
import { StorageModule } from "./storage/storage.module.js";

@Module({
  imports: [
    AiModule,
    DatabaseModule,
    StorageModule,
    AuthenticationModule,
    DocumentsModule,
    UsersModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AccessTokenGuard,
    },
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
})
export class AppModule {}
