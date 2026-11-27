import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import {
  documentListQuerySchema,
  documentUpdateSchema,
} from "./document.schema.js";

function createUploadedFile(
  content: string,
  mimetype = "application/pdf",
): Express.Multer.File {
  const buffer = Buffer.from(content);

  return {
    buffer,
    destination: "",
    encoding: "7bit",
    fieldname: "file",
    filename: "replacement.pdf",
    mimetype,
    originalname: "replacement.pdf",
    path: "",
    size: buffer.length,
    stream: undefined as never,
  };
}

describe("document schemas", () => {
  it("accepts a trimmed name without requiring a replacement PDF", () => {
    const result = documentUpdateSchema.safeParse({
      name: "  Updated document  ",
      file: undefined,
    });

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.name, "Updated document");
      assert.equal(result.data.file, undefined);
    }
  });

  it("reuses PDF validation for replacement files", () => {
    const validResult = documentUpdateSchema.safeParse({
      name: "Updated document",
      file: createUploadedFile("%PDF-replacement"),
    });
    const invalidResult = documentUpdateSchema.safeParse({
      name: "Updated document",
      file: createUploadedFile("plain text", "text/plain"),
    });

    assert.equal(validResult.success, true);
    assert.equal(invalidResult.success, false);
  });

  it("defaults pagination and accepts only supported page sizes", () => {
    const defaultResult = documentListQuerySchema.safeParse({});
    const supportedResult = documentListQuerySchema.safeParse({
      page: "3",
      pageSize: "50",
    });
    const unsupportedResult = documentListQuerySchema.safeParse({
      page: "1",
      pageSize: "25",
    });

    assert.deepEqual(
      defaultResult.success ? defaultResult.data : null,
      { page: 1, pageSize: 10 },
    );
    assert.deepEqual(
      supportedResult.success ? supportedResult.data : null,
      { page: 3, pageSize: 50 },
    );
    assert.equal(unsupportedResult.success, false);
  });
});
