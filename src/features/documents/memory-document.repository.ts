import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { DocumentRepository } from "./document.repository.js";
import type {
  CreateStoredDocumentInput,
  DocumentMetadata,
  StoredDocument,
} from "./document.types.js";

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

@Injectable()
export class MemoryDocumentRepository implements DocumentRepository {
  private readonly documents = new Map<string, StoredDocument>();

  async create(input: CreateStoredDocumentInput): Promise<DocumentMetadata> {
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

    this.documents.set(document.id, document);
    return toMetadata(document);
  }

  async findById(id: string): Promise<StoredDocument | undefined> {
    return this.documents.get(id);
  }

  async list(): Promise<readonly DocumentMetadata[]> {
    return Array.from(this.documents.values(), toMetadata).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }
}
