import { Buffer } from "node:buffer";
import {
  Injectable,
  Logger,
  type OnModuleInit,
} from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENT_STORAGE_BUCKET,
  STORAGE_SECRET_KEY,
  DOCUMENT_STORAGE_SIGNED_URL_TTL_SECONDS,
  STORAGE_URL,
} from "../config/environment.js";

export type DocumentStorageOperation =
  | "download"
  | "remove"
  | "sign"
  | "upload";

export class DocumentStorageError extends Error {
  constructor(
    readonly operation: DocumentStorageOperation,
    readonly storageCode: string | undefined,
  ) {
    super(`Document storage ${operation} failed.`);
    this.name = "DocumentStorageError";
  }
}

export interface SignedDocumentUrl {
  readonly expiresAt: string;
  readonly url: string;
}

@Injectable()
export class DocumentStorageService implements OnModuleInit {
  private readonly logger = new Logger(DocumentStorageService.name);
  private readonly client: SupabaseClient = createClient(
    STORAGE_URL,
    STORAGE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );

  readonly documentsBucket = DOCUMENT_STORAGE_BUCKET;

  async onModuleInit(): Promise<void> {
    const { data, error } = await this.client.storage.getBucket(
      this.documentsBucket,
    );

    if (error || !data) {
      throw new Error(
        `Document storage bucket "${this.documentsBucket}" is unavailable. Create the private bucket and verify the storage configuration.`,
      );
    }

    if (data.public) {
      throw new Error(
        `Document storage bucket "${this.documentsBucket}" must be private.`,
      );
    }

    this.logger.log(
      `Document storage bucket "${this.documentsBucket}" is ready.`,
    );
  }

  async uploadPdf(objectPath: string, content: Buffer): Promise<void> {
    const { error } = await this.client.storage
      .from(this.documentsBucket)
      .upload(objectPath, content, {
        cacheControl: "0",
        contentType: "application/pdf",
        upsert: false,
      });

    if (error) {
      throw new DocumentStorageError("upload", error.name);
    }
  }

  async downloadPdf(bucket: string, objectPath: string): Promise<Buffer> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .download(objectPath);

    if (error || !data) {
      throw new DocumentStorageError("download", error?.name);
    }

    return Buffer.from(await data.arrayBuffer());
  }

  async createSignedPdfUrl(
    bucket: string,
    objectPath: string,
  ): Promise<SignedDocumentUrl> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(objectPath, DOCUMENT_STORAGE_SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      throw new DocumentStorageError("sign", error?.name);
    }

    return {
      url: data.signedUrl,
      expiresAt: new Date(
        Date.now() + DOCUMENT_STORAGE_SIGNED_URL_TTL_SECONDS * 1_000,
      ).toISOString(),
    };
  }

  async removePdf(bucket: string, objectPath: string): Promise<void> {
    const { error } = await this.client.storage
      .from(bucket)
      .remove([objectPath]);

    if (error) {
      throw new DocumentStorageError("remove", error.name);
    }
  }
}


