import { GoogleGenAI } from "@google/genai";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  GEMINI_API_KEY,
  GEMINI_EMBEDDING_MODEL,
} from "../../config/environment.js";
import type { DocumentChunk, DocumentEvidence } from "./document.types.js";

const CHUNK_LENGTH_CHARACTERS = 1_200;
const CHUNK_OVERLAP_CHARACTERS = 200;
const EMBEDDING_BATCH_SIZE = 50;
const EMBEDDING_DIMENSIONS = 768;
const MAX_DOCUMENT_CHUNKS = 500;
const MIN_EXTRACTED_TEXT_CHARACTERS = 50;
const MAX_RETRIEVED_CHUNKS = 4;

const geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

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
            "The PDF contains too much text for this demo. Try a smaller document.",
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

function calculateCosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number | null {
  if (left.length !== right.length) {
    return null;
  }

  let similarity = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];

    if (leftValue === undefined || rightValue === undefined) {
      return null;
    }

    similarity += leftValue * rightValue;
  }

  return similarity;
}

async function embedPdfTextChunks(
  textChunks: readonly PdfTextChunk[],
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
      const response = await geminiClient.models.embedContent({
        model: GEMINI_EMBEDDING_MODEL,
        contents: chunkBatch.map((chunk) => chunk.text),
        config: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
          taskType: "RETRIEVAL_DOCUMENT",
        },
      });
      const embeddings = response.embeddings ?? [];

      if (embeddings.length !== chunkBatch.length) {
        throw new DocumentIndexingError(
          "DOCUMENT_EMBEDDING_FAILED",
          "The document could not be indexed for AI chat. Try uploading it again.",
          502,
        );
      }
      // embeddings = [{value: [0.234, -0.345]}, {value: [0.345, 0.345]}]

      for (
        let batchIndex = 0;
        batchIndex < chunkBatch.length;
        batchIndex += 1
      ) {
        const textChunk = chunkBatch[batchIndex];
        const embeddingValues = embeddings[batchIndex]?.values;

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
): Promise<DocumentChunk[]> {
  const textChunks = await extractPdfTextChunks(pdfContent);
  return embedPdfTextChunks(textChunks);
}

interface RetrieveDocumentEvidenceInput {
  chunks: DocumentChunk[];
  question: string;
  signal: AbortSignal;
}

export async function retrieveDocumentEvidence({
  chunks,
  question,
  signal,
}: RetrieveDocumentEvidenceInput): Promise<readonly DocumentEvidence[]> {
  if (chunks.length === 0) {
    return [];
  }

  const response = await geminiClient.models.embedContent({
    model: GEMINI_EMBEDDING_MODEL,
    contents: question,
    config: {
      abortSignal: signal,
      outputDimensionality: EMBEDDING_DIMENSIONS,
      taskType: "QUESTION_ANSWERING",
    },
  });
  const embeddingValues = response.embeddings?.[0]?.values;

  if (!embeddingValues || embeddingValues.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("Gemini returned an invalid question embedding.");
  }

  const questionEmbedding = normalizeEmbedding(embeddingValues);

  return chunks
    .map((chunk) => ({
      chunk,
      similarity: calculateCosineSimilarity(questionEmbedding, chunk.embedding),
    }))
    .filter(
      (result): result is { chunk: DocumentChunk; similarity: number } =>
        result.similarity !== null,
    )
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, MAX_RETRIEVED_CHUNKS)
    .map(({ chunk }) => ({
      pageNumber: chunk.pageNumber,
      text: chunk.text,
    }));
}
