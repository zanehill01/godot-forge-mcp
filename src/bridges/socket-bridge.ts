/**
 * Socket Bridge — WebSocket client connecting to the Godot editor plugin.
 *
 * The editor plugin runs a WebSocket server (JSON-RPC 2.0).
 * This bridge connects to it and provides a clean async API with:
 * - Exponential backoff reconnection
 * - Backpressure control (max pending requests)
 * - Message queuing for offline scenarios
 * - Schema validation on incoming messages
 * - Graceful mid-call disconnect handling
 */

import { WebSocket } from "ws";

export interface SocketBridgeOptions {
	host: string;
	port: number;
	reconnectInterval: number;
	maxReconnectAttempts: number;
	maxPendingRequests: number;
	requestTimeout: number;
}

const DEFAULT_OPTIONS: SocketBridgeOptions = {
	host: "127.0.0.1",
	port: 6100,
	reconnectInterval: 1000,
	maxReconnectAttempts: 10,
	maxPendingRequests: 100,
	requestTimeout: 10000,
};

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	timer: NodeJS.Timeout;
	method: string;
}

interface JsonRpcResponse {
	jsonrpc: string;
	id: number;
	result?: unknown;
	error?: { code?: number; message: string; data?: unknown };
}

export class SocketBridge {
	private ws: WebSocket | null = null;
	private options: SocketBridgeOptions;
	private connected = false;
	private connecting = false;
	private reconnectAttempts = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private requestId = 0;
	private pendingRequests = new Map<number, PendingRequest>();
	private messageQueue: Array<{ method: string; params: Record<string, unknown>; resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];
	private onConnectCallback: (() => void) | null = null;
	private onDisconnectCallback: (() => void) | null = null;

