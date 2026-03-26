/**
 * DAP Client — Connects to Godot's Debug Adapter Protocol server.
 *
 * Godot supports DAP when running with `--remote-debug` or via the editor.
 * Default port: 6006 (configurable in Editor Settings > Network > Debug Adapter).
 *
 * Protocol: DAP messages over TCP with Content-Length headers.
 */

import { Socket } from "node:net";

export interface DapClientOptions {
	host: string;
	port: number;
	connectTimeout: number;
	requestTimeout: number;
}

const DEFAULT_OPTIONS: DapClientOptions = {
	host: "127.0.0.1",
	port: 6006,
	connectTimeout: 5000,
	requestTimeout: 10000,
};

interface DapPendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	timer: NodeJS.Timeout;
}

export interface DapBreakpoint {
	id?: number;
	verified: boolean;
	line: number;
	source?: { path: string };
}

export interface DapStackFrame {
	id: number;
	name: string;
	source?: { path: string; name?: string };
	line: number;
	column: number;
}

export interface DapVariable {
	name: string;
	value: string;
	type?: string;
	variablesReference: number;
}

export interface DapThread {
	id: number;
	name: string;
}

export class DapClient {
	private socket: Socket | null = null;
	private options: DapClientOptions;
	private connected = false;
	private initialized = false;
	private sequenceId = 0;
	private pendingRequests = new Map<number, DapPendingRequest>();
	private buffer = "";

	// State
	private threads: DapThread[] = [];
	private stoppedThreadId: number | null = null;
	private onStoppedCallback: ((reason: string, threadId: number) => void) | null = null;
	private onOutputCallback: ((output: string, category: string) => void) | null = null;

