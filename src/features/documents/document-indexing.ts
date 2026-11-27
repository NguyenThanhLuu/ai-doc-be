import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { AiService } from "../../ai/ai.service.js";
import type { DocumentChunk } from "./document.types.js";

const CHUNK_LENGTH_CHARACTERS = 1_200;
const CHUNK_OVERLAP_CHARACTERS = 200;
const EMBEDDING_BATCH_SIZE = 50;
const EMBEDDING_DIMENSIONS = 768;
const EMBEDDING_REQUEST_TIMEOUT_MILLISECONDS = 60_000;
const MAX_DOCUMENT_CHUNKS = 500;
const MIN_EXTRACTED_TEXT_CHARACTERS = 50;

interface PdfTextChunk {
  pageNumber: number;
  text: string;
}

type DocumentIndexingErrorCode =
  | "DOCUMENT_EMBEDDING_FAILED"
  | "PDF_INDEX_TOO_LARGE"
  | "PDF_TEXT_EXTRACTION_FAILED"
  | "PDF_TEXT_UNAVAILABLE";

export class DocumentIndexingError extends Error {
  readonly code: DocumentIndexingErrorCode;
  readonly statusCode: number;

  constructor(
    code: DocumentIndexingErrorCode,
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.name = "DocumentIndexingError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizePageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function splitPageIntoChunks(
  pageNumber: number,
  pageText: string,
): PdfTextChunk[] {
  const chunks: PdfTextChunk[] = [];
  let chunkStart = 0;

  while (chunkStart < pageText.length) {
    const chunkEnd = Math.min(
      chunkStart + CHUNK_LENGTH_CHARACTERS,
      pageText.length,
    );
    const text = pageText.slice(chunkStart, chunkEnd).trim();

    if (text !== "") {
      chunks.push({ pageNumber, text });
    }

    if (chunkEnd === pageText.length) {
      break;
    }

    chunkStart = chunkEnd - CHUNK_OVERLAP_CHARACTERS;
  }

  return chunks;
}

async function extractPdfTextChunks(
  pdfContent: Buffer,
): Promise<PdfTextChunk[]> {
  const loadingTask = getDocument({ data: new Uint8Array(pdfContent) });

  try {
    const pdfDocument = await loadingTask.promise;
    const chunks: PdfTextChunk[] = [];
    let extractedTextCharacters = 0;

    for (
      let pageNumber = 1;
      pageNumber <= pdfDocument.numPages;
      pageNumber += 1
    ) {
      const pdfPage = await pdfDocument.getPage(pageNumber);

      try {
        const textContent = await pdfPage.getTextContent();
        const pageText = normalizePageText(
          textContent.items
            .map((textItem) => ("str" in textItem ? textItem.str : ""))
            .join(" "),
        );

        extractedTextCharacters += pageText.length;
        chunks.push(...splitPageIntoChunks(pageNumber, pageText));

        if (chunks.length > MAX_DOCUMENT_CHUNKS) {
          throw new DocumentIndexingError(
            "PDF_INDEX_TOO_LARGE",
            "The PDF contains too much text to process. Try a smaller document.",
            422,
          );
        }
      } finally {
        pdfPage.cleanup();
      }
    }

    if (
      extractedTextCharacters < MIN_EXTRACTED_TEXT_CHARACTERS ||
      chunks.length === 0
    ) {
      throw new DocumentIndexingError(
        "PDF_TEXT_UNAVAILABLE",
        "This PDF does not contain enough readable text. Scanned PDFs are not supported yet.",
        422,
      );
    }

    return chunks;
  } catch (error: unknown) {
    if (error instanceof DocumentIndexingError) {
      throw error;
    }

    throw new DocumentIndexingError(
      "PDF_TEXT_EXTRACTION_FAILED",
      "The PDF text could not be read. Try a different text-based PDF.",
      422,
    );
  } finally {
    await loadingTask.destroy();
  }
}

function normalizeEmbedding(values: readonly number[]): number[] {
  const magnitude = Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0),
  );

  if (magnitude === 0) {
    throw new DocumentIndexingError(
      "DOCUMENT_EMBEDDING_FAILED",
      "The document could not be indexed for AI chat. Try uploading it again.",
      502,
    );
  }

  return values.map((value) => value / magnitude);
}

async function embedPdfTextChunks(
  textChunks: readonly PdfTextChunk[],
  aiService: AiService,
): Promise<DocumentChunk[]> {
  const documentChunks: DocumentChunk[] = [];

  try {
    for (
      let batchStart = 0;
      batchStart < textChunks.length;
      batchStart += EMBEDDING_BATCH_SIZE
    ) {
      const chunkBatch = textChunks.slice(
        batchStart,
        batchStart + EMBEDDING_BATCH_SIZE,
      );
      const embeddings = await aiService.createDocumentEmbeddings(
        chunkBatch.map((chunk) => chunk.text),
        AbortSignal.timeout(EMBEDDING_REQUEST_TIMEOUT_MILLISECONDS),
      );

      if (embeddings.length !== chunkBatch.length) {
        throw new DocumentIndexingError(
          "DOCUMENT_EMBEDDING_FAILED",
          "The document could not be indexed for AI chat. Try uploading it again.",
          502,
        );
      }
      for (
        let batchIndex = 0;
        batchIndex < chunkBatch.length;
        batchIndex += 1
      ) {
        const textChunk = chunkBatch[batchIndex];
        const embeddingValues = embeddings[batchIndex];

        if (
          !textChunk ||
          !embeddingValues ||
          embeddingValues.length !== EMBEDDING_DIMENSIONS
        ) {
          throw new DocumentIndexingError(
            "DOCUMENT_EMBEDDING_FAILED",
            "The document could not be indexed for AI chat. Try uploading it again.",
            502,
          );
        }

        documentChunks.push({
          pageNumber: textChunk.pageNumber,
          text: textChunk.text,
          embedding: normalizeEmbedding(embeddingValues),
        });
      }
    }
  } catch (error: unknown) {
    if (error instanceof DocumentIndexingError) {
      throw error;
    }

    throw new DocumentIndexingError(
      "DOCUMENT_EMBEDDING_FAILED",
      "The document could not be indexed for AI chat. Try uploading it again.",
      502,
    );
  }

  return documentChunks;
}

export async function createPdfDocumentIndex(
  pdfContent: Buffer,
  aiService: AiService,
): Promise<DocumentChunk[]> {
  const textChunks = await extractPdfTextChunks(pdfContent);
  return embedPdfTextChunks(textChunks, aiService);
}

interface CreateQuestionEmbeddingInput {
  aiService: AiService;
  question: string;
  signal: AbortSignal;
}

export async function createQuestionEmbedding({
  aiService,
  question,
  signal,
}: CreateQuestionEmbeddingInput): Promise<number[]> {
  const embeddingValues = await aiService.createQuestionEmbedding(
    question,
    signal,
  );

  if (embeddingValues.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("The AI provider returned an invalid question embedding.");
  }

  return normalizeEmbedding(embeddingValues);
}
