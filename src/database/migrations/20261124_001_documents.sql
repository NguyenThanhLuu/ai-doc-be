CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS vector
  WITH SCHEMA extensions;

CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  upload_request_id uuid NOT NULL,
  name varchar(120) NOT NULL,
  original_file_name text NOT NULL,
  mime_type varchar(100) NOT NULL DEFAULT 'application/pdf',
  size_bytes integer NOT NULL,
  storage_bucket text NOT NULL,
  storage_object_path text NOT NULL,
  indexing_status varchar(20) NOT NULL DEFAULT 'processing',
  indexing_attempts smallint NOT NULL DEFAULT 0,
  next_index_at timestamptz NOT NULL DEFAULT NOW(),
  indexing_locked_by uuid,
  indexing_locked_until timestamptz,
  indexing_error_code text,
  embedding_model text,
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT documents_user_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT documents_mime_type_check
    CHECK (mime_type = 'application/pdf'),
  CONSTRAINT documents_size_check
    CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  CONSTRAINT documents_indexing_status_check
    CHECK (indexing_status IN ('processing', 'ready', 'failed')),
  CONSTRAINT documents_indexing_attempts_check
    CHECK (indexing_attempts >= 0),
  CONSTRAINT documents_user_upload_request_unique
    UNIQUE (user_id, upload_request_id),
  CONSTRAINT documents_storage_object_unique
    UNIQUE (storage_bucket, storage_object_path)
);

CREATE INDEX documents_user_created_index
  ON public.documents (user_id, created_at DESC, id DESC);

CREATE INDEX documents_indexing_queue_index
  ON public.documents (next_index_at, created_at)
  WHERE indexing_status = 'processing';

CREATE TABLE public.document_chunks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  page_number integer NOT NULL,
  text text NOT NULL,
  embedding extensions.vector(768) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT document_chunks_document_fk
    FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE,
  CONSTRAINT document_chunks_chunk_index_check
    CHECK (chunk_index >= 0),
  CONSTRAINT document_chunks_page_number_check
    CHECK (page_number > 0),
  CONSTRAINT document_chunks_text_check
    CHECK (length(text) > 0),
  CONSTRAINT document_chunks_document_index_unique
    UNIQUE (document_id, chunk_index)
);

CREATE INDEX document_chunks_document_index
  ON public.document_chunks (document_id, chunk_index);
