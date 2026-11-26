import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AiService } from "./ai/ai.service.js";
import { AppModule } from "./app.module.js";
import { attachDocumentChatSocket } from "./features/document-chat/document-chat.socket.js";
import { AuthenticationService } from "./features/authentication/authentication.service.js";
import { DocumentRepository } from "./features/documents/document.repository.js";
import { corsMiddleware } from "./middleware/cors-middleware.js";

const PORT = 3000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableShutdownHooks();
  app.disable("x-powered-by");
  app.use(corsMiddleware);

  await app.init();

  const documentRepository = app.get(DocumentRepository);
  const authenticationService = app.get(AuthenticationService);
  const aiService = app.get(AiService);
  attachDocumentChatSocket(
    app.getHttpServer(),
    documentRepository,
    authenticationService,
    aiService,
  );

  await app.listen(PORT);
  console.log(`Node AI Pro API is listening on http://localhost:${PORT}`);
}

await bootstrap();
