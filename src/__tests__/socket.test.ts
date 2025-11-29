import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SocketServer, SocketClient } from "../lib/socket.js";
import type { Message, MessageType } from "../types.js";
import * as fs from "fs";

const TEST_SOCKET_PATH = "/tmp/aio-test-socket.sock";

// Store original env for restoration
const originalEnv = process.env.SOCKET_PATH;

describe("Socket Server and Client", () => {
  beforeEach(() => {
    process.env.SOCKET_PATH = TEST_SOCKET_PATH;
    // Cleanup any existing socket file
    if (fs.existsSync(TEST_SOCKET_PATH)) {
      fs.unlinkSync(TEST_SOCKET_PATH);
    }
  });

  afterEach(() => {
    process.env.SOCKET_PATH = originalEnv;
  });

  test("SocketServer should start and stop", async () => {
    const server = new SocketServer();
    await server.start();

    // Socket file should exist
    expect(fs.existsSync(TEST_SOCKET_PATH)).toBe(true);

    await server.stop();

    // Socket file should be removed
    expect(fs.existsSync(TEST_SOCKET_PATH)).toBe(false);
  });

  test("SocketClient should connect to server", async () => {
    const server = new SocketServer();
    await server.start();

    const client = new SocketClient("test-client", "worker");
    await client.connect();

    // Give time for connection to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(client.isConnected()).toBe(true);

    client.disconnect();
    await server.stop();
  });

  test("Server should receive messages from client", async () => {
    const server = new SocketServer();
    await server.start();

    const receivedMessages: Message[] = [];
    server.onMessage((msg) => {
      receivedMessages.push(msg);
    });

    const client = new SocketClient("test-worker", "worker");
    await client.connect();

    // Give time for connection to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Send a message
    const testMessage: Message = {
      id: "test-msg-1",
      timestamp: Date.now(),
      from: "test-worker",
      to: "orche",
      type: "PROGRESS" as MessageType,
      payload: {
        task_id: "task-1",
        status: "running",
        message: "Test message",
      },
    };

    client.sendMessage(testMessage);

    // Give time for message to be received
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0].id).toBe("test-msg-1");
    expect(receivedMessages[0].type).toBe("PROGRESS");

    client.disconnect();
    await server.stop();
  });

  test("Server should forward messages to target client", async () => {
    const server = new SocketServer();
    await server.start();

    const worker1 = new SocketClient("worker-1", "worker");
    const worker2 = new SocketClient("worker-2", "worker");

    await worker1.connect();
    await worker2.connect();

    // Give time for connections to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    const receivedByWorker1: Message[] = [];
    const receivedByWorker2: Message[] = [];

    worker1.onMessage((msg) => { receivedByWorker1.push(msg); });
    worker2.onMessage((msg) => { receivedByWorker2.push(msg); });

    // Simulate orche sending a message to worker-1
    const messageToWorker1: Message = {
      id: "msg-to-w1",
      timestamp: Date.now(),
      from: "orche",
      to: "worker-1",
      type: "TASK_ASSIGN" as MessageType,
      payload: {
        task_id: "task-1",
        description: "Test task",
      },
    };

    server.broadcastMessage(messageToWorker1);

    // Give time for message to be received
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedByWorker1.length).toBe(1);
    expect(receivedByWorker1[0].id).toBe("msg-to-w1");
    expect(receivedByWorker2.length).toBe(0);

    worker1.disconnect();
    worker2.disconnect();
    await server.stop();
  });

  test("Server should track connected clients", async () => {
    const server = new SocketServer();
    await server.start();

    const client1 = new SocketClient("client-1", "worker");
    const client2 = new SocketClient("client-2", "planner");

    await client1.connect();
    await client2.connect();

    // Give time for connections to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    const clients = server.getConnectedClients();
    expect(clients.length).toBe(2);
    expect(clients.some((c) => c.id === "client-1" && c.role === "worker")).toBe(true);
    expect(clients.some((c) => c.id === "client-2" && c.role === "planner")).toBe(true);

    client1.disconnect();
    client2.disconnect();
    await server.stop();
  });

  test("Client should handle server not available gracefully", async () => {
    const client = new SocketClient("test-client", "worker");

    // Server not started, client should not crash
    await client.connect();

    expect(client.isConnected()).toBe(false);

    client.disconnect();
  });
});
