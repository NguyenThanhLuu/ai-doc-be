import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { ApiHttpException } from "../../http/api-http.exception.js";
import {
  DocumentStorageError,
  DocumentStorageService,
  type SignedDocumentUrl,
} from "../../storage/document-storage.service.js";
import {
  DocumentRepository,
  DuplicateDocumentUploadError,
} from "./document.repository.js";
import type {
  DocumentMetadata,
  DocumentRecord,
  PaginatedDocuments,
} from "./document.types.js";

interface CreateDocumentInput {
  readonly file: Express.Multer.File;
  readonly name: string;
  readonly uploadRequestId: string;
  readonly userId: string;
}

interface UpdateDocumentInput {
  readonly file: Express.Multer.File | undefined;
  readonly name: string;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(DocumentRepository)
    private readonly documentRepository: DocumentRepository,
    @Inject(DocumentStorageService)
    private readonly storageService: DocumentStorageService,
  ) {}

  async create(input: CreateDocumentInput): Promise<DocumentMetadata> {
    const existingDocument =
      await this.documentRepository.findByUploadRequestId(
        input.userId,
        input.uploadRequestId,
      );

    if (existingDocument) {
      return existingDocument;
    }

    const documentId = randomUUID();
    const storageBucket = this.storageService.documentsBucket;
    const storageObjectPath = `${input.userId}/${documentId}.pdf`;

    try {
      await this.storageService.uploadPdf(
        storageObjectPath,
        input.file.buffer,
      );
    } catch (error: unknown) {
      this.throwStorageError(error, "DOCUMENT_STORAGE_UPLOAD_FAILED");
    }

    try {
      return await this.documentRepository.createProcessing({
        id: documentId,
        userId: input.userId,
        uploadRequestId: input.uploadRequestId,
        name: input.name,
        originalFileName: input.file.originalname,
        size: input.file.size,
        storageBucket,
        storageObjectPath,
      });
    } catch (error: unknown) {
      await this.removeStoredPdf(
        storageBucket,
        storageObjectPath,
        "Failed to remove an orphaned uploaded PDF.",
      );

      if (error instanceof DuplicateDocumentUploadError) {
        const duplicateDocument =
          await this.documentRepository.findByUploadRequestId(
            input.userId,
            input.uploadRequestId,
          );

        if (duplicateDocument) {
          return duplicateDocument;
        }
      }

      throw error;
    }
  }

  findById(documentId: string, userId: string): Promise<DocumentRecord | null> {
    return this.documentRepository.findByIdForUser(documentId, userId);
  }

  list(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedDocuments> {
    return this.documentRepository.listPageByUserId(userId, page, pageSize);
  }

  async update(
    document: DocumentRecord,
    input: UpdateDocumentInput,
  ): Promise<DocumentMetadata> {
    if (!input.file) {
      const updatedDocument = await this.documentRepository.updateName(
        document.id,
        document.userId,
        input.name,
      );

      if (!updatedDocument) {
        this.throwDocumentNotFound();
      }

      return updatedDocument;
    }

    const storageBucket = this.storageService.documentsBucket;
    const storageObjectPath = `${document.userId}/${document.id}/${randomUUID()}.pdf`;

    try {
      await this.storageService.uploadPdf(
        storageObjectPath,
        input.file.buffer,
      );
    } catch (error: unknown) {
      this.throwStorageError(error, "DOCUMENT_STORAGE_UPLOAD_FAILED");
    }

    let updatedDocument: DocumentMetadata | null;

    try {
      updatedDocument = await this.documentRepository.replaceFile({
        documentId: document.id,
        userId: document.userId,
        expectedStorageObjectPath: document.storageObjectPath,
        name: input.name,
        originalFileName: input.file.originalname,
        size: input.file.size,
        storageBucket,
        storageObjectPath,
      });
    } catch (error: unknown) {
      await this.removeStoredPdf(
        storageBucket,
        storageObjectPath,
        "Failed to remove an orphaned replacement PDF.",
      );
      throw error;
    }

    if (!updatedDocument) {
      await this.removeStoredPdf(
        storageBucket,
        storageObjectPath,
        "Failed to remove an orphaned replacement PDF.",
      );
      this.throwDocumentNotFound();
    }

    await this.removeStoredPdf(
      document.storageBucket,
      document.storageObjectPath,
      "Failed to remove the replaced PDF.",
    );
    return updatedDocument;
  }

  async delete(document: DocumentRecord): Promise<void> {
    const deletedDocument = await this.documentRepository.deleteByIdForUser(
      document.id,
      document.userId,
    );

    if (!deletedDocument) {
      this.throwDocumentNotFound();
    }

    await this.removeStoredPdf(
      deletedDocument.storageBucket,
      deletedDocument.storageObjectPath,
      "Failed to remove the deleted document PDF.",
    );
  }

  async createSignedContentUrl(
    document: DocumentRecord,
  ): Promise<SignedDocumentUrl> {
    try {
      return await this.storageService.createSignedPdfUrl(
        document.storageBucket,
        document.storageObjectPath,
      );
    } catch (error: unknown) {
      this.throwStorageError(error, "DOCUMENT_CONTENT_URL_FAILED");
    }
  }

  async retryIndexing(document: DocumentRecord): Promise<DocumentMetadata> {
    if (document.indexingStatus !== "failed") {
      throw new ApiHttpException(
        HttpStatus.CONFLICT,
        "DOCUMENT_INDEXING_NOT_FAILED",
        "Only a failed document can be indexed again.",
      );
    }

    const retriedDocument = await this.documentRepository.retryIndexing(
      document.id,
      document.userId,
    );

    if (!retriedDocument) {
      throw new ApiHttpException(
        HttpStatus.CONFLICT,
        "DOCUMENT_INDEXING_RETRY_CONFLICT",
        "The document indexing status changed. Refresh the list and try again.",
      );
    }

    return retriedDocument;
  }

  private async removeStoredPdf(
    bucket: string,
    objectPath: string,
    failureMessage: string,
  ): Promise<void> {
    try {
      await this.storageService.removePdf(bucket, objectPath);
    } catch (error: unknown) {
      this.logger.error(failureMessage, {
        bucket,
        objectPath,
        storageCode:
          error instanceof DocumentStorageError ? error.storageCode : undefined,
      });
    }
  }

  private throwDocumentNotFound(): never {
    throw new ApiHttpException(
      HttpStatus.NOT_FOUND,
      "DOCUMENT_NOT_FOUND",
      "The requested document could not be found.",
    );
  }

  private throwStorageError(error: unknown, code: string): never {
    if (error instanceof DocumentStorageError) {
      this.logger.error("A document Storage operation failed.", {
        operation: error.operation,
        storageCode: error.storageCode,
      });

      throw new ApiHttpException(
        HttpStatus.BAD_GATEWAY,
        code,
        "The PDF storage service is temporarily unavailable. Please try again.",
      );
    }

    throw error;
  }
}
