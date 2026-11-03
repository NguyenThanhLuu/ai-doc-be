export interface DocumentMetadata {
  readonly id: string;
  readonly name: string;
  readonly originalFileName: string;
  readonly mimeType: "application/pdf";
  readonly size: number;
  readonly createdAt: string;
}

export interface DocumentChunk {
  readonly pageNumber: number;
  readonly text: string;
  readonly embedding: readonly number[];
}

export interface DocumentEvidence {
  readonly pageNumber: number;
  readonly text: string;
}

export interface StoredDocument extends DocumentMetadata {
  readonly content: Buffer;
  readonly chunks: readonly DocumentChunk[];
}

export interface CreateStoredDocumentInput {
  readonly name: string;
  readonly originalFileName: string;
  readonly size: number;
  readonly content: Buffer;
  readonly chunks: readonly DocumentChunk[];
}
