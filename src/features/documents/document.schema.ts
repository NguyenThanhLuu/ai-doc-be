import { Buffer } from "node:buffer";
import { z } from "zod";

export const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_PAGE_SIZES = [10, 20, 50, 100] as const;

const PDF_SIGNATURE = Buffer.from("%PDF-");
const ACCEPTED_PDF_MIME_TYPES = new Set([
  "application/pdf",
  "application/octet-stream",
]);

function isMulterFile(value: unknown): value is Express.Multer.File {
  return (
    typeof value === "object" &&
    value !== null &&
    Buffer.isBuffer(Reflect.get(value, "buffer"))
  );
}

function hasPdfSignature(file: Express.Multer.File): boolean {
  return file.buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
}

const uploadedPdfSchema = z
  .custom<Express.Multer.File>(isMulterFile, {
    error: "Select a PDF file.",
  })
  .refine((file) => file.size > 0, "The PDF file cannot be empty.")
  .refine(
    (file) => file.size <= MAX_PDF_SIZE_BYTES,
    "The PDF file must be 10 MB or smaller.",
  )
  .refine(
    (file) => ACCEPTED_PDF_MIME_TYPES.has(file.mimetype.toLowerCase()),
    "Only PDF files are supported.",
  )
  .refine(hasPdfSignature, "The selected file is not a valid PDF.");

const documentNameSchema = z
  .string({ error: "Document name is required." })
  .trim()
  .min(1, "Document name is required.")
  .max(120, "Document name must contain 120 characters or fewer.");

export const documentUploadSchema = z.object({
  uploadRequestId: z
    .string({ error: "Upload request ID is required." })
    .uuid("Upload request ID is invalid."),
  name: documentNameSchema,
  file: uploadedPdfSchema,
});

export const documentUpdateSchema = z.object({
  name: documentNameSchema,
  file: uploadedPdfSchema.optional(),
});

export const documentListQuerySchema = z.object({
  page: z.coerce
    .number({ error: "Page must be a number." })
    .int("Page must be a whole number.")
    .min(1, "Page must be at least 1.")
    .max(1_000_000, "Page is too large.")
    .default(1),
  pageSize: z.coerce
    .number({ error: "Page size must be a number." })
    .int("Page size must be a whole number.")
    .refine(
      (value) => DOCUMENT_PAGE_SIZES.some((pageSize) => pageSize === value),
      "Page size must be one of 10, 20, 50, or 100.",
    )
    .default(10),
});

export const documentIdSchema = z
  .string({ error: "Document ID is required." })
  .uuid("Document ID is invalid.");
