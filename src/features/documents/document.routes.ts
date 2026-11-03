import { Router } from "express";
import multer from "multer";
import {
  documentIdSchema,
  documentUploadSchema,
  MAX_PDF_SIZE_BYTES,
} from "./document.schema.js";
import {
  createDocument,
  findDocument,
  listDocuments,
} from "./document.store.js";
import {
  createPdfDocumentIndex,
  DocumentIndexingError,
} from "./document-indexing.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: MAX_PDF_SIZE_BYTES,
  },
});

export const documentRouter = Router();

function readBodyField(body: unknown, fieldName: string): unknown {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  return Reflect.get(body, fieldName);
}

documentRouter.post("/", upload.single("file"), async (request, response) => {
  const validationResult = documentUploadSchema.safeParse({
    name: readBodyField(request.body, "name"),
    file: request.file,
  });

  if (!validationResult.success) {
    response.status(400).json({
      error: {
        code: "DOCUMENT_VALIDATION_FAILED",
        message:
          validationResult.error.issues[0]?.message ??
          "Check the document details and try again.",
      },
    });
    return;
  }

  try {
    const chunks = await createPdfDocumentIndex(
      validationResult.data.file.buffer,
    );
    const document = createDocument({
      name: validationResult.data.name,
      originalFileName: validationResult.data.file.originalname,
      size: validationResult.data.file.size,
      content: validationResult.data.file.buffer,
      chunks,
    });

    response.status(201).json({
      message: "Document added and indexed successfully.",
      document,
    });
  } catch (error: unknown) {
    if (error instanceof DocumentIndexingError) {
      if (error.statusCode >= 500) {
        console.error("Document indexing failed.", { code: error.code });
      }

      response.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    throw error;
  }
});

documentRouter.get("/", (_request, response) => {
  response.json({ documents: listDocuments() });
});

documentRouter.get("/:documentId/content", (request, response) => {
  const idResult = documentIdSchema.safeParse(request.params.documentId);

  if (!idResult.success) {
    response.status(400).json({
      error: {
        code: "INVALID_DOCUMENT_ID",
        message: idResult.error.issues[0]?.message ?? "Document ID is invalid.",
      },
    });
    return;
  }

  const document = findDocument(idResult.data);

  if (!document) {
    response.status(404).json({
      error: {
        code: "DOCUMENT_NOT_FOUND",
        message: "The requested document could not be found.",
      },
    });
    return;
  }

  response.set({
    "Cache-Control": "no-store",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.originalFileName)}`,
    "Content-Length": String(document.size),
    "Content-Type": document.mimeType,
  });
  response.send(document.content);
});

documentRouter.get("/:documentId", (request, response) => {
  const idResult = documentIdSchema.safeParse(request.params.documentId);

  if (!idResult.success) {
    response.status(400).json({
      error: {
        code: "INVALID_DOCUMENT_ID",
        message: idResult.error.issues[0]?.message ?? "Document ID is invalid.",
      },
    });
    return;
  }

  const document = findDocument(idResult.data);

  if (!document) {
    response.status(404).json({
      error: {
        code: "DOCUMENT_NOT_FOUND",
        message: "The requested document could not be found.",
      },
    });
    return;
  }

  response.json({
    document: {
      id: document.id,
      name: document.name,
      originalFileName: document.originalFileName,
      mimeType: document.mimeType,
      size: document.size,
      createdAt: document.createdAt,
    },
  });
});
