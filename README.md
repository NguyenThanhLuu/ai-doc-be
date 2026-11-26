# Node AI Pro Backend

Node AI Pro is the local NestJS and TypeScript API for React AI Pro. PDF files
are stored through the document-storage adapter (currently backed by a private
Supabase Storage bucket), while document metadata,
indexing state, extracted chunks, and pgvector embeddings are stored in
PostgreSQL.

## Technology

- Node.js 22.12 or newer.
- NestJS 12 with the Express platform adapter and strict TypeScript.
- Socket.IO for document-scoped realtime chat.
- Multer for `multipart/form-data` parsing with memory storage.
- PostgreSQL through a shared `node-postgres` connection pool.
- Provider-neutral document storage, currently backed by Supabase Storage.
- pgvector for document chunk embeddings and similarity search.
- Zod for runtime validation at HTTP boundaries.
- Provider-neutral AI service, currently backed by the Google Gen AI SDK.
- Oxlint for static analysis.

## Current Scope

The API supports:

- Uploading one PDF and returning before AI indexing completes.
- Listing only the authenticated user's documents and indexing status.
- Reading one document's metadata.
- Creating short-lived signed URLs for private PDF viewing.
- Initializing one temporary chat context per connected PDF detail socket.
- Validating chat message input and streaming AI responses.
- Keeping a small bounded multi-turn history in socket memory.
- Cancelling active AI responses and immediately cleaning up on explicit
  exit or socket disconnect.
- Signing in with email and password through short-lived access JWTs.
- Restoring authentication through a seven-day refresh JWT cookie.

The authentication foundation stores users in PostgreSQL. Access and refresh
tokens are stateless and are signed with separate secrets.
Document ownership is enforced for HTTP and Socket.IO access. PDF files,
metadata, chunks, embeddings, and retry state survive backend restarts. Chat
history remains intentionally temporary in socket memory.

## Project Structure

```text
src/
|-- app.module.ts
|-- main.ts
|-- ai/
|   |-- ai.module.ts
|   `-- ai.service.ts
|-- config/
|   `-- environment.ts
|-- database/
|   |-- database.module.ts
|   `-- database.service.ts
|-- features/
|   |-- authentication/
|   |   |-- authentication.controller.ts
|   |   |-- authentication.module.ts
|   |   |-- authentication.repository.ts
|   |   |-- authentication.schema.ts
|   |   |-- authentication.service.ts
|   |   `-- authentication.types.ts
|   |-- document-chat/
|   |   |-- document-chat.socket.ts
|   |   `-- document-chat.types.ts
|   `-- documents/
|       |-- documents.module.ts
|       |-- documents.controller.ts
|       |-- documents.service.ts
|       |-- document.schema.ts
|       |-- document.repository.ts
|       |-- document-indexing.worker.ts
|       `-- document.types.ts
|-- http/
|   |-- api-http.exception.ts
|   `-- api-exception.filter.ts
`-- middleware/
    `-- cors-middleware.ts
```

`main.ts` creates the Nest application, attaches Socket.IO to Nest's HTTP
server, and opens the local port. `AppModule` composes feature modules and the
shared API error filter. Each feature owns its controller, service, validation,
and contracts.

`DocumentsService`, the indexing worker, and the chat socket use the concrete
`DocumentRepository` directly; there is no repository token or duplicate
PostgreSQL implementation class. Vendor-specific SDK calls are isolated behind
the provider-neutral `AiService` and `DocumentStorageService`, so changing an
AI or storage provider does not change document business code.

## API Contract

### Authentication tokens

`POST /api/auth/login` accepts `email` and `password`, returns a one-hour access
token with the authenticated user, and sets a seven-day refresh token in an
`HttpOnly`, `SameSite=Lax` cookie. `POST /api/auth/refresh` validates that
cookie and returns a new access token with the current user. `GET /api/auth/me`
accepts the access token as a Bearer token. `POST /api/auth/logout` clears the
refresh-token cookie.

Email matching is case-sensitive. The API stores the exact valid email value
provided during account creation and requires the same casing at sign-in.

An application-wide access-token guard protects every HTTP controller route by
default. Login, refresh, and logout are explicitly public. Protected requests
must provide `Authorization: Bearer <access-token>`.

### Account management

All account-management endpoints require a Bearer access token:

- `GET /api/users` returns all safe account summaries and is restricted to
  administrators.
- `POST /api/users` creates an `admin` or `user` account and is restricted to
  administrators.
- `PATCH /api/users/me/username` updates only the authenticated user's
  username and returns a replacement access token that preserves the original
  access token's expiration time.
- `PATCH /api/users/me/password` verifies the current password, stores a new
  bcrypt hash, and clears the refresh-token cookie so the user must sign in
  again.

Run `npm run db:migrate` to apply pending PostgreSQL migrations. The migration
runner records completed SQL files in `public.schema_migrations` and applies
each pending file transactionally.

### Create a document

`POST /api/documents` accepts `multipart/form-data` with:

- `name`: required custom document name, at most 120 characters.
- `file`: required PDF, at most 10 MB.
- `uploadRequestId`: required UUID used to make retries idempotent.

