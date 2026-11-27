import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import multer from "multer";
import { ApiHttpException } from "../../http/api-http.exception.js";
import { CurrentUser } from "../authentication/current-user.decorator.js";
import type { AuthenticatedPrincipal } from "../authentication/authentication.types.js";
import {
  documentIdSchema,
  documentListQuerySchema,
  documentUpdateSchema,
  documentUploadSchema,
  MAX_PDF_SIZE_BYTES,
} from "./document.schema.js";
import type {
  DocumentMetadata,
  DocumentRecord,
  PaginatedDocuments,
} from "./document.types.js";
import { DocumentsService } from "./documents.service.js";

interface CreateDocumentResponse {
  readonly document: DocumentMetadata;
  readonly message: string;
}

interface DocumentMetadataResponse {
  readonly document: DocumentMetadata;
}

interface DocumentContentUrlResponse {
  readonly expiresAt: string;
  readonly url: string;
}

interface DeleteDocumentResponse {
  readonly documentId: string;
  readonly message: string;
}

function readBodyField(body: unknown, fieldName: string): unknown {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  return Reflect.get(body, fieldName);
}

function toMetadata(document: DocumentRecord): DocumentMetadata {
  return {
    id: document.id,
    name: document.name,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType,
    size: document.size,
    indexingStatus: document.indexingStatus,
    indexingError: document.indexingError,
    createdAt: document.createdAt,
  };
}

@Controller("api/documents")
export class DocumentsController {
  constructor(
    @Inject(DocumentsService)
    private readonly documentsService: DocumentsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
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
    @CurrentUser() currentUser: AuthenticatedPrincipal,
  ): Promise<CreateDocumentResponse> {
    const validationResult = documentUploadSchema.safeParse({
      uploadRequestId: readBodyField(body, "uploadRequestId"),
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

    const document = await this.documentsService.create({
      ...validationResult.data,
      userId: currentUser.id,
    });

    return {
      message:
        "PDF uploaded successfully. AI indexing is running in the background.",
      document,
    };
  }

  @Get()
  @Header("Cache-Control", "no-store")
  async list(
    @Query() query: unknown,
    @CurrentUser() currentUser: AuthenticatedPrincipal,
  ): Promise<PaginatedDocuments> {
    const validationResult = documentListQuerySchema.safeParse({
      page: readBodyField(query, "page"),
      pageSize: readBodyField(query, "pageSize"),
    });

    if (!validationResult.success) {
      throw new ApiHttpException(
        HttpStatus.BAD_REQUEST,
        "DOCUMENT_PAGINATION_INVALID",
        validationResult.error.issues[0]?.message ??
          "Check the pagination values and try again.",
      );
    }

    return this.documentsService.list(
      currentUser.id,
      validationResult.data.page,
      validationResult.data.pageSize,
    );
  }

  @Patch(":documentId")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: multer.memoryStorage(),
      limits: {
        files: 1,
        fileSize: MAX_PDF_SIZE_BYTES,
      },
    }),
  )
  async update(
    @Param("documentId") documentId: string,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() currentUser: AuthenticatedPrincipal,
  ): Promise<CreateDocumentResponse> {
    const document = await this.findValidatedDocument(
      documentId,
      currentUser.id,
    );
    const validationResult = documentUpdateSchema.safeParse({
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

    const updatedDocument = await this.documentsService.update(
      document,
      {
        name: validationResult.data.name,
        file: validationResult.data.file,
      },
    );

    return {
      message: file
        ? "Document updated successfully. AI indexing is running for the replacement PDF."
        : "Document name updated successfully.",
      document: updatedDocument,
    };
  }

  @Delete(":documentId")
  async delete(
    @Param("documentId") documentId: string,
    @CurrentUser() currentUser: AuthenticatedPrincipal,
  ): Promise<DeleteDocumentResponse> {
    const document = await this.findValidatedDocument(
      documentId,
      currentUser.id,
    );
    await this.documentsService.delete(document);

    return {
      documentId: document.id,
      message: "Document deleted successfully.",
    };
  }

  @Get(":documentId/content-url")
  @Header("Cache-Control", "no-store")
  async getContentUrl(
    @Param("documentId") documentId: string,
    @CurrentUser() currentUser: AuthenticatedPrincipal,
  ): Promise<DocumentContentUrlResponse> {
    const document = await this.findValidatedDocument(
      documentId,
      currentUser.id,
    );
    return this.documentsService.createSignedContentUrl(document);
  }

  @Get(":documentId/content")
  @Header("Cache-Control", "no-store")
  async redirectToContent(
    @Param("documentId") documentId: string,
    @CurrentUser() currentUser: AuthenticatedPrincipal,
    @Res() response: Response,
  ): Promise<void> {
    const document = await this.findValidatedDocument(
      documentId,
      currentUser.id,
    );
    const contentUrl =
      await this.documentsService.createSignedContentUrl(document);

    response.redirect(HttpStatus.TEMPORARY_REDIRECT, contentUrl.url);
  }

  @Post(":documentId/indexing/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  async retryIndexing(
    @Param("documentId") documentId: string,
    @CurrentUser() currentUser: AuthenticatedPrincipal,
  ): Promise<CreateDocumentResponse> {
    const document = await this.findValidatedDocument(
      documentId,
      currentUser.id,
    );
    const retriedDocument = await this.documentsService.retryIndexing(document);

    return {
      message: "Document indexing was queued again.",
      document: retriedDocument,
    };
  }

  @Get(":documentId")
  @Header("Cache-Control", "no-store")
  async getOne(
    @Param("documentId") documentId: string,
    @CurrentUser() currentUser: AuthenticatedPrincipal,
  ): Promise<DocumentMetadataResponse> {
    const document = await this.findValidatedDocument(
      documentId,
      currentUser.id,
    );

    return { document: toMetadata(document) };
  }

  private async findValidatedDocument(
    documentId: string,
    userId: string,
  ): Promise<DocumentRecord> {
    const idResult = documentIdSchema.safeParse(documentId);

    if (!idResult.success) {
      throw new ApiHttpException(
        HttpStatus.BAD_REQUEST,
        "INVALID_DOCUMENT_ID",
        idResult.error.issues[0]?.message ?? "Document ID is invalid.",
      );
    }

    const document = await this.documentsService.findById(
      idResult.data,
      userId,
    );

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
