import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { FRONTEND_ORIGIN } from "../../config/environment.js";
import { retrieveDocumentEvidence } from "../documents/document-indexing.js";
import { findDocument } from "../documents/document.store.js";
import type { DocumentChunk } from "../documents/document.types.js";
import {
  mapGeminiError,
  readGeminiErrorStatus,
  streamGeminiResponse,
} from "./gemini-generation.js";
import type {
  ChatError,
  ChatHistoryMessage,
  ClientToServerEvents,
  DocumentChatSocketData,
  InterServerEvents,
  ServerToClientEvents,
} from "./document-chat.types.js";

type DocumentChatServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  DocumentChatSocketData
>;

type DocumentChatSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  DocumentChatSocketData
>;

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_HISTORY_TURNS = 5;

function createError(code: string, message: string): ChatError {
  return { code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readDocumentId(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.documentId !== "string") {
    return null;
  }

  const documentId = payload.documentId.trim();
  return documentId === "" ? null : documentId;
}

function readMessageContent(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.content !== "string") {
    return null;
  }

  const content = payload.content.trim();

  if (content === "" || content.length > MAX_MESSAGE_LENGTH) {
    return null;
  }

  return content;
}

function appendCompletedTurn(
  history: readonly ChatHistoryMessage[],
  userContent: string,
  assistantContent: string,
): ChatHistoryMessage[] {
  const nextHistory: ChatHistoryMessage[] = [
    ...history,
    { role: "user", content: userContent },
    { role: "assistant", content: assistantContent },
  ];

  return nextHistory.slice(-MAX_HISTORY_TURNS * 2);
}

function stopActiveResponse(socket: DocumentChatSocket): void {
  socket.data.activeResponse?.controller.abort();
  socket.data.activeResponse = null;
}

async function streamGeminiAssistantResponse(
  socket: DocumentChatSocket,
  userContent: string,
  documentChunks: readonly DocumentChunk[],
): Promise<void> {
  const assistantMessageId = randomUUID();
  const createdAt = new Date().toISOString();
  const controller = new AbortController();
  let content = "";

  socket.data.activeResponse = { assistantMessageId, controller };
  socket.emit("chat:assistant:started", {
    message: {
      id: assistantMessageId,
      role: "assistant",
      content,
      status: "streaming",
      createdAt,
    },
  });

  try {
    const evidence = await retrieveDocumentEvidence({
      chunks: documentChunks,
      question: userContent,
      signal: controller.signal,
    });

    for await (const delta of streamGeminiResponse({
      evidence,
      history: socket.data.history,
      message: userContent,
      signal: controller.signal,
    })) {
      content += delta;
      socket.emit("chat:assistant:delta", {
        assistantMessageId,
        delta,
      });
    }

    if (content.trim() === "") {
      throw new Error("Gemini returned an empty response.");
    }

    socket.data.history = appendCompletedTurn(
      socket.data.history,
      userContent,
      content,
    );
    socket.emit("chat:assistant:completed", {
      message: {
        id: assistantMessageId,
        role: "assistant",
        content,
        status: "completed",
        createdAt,
      },
    });
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      socket.emit("chat:assistant:cancelled", {
        message: {
          id: assistantMessageId,
          role: "assistant",
          content,
          status: "cancelled",
          createdAt,
        },
      });
    } else {
      const chatError = mapGeminiError(error);

      socket.emit("chat:assistant:failed", {
        message: {
          id: assistantMessageId,
          role: "assistant",
          content,
          status: "failed",
          createdAt,
        },
        error: chatError,
      });
      console.error("Gemini document chat failed.", {
        code: chatError.code,
        providerStatus: readGeminiErrorStatus(error),
      });
    }
  } finally {
    if (socket.data.activeResponse?.assistantMessageId === assistantMessageId) {
      socket.data.activeResponse = null;
    }
  }
}

export function attachDocumentChatSocket(httpServer: HttpServer): void {
  const io: DocumentChatServer = new Server(httpServer, {
    cors: {
      origin: FRONTEND_ORIGIN,
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    socket.data.documentId = null;
    socket.data.documentChunks = null;
    socket.data.activeResponse = null;
    socket.data.history = [];

    socket.on("chat:session:create", (payload, acknowledge) => {
      const documentId = readDocumentId(payload);

      if (documentId === null) {
        acknowledge({
          ok: false,
          error: createError(
            "INVALID_DOCUMENT_ID",
            "A valid document is required to start chat.",
          ),
        });
        return;
      }

      const document = findDocument(documentId);

      if (!document) {
        acknowledge({
          ok: false,
          error: createError(
            "DOCUMENT_NOT_FOUND",
            "The requested document could not be found.",
          ),
        });
        return;
      }

      stopActiveResponse(socket);
      socket.data.documentId = documentId;
      socket.data.documentChunks = document.chunks;
      socket.data.history = [];
      acknowledge({ ok: true });
    });

    socket.on("chat:message:create", (payload, acknowledge) => {
      const content = readMessageContent(payload);

      if (content === null) {
        acknowledge({
          ok: false,
          error: createError(
            "INVALID_MESSAGE",
            "Enter a message containing 2,000 characters or fewer.",
          ),
        });
        return;
      }

      if (
        socket.data.documentId === null ||
        socket.data.documentChunks === null
      ) {
        acknowledge({
          ok: false,
          error: createError(
            "CHAT_NOT_READY",
            "Document chat is still connecting. Try again in a moment.",
          ),
        });
        return;
      }

      if (socket.data.activeResponse !== null) {
        acknowledge({
          ok: false,
          error: createError(
            "RESPONSE_IN_PROGRESS",
            "Wait for the current response to finish or stop it first.",
          ),
        });
        return;
      }

      acknowledge({ ok: true });
      void streamGeminiAssistantResponse(
        socket,
        content,
        socket.data.documentChunks,
      );
    });

    socket.on("chat:response:cancel", (acknowledge) => {
      if (socket.data.activeResponse === null) {
        acknowledge({
          ok: false,
          error: createError(
            "RESPONSE_NOT_FOUND",
            "There is no active response to stop.",
          ),
        });
        return;
      }

      socket.data.activeResponse.controller.abort();
      acknowledge({ ok: true });
    });

    socket.on("chat:session:destroy", (acknowledge) => {
      stopActiveResponse(socket);
      socket.data.documentId = null;
      socket.data.documentChunks = null;
      socket.data.history = [];
      acknowledge({ ok: true });
    });

    socket.on("disconnect", () => {
      stopActiveResponse(socket);
      socket.data.documentId = null;
      socket.data.documentChunks = null;
      socket.data.history = [];
    });
  });
}