	constructor(options?: Partial<DapClientOptions>) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
	}

	/**
	 * Connect to the Godot DAP server and perform initialization.
	 */
	async connect(): Promise<boolean> {
		if (this.connected) return true;

		return new Promise((resolve) => {
			let settled = false;
			const settle = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };

			const timeout = setTimeout(() => {
				this.socket?.destroy();
				settle(false);
			}, this.options.connectTimeout);

			this.socket = new Socket();

			this.socket.on("connect", async () => {
				clearTimeout(timeout);
				this.connected = true;

				this.socket!.on("data", (data: Buffer) => {
					this.handleData(data.toString());
				});

				try {
					// DAP initialize
					await this.request("initialize", {
						clientID: "godot-forge-mcp",
						clientName: "Godot Forge MCP",
						adapterID: "godot",
						linesStartAt1: true,
						columnsStartAt1: true,
						pathFormat: "path",
						supportsVariableType: true,
						supportsVariablePaging: false,
					});

					this.initialized = true;
					settle(true);
				} catch {
					settle(false);
				}
			});

			this.socket.on("error", () => {
				clearTimeout(timeout);
				settle(false);
			});

			this.socket.on("close", () => {
				this.connected = false;
				this.initialized = false;
				this.rejectAllPending("DAP connection closed");
			});

			this.socket.connect(this.options.port, this.options.host);
		});
	}

	/**
	 * Attach to a running Godot debug session.
	 */
	async attach(): Promise<boolean> {
		try {
			await this.request("attach", {});
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Launch a Godot project in debug mode.
	 */
	async launch(projectPath: string, scene?: string): Promise<boolean> {
		try {
			const args: Record<string, unknown> = {
				project: projectPath,
				debugMode: "editor",
			};
			if (scene) args.scene = scene;
			await this.request("launch", args);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Disconnect from the DAP server.
	 */
	disconnect(): void {
		if (this.socket) {
			try { this.request("disconnect", { terminateDebuggee: false }).catch(() => {}); } catch { /* ignore */ }
			this.socket.destroy();
			this.socket = null;
		}
		this.connected = false;
		this.initialized = false;
		this.rejectAllPending("Disconnected");
	}

	isConnected(): boolean {
		return this.connected && this.initialized;
	}

	// ── Breakpoints ─────────────────────────────────────────────

	/**
	 * Set breakpoints on a source file. Replaces all existing breakpoints on that file.
	 */
	async setBreakpoints(filePath: string, lines: number[]): Promise<DapBreakpoint[]> {
		const result = await this.request("setBreakpoints", {
			source: { path: filePath },
			breakpoints: lines.map((line) => ({ line })),
		}) as { breakpoints: DapBreakpoint[] };
		return result.breakpoints ?? [];
	}

	/**
	 * Clear all breakpoints on a file.
	 */
	async clearBreakpoints(filePath: string): Promise<void> {
		await this.request("setBreakpoints", {
			source: { path: filePath },
			breakpoints: [],
		});
	}

	// ── Execution Control ───────────────────────────────────────

	/**
	 * Continue execution.
	 */
	async continue(threadId?: number): Promise<void> {
		await this.request("continue", { threadId: threadId ?? this.stoppedThreadId ?? 1 });
	}

	/**
	 * Step over (next line).
	 */
	async stepOver(threadId?: number): Promise<void> {
		await this.request("next", { threadId: threadId ?? this.stoppedThreadId ?? 1 });
	}

	/**
	 * Step into a function.
	 */
	async stepIn(threadId?: number): Promise<void> {
		await this.request("stepIn", { threadId: threadId ?? this.stoppedThreadId ?? 1 });
	}

	/**
	 * Step out of the current function.
	 */
	async stepOut(threadId?: number): Promise<void> {
		await this.request("stepOut", { threadId: threadId ?? this.stoppedThreadId ?? 1 });
	}

	/**
	 * Pause execution.
	 */
	async pause(threadId?: number): Promise<void> {
		await this.request("pause", { threadId: threadId ?? 1 });
	}

	// ── Inspection ──────────────────────────────────────────────

	/**
	 * Get all threads.
	 */
	async getThreads(): Promise<DapThread[]> {
		const result = await this.request("threads", {}) as { threads: DapThread[] };
		this.threads = result.threads ?? [];
		return this.threads;
	}

	/**
	 * Get the current call stack for a thread.
	 */
	async getStackTrace(threadId?: number, startFrame?: number, levels?: number): Promise<DapStackFrame[]> {
		const result = await this.request("stackTrace", {
			threadId: threadId ?? this.stoppedThreadId ?? 1,
			startFrame: startFrame ?? 0,
			levels: levels ?? 20,
		}) as { stackFrames: DapStackFrame[] };
		return result.stackFrames ?? [];
	}

	/**
	 * Get scopes for a stack frame (locals, globals, etc.).
	 */
	async getScopes(frameId: number): Promise<Array<{ name: string; variablesReference: number; expensive: boolean }>> {
		const result = await this.request("scopes", { frameId }) as { scopes: Array<{ name: string; variablesReference: number; expensive: boolean }> };
		return result.scopes ?? [];
	}

	/**
	 * Get variables for a scope or object.
	 */
	async getVariables(variablesReference: number): Promise<DapVariable[]> {
		const result = await this.request("variables", { variablesReference }) as { variables: DapVariable[] };
		return result.variables ?? [];
	}

	/**
	 * Evaluate an expression in the current debug context.
	 */
	async evaluate(expression: string, frameId?: number, context?: string): Promise<{ result: string; type?: string; variablesReference: number }> {
		const result = await this.request("evaluate", {
			expression,
			frameId,
			context: context ?? "repl",
		});
		return result as { result: string; type?: string; variablesReference: number };
	}

	// ── Event Callbacks ─────────────────────────────────────────

	onStopped(cb: (reason: string, threadId: number) => void): void {
		this.onStoppedCallback = cb;
	}

	onOutput(cb: (output: string, category: string) => void): void {
		this.onOutputCallback = cb;
	}

	getStoppedThreadId(): number | null {
		return this.stoppedThreadId;
	}

	// ── Protocol Layer ──────────────────────────────────────────

	private async request(command: string, args: unknown): Promise<unknown> {
		if (!this.connected || !this.socket) {
			throw new Error("Not connected to DAP server");
		}

		return new Promise((resolve, reject) => {
			const seq = ++this.sequenceId;
			const timer = setTimeout(() => {
				this.pendingRequests.delete(seq);
				reject(new Error(`DAP request ${command} timed out after ${this.options.requestTimeout}ms`));
			}, this.options.requestTimeout);

			this.pendingRequests.set(seq, { resolve, reject, timer });

			this.send({
				seq,
				type: "request",
				command,
				arguments: args,
			});
		});
	}

	private send(msg: object): void {
		const body = JSON.stringify(msg);
		const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
		this.socket!.write(header + body);
	}

	private handleData(data: string): void {
		this.buffer += data;

		while (true) {
			const headerEnd = this.buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) break;

			const header = this.buffer.slice(0, headerEnd);
			const match = header.match(/Content-Length:\s*(\d+)/i);
			if (!match) {
				this.buffer = this.buffer.slice(headerEnd + 4);
				continue;
			}

			const contentLength = parseInt(match[1], 10);
			const bodyStart = headerEnd + 4;
			if (this.buffer.length < bodyStart + contentLength) break;

			const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
			this.buffer = this.buffer.slice(bodyStart + contentLength);

			try {
				const msg = JSON.parse(body);
				this.handleMessage(msg);
			} catch { /* skip malformed */ }
		}
	}

	private handleMessage(msg: { type: string; request_seq?: number; command?: string; body?: unknown; event?: string; success?: boolean; message?: string }): void {
		// Response
		if (msg.type === "response" && msg.request_seq !== undefined) {
			const req = this.pendingRequests.get(msg.request_seq);
			if (req) {
				clearTimeout(req.timer);
				this.pendingRequests.delete(msg.request_seq);
				if (msg.success === false) {
					req.reject(new Error(`DAP error: ${msg.message ?? msg.command}`));
				} else {
					req.resolve(msg.body);
				}
			}
			return;
		}

		// Event
		if (msg.type === "event") {
			switch (msg.event) {
				case "stopped": {
					const body = msg.body as { reason: string; threadId: number } | undefined;
					this.stoppedThreadId = body?.threadId ?? null;
					this.onStoppedCallback?.(body?.reason ?? "unknown", body?.threadId ?? 0);
					break;
				}
				case "output": {
					const body = msg.body as { output: string; category?: string } | undefined;
					this.onOutputCallback?.(body?.output ?? "", body?.category ?? "console");
					break;
				}
				case "thread": {
					// Thread started/exited
					break;
				}
				case "terminated": {
					this.stoppedThreadId = null;
					break;
				}
			}
		}
	}

	private rejectAllPending(reason: string): void {
		for (const [, req] of this.pendingRequests) {
			clearTimeout(req.timer);
			req.reject(new Error(reason));
		}
		this.pendingRequests.clear();
	}
}
