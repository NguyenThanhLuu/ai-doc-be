# Node AI Pro Backend

Node AI Pro is the local NestJS and TypeScript API for React AI Pro. The
current implementation accepts PDF uploads, keeps them in process memory, and
serves their metadata and content back to the frontend.

## Technology

- Node.js 22.12 or newer.
- NestJS 12 with the Express platform adapter and strict TypeScript.
- Socket.IO for document-scoped realtime chat.
- Multer for `multipart/form-data` parsing with memory storage.
- PostgreSQL through a shared `node-postgres` connection pool.
- Zod for runtime validation at HTTP boundaries.
- Google Gen AI SDK for Gemini response streaming.
- Oxlint for static analysis.

## Current Scope

The API supports:

- Uploading one PDF with a user-defined document name.
- Listing uploaded document metadata.
- Reading one document's metadata.
- Streaming a stored PDF back for inline browser viewing.
- Initializing one temporary chat context per connected PDF detail socket.
- Validating chat message input and streaming real Gemini responses.
- Keeping a small bounded multi-turn history in socket memory.
- Cancelling active Gemini responses and immediately cleaning up on explicit
  exit or socket disconnect.
- Signing in with email and password through short-lived access JWTs.
- Restoring authentication through a seven-day refresh JWT cookie.

The authentication foundation stores users in PostgreSQL. Access and refresh
tokens are stateless and are signed with separate secrets.
Existing document metadata, PDF content, extracted text, embeddings, and chat
history remain in memory. Role-protected user management and authorization for
document HTTP and Socket.IO access remain planned in
[`docs/auth-roadmap.md`](docs/auth-roadmap.md).

## Project Structure

```text
src/
|-- app.module.ts
|-- main.ts
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
|   |   |-- document-chat.types.ts
|   |   `-- gemini-generation.ts
|   `-- documents/
|       |-- documents.module.ts
|       |-- documents.controller.ts
|       |-- documents.service.ts
|       |-- document.schema.ts
|       |-- document.repository.ts
|       |-- memory-document.repository.ts
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
contracts, and in-memory state when needed.

## API Contract

### Authentication tokens

`POST /api/auth/login` accepts `email` and `password`, returns a one-hour access
token with the authenticated user, and sets a seven-day refresh token in an
`HttpOnly`, `SameSite=Lax` cookie. `POST /api/auth/refresh` validates that
cookie and returns a new access token with the current user. `GET /api/auth/me`
accepts the access token as a Bearer token. `POST /api/auth/logout` clears the
refresh-token cookie.

### Create a document

`POST /api/documents` accepts `multipart/form-data` with:

- `name`: required custom document name, at most 120 characters.
- `file`: required PDF, at most 10 MB.

The server validates the text field, Multer file structure, MIME type, size,
and `%PDF-` file signature. A successful request returns `201`:

```json
{
  "message": "Document added successfully.",
  "document": {
    "id": "generated UUID",
    "name": "Research notes",
    "originalFileName": "source.pdf",
    "mimeType": "application/pdf",
    "size": 12345,
    "createdAt": "ISO-8601 timestamp"
  }
}
```

### List documents

`GET /api/documents` returns `{ "documents": [...] }` ordered newest first.
File buffers are never included in this response.

### Read document metadata

`GET /api/documents/:documentId` returns `{ "document": {...} }` or `404`.

### Read PDF content

`GET /api/documents/:documentId/content` returns the stored buffer with
`Content-Type: application/pdf` and inline content disposition.

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

## In-Memory Storage

Documents are stored by `MemoryDocumentRepository` in a process-local `Map`.
Each entry contains metadata, the complete PDF `Buffer`, and its generated
document chunks. All documents are lost whenever the backend stops or restarts.
The 10 MB request limit reduces individual upload risk, but this storage design
is for local incremental development only and is not suitable for production or
multiple server instances.

HTTP controllers and Socket.IO depend on the `DocumentRepository` contract, not
directly on the in-memory `Map`. A future implementation can replace the Nest
provider with a PostgreSQL repository using `pg` for metadata/chunks and a
Supabase Storage bucket for PDF content. No PostgreSQL or Supabase dependency,
configuration, schema, or network call is included while persistence is not
needed. Chat history remains temporary socket memory.

## Ephemeral Document Chat

Socket.IO streams real Gemini text deltas while preserving the Phase 1 event
contract. Each successful PDF detail-page mount opens one socket, and that
socket is the temporary chat context for the current document.

- Two tabs showing the same PDF use two independent sockets.
- Closing and reopening the chat Drawer does not affect the socket.
- Leaving, refreshing, or closing the detail page permanently deletes its chat
  history. Visible messages exist in frontend React state, and the bounded
  Gemini conversation context exists only on `socket.data`.
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
GEMINI_API_KEY=your-api-key
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
FRONTEND_ORIGIN=http://localhost:5173
```

`DATABASE_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, and
`GEMINI_API_KEY` are required. The token secrets must differ and contain at
least 32 bytes. `GEMINI_MODEL` and `GEMINI_EMBEDDING_MODEL` have the defaults
shown above. Both `npm run dev` and
`npm run start` load `.env` through Node's built-in `--env-file` option. The
file is ignored by Git and must never be committed.

Nest verifies the database connection during startup and stops initialization
when the URL is missing, SSL is not required, or Supabase cannot be reached.
The connection pool is shared application-wide and closes through Nest's
shutdown lifecycle. Supabase API keys are not needed for this server-side
PostgreSQL connection.

The backend limits Gemini responses to 1,000 output tokens, disables automatic
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
allows the current `GET`, `POST`, and `OPTIONS` methods plus the `Accept` and
`Content-Type` request headers. Socket.IO uses the same origin value for its
polling handshake and connection configuration.

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
