import type {
  CreateStoredDocumentInput,
  DocumentMetadata,
  StoredDocument,
} from "./document.types.js";

export const DOCUMENT_REPOSITORY = Symbol("DOCUMENT_REPOSITORY");

export interface DocumentRepository {
  create(input: CreateStoredDocumentInput): Promise<DocumentMetadata>;
  findById(id: string): Promise<StoredDocument | undefined>;
  list(): Promise<readonly DocumentMetadata[]>;
}
