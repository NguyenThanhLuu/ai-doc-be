import { Module } from "@nestjs/common";
import { DocumentIndexingWorker } from "./document-indexing.worker.js";
import { DocumentRepository } from "./document.repository.js";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentIndexingWorker, DocumentRepository],
  exports: [DocumentRepository],
})
export class DocumentsModule {}
