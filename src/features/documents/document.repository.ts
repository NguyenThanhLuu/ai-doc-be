import { Inject, Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import {
  getDocumentIndexingFailure,
  type CreateProcessingDocumentInput,
  type DocumentChunk,
  type DocumentEvidence,
  type DocumentIndexingStatus,
  type DocumentMetadata,
  type PaginatedDocuments,
  type ReplaceDocumentFileInput,
  type DocumentRecord,
} from "./document.types.js";

const CHUNK_INSERT_BATCH_SIZE = 50;

export class DuplicateDocumentUploadError extends Error {
  constructor() {
    super("This document upload request already exists.");
    this.name = "DuplicateDocumentUploadError";
  }
}

interface DocumentRow extends QueryResultRow {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly originalFileName: string;
  readonly mimeType: "application/pdf";
  readonly size: number;
  readonly storageBucket: string;
  readonly storageObjectPath: string;
  readonly indexingStatus: DocumentIndexingStatus;
  readonly indexingAttempts: number;
  readonly indexingErrorCode: string | null;
  readonly createdAt: Date;
}

interface EvidenceRow extends QueryResultRow {
  readonly pageNumber: number;
  readonly text: string;
}

interface DocumentCountRow extends QueryResultRow {
  readonly totalItems: string;
}

function toMetadata(row: DocumentRow): DocumentMetadata {
  return {
    id: row.id,
    name: row.name,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    size: row.size,
    indexingStatus: row.indexingStatus,
    indexingError: getDocumentIndexingFailure(row.indexingErrorCode),
    createdAt: row.createdAt.toISOString(),
  };
}

function toRecord(row: DocumentRow): DocumentRecord {
  return {
    ...toMetadata(row),
    userId: row.userId,
    storageBucket: row.storageBucket,
    storageObjectPath: row.storageObjectPath,
    indexingAttempts: row.indexingAttempts,
  };
}

function isUniqueConstraintError(
  error: unknown,
  constraintName: string,
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "code") === "23505" &&
    Reflect.get(error, "constraint") === constraintName
  );
}

function serializeVector(values: readonly number[]): string {
  if (
    values.length !== 768 ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("An invalid 768-dimensional embedding was provided.");
  }

  return `[${values.join(",")}]`;
}

const DOCUMENT_COLUMNS = `
  id,
  user_id AS "userId",
  name,
  original_file_name AS "originalFileName",
  mime_type AS "mimeType",
  size_bytes AS size,
  storage_bucket AS "storageBucket",
  storage_object_path AS "storageObjectPath",
  indexing_status AS "indexingStatus",
  indexing_attempts AS "indexingAttempts",
  indexing_error_code AS "indexingErrorCode",
  created_at AS "createdAt"
`;