All document endpoints require a valid Bearer access token, including PDF
content responses.

The server validates the fields, Multer file structure, MIME type, size, and
`%PDF-` signature. A durable upload returns `202` while AI indexing continues:

```json
{
  "message": "PDF uploaded successfully. AI indexing is running in the background.",
  "document": {
    "id": "generated UUID",
    "name": "Research notes",
    "originalFileName": "source.pdf",
    "mimeType": "application/pdf",
    "size": 12345,
    "indexingStatus": "processing",
    "indexingError": null,
    "createdAt": "ISO-8601 timestamp"
  }
}
```

### List documents

`GET /api/documents` returns only the authenticated user's documents ordered
newest first. File buffers and Storage paths are never included.

### Read document metadata

`GET /api/documents/:documentId` returns `{ "document": {...} }` or `404`.

### Read PDF content

`GET /api/documents/:documentId/content-url` returns a short-lived signed URL
after checking ownership. The compatibility `/content` endpoint redirects to a
fresh signed URL.

`POST /api/documents/:documentId/indexing/retry` queues a failed document for
indexing again without uploading the PDF again.

### Error shape

All handled API failures use:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Plain-language recovery guidance."
  }
}
```

## Durable Document Storage and Indexing

The upload request temporarily holds at most one 10 MB PDF buffer, writes it to
private document storage, then creates a PostgreSQL `documents` row with
`indexing_status = 'processing'`. The document row itself acts as the durable
queue, so a separate jobs table is not required.

The background worker claims one processing document, downloads its PDF,
extracts text, creates AI embeddings, stores the results in
`document_chunks`, and marks the document `ready`. Transient failures receive
up to three total attempts; permanent or exhausted failures become `failed`.
Expired worker locks let processing resume after a backend restart. Chat
history remains temporary socket memory.

## Ephemeral Document Chat

Socket.IO streams real AI text deltas while preserving the Phase 1 event
contract. Each successful PDF detail-page mount opens one socket, and that
socket is the temporary chat context for the current document.

- Two tabs showing the same PDF use two independent sockets.
- Closing and reopening the chat Drawer does not affect the socket.
- Leaving, refreshing, or closing the detail page permanently deletes its chat
  history. Visible messages exist in frontend React state, and the bounded
  AI conversation context exists only on `socket.data`.
- A disconnect immediately cancels the active response and clears the socket
  context. A reconnect initializes the document context again but does not
  resume an interrupted response.
- Controlled navigation sends an explicit destroy command. Socket disconnect
  remains the immediate cleanup fallback for refresh or tab close.

### Client commands

- `chat:session:create`
- `chat:session:destroy`
- `chat:message:create`
- `chat:response:cancel`

Payload-bearing commands are treated as unknown and narrowed with small runtime
guards before use. Acknowledgements return a discriminated success result or a
stable error with a plain-language message.

### Server events

- `chat:assistant:started`, `chat:assistant:delta`,
  `chat:assistant:completed`, `chat:assistant:failed`, and
  `chat:assistant:cancelled`

Events are emitted directly to the requesting socket without a custom room.
Delta events contain the stable assistant message ID. Only one assistant
response runs per socket.

Chat messages are not stored durably or written to a database. The backend
keeps the current `documentId`, active response controller, and at most five
completed user-and-assistant turns on `socket.data`. It only commits an
exchange after successful completion. Destroying or disconnecting the socket
clears this context immediately.

## Environment Configuration

Copy `.env.example` to the ignored backend `.env` file, then replace its
placeholders. Get the PostgreSQL Session Pooler connection string from the
Supabase dashboard's Connect panel and append `sslmode=require`. Percent-encode
reserved characters in the database password before placing it in the URL.

```env
DATABASE_URL=postgresql://postgres.YOUR_PROJECT_REF:YOUR_URL_ENCODED_DATABASE_PASSWORD@YOUR_SESSION_POOLER_HOST:5432/postgres?sslmode=require
ACCESS_TOKEN_SECRET=replace-with-a-random-secret-of-at-least-32-bytes
REFRESH_TOKEN_SECRET=replace-with-a-different-random-secret-of-at-least-32-bytes
STORAGE_URL=https://YOUR_PROJECT_REF.supabase.co
STORAGE_SECRET_KEY=sb_secret_REPLACE_WITH_YOUR_SECRET_KEY
DOCUMENT_STORAGE_BUCKET=documents
DOCUMENT_STORAGE_SIGNED_URL_TTL_SECONDS=600
AI_API_KEY=your-ai-provider-api-key
AI_CHAT_MODEL=gemini-3.1-flash-lite
AI_EMBEDDING_MODEL=gemini-embedding-001
FRONTEND_ORIGIN=http://localhost:5173
```

`DATABASE_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `STORAGE_URL`,
`STORAGE_SECRET_KEY`, and `AI_API_KEY` are required. Storage credentials must
remain backend-only. The token secrets must differ and contain at least 32
bytes. `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`, the bucket name, and signed URL
TTL use the values shown above. Legacy `SUPABASE_*` and `GEMINI_*` names remain
accepted during migration. `npm run dev` requires the local `.env` file, while
`npm run start` and `npm run db:migrate` load it only when present so hosted
environments can inject variables directly. The file is ignored by Git and
must never be committed.

