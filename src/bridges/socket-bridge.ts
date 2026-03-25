/**
 * Socket Bridge — WebSocket client connecting to the Godot editor plugin.
 *
 * The editor plugin runs a WebSocket server (JSON-RPC 2.0).
 * This bridge connects to it and provides a clean async API.
 */

import { WebSocket } from "ws";

export interface SocketBridgeOptions {
	host: string;
	port: number;
	reconnectInterval: number;
	maxReconnectAttempts: number;
}

const DEFAULT_OPTIONS: SocketBridgeOptions = {
	host: "127.0.0.1",
	port: 6100,
	reconnectInterval: 3000,
	maxReconnectAttempts: 10,
};

export class SocketBridge {
	private ws: WebSocket | null = null;
	private options: SocketBridgeOptions;
	private connected = false;
	private reconnectAttempts = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private requestId = 0;
	private pendingRequests = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }
	>();
	private onConnectCallback: (() => void) | null = null;
	private onDisconnectCallback: (() => void) | null = null;

	constructor(options?: Partial<SocketBridgeOptions>) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
	}

	/**
	 * Attempt to connect to the editor plugin.
	 */
	async connect(): Promise<boolean> {
		return new Promise((resolve) => {
			const url = `ws://${this.options.host}:${this.options.port}`;

			try {
				this.ws = new WebSocket(url);

				this.ws.on("open", () => {
					this.connected = true;
					this.reconnectAttempts = 0;
					this.onConnectCallback?.();
					resolve(true);
				});

				this.ws.on("message", (data: Buffer) => {
					this.handleMessage(data.toString());
				});

				this.ws.on("close", () => {
					this.connected = false;
					this.onDisconnectCallback?.();
					this.scheduleReconnect();
				});

				this.ws.on("error", () => {
					if (!this.connected) {
						resolve(false);
					}
				});
			} catch {
				resolve(false);
			}
		});
	}

	/**
	 * Disconnect from the editor plugin.
	 */
	disconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.connected = false;
		// Reject all pending requests
		for (const [, req] of this.pendingRequests) {
			clearTimeout(req.timer);
			req.reject(new Error("Disconnected"));
		}
		this.pendingRequests.clear();
	}

	/**
	 * Check if connected to the editor plugin.
	 */
	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Set connection state callbacks.
	 */
	onConnect(cb: () => void): void {
		this.onConnectCallback = cb;
	}

	onDisconnect(cb: () => void): void {
		this.onDisconnectCallback = cb;
	}

	/**
	 * Call a method on the editor plugin via JSON-RPC.
	 * Method format: "domain.action" (e.g., "scene.get_tree_data")
	 */
	async call(method: string, params: Record<string, unknown> = {}, timeout = 10000): Promise<unknown> {
		if (!this.connected || !this.ws) {
			throw new Error("Not connected to editor plugin");
		}

		return new Promise((resolve, reject) => {
			const id = ++this.requestId;

			const timer = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Request ${method} timed out after ${timeout}ms`));
			}, timeout);

			this.pendingRequests.set(id, { resolve, reject, timer });

			const request = JSON.stringify({
				jsonrpc: "2.0",
				id,
				method,
				params,
			});

			this.ws!.send(request);
		});
	}

	// ── Convenience Methods ────────────────────────────────────

	async getSceneTree(): Promise<unknown> {
		return this.call("scene.get_tree_data");
	}

	async getSelectedNodes(): Promise<unknown> {
		return this.call("scene.get_selected_nodes");
	}

	async getNodeProperties(path: string): Promise<unknown> {
		return this.call("scene.get_node_properties", { path });
	}

	async setNodeProperty(path: string, property: string, value: unknown): Promise<unknown> {
		return this.call("scene.set_node_property", { path, property, value });
	}

	async screenshot(): Promise<unknown> {
		return this.call("debug.screenshot");
	}

	async getPerformance(): Promise<unknown> {
		return this.call("debug.get_performance");
	}

	async getEditorState(): Promise<unknown> {
		return this.call("editor.get_state");
	}

	async injectInput(type: string, params: Record<string, unknown>): Promise<unknown> {
		return this.call(`input.inject_${type}`, params);
	}

	// ── Private ────────────────────────────────────────────────

	private handleMessage(text: string): void {
		try {
			const msg = JSON.parse(text);

			if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
				const req = this.pendingRequests.get(msg.id)!;
				clearTimeout(req.timer);
				this.pendingRequests.delete(msg.id);

				if (msg.error) {
					req.reject(new Error(msg.error.message ?? "RPC error"));
				} else {
					req.resolve(msg.result);
				}
			}
		} catch {
			// Ignore malformed messages
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
			return;
		}

		this.reconnectTimer = setTimeout(async () => {
			this.reconnectAttempts++;
			await this.connect();
		}, this.options.reconnectInterval);
	}
}
