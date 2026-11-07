import { DurableObject } from "cloudflare:workers";
import { arenaCommand, revokeArenaSession } from "./cloud-arena.js";

const EVENTS = new Set([
  "sync",
  "match:join",
  "match:leave",
  "match:rematch-request",
  "match:rematch-accept",
]);

export class ArenaDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = Promise.resolve();
  }

  enqueue(task) {
    const result = this.queue.then(task, task);
    this.queue = result.catch((error) => console.error("Arena event failed", error));
    return result;
  }

  async fetch(request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: "WebSocket upgrade required." }, { status: 426 });
    }
    const connection = new URL(request.url).searchParams.get("connection");
    const user = {
      id: Number(request.headers.get("x-arena-user-id")),
      username: request.headers.get("x-arena-username"),
      tokenHash: request.headers.get("x-arena-token-hash"),
    };
    if (!/^[a-f0-9-]{36}$/.test(connection || "") ||
        !Number.isSafeInteger(user.id) ||
        !user.username ||
        !/^[a-f0-9]{64}$/.test(user.tokenHash || "")) {
      return Response.json({ error: "Invalid arena session." }, { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [connection]);
    server.serializeAttachment({
      user,
      connection,
      lastValidatedAt: 0,
      lastPacketAt: 0,
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, message) {
    return this.enqueue(() => this.handleMessage(socket, message));
  }

  async handleMessage(socket, message) {
    if (typeof message !== "string" || message.length > 4096) {
      socket.close(1009, "Message too large");
      return;
    }
    let packet;
    try { packet = JSON.parse(message); } catch { return; }
    if (packet.event === "ping:check") {
      socket.send(JSON.stringify({ ack: packet.id, data: { ok: true } }));
      return;
    }
    if (!EVENTS.has(packet.event)) return;

    const attachment = socket.deserializeAttachment();
    if (!attachment) {
      socket.close(1011, "Missing connection state");
      return;
    }
    const now = Date.now();
    if (packet.event === "sync" && now - attachment.lastPacketAt < 35) return;
    attachment.lastPacketAt = now;

    if (now - attachment.lastValidatedAt >= 5000) {
      const session = await this.env.DB.prepare(
        "SELECT s.user_id,u.username FROM game_sessions s JOIN game_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
      ).bind(attachment.user.tokenHash, now).first();
      if (!session || session.user_id !== attachment.user.id) {
        socket.send(JSON.stringify({ event: "session:expired" }));
        socket.close(4001, "Session expired");
        return;
      }
      attachment.user.username = session.username;
      attachment.lastValidatedAt = now;
    }
    socket.serializeAttachment(attachment);

    const result = await arenaCommand(
      this.ctx.storage,
      this.env.DB,
      attachment.user,
      attachment.connection,
      packet.event,
      packet.payload || {},
      packet.lastRoomId || null,
    );
    socket.send(JSON.stringify({ ack: packet.id, data: result, view: result }));
  }

  webSocketClose(socket) {
    return this.enqueue(async () => {
      const attachment = socket.deserializeAttachment();
      if (attachment) {
        await arenaCommand(
          this.ctx.storage,
          this.env.DB,
          attachment.user,
          attachment.connection,
          "match:leave",
        );
      }
    });
  }

  webSocketError(socket) {
    return this.webSocketClose(socket);
  }

  revokeSession(userId, tokenHash) {
    return this.enqueue(async () => {
      const user = { id: userId, tokenHash };
      await revokeArenaSession(this.ctx.storage, this.env.DB, user);
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment();
        if (attachment?.user.id !== userId || attachment.user.tokenHash !== tokenHash) continue;
        socket.send(JSON.stringify({ event: "session:expired" }));
        socket.close(4001, "Session expired");
      }
    });
  }
}
