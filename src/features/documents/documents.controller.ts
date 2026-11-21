import {
  Body,
  Controller,
  Get,
  Header,
  HttpStatus,
  Inject,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import multer from "multer";
import { ApiHttpException } from "../../http/api-http.exception.js";
import {
  documentIdSchema,
  documentUploadSchema,
  MAX_PDF_SIZE_BYTES,
} from "./document.schema.js";
import type { DocumentMetadata, StoredDocument } from "./document.types.js";
import { DocumentsService } from "./documents.service.js";

interface CreateDocumentResponse {
  document: DocumentMetadata;
  message: string;
}

interface DocumentMetadataResponse {
  document: DocumentMetadata;
}

interface DocumentListResponse {
  documents: readonly DocumentMetadata[];
}

function readBodyField(body: unknown, fieldName: string): unknown {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  return Reflect.get(body, fieldName);
}

@Controller("api/documents")
export class DocumentsController {
  constructor(
    @Inject(DocumentsService)
    private readonly documentsService: DocumentsService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      storage: multer.memoryStorage(),
      limits: {
        files: 1,
        fileSize: MAX_PDF_SIZE_BYTES,
      },
    }),
  )
  async create(
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<CreateDocumentResponse> {
    const validationResult = documentUploadSchema.safeParse({
      name: readBodyField(body, "name"),
      file,
    });

    if (!validationResult.success) {
      throw new ApiHttpException(
        HttpStatus.BAD_REQUEST,
        "DOCUMENT_VALIDATION_FAILED",
        validationResult.error.issues[0]?.message ??
          "Check the document details and try again.",
      );
    }

    const document = await this.documentsService.create(validationResult.data);

    return {
      message: "Document added and indexed successfully.",
      document,
    };
  }

  @Get()
  async list(): Promise<DocumentListResponse> {
    return { documents: await this.documentsService.list() };
  }

  @Get(":documentId/content")
  @Header("Cache-Control", "no-store")
  async getContent(
    @Param("documentId") documentId: string,
  ): Promise<StreamableFile> {
    const document = await this.findValidatedDocument(documentId);

    return new StreamableFile(document.content, {
      type: document.mimeType,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(document.originalFileName)}`,
      length: document.size,
    });
  }

  @Get(":documentId")
  async getOne(
    @Param("documentId") documentId: string,
  ): Promise<DocumentMetadataResponse> {
    const document = await this.findValidatedDocument(documentId);

    return {
      document: {
        id: document.id,
        name: document.name,
        originalFileName: document.originalFileName,
        mimeType: document.mimeType,
        size: document.size,
        createdAt: document.createdAt,
      },
    };
  }

  private async findValidatedDocument(
    documentId: string,
  ): Promise<StoredDocument> {
    const idResult = documentIdSchema.safeParse(documentId);

    if (!idResult.success) {
      throw new ApiHttpException(
        HttpStatus.BAD_REQUEST,
        "INVALID_DOCUMENT_ID",
        idResult.error.issues[0]?.message ?? "Document ID is invalid.",
      );
    }

    const document = await this.documentsService.findById(idResult.data);

    if (!document) {
      throw new ApiHttpException(
        HttpStatus.NOT_FOUND,
        "DOCUMENT_NOT_FOUND",
        "The requested document could not be found.",
      );
    }

    return document;
  }
}
