import { Buffer } from "node:buffer";
import { z } from "zod";

export const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;

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

export const documentUploadSchema = z.object({
  uploadRequestId: z
    .string({ error: "Upload request ID is required." })
    .uuid("Upload request ID is invalid."),
  name: z
    .string({ error: "Document name is required." })
    .trim()
    .min(1, "Document name is required.")
    .max(120, "Document name must contain 120 characters or fewer."),
  file: uploadedPdfSchema,
});

export const documentIdSchema = z
  .string({ error: "Document ID is required." })
  .uuid("Document ID is invalid.");
