# Node AI Pro Backend

Node AI Pro is the local Express and TypeScript API for React AI Pro. The
current implementation accepts PDF uploads, keeps them in process memory, and
serves their metadata and content back to the frontend.

## Technology

- Node.js 22.12 or newer.
- Express with strict TypeScript.
- Socket.IO for document-scoped realtime chat.
- Multer for `multipart/form-data` parsing with memory storage.
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

There is no authentication, database, durable file storage, PDF analysis,
retrieval, or citation support yet. Gemini currently answers general questions
and is instructed not to claim access to the open PDF.

## Project Structure

```text
src/
|-- app.ts
|-- server.ts
|-- config/
|   `-- environment.ts
|-- features/
|   |-- document-chat/
|   |   |-- document-chat.socket.ts
|   |   |-- document-chat.types.ts
|   |   `-- gemini-generation.ts
|   `-- documents/
|       |-- document.routes.ts
|       |-- document.schema.ts
|       |-- document.store.ts
|       `-- document.types.ts
`-- middleware/
    |-- cors-middleware.ts
    `-- error-handler.ts
```

`app.ts` composes middleware and routes without opening a network port.
`server.ts` creates one Node HTTP server, attaches both Express and Socket.IO,
and opens the local port. Each feature owns its handlers, validation, contracts,
and in-memory state when needed.

## API Contract

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

Documents are stored in a process-local `Map`. Each entry contains metadata and
the complete PDF `Buffer`. All documents are lost whenever the backend stops or
restarts. The 10 MB request limit reduces individual upload risk, but this
storage design is for local incremental development only and is not suitable
for production or multiple server instances.

MongoDB and durable object storage are planned future replacements for document
persistence only, not current behavior and not a future chat-history store.

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

Chat messages are not stored durably or written to MongoDB. The backend keeps
the current `documentId`, active response controller, and at most six recent
conversation messages with a 12,000-character bound on `socket.data`. It only
commits a user-and-assistant exchange after successful completion. Destroying
or disconnecting the socket clears this context immediately.

## Gemini Configuration

Create an API key in Google AI Studio and place it in the ignored backend
`.env` file:

```env
GEMINI_API_KEY=your-api-key
GEMINI_MODEL=gemini-3.1-flash-lite
FRONTEND_ORIGIN=http://localhost:5173
```

`GEMINI_API_KEY` is required. `GEMINI_MODEL` is optional and defaults to
`gemini-3.1-flash-lite`. Both `npm run dev` and `npm run start` load `.env`
through Node's built-in `--env-file` option. The file is ignored by Git and
must never be committed. The backend limits responses to 800 output tokens,
disables automatic continuation, and never sends provider error details or
credentials to the frontend.

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

The Phase 2 source passes backend and frontend TypeScript validation and
Oxlint. A live Gemini request was not made because no API credential is stored
in the repository; the local Socket.IO runtime smoke test remains pending.

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
