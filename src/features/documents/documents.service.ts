import { Inject, Injectable } from "@nestjs/common";
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepository,
} from "./document.repository.js";
import type { DocumentMetadata, StoredDocument } from "./document.types.js";
import { createPdfDocumentIndex } from "./document-indexing.js";

interface CreateDocumentInput {
  file: Express.Multer.File;
  name: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documentRepository: DocumentRepository,
  ) {}

  async create(input: CreateDocumentInput): Promise<DocumentMetadata> {
    const chunks = await createPdfDocumentIndex(input.file.buffer);

    return this.documentRepository.create({
      name: input.name,
      originalFileName: input.file.originalname,
      size: input.file.size,
      content: input.file.buffer,
      chunks,
    });
  }

  async findById(id: string): Promise<StoredDocument | undefined> {
    return this.documentRepository.findById(id);
  }

  async list(): Promise<readonly DocumentMetadata[]> {
    return this.documentRepository.list();
  }
}
