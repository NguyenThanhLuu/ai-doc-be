import type { DocumentChunk } from "../documents/document.types.js";

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  createdAt: string;
}

export interface ChatError {
  code: string;
  message: string;
}

export interface ChatHistoryMessage {
  role: ChatMessageRole;
  content: string;
}

export type ChatCommandResult =
  | { ok: true }
  | { ok: false; error: ChatError };

export type ChatAcknowledge = (result: ChatCommandResult) => void;

interface ChatMessageEvent {
  message: ChatMessage;
}

interface AssistantDeltaEvent {
  assistantMessageId: string;
  delta: string;
}

interface AssistantFailedEvent extends ChatMessageEvent {
  error: ChatError;
}

export interface ServerToClientEvents {
  "chat:assistant:started": (event: ChatMessageEvent) => void;
  "chat:assistant:delta": (event: AssistantDeltaEvent) => void;
  "chat:assistant:completed": (event: ChatMessageEvent) => void;
  "chat:assistant:failed": (event: AssistantFailedEvent) => void;
  "chat:assistant:cancelled": (event: ChatMessageEvent) => void;
}

export interface ClientToServerEvents {
  "chat:session:create": (
    payload: unknown,
    acknowledge: ChatAcknowledge,
  ) => void;
  "chat:session:destroy": (acknowledge: ChatAcknowledge) => void;
  "chat:message:create": (
    payload: unknown,
    acknowledge: ChatAcknowledge,
  ) => void;
  "chat:response:cancel": (acknowledge: ChatAcknowledge) => void;
}

export interface ActiveChatResponse {
  assistantMessageId: string;
  controller: AbortController;
}

export interface DocumentChatSocketData {
  documentId: string | null;
  documentChunks: readonly DocumentChunk[] | null;
  activeResponse: ActiveChatResponse | null;
  history: ChatHistoryMessage[];
}

export type InterServerEvents = Record<never, never>;
