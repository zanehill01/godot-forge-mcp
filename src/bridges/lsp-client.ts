/**
 * LSP Client — Connects to Godot's built-in GDScript Language Server.
 *
 * Godot runs an LSP server when the editor is open (default port 6005).
 * Can also be started headlessly: `godot --headless --lsp-port 6005`
 *
 * Protocol: JSON-RPC 2.0 over TCP with Content-Length headers.
 */

import { Socket } from "node:net";

export interface LspClientOptions {
	host: string;
	port: number;
	connectTimeout: number;
	requestTimeout: number;
}

const DEFAULT_OPTIONS: LspClientOptions = {
	host: "127.0.0.1",
	port: 6005,
	connectTimeout: 5000,
	requestTimeout: 10000,
};

interface LspPendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
	timer: NodeJS.Timeout;
}

export interface LspDiagnostic {
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	severity: number; // 1=Error, 2=Warning, 3=Info, 4=Hint
	message: string;
	source?: string;
}

export interface LspSymbol {
	name: string;
	kind: number;
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	children?: LspSymbol[];
}

export interface LspCompletionItem {
	label: string;
	kind: number;
	detail?: string;
	documentation?: string | { kind: string; value: string };
	insertText?: string;
}

export class LspClient {
	private socket: Socket | null = null;
	private options: LspClientOptions;
	private connected = false;
	private requestId = 0;
	private pendingRequests = new Map<number, LspPendingRequest>();
	private buffer = "";
	private initialized = false;
	private diagnostics = new Map<string, LspDiagnostic[]>();

	constructor(options?: Partial<LspClientOptions>) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
	}

	/**
	 * Connect to the Godot LSP server and perform initialization handshake.
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

				// Handle incoming data
				this.socket!.on("data", (data: Buffer) => {
					this.handleData(data.toString());
				});

				// LSP initialize handshake
				try {
					await this.request("initialize", {
						processId: process.pid,
						capabilities: {
							textDocument: {
								synchronization: { didSave: true, didOpen: true, didClose: true },
								completion: { completionItem: { snippetSupport: false } },
								hover: {},
								signatureHelp: {},
								definition: {},
								references: {},
								documentSymbol: {},
								publishDiagnostics: {},
							},
						},
						rootUri: null,
					});
					await this.notify("initialized", {});
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
				this.rejectAllPending("LSP connection closed");
			});

			this.socket.connect(this.options.port, this.options.host);
		});
	}

	/**
	 * Disconnect from the LSP server.
	 */
	disconnect(): void {
		if (this.socket) {
			try { this.request("shutdown", {}).catch(() => {}); } catch { /* ignore */ }
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

	/**
	 * Get diagnostics (errors/warnings) for a file.
	 */
	getDiagnostics(uri: string): LspDiagnostic[] {
		return this.diagnostics.get(uri) ?? [];
	}

	/**
	 * Get all diagnostics across all open files.
	 */
	getAllDiagnostics(): Map<string, LspDiagnostic[]> {
		return new Map(this.diagnostics);
	}

	/**
	 * Open a text document in the LSP (triggers diagnostics).
	 */
	async openDocument(uri: string, content: string): Promise<void> {
		await this.notify("textDocument/didOpen", {
			textDocument: { uri, languageId: "gdscript", version: 1, text: content },
		});
	}

	/**
	 * Close a text document.
	 */
	async closeDocument(uri: string): Promise<void> {
		await this.notify("textDocument/didClose", {
			textDocument: { uri },
		});
	}

	/**
	 * Get document symbols (classes, methods, variables, signals).
	 */
	async getDocumentSymbols(uri: string): Promise<LspSymbol[]> {
		const result = await this.request("textDocument/documentSymbol", {
			textDocument: { uri },
		});
		return (result as LspSymbol[]) ?? [];
	}

	/**
	 * Get completions at a position.
	 */
	async getCompletions(uri: string, line: number, character: number): Promise<LspCompletionItem[]> {
		const result = await this.request("textDocument/completion", {
			textDocument: { uri },
			position: { line, character },
		});
		if (Array.isArray(result)) return result;
		if (result && typeof result === "object" && "items" in result) return (result as { items: LspCompletionItem[] }).items;
		return [];
	}

	/**
	 * Get hover info (type, docs) for a symbol at a position.
	 */
	async getHoverInfo(uri: string, line: number, character: number): Promise<{ contents: string } | null> {
		const result = await this.request("textDocument/hover", {
			textDocument: { uri },
			position: { line, character },
		});
		if (!result) return null;
		const r = result as { contents?: unknown };
		if (typeof r.contents === "string") return { contents: r.contents };
		if (typeof r.contents === "object" && r.contents !== null && "value" in r.contents) {
			return { contents: (r.contents as { value: string }).value };
		}
		return { contents: JSON.stringify(r.contents) };
	}

	/**
	 * Go to definition of a symbol.
	 */
	async getDefinition(uri: string, line: number, character: number): Promise<Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>> {
		const result = await this.request("textDocument/definition", {
			textDocument: { uri },
			position: { line, character },
		});
		if (!result) return [];
		if (Array.isArray(result)) return result;
		return [result as { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }];
	}

	/**
	 * Find all references to a symbol.
	 */
	async getReferences(uri: string, line: number, character: number): Promise<Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>> {
		const result = await this.request("textDocument/references", {
			textDocument: { uri },
			position: { line, character },
			context: { includeDeclaration: true },
		});
		return (result as Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>) ?? [];
	}

	// ── Protocol Layer ──────────────────────────────────────────

	private async request(method: string, params: unknown): Promise<unknown> {
		if (!this.connected || !this.socket) {
			throw new Error("Not connected to LSP server");
		}

		return new Promise((resolve, reject) => {
			const id = ++this.requestId;
			const timer = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`LSP request ${method} timed out after ${this.options.requestTimeout}ms`));
			}, this.options.requestTimeout);

			this.pendingRequests.set(id, { resolve, reject, timer });
			this.send({ jsonrpc: "2.0", id, method, params });
		});
	}

	private async notify(method: string, params: unknown): Promise<void> {
		if (!this.connected || !this.socket) {
			throw new Error("Not connected to LSP server");
		}
		this.send({ jsonrpc: "2.0", method, params });
	}

	private send(msg: object): void {
		const body = JSON.stringify(msg);
		const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
		this.socket!.write(header + body);
	}

	private handleData(data: string): void {
		this.buffer += data;

		while (true) {
			// Parse Content-Length header
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
			} catch {
				// Malformed JSON, skip
			}
		}
	}

	private handleMessage(msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message: string } }): void {
		// Response to a request
		if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
			const req = this.pendingRequests.get(msg.id)!;
			clearTimeout(req.timer);
			this.pendingRequests.delete(msg.id);
			if (msg.error) {
				req.reject(new Error(`LSP error: ${msg.error.message}`));
			} else {
				req.resolve(msg.result);
			}
			return;
		}

		// Server notification
		if (msg.method === "textDocument/publishDiagnostics" && msg.params) {
			const p = msg.params as { uri: string; diagnostics: LspDiagnostic[] };
			this.diagnostics.set(p.uri, p.diagnostics);
		}
	}

	private rejectAllPending(reason: string): void {
		for (const [id, req] of this.pendingRequests) {
			clearTimeout(req.timer);
			req.reject(new Error(reason));
		}
		this.pendingRequests.clear();
	}
}