The database migration creates a private Storage bucket named `documents`,
restricts it to `application/pdf`, and sets its maximum size to 10 MB. Copy the
project URL and a backend Secret key into `.env`. If you choose a different
bucket name, create that private bucket manually with the same restrictions.
Nest verifies the database connection and bucket during startup and fails fast
when either is unavailable or misconfigured.

The backend limits AI responses to 1,000 output tokens, disables automatic
continuation, and never sends provider error details or credentials to the
frontend.

## Local Commands

```bash
npm run dev
npm run start
npm run typecheck
npm run lint
```

The API listens on `http://localhost:3000`. React AI Pro calls
`http://localhost:3000/api` directly during local development, as configured
in the frontend's `.env.development` file.

## Cross-Origin Requests

The frontend calls the API through its environment-configured absolute URL, so
the backend enables CORS for one frontend origin. Local development defaults to
`http://localhost:5173`. Set `FRONTEND_ORIGIN` in the backend process when the
frontend is hosted elsewhere, for example:

```text
FRONTEND_ORIGIN=https://app.your-domain.com
```

Only that exact origin receives the REST CORS response headers. The middleware
allows `GET`, `POST`, `PUT`, `PATCH`, and `OPTIONS` plus the `Accept`,
`Authorization`, and `Content-Type` request headers. Socket.IO uses the same
origin value for its polling handshake and connection configuration.

## Accessibility

The backend does not render UI. It returns concise error messages that the
frontend can expose to users without leaking internal stack traces.

## Verification

The backend passes TypeScript validation and Oxlint. Runtime smoke checks cover
the document list, invalid and missing document responses, unknown routes,
upload validation and size limits, CORS preflights, and the Socket.IO polling
handshake. Live Gemini indexing and response generation require a configured
API credential and external provider access.

## Change History

### 2026-11-24

- Replaced process-memory document storage with PostgreSQL metadata/chunks and
  private Supabase Storage PDF objects.
- Added durable background indexing state, three-attempt retry, pgvector
  evidence retrieval, signed PDF URLs, and per-user HTTP/Socket.IO ownership.

### 2026-10-25

- Created the Express and strict TypeScript backend.
- Added Zod-validated PDF upload and in-memory storage.
- Added list, metadata, and inline PDF content endpoints.

### 2026-10-26

- Added configurable CORS support for direct frontend API requests.
- Documented the planned one-session-per-PDF-detail-visit chat lifecycle and
  non-persistent history requirement.
- Attached Socket.IO to the Express HTTP server and implemented Zod-validated
  commands, isolated in-memory rooms, idempotent message acceptance, ordered
  mock streaming, cancellation, reconnect resume, explicit destruction, and
  30-second disconnect expiry.
- Expanded the deterministic mock response to exercise a longer realtime stream
  while remaining explicit that PDF analysis and external AI are unavailable.

### 2026-10-28

- Simplified Phase 1 to one document context per socket.
- Removed custom rooms, the server session/message store, reconnect resume,
  disconnect-grace timers, idempotency bookkeeping, and socket-specific Zod
  schemas.
- Kept manual boundary guards, one-active-response enforcement, mock streaming,
  cancellation, direct cleanup, and typed event maps.

### 2026-10-29

- Added the official Google Gen AI SDK and backend-only Gemini configuration.
- Replaced deterministic mock generation with real Gemini streaming while
  preserving the existing Socket.IO event contract and cancellation flow.
- Added bounded in-memory multi-turn context that is committed only after a
  successful response and cleared on session replacement, destruction, or
  disconnect.
- Added safe provider error mapping, output limits, disabled automatic
  continuation, and instructions that prevent Phase 2 from claiming PDF
  access before retrieval is implemented.
- Added an ignored backend `.env` file and configured the development and start
  commands to load it through Node's built-in environment-file support.

### 2026-11-16

- Migrated the REST application bootstrap and document feature from plain
  Express routing to NestJS modules, controllers, services, DI, and a global
  exception filter while preserving the existing HTTP and Socket.IO contracts.
- Replaced the module-global document `Map` with an injectable
  `DocumentRepository` contract backed by `MemoryDocumentRepository`.
- Kept Multer memory uploads, Zod validation, Gemini indexing, Socket.IO chat,
  CORS behavior, and all client-facing response shapes unchanged.

### 2026-11-19

- Added the Supabase PostgreSQL environment template and strict connection URL
  validation with encrypted connections required.
- Added a shared NestJS database module that verifies connectivity during
  startup and closes its `node-postgres` pool during shutdown.
- Recorded the admin/user authentication requirements and phased delivery plan
  in `docs/auth-roadmap.md`.
- Added versioned `users` and `sessions` migrations, bcrypt password hashing,
  one-time initial-admin setup, and opaque cookie-backed login sessions.

### 2026-11-20

- Removed the completed one-time admin setup flow and its migration runner.
- Replaced database sessions with one-hour access JWTs and a seven-day refresh
  JWT stored in an `HttpOnly` cookie.
