/**
 * Tests for Socket Bridge — connection, messaging, backpressure, reconnection.
 * These tests don't require a real WebSocket server; they test the bridge's internal logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SocketBridge } from "../socket-bridge.js";

describe("SocketBridge", () => {
	describe("construction", () => {
		it("creates with default options", () => {
			const bridge = new SocketBridge();
			expect(bridge.isConnected()).toBe(false);
		});

		it("accepts custom options", () => {
			const bridge = new SocketBridge({
				port: 7000,
				maxPendingRequests: 50,
				requestTimeout: 5000,
			});
			expect(bridge.isConnected()).toBe(false);
		});
	});

	describe("connection state", () => {
		it("starts disconnected", () => {
			const bridge = new SocketBridge();
			expect(bridge.isConnected()).toBe(false);
		});

		it("returns false when connecting to nonexistent server", async () => {
			const bridge = new SocketBridge({ port: 59999, maxReconnectAttempts: 0 });
			const result = await bridge.connect();
			expect(result).toBe(false);
			bridge.disconnect();
		});
	});

	describe("call without connection", () => {
		it("queues messages when not connected", async () => {
			const bridge = new SocketBridge({ maxReconnectAttempts: 0, requestTimeout: 100 });
			// The call should queue and eventually timeout since we never connect
			await expect(bridge.call("test.method")).rejects.toThrow("timed out");
			bridge.disconnect();
		});
	});

	describe("backpressure", () => {
		it("rejects when message queue is full", async () => {
			const bridge = new SocketBridge({
				maxPendingRequests: 2,
				maxReconnectAttempts: 0,
				requestTimeout: 50,
			});

			// Fill the queue
			const p1 = bridge.call("method1").catch(() => {});
			const p2 = bridge.call("method2").catch(() => {});

			// Third should fail immediately
			await expect(bridge.call("method3")).rejects.toThrow("Message queue full");

			bridge.disconnect();
		});
	});

	describe("disconnect", () => {
		it("clears all pending requests on disconnect", async () => {
			const bridge = new SocketBridge({ maxReconnectAttempts: 0, requestTimeout: 5000 });

			const promise = bridge.call("test.method").catch((e: Error) => e.message);

			// Disconnect should reject the pending request
			bridge.disconnect();

			const result = await promise;
			expect(result).toContain("Disconnected");
		});
	});

	describe("getStats", () => {
		it("reports correct stats", () => {
			const bridge = new SocketBridge({ maxReconnectAttempts: 0 });
			const stats = bridge.getStats();
			expect(stats.connected).toBe(false);
			expect(stats.pendingRequests).toBe(0);
			expect(stats.queuedMessages).toBe(0);
			expect(stats.reconnectAttempts).toBe(0);
		});
	});

	describe("callbacks", () => {
		it("accepts connect/disconnect callbacks without error", () => {
			const bridge = new SocketBridge();
			bridge.onConnect(() => {});
			bridge.onDisconnect(() => {});
			bridge.disconnect();
		});
	});
});
