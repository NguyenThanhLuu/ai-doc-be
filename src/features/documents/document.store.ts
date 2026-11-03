import { randomUUID } from "node:crypto";
import type {
  CreateStoredDocumentInput,
  DocumentMetadata,
  StoredDocument,
} from "./document.types.js";

const documents = new Map<string, StoredDocument>();

function toMetadata(document: StoredDocument): DocumentMetadata {
  return {
    id: document.id,
    name: document.name,
    originalFileName: document.originalFileName,
    mimeType: document.mimeType,
    size: document.size,
    createdAt: document.createdAt,
  };
}

export function createDocument(
  input: CreateStoredDocumentInput,
): DocumentMetadata {
  const document: StoredDocument = {
    id: randomUUID(),
    name: input.name,
    originalFileName: input.originalFileName,
    mimeType: "application/pdf",
    size: input.size,
    createdAt: new Date().toISOString(),
    content: input.content,
    chunks: input.chunks,
  };

  documents.set(document.id, document);

  return toMetadata(document);
}

export function listDocuments(): readonly DocumentMetadata[] {
  return Array.from(documents.values(), toMetadata).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function findDocument(id: string): StoredDocument | undefined {
  return documents.get(id);
}
