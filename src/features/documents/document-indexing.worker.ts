import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { AiService } from "../../ai/ai.service.js";
import {
  DocumentStorageError,
  DocumentStorageService,
} from "../../storage/document-storage.service.js";
import {
  createPdfDocumentIndex,
  DocumentIndexingError,
} from "./document-indexing.js";
import { DocumentRepository } from "./document.repository.js";
import type { DocumentRecord } from "./document.types.js";

const POLL_INTERVAL_MILLISECONDS = 2_000;
const LOCK_DURATION_MILLISECONDS = 10 * 60 * 1_000;
const MAX_INDEXING_ATTEMPTS = 3;
const RETRY_DELAYS_MILLISECONDS = [10_000, 60_000] as const;

interface IndexingFailure {
  readonly code: string;
  readonly isPermanent: boolean;
}

@Injectable()
export class DocumentIndexingWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DocumentIndexingWorker.name);
  private readonly workerId = randomUUID();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private isShuttingDown = false;

  constructor(
    @Inject(DocumentRepository)
    private readonly documentRepository: DocumentRepository,
    @Inject(DocumentStorageService)
    private readonly storageService: DocumentStorageService,
    @Inject(AiService)
    private readonly aiService: AiService,
  ) {}

  onApplicationBootstrap(): void {
    this.scheduleNextPoll(0);
  }

  onApplicationShutdown(): void {
    this.isShuttingDown = true;

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextPoll(delayMilliseconds: number): void {
    if (this.isShuttingDown) {
      return;
    }

    this.timer = setTimeout(() => void this.poll(), delayMilliseconds);
    this.timer.unref();
  }

  private async poll(): Promise<void> {
    if (this.isRunning || this.isShuttingDown) {
      return;
    }

    this.isRunning = true;
    let shouldPollImmediately = false;

    try {
      const document = await this.documentRepository.claimNextForIndexing(
        this.workerId,
        LOCK_DURATION_MILLISECONDS,
      );

      if (document) {
        shouldPollImmediately = true;
        await this.indexDocument(document);
      }
    } catch (error: unknown) {
      this.logger.error(
        "Document indexing worker poll failed.",
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isRunning = false;
      this.scheduleNextPoll(
        shouldPollImmediately ? 0 : POLL_INTERVAL_MILLISECONDS,
      );
    }
  }

  private async indexDocument(document: DocumentRecord): Promise<void> {
    const startedAt = Date.now();

    try {
      const pdfContent = await this.storageService.downloadPdf(
        document.storageBucket,
        document.storageObjectPath,
      );
      const chunks = await createPdfDocumentIndex(pdfContent, this.aiService);

      await this.documentRepository.completeIndexing(
        document.id,
        chunks,
        this.aiService.embeddingModel,
      );

      this.logger.log("Document indexing completed.", {
        documentId: document.id,
        attempt: document.indexingAttempts,
        chunkCount: chunks.length,
        durationMilliseconds: Date.now() - startedAt,
      });
    } catch (error: unknown) {
      await this.handleIndexingFailure(document, error, startedAt);
    }
  }

  private async handleIndexingFailure(
    document: DocumentRecord,
    error: unknown,
    startedAt: number,
  ): Promise<void> {
    const failure = this.readFailure(error);
    const hasNoAttemptsRemaining =
      document.indexingAttempts >= MAX_INDEXING_ATTEMPTS;
    const isFinalFailure = failure.isPermanent || hasNoAttemptsRemaining;
    const retryDelay =
      RETRY_DELAYS_MILLISECONDS[document.indexingAttempts - 1] ??
      RETRY_DELAYS_MILLISECONDS.at(-1) ??
      60_000;

    await this.documentRepository.recordIndexingFailure(
      document.id,
      isFinalFailure ? "failed" : "processing",
      failure.code,
      new Date(Date.now() + (isFinalFailure ? 0 : retryDelay)),
    );

    const logContext = {
      documentId: document.id,
      attempt: document.indexingAttempts,
      code: failure.code,
      willRetry: !isFinalFailure,
      durationMilliseconds: Date.now() - startedAt,
    };

    if (isFinalFailure) {
      this.logger.error("Document indexing failed permanently.", logContext);
    } else {
      this.logger.warn("Document indexing will be retried.", logContext);
    }
  }

  private readFailure(error: unknown): IndexingFailure {
    if (error instanceof DocumentIndexingError) {
      return {
        code: error.code,
        isPermanent: error.code !== "DOCUMENT_EMBEDDING_FAILED",
      };
    }

    if (error instanceof DocumentStorageError) {
      return {
        code: "DOCUMENT_STORAGE_READ_FAILED",
        isPermanent: false,
      };
    }

    this.logger.error(
      "Unexpected document indexing error.",
      error instanceof Error ? error.stack : undefined,
    );

    return { code: "DOCUMENT_INDEXING_FAILED", isPermanent: false };
  }
}
