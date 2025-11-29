import * as net from "net";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";
import type { Message, MessageType, MessagePayload } from "../types.js";

// Get socket path dynamically to allow test overrides
function getSocketPath(): string {
  return process.env.SOCKET_PATH || "/tmp/aio-orche.sock";
}

// Message handler type
export type MessageHandler = (message: Message) => void | Promise<void>;

// Client connection info
interface ClientInfo {
  id: string;
  socket: net.Socket;
  role: string;
}

// Socket Server (runs on orche)
export class SocketServer {
  private server: net.Server | null = null;
  private clients: Map<string, ClientInfo> = new Map();
  private messageHandlers: MessageHandler[] = [];

  async start(): Promise<void> {
    const socketPath = getSocketPath();

    // Remove existing socket file if exists
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on("error", (err) => {
        console.error("Socket server error:", err);
        reject(err);
      });

      this.server.listen(socketPath, () => {
        console.error(`Socket server listening on ${socketPath}`);
        resolve();
      });
    });
  }

  private handleConnection(socket: net.Socket): void {
    const clientId = uuidv4().slice(0, 8);
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();

      // Process complete messages (newline-delimited JSON)
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            this.handleMessage(clientId, socket, msg);
          } catch (err) {
            console.error("Failed to parse message:", err);
          }
        }
      }
    });

    socket.on("close", () => {
      this.clients.delete(clientId);
      console.error(`Client ${clientId} disconnected`);
    });

    socket.on("error", (err) => {
      console.error(`Client ${clientId} error:`, err);
      this.clients.delete(clientId);
    });
  }

  private handleMessage(
    clientId: string,
    socket: net.Socket,
    msg: {
      type: string;
      role?: string;
      clientId?: string;
      message?: Message;
    }
  ): void {
    if (msg.type === "register") {
      // Client registration
      const role = msg.role || "unknown";
      const actualClientId = msg.clientId || clientId;
      this.clients.set(actualClientId, {
        id: actualClientId,
        socket,
        role,
      });
      console.error(
        `Client ${actualClientId} registered with role: ${role}`
      );

      // Send acknowledgment
      this.sendToSocket(socket, {
        type: "registered",
        clientId: actualClientId,
      });
    } else if (msg.type === "message" && msg.message) {
      // Incoming message from client
      this.handleIncomingMessage(msg.message);
    }
  }

  private handleIncomingMessage(message: Message): void {
    // Notify registered handlers
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (err) {
        console.error("Message handler error:", err);
      }
    }

    // Forward to target client if connected
    this.forwardMessage(message);
  }

  // Forward message to target client
  private forwardMessage(message: Message): void {
    // Find target client
    // For messages to "orche", we don't need to forward (orche processes them)
    // For messages to workers/planner/reviewer, forward to the specific client
    const targetClient = this.clients.get(message.to);

    if (targetClient) {
      this.sendToSocket(targetClient.socket, {
        type: "message",
        message,
      });
    } else if (
      message.to !== "orche" &&
      message.to !== "planner" &&
      message.to !== "reviewer"
    ) {
      // Target not connected, try to find by role prefix
      for (const [, client] of this.clients) {
        if (client.id === message.to || client.role === message.to) {
          this.sendToSocket(client.socket, {
            type: "message",
            message,
          });
          return;
        }
      }
      console.error(`Target ${message.to} not connected`);
    } else {
      // Broadcast to specific role clients (planner, reviewer)
      for (const [, client] of this.clients) {
        if (client.role === message.to) {
          this.sendToSocket(client.socket, {
            type: "message",
            message,
          });
        }
      }
    }
  }

  // Send message to a specific socket
  private sendToSocket(socket: net.Socket, data: unknown): void {
    try {
      socket.write(JSON.stringify(data) + "\n");
    } catch (err) {
      console.error("Failed to send to socket:", err);
    }
  }

  // Broadcast message to specific target
  broadcastMessage(message: Message): void {
    this.forwardMessage(message);
  }

  // Register message handler
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  // Get connected clients
  getConnectedClients(): { id: string; role: string }[] {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.id,
      role: c.role,
    }));
  }

  // Stop server
  stop(): Promise<void> {
    const socketPath = getSocketPath();

    return new Promise((resolve) => {
      if (this.server) {
        // Close all client connections
        for (const [, client] of this.clients) {
          client.socket.destroy();
        }
        this.clients.clear();

        this.server.close(() => {
          // Remove socket file
          if (fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// Socket Client (runs on worker/planner/reviewer)
export class SocketClient {
  private socket: net.Socket | null = null;
  private messageHandlers: MessageHandler[] = [];
  private clientId: string;
  private role: string;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private buffer = "";

  constructor(clientId: string, role: string) {
    this.clientId = clientId;
    this.role = role;
  }

  async connect(): Promise<void> {
    const socketPath = getSocketPath();

    return new Promise((resolve, reject) => {
      // Check if socket file exists
      if (!fs.existsSync(socketPath)) {
        console.error(`Socket file ${socketPath} does not exist, will retry...`);
        this.scheduleReconnect();
        resolve(); // Don't reject, just continue without connection
        return;
      }

      this.socket = net.createConnection(socketPath, () => {
        console.error(`Connected to socket server at ${socketPath}`);
        this.connected = true;

        // Register with server
        this.send({
          type: "register",
          role: this.role,
          clientId: this.clientId,
        });

        resolve();
      });

      this.socket.on("data", (data) => {
        this.buffer += data.toString();

        // Process complete messages
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const msg = JSON.parse(line);
              this.handleMessage(msg);
            } catch (err) {
              console.error("Failed to parse message:", err);
            }
          }
        }
      });

      this.socket.on("close", () => {
        console.error("Disconnected from socket server");
        this.connected = false;
        this.scheduleReconnect();
      });

      this.socket.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          console.error("Socket server not available, will retry...");
          this.scheduleReconnect();
          resolve(); // Don't reject for ENOENT
        } else {
          console.error("Socket client error:", err);
          this.connected = false;
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connected) {
        console.error("Attempting to reconnect...");
        this.connect().catch(() => {});
      }
    }, 5000);
  }

  private handleMessage(msg: { type: string; message?: Message }): void {
    if (msg.type === "registered") {
      console.error("Successfully registered with socket server");
    } else if (msg.type === "message" && msg.message) {
      // Notify handlers
      for (const handler of this.messageHandlers) {
        try {
          handler(msg.message);
        } catch (err) {
          console.error("Message handler error:", err);
        }
      }
    }
  }

  // Send raw data to server
  private send(data: unknown): void {
    if (this.socket && this.connected) {
      try {
        this.socket.write(JSON.stringify(data) + "\n");
      } catch (err) {
        console.error("Failed to send:", err);
      }
    }
  }

  // Send a message through the socket
  sendMessage(message: Message): void {
    this.send({
      type: "message",
      message,
    });
  }

  // Register message handler
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  // Check if connected
  isConnected(): boolean {
    return this.connected;
  }

  // Disconnect
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }
}

// Singleton instances
let socketServer: SocketServer | null = null;
let socketClient: SocketClient | null = null;

// Get or create socket server (for orche)
export function getSocketServer(): SocketServer {
  if (!socketServer) {
    socketServer = new SocketServer();
  }
  return socketServer;
}

// Get or create socket client (for worker/planner/reviewer)
export function getSocketClient(clientId: string, role: string): SocketClient {
  if (!socketClient) {
    socketClient = new SocketClient(clientId, role);
  }
  return socketClient;
}

// Helper function to notify via socket (used by db.ts)
export function notifyViaSocket(message: Message): void {
  if (socketServer) {
    socketServer.broadcastMessage(message);
  } else if (socketClient && socketClient.isConnected()) {
    socketClient.sendMessage(message);
  }
}

// Cleanup function
export function cleanupSocket(): Promise<void> {
  const promises: Promise<void>[] = [];

  if (socketServer) {
    promises.push(socketServer.stop());
    socketServer = null;
  }

  if (socketClient) {
    socketClient.disconnect();
    socketClient = null;
  }

  return Promise.all(promises).then(() => {});
}
