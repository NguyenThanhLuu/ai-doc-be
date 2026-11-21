import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { DatabaseModule } from "./database/database.module.js";
import { AuthenticationModule } from "./features/authentication/authentication.module.js";
import { DocumentsModule } from "./features/documents/documents.module.js";
import { ApiExceptionFilter } from "./http/api-exception.filter.js";

@Module({
  imports: [DatabaseModule, AuthenticationModule, DocumentsModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
})
export class AppModule {}