@Injectable()
export class DocumentRepository {
  constructor(
    @Inject(DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  async createProcessing(
    input: CreateProcessingDocumentInput,
  ): Promise<DocumentMetadata> {
    try {
      const result = await this.databaseService.pool.query<DocumentRow>(
        `
          INSERT INTO documents (
            id,
            user_id,
            upload_request_id,
            name,
            original_file_name,
            size_bytes,
            storage_bucket,
            storage_object_path
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING ${DOCUMENT_COLUMNS}
        `,
        [
          input.id,
          input.userId,
          input.uploadRequestId,
          input.name,
          input.originalFileName,
          input.size,
          input.storageBucket,
          input.storageObjectPath,
        ],
      );

      const document = result.rows[0];

      if (!document) {
        throw new Error("PostgreSQL did not return the created document.");
      }

      return toMetadata(document);
    } catch (error: unknown) {
      if (
        isUniqueConstraintError(error, "documents_user_upload_request_unique")
      ) {
        throw new DuplicateDocumentUploadError();
      }

      throw error;
    }
  }

  async findByIdForUser(
    documentId: string,
    userId: string,
  ): Promise<DocumentRecord | null> {
    const result = await this.databaseService.pool.query<DocumentRow>(
      `
        SELECT ${DOCUMENT_COLUMNS}
        FROM documents
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `,
      [documentId, userId],
    );

    const document = result.rows[0];
    return document ? toRecord(document) : null;
  }

  async findByUploadRequestId(
    userId: string,
    uploadRequestId: string,
  ): Promise<DocumentMetadata | null> {
    const result = await this.databaseService.pool.query<DocumentRow>(
      `
        SELECT ${DOCUMENT_COLUMNS}
        FROM documents
        WHERE user_id = $1 AND upload_request_id = $2
        LIMIT 1
      `,
      [userId, uploadRequestId],
    );

    const document = result.rows[0];
    return document ? toMetadata(document) : null;
  }

  async listPageByUserId(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedDocuments> {
    const offset = (page - 1) * pageSize;
    const [documentsResult, countResult] = await Promise.all([
      this.databaseService.pool.query<DocumentRow>(
        `
          SELECT ${DOCUMENT_COLUMNS}
          FROM documents
          WHERE user_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2 OFFSET $3
        `,
        [userId, pageSize, offset],
      ),
      this.databaseService.pool.query<DocumentCountRow>(
        `
          SELECT COUNT(*)::text AS "totalItems"
          FROM documents
          WHERE user_id = $1
        `,
        [userId],
      ),
    ]);
    const totalItems = Number(countResult.rows[0]?.totalItems ?? 0);

    if (!Number.isSafeInteger(totalItems) || totalItems < 0) {
      throw new Error("PostgreSQL returned an invalid document count.");
    }

    return {
      documents: documentsResult.rows.map(toMetadata),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
      },
    };
  }

  async updateName(
    documentId: string,
    userId: string,
    name: string,
  ): Promise<DocumentMetadata | null> {
    const result = await this.databaseService.pool.query<DocumentRow>(
      `
        UPDATE documents
        SET name = $3, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING ${DOCUMENT_COLUMNS}
      `,
      [documentId, userId, name],
    );
    const document = result.rows[0];
    return document ? toMetadata(document) : null;
  }

  async replaceFile(
    input: ReplaceDocumentFileInput,
  ): Promise<DocumentMetadata | null> {
    const client = await this.databaseService.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await client.query<DocumentRow>(
        `
          UPDATE documents
          SET
            name = $3,
            original_file_name = $4,
            size_bytes = $5,
            storage_bucket = $6,
            storage_object_path = $7,
            indexing_status = 'processing',
            indexing_attempts = 0,
            next_index_at = NOW(),
            indexing_locked_by = NULL,
            indexing_locked_until = NULL,
            indexing_error_code = NULL,
            embedding_model = NULL,
            indexed_at = NULL,
            updated_at = NOW()
          WHERE id = $1
            AND user_id = $2
            AND storage_object_path = $8
          RETURNING ${DOCUMENT_COLUMNS}
        `,
        [
          input.documentId,
          input.userId,
          input.name,
          input.originalFileName,
          input.size,
          input.storageBucket,
          input.storageObjectPath,
          input.expectedStorageObjectPath,
        ],
      );
      const document = result.rows[0];

      if (!document) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query("DELETE FROM document_chunks WHERE document_id = $1", [
        input.documentId,
      ]);
      await client.query("COMMIT");
      return toMetadata(document);
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteByIdForUser(
    documentId: string,
    userId: string,
  ): Promise<DocumentRecord | null> {
    const result = await this.databaseService.pool.query<DocumentRow>(
      `
        DELETE FROM documents
        WHERE id = $1 AND user_id = $2
        RETURNING ${DOCUMENT_COLUMNS}
      `,
      [documentId, userId],
    );
    const document = result.rows[0];
    return document ? toRecord(document) : null;
  }

  async claimNextForIndexing(
    workerId: string,
    lockDurationMilliseconds: number,
  ): Promise<DocumentRecord | null> {
    const result = await this.databaseService.pool.query<DocumentRow>(
      `
        WITH next_document AS (
          SELECT id AS document_id
          FROM documents
          WHERE indexing_status = 'processing'
            AND next_index_at <= NOW()
            AND (
              indexing_locked_until IS NULL
              OR indexing_locked_until <= NOW()
            )
          ORDER BY next_index_at ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE documents AS document
        SET
          indexing_attempts = document.indexing_attempts + 1,
          indexing_locked_by = $1,
          indexing_locked_until = NOW() + ($2 * INTERVAL '1 millisecond'),
          updated_at = NOW()
        FROM next_document
        WHERE document.id = next_document.document_id
        RETURNING ${DOCUMENT_COLUMNS}
      `,
      [workerId, lockDurationMilliseconds],
    );

    const document = result.rows[0];
    return document ? toRecord(document) : null;
  }

  async completeIndexing(
    documentId: string,
    storageObjectPath: string,
    chunks: readonly DocumentChunk[],
    embeddingModel: string,
  ): Promise<void> {
    const client = await this.databaseService.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM document_chunks WHERE document_id = $1", [
        documentId,
      ]);

      for (
        let batchStart = 0;
        batchStart < chunks.length;
        batchStart += CHUNK_INSERT_BATCH_SIZE
      ) {
        await this.insertChunkBatch(
          client,
          documentId,
          chunks.slice(batchStart, batchStart + CHUNK_INSERT_BATCH_SIZE),
          batchStart,
        );
      }

      const updateResult = await client.query(
        `
          UPDATE documents
          SET
            indexing_status = 'ready',
            indexing_error_code = NULL,
            indexing_locked_by = NULL,
            indexing_locked_until = NULL,
            embedding_model = $3,
            indexed_at = NOW(),
            updated_at = NOW()
          WHERE id = $1 AND storage_object_path = $2
        `,
        [documentId, storageObjectPath, embeddingModel],
      );

      if (updateResult.rowCount !== 1) {
        throw new Error("The indexed document no longer exists.");
      }

      await client.query("COMMIT");
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordIndexingFailure(
    documentId: string,
    storageObjectPath: string,
    status: Extract<DocumentIndexingStatus, "failed" | "processing">,
    errorCode: string,
    nextIndexAt: Date,
  ): Promise<void> {
    await this.databaseService.pool.query(
      `
        UPDATE documents
        SET
          indexing_status = $3,
          indexing_error_code = $4,
          next_index_at = $5,
          indexing_locked_by = NULL,
          indexing_locked_until = NULL,
          updated_at = NOW()
        WHERE id = $1 AND storage_object_path = $2
      `,
      [documentId, storageObjectPath, status, errorCode, nextIndexAt],
    );
  }

  async retryIndexing(
    documentId: string,
    userId: string,
  ): Promise<DocumentMetadata | null> {
    const result = await this.databaseService.pool.query<DocumentRow>(
      `
        UPDATE documents
        SET
          indexing_status = 'processing',
          indexing_attempts = 0,
          next_index_at = NOW(),
          indexing_locked_by = NULL,
          indexing_locked_until = NULL,
          indexing_error_code = NULL,
          updated_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND indexing_status = 'failed'
        RETURNING ${DOCUMENT_COLUMNS}
      `,
      [documentId, userId],
    );

    const document = result.rows[0];
    return document ? toMetadata(document) : null;
  }

  async findRelevantEvidence(
    documentId: string,
    userId: string,
    questionEmbedding: readonly number[],
    limit: number,
  ): Promise<readonly DocumentEvidence[]> {
    const result = await this.databaseService.pool.query<EvidenceRow>(
      `
        SELECT
          chunk.page_number AS "pageNumber",
          chunk.text
        FROM document_chunks AS chunk
        INNER JOIN documents AS document ON document.id = chunk.document_id
        WHERE document.id = $1
          AND document.user_id = $2
          AND document.indexing_status = 'ready'
        ORDER BY chunk.embedding <=> $3::extensions.vector
        LIMIT $4
      `,
      [documentId, userId, serializeVector(questionEmbedding), limit],
    );

    return result.rows;
  }

  private async insertChunkBatch(
    client: PoolClient,
    documentId: string,
    chunks: readonly DocumentChunk[],
    firstChunkIndex: number,
  ): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const parameters: unknown[] = [];
    const rows = chunks.map((chunk, batchIndex) => {
      const parameterOffset = batchIndex * 5;
      parameters.push(
        documentId,
        firstChunkIndex + batchIndex,
        chunk.pageNumber,
        chunk.text,
        serializeVector(chunk.embedding),
      );

      return `(
        $${parameterOffset + 1},
        $${parameterOffset + 2},
        $${parameterOffset + 3},
        $${parameterOffset + 4},
        $${parameterOffset + 5}::extensions.vector
      )`;
    });

    await client.query(
      `
        INSERT INTO document_chunks (
          document_id,
          chunk_index,
          page_number,
          text,
          embedding
        )
        VALUES ${rows.join(",")}
      `,
      parameters,
    );
  }
}
