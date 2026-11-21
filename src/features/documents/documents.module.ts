import { Module } from "@nestjs/common";
import { DOCUMENT_REPOSITORY } from "./document.repository.js";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";
import { MemoryDocumentRepository } from "./memory-document.repository.js";

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    {
      provide: DOCUMENT_REPOSITORY,
      useClass: MemoryDocumentRepository,
    },
  ],
  exports: [DOCUMENT_REPOSITORY],
})
export class DocumentsModule {}