	constructor(options?: Partial<SocketBridgeOptions>) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
	}

	/**
	 * Attempt to connect to the editor plugin.
	 */
	async connect(): Promise<boolean> {
		if (this.connected) return true;
		if (this.connecting) return false;

		this.connecting = true;

		return new Promise((resolve) => {
			const url = `ws://${this.options.host}:${this.options.port}`;
			let settled = false;

			const settle = (value: boolean) => {
				if (!settled) {
					settled = true;
					this.connecting = false;
					resolve(value);
				}
			};

			try {
				this.ws = new WebSocket(url);

				const connectionTimeout = setTimeout(() => {
					if (!settled) {
						this.ws?.terminate();
						settle(false);
					}
				}, 5000);

				this.ws.on("open", () => {
					clearTimeout(connectionTimeout);
					this.connected = true;
					this.reconnectAttempts = 0;
					this.onConnectCallback?.();
					this.flushMessageQueue();
					settle(true);
				});

				this.ws.on("message", (data: Buffer) => {
					this.handleMessage(data.toString());
				});

				this.ws.on("close", () => {
					clearTimeout(connectionTimeout);
					const wasConnected = this.connected;
					this.connected = false;
					if (wasConnected) {
						this.onDisconnectCallback?.();
						this.rejectAllPending("Connection closed");
					}
					this.scheduleReconnect();
					settle(false);
				});

				this.ws.on("error", (_err: Error) => {
					clearTimeout(connectionTimeout);
					settle(false);
				});
			} catch {
				settle(false);
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
		this.reconnectAttempts = this.options.maxReconnectAttempts; // prevent auto-reconnect
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.connected = false;
		this.connecting = false;
		this.rejectAllPending("Disconnected");
		this.rejectMessageQueue("Disconnected");
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
	 * If not connected, queues the message for delivery after reconnection.
	 */
	async call(method: string, params: Record<string, unknown> = {}, timeout?: number): Promise<unknown> {
		const effectiveTimeout = timeout ?? this.options.requestTimeout;

		if (!this.connected || !this.ws) {
			// Queue the message for when we reconnect
			if (this.messageQueue.length >= this.options.maxPendingRequests) {
				throw new Error(`Message queue full (${this.options.maxPendingRequests} pending). Cannot queue ${method}.`);
			}
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					const idx = this.messageQueue.findIndex((m) => m.method === method);
					if (idx !== -1) this.messageQueue.splice(idx, 1);
					reject(new Error(`Queued request ${method} timed out after ${effectiveTimeout}ms (not connected)`));
				}, effectiveTimeout);

				this.messageQueue.push({
					method,
					params,
					resolve: (v) => { clearTimeout(timer); resolve(v); },
					reject: (e) => { clearTimeout(timer); reject(e); },
				});
			});
		}

		// Backpressure check
		if (this.pendingRequests.size >= this.options.maxPendingRequests) {
			throw new Error(`Too many pending requests (${this.pendingRequests.size}). Wait for responses before sending more.`);
		}

		return new Promise((resolve, reject) => {
			const id = ++this.requestId;

			const timer = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Request ${method} (id=${id}) timed out after ${effectiveTimeout}ms`));
			}, effectiveTimeout);

			this.pendingRequests.set(id, { resolve, reject, timer, method });

			const request = JSON.stringify({
				jsonrpc: "2.0",
				id,
				method,
				params,
			});

			try {
				this.ws!.send(request);
			} catch (err) {
				clearTimeout(timer);
				this.pendingRequests.delete(id);
				reject(new Error(`Failed to send ${method}: ${err instanceof Error ? err.message : String(err)}`));
			}
		});
	}

	/**
	 * Get connection statistics for diagnostics.
	 */
	getStats(): { connected: boolean; pendingRequests: number; queuedMessages: number; reconnectAttempts: number } {
		return {
			connected: this.connected,
			pendingRequests: this.pendingRequests.size,
			queuedMessages: this.messageQueue.length,
			reconnectAttempts: this.reconnectAttempts,
		};
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
		return this.call("debug.screenshot", {}, 15000);
	}

	async getPerformance(): Promise<unknown> {
		return this.call("debug.get_performance");
	}

	async getRunningSceneTree(): Promise<unknown> {
		return this.call("debug.get_running_scene_tree");
	}

	async getEditorState(): Promise<unknown> {
		return this.call("editor.get_state");
	}

	async openScene(path: string): Promise<unknown> {
		return this.call("editor.open_scene", { path });
	}

	async openScript(path: string, line?: number): Promise<unknown> {
		return this.call("editor.open_script", { path, line });
	}

	async injectInput(type: string, params: Record<string, unknown>): Promise<unknown> {
		return this.call(`input.inject_${type}`, params);
	}

	// ── Private ────────────────────────────────────────────────

	private handleMessage(text: string): void {
		let msg: JsonRpcResponse;
		try {
			msg = JSON.parse(text);
		} catch {
			console.error("[godot-forge] Received malformed JSON from editor plugin");
			return;
		}

		// Validate JSON-RPC response structure
		if (typeof msg !== "object" || msg === null) {
			console.error("[godot-forge] Received non-object message from editor plugin");
			return;
		}

		if (msg.id === undefined || msg.id === null) {
			// Could be a notification — ignore silently
			return;
		}

		const id = typeof msg.id === "string" ? Number.parseInt(msg.id, 10) : msg.id;
		if (typeof id !== "number" || Number.isNaN(id)) {
			console.error(`[godot-forge] Received response with non-numeric id: ${msg.id}`);
			return;
		}

		const req = this.pendingRequests.get(id);
		if (!req) {
			// Response for an already-timed-out or unknown request
			return;
		}

		clearTimeout(req.timer);
		this.pendingRequests.delete(id);

		if (msg.error) {
			const errMsg = typeof msg.error === "object" && msg.error.message
				? msg.error.message
				: JSON.stringify(msg.error);
			req.reject(new Error(`RPC error in ${req.method}: ${errMsg}`));
		} else {
			req.resolve(msg.result);
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
			this.rejectMessageQueue("Max reconnection attempts reached");
			return;
		}

		// Exponential backoff with jitter: base * 2^attempt + random jitter
		const base = this.options.reconnectInterval;
		const delay = Math.min(base * Math.pow(2, this.reconnectAttempts), 30000);
		const jitter = Math.random() * delay * 0.1;

		this.reconnectTimer = setTimeout(async () => {
			this.reconnectAttempts++;
			await this.connect();
		}, delay + jitter);
	}

	private flushMessageQueue(): void {
		const queue = [...this.messageQueue];
		this.messageQueue = [];
		for (const msg of queue) {
			this.call(msg.method, msg.params)
				.then(msg.resolve)
				.catch(msg.reject);
		}
	}

	private rejectAllPending(reason: string): void {
		for (const [id, req] of this.pendingRequests) {
			clearTimeout(req.timer);
			req.reject(new Error(`${reason} (pending: ${req.method}, id=${id})`));
		}
		this.pendingRequests.clear();
	}

	private rejectMessageQueue(reason: string): void {
		const queue = [...this.messageQueue];
		this.messageQueue = [];
		for (const msg of queue) {
			msg.reject(new Error(`${reason} (queued: ${msg.method})`));
		}
	}
}
