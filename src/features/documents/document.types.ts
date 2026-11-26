export type DocumentIndexingStatus = "failed" | "processing" | "ready";

export interface DocumentIndexingFailure {
  readonly code: string;
  readonly message: string;
}

export interface DocumentMetadata {
  readonly id: string;
  readonly name: string;
  readonly originalFileName: string;
  readonly mimeType: "application/pdf";
  readonly size: number;
  readonly indexingStatus: DocumentIndexingStatus;
  readonly indexingError: DocumentIndexingFailure | null;
  readonly createdAt: string;
}

export interface DocumentChunk {
  readonly pageNumber: number;
  readonly text: string;
  readonly embedding: number[];
}

export interface DocumentEvidence {
  readonly pageNumber: number;
  readonly text: string;
}

export interface DocumentRecord extends DocumentMetadata {
  readonly userId: string;
  readonly storageBucket: string;
  readonly storageObjectPath: string;
  readonly indexingAttempts: number;
}

export interface CreateProcessingDocumentInput {
  readonly id: string;
  readonly userId: string;
  readonly uploadRequestId: string;
  readonly name: string;
  readonly originalFileName: string;
  readonly size: number;
  readonly storageBucket: string;
  readonly storageObjectPath: string;
}

export function getDocumentIndexingFailure(
  code: string | null,
): DocumentIndexingFailure | null {
  if (code === null) {
    return null;
  }

  const messages: Readonly<Record<string, string>> = {
    DOCUMENT_EMBEDDING_FAILED:
      "AI indexing could not be completed. Try indexing the document again.",
    DOCUMENT_INDEXING_FAILED:
      "The document could not be indexed. Try indexing it again.",
    DOCUMENT_STORAGE_READ_FAILED:
      "The stored PDF could not be read. Try indexing it again.",
    PDF_INDEX_TOO_LARGE:
      "The PDF contains too much text. Upload a smaller document.",
    PDF_TEXT_EXTRACTION_FAILED:
      "The PDF text could not be read. Upload a different text-based PDF.",
    PDF_TEXT_UNAVAILABLE:
      "The PDF does not contain enough readable text. Scanned PDFs are not supported yet.",
  };

  return {
    code,
    message:
      messages[code] ??
      "The document could not be indexed. Try indexing it again.",
  };
}
