import { createServer } from "node:http";
import { app } from "./app.js";
import { attachDocumentChatSocket } from "./features/document-chat/document-chat.socket.js";

const PORT = 3000;
const httpServer = createServer(app);

attachDocumentChatSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Node AI Pro API is listening on http://localhost:${PORT}`);
});
