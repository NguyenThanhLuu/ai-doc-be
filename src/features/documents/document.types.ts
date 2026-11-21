export interface DocumentMetadata {
  id: string;
  name: string;
  originalFileName: string;
  mimeType: "application/pdf";
  size: number;
  createdAt: string;
}

export interface DocumentChunk {
  pageNumber: number;
  text: string;
  embedding: number[];
}

export interface DocumentEvidence {
  pageNumber: number;
  text: string;
}

export interface StoredDocument extends DocumentMetadata {
  content: Buffer;
  chunks: DocumentChunk[];
}

export interface CreateStoredDocumentInput {
  name: string;
  originalFileName: string;
  size: number;
  content: Buffer;
  chunks: DocumentChunk[];
}
