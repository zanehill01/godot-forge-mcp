/**
 * Intelligence Tool Group — LSP + DAP integration for smart development.
 *
 * LSP: Connects to Godot's built-in GDScript Language Server for real-time
 * diagnostics, completions, hover info, symbol lookup, and go-to-definition.
 *
 * DAP: Connects to Godot's Debug Adapter Protocol for breakpoints, stepping,
 * stack traces, variable inspection, and expression evaluation.
 *
 * These tools require the Godot editor to be running (LSP/DAP are hosted by the editor).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { LspClient } from "../../bridges/lsp-client.js";
import { DapClient } from "../../bridges/dap-client.js";
import { resToAbsolute, absoluteToRes } from "../../utils/path.js";
import type { ToolContext } from "../registry.js";

let lspClient: LspClient | null = null;
let dapClient: DapClient | null = null;

function getLsp(port?: number): LspClient {
	if (!lspClient) {
		lspClient = new LspClient({ port: port ?? 6005 });
	}
	return lspClient;
}

function getDap(port?: number): DapClient {
	if (!dapClient) {
		dapClient = new DapClient({ port: port ?? 6006 });
	}
	return dapClient;
}

function resToFileUri(resPath: string, projectRoot: string): string {
	const abs = resToAbsolute(resPath, projectRoot);
	return `file:///${abs.replace(/\\/g, "/").replace(/^\//, "")}`;
}

export function registerIntelligenceTools(server: McpServer, ctx: ToolContext): void {

	// ═══════════════════════════════════════════════════════════
	// LSP: Connect
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_lsp_connect", "Connect to Godot's GDScript Language Server for real-time code intelligence. The Godot editor must be running. Use `godot --headless --lsp-port 6005` for headless mode.", {
		port: z.number().optional().default(6005).describe("LSP server port (default 6005)"),
	}, async ({ port }) => {
		try {
			const lsp = getLsp(port);
			if (lsp.isConnected()) {
				return { content: [{ type: "text", text: "Already connected to GDScript LSP." }] };
			}
			const success = await lsp.connect();
			if (!success) {
				return { content: [{ type: "text", text: `Failed to connect to GDScript LSP on port ${port}. Is the Godot editor running?` }], isError: true };
			}
			return { content: [{ type: "text", text: `Connected to GDScript LSP on port ${port}. Code intelligence is now active.` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// LSP: Diagnostics
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_lsp_diagnostics", "Get GDScript errors and warnings for a file (or all open files) from the language server. Validates code WITHOUT running the project.", {
		scriptPath: z.string().optional().describe("Script to check (res:// path). Omit to get all diagnostics."),
	}, async ({ scriptPath }) => {
		try {
			const lsp = getLsp();
			if (!lsp.isConnected()) {
				return { content: [{ type: "text", text: "LSP not connected. Call godot_lsp_connect first." }], isError: true };
			}

			if (scriptPath) {
				const uri = resToFileUri(scriptPath, ctx.projectRoot);
				// Open the document to trigger diagnostics
				const absPath = resToAbsolute(scriptPath, ctx.projectRoot);
				const content = readFileSync(absPath, "utf-8");
				await lsp.openDocument(uri, content);

				// Wait a moment for diagnostics to arrive
				await new Promise((r) => setTimeout(r, 500));

				const diagnostics = lsp.getDiagnostics(uri);
				const severityMap: Record<number, string> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							script: scriptPath,
							diagnosticCount: diagnostics.length,
							diagnostics: diagnostics.map((d) => ({
								severity: severityMap[d.severity] ?? "unknown",
								line: d.range.start.line + 1,
								column: d.range.start.character,
								message: d.message,
								source: d.source,
							})),
						}, null, 2),
					}],
				};
			}

			// All diagnostics
			const all = lsp.getAllDiagnostics();
			const result: Record<string, unknown[]> = {};
			const severityMap: Record<number, string> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };
			for (const [uri, diags] of all) {
				if (diags.length > 0) {
					result[uri] = diags.map((d) => ({
						severity: severityMap[d.severity] ?? "unknown",
						line: d.range.start.line + 1,
						message: d.message,
					}));
				}
			}
			return { content: [{ type: "text", text: JSON.stringify({ fileCount: Object.keys(result).length, diagnostics: result }, null, 2) }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// LSP: Symbols
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_lsp_symbols", "Get all symbols (classes, methods, variables, signals, enums) in a GDScript file from the language server.", {
		scriptPath: z.string().describe("Script path (res://)"),
	}, async ({ scriptPath }) => {
		try {
			const lsp = getLsp();
			if (!lsp.isConnected()) {
				return { content: [{ type: "text", text: "LSP not connected. Call godot_lsp_connect first." }], isError: true };
			}

			const uri = resToFileUri(scriptPath, ctx.projectRoot);
			const absPath = resToAbsolute(scriptPath, ctx.projectRoot);
			const content = readFileSync(absPath, "utf-8");
			await lsp.openDocument(uri, content);

			const symbols = await lsp.getDocumentSymbols(uri);
			const kindMap: Record<number, string> = { 5: "class", 6: "method", 8: "constructor", 12: "function", 13: "variable", 14: "constant", 10: "enum", 22: "struct", 24: "event" };

			const flatten = (syms: typeof symbols, depth = 0): unknown[] => {
				const result: unknown[] = [];
				for (const s of syms) {
					result.push({
						name: s.name,
						kind: kindMap[s.kind] ?? `kind_${s.kind}`,
						line: s.range.start.line + 1,
						depth,
					});
					if (s.children) result.push(...flatten(s.children, depth + 1));
				}
				return result;
			};

			return {
				content: [{
					type: "text",
					text: JSON.stringify({ script: scriptPath, symbols: flatten(symbols) }, null, 2),
				}],
			};
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// LSP: Completions
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_lsp_completions", "Get code completions at a specific position in a GDScript file. Shows what methods, properties, and signals are available.", {
		scriptPath: z.string().describe("Script path (res://)"),
		line: z.number().describe("Line number (1-based)"),
		character: z.number().describe("Column/character position (0-based)"),
	}, async ({ scriptPath, line, character }) => {
		try {
			const lsp = getLsp();
			if (!lsp.isConnected()) {
				return { content: [{ type: "text", text: "LSP not connected." }], isError: true };
			}

			const uri = resToFileUri(scriptPath, ctx.projectRoot);
			const absPath = resToAbsolute(scriptPath, ctx.projectRoot);
			const content = readFileSync(absPath, "utf-8");
			await lsp.openDocument(uri, content);

			const completions = await lsp.getCompletions(uri, line - 1, character);
			const kindMap: Record<number, string> = { 1: "text", 2: "method", 3: "function", 4: "constructor", 5: "field", 6: "variable", 7: "class", 8: "interface", 9: "module", 10: "property", 13: "enum", 14: "keyword", 15: "snippet", 21: "constant", 22: "struct", 23: "event" };

			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						script: scriptPath,
						position: { line, character },
						completionCount: completions.length,
						completions: completions.slice(0, 50).map((c) => ({
							label: c.label,
							kind: kindMap[c.kind] ?? `kind_${c.kind}`,
							detail: c.detail,
							insertText: c.insertText,
						})),
					}, null, 2),
				}],
			};
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// LSP: Hover
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_lsp_hover", "Get type information and documentation for a symbol at a position in a GDScript file.", {
		scriptPath: z.string().describe("Script path (res://)"),
		line: z.number().describe("Line number (1-based)"),
		character: z.number().describe("Column position (0-based)"),
	}, async ({ scriptPath, line, character }) => {
		try {
			const lsp = getLsp();
			if (!lsp.isConnected()) {
				return { content: [{ type: "text", text: "LSP not connected." }], isError: true };
			}

			const uri = resToFileUri(scriptPath, ctx.projectRoot);
			const absPath = resToAbsolute(scriptPath, ctx.projectRoot);
			const content = readFileSync(absPath, "utf-8");
			await lsp.openDocument(uri, content);

			const hover = await lsp.getHoverInfo(uri, line - 1, character);
			if (!hover) {
				return { content: [{ type: "text", text: "No hover information available at this position." }] };
			}
			return { content: [{ type: "text", text: hover.contents }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// LSP: Go to Definition
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_lsp_definition", "Find where a symbol is defined. Jump from usage to declaration.", {
		scriptPath: z.string().describe("Script path (res://)"),
		line: z.number().describe("Line number (1-based)"),
		character: z.number().describe("Column position (0-based)"),
	}, async ({ scriptPath, line, character }) => {
		try {
			const lsp = getLsp();
			if (!lsp.isConnected()) {
				return { content: [{ type: "text", text: "LSP not connected." }], isError: true };
			}

			const uri = resToFileUri(scriptPath, ctx.projectRoot);
			const absPath = resToAbsolute(scriptPath, ctx.projectRoot);
			const content = readFileSync(absPath, "utf-8");
			await lsp.openDocument(uri, content);

			const defs = await lsp.getDefinition(uri, line - 1, character);
			if (defs.length === 0) {
				return { content: [{ type: "text", text: "No definition found at this position." }] };
			}
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						definitions: defs.map((d) => ({
							file: d.uri,
							line: d.range.start.line + 1,
							column: d.range.start.character,
						})),
					}, null, 2),
				}],
			};
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// DAP: Connect
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_dap_connect", "Connect to Godot's Debug Adapter for breakpoints, stepping, and variable inspection. The Godot editor must be running with DAP enabled.", {
		port: z.number().optional().default(6006).describe("DAP server port (default 6006)"),
	}, async ({ port }) => {
		try {
			const dap = getDap(port);
			if (dap.isConnected()) {
				return { content: [{ type: "text", text: "Already connected to Godot DAP." }] };
			}
			const success = await dap.connect();
			if (!success) {
				return { content: [{ type: "text", text: `Failed to connect to Godot DAP on port ${port}. Is the Godot editor running with DAP enabled?` }], isError: true };
			}
			return { content: [{ type: "text", text: `Connected to Godot DAP on port ${port}. Debugging is now active.` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// DAP: Breakpoints
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_dap_breakpoints", "Set or clear breakpoints on a GDScript file.", {
		scriptPath: z.string().describe("Script path (res://)"),
		lines: z.array(z.number()).describe("Line numbers to set breakpoints on. Empty array clears all breakpoints on this file."),
	}, async ({ scriptPath, lines }) => {
		try {
			const dap = getDap();
			if (!dap.isConnected()) {
				return { content: [{ type: "text", text: "DAP not connected. Call godot_dap_connect first." }], isError: true };
			}

			const absPath = resToAbsolute(scriptPath, ctx.projectRoot);
			if (lines.length === 0) {
				await dap.clearBreakpoints(absPath);
				return { content: [{ type: "text", text: `Cleared all breakpoints on ${scriptPath}` }] };
			}

			const bps = await dap.setBreakpoints(absPath, lines);
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						script: scriptPath,
						breakpoints: bps.map((bp) => ({
							line: bp.line,
							verified: bp.verified,
						})),
					}, null, 2),
				}],
			};
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// DAP: Execution Control
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_dap_step", "Control execution: continue, step over, step in, step out, or pause.", {
		action: z.enum(["continue", "step_over", "step_in", "step_out", "pause"]),
	}, async ({ action }) => {
		try {
			const dap = getDap();
			if (!dap.isConnected()) {
				return { content: [{ type: "text", text: "DAP not connected." }], isError: true };
			}

			switch (action) {
				case "continue": await dap.continue(); break;
				case "step_over": await dap.stepOver(); break;
				case "step_in": await dap.stepIn(); break;
				case "step_out": await dap.stepOut(); break;
				case "pause": await dap.pause(); break;
			}
			return { content: [{ type: "text", text: `Executed: ${action}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }; }
	});

	// ═══════════════════════════════════════════════════════════
	// DAP: Stack Trace + Variables
	// ═══════════════════════════════════════════════════════════

	server.tool("godot_dap_inspect", "When stopped at a breakpoint, inspect the call stack, local variables, and evaluate expressions.", {
		action: z.enum(["stack_trace", "variables", "evaluate"]),
		frameId: z.number().optional().describe("Stack frame ID (from stack_trace results)"),
		expression: z.string().optional().describe("Expression to evaluate (for 'evaluate' action)"),
	}, async ({ action, frameId, expression }) => {
		try {
			const dap = getDap();
			if (!dap.isConnected()) {
				return { content: [{ type: "text", text: "DAP not connected." }], isError: true };
			}

			switch (action) {
				case "stack_trace": {
					const frames = await dap.getStackTrace();
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								threadId: dap.getStoppedThreadId(),
								frames: frames.map((f) => ({
									id: f.id,
									name: f.name,
									file: f.source?.path,
									line: f.line,
								})),
							}, null, 2),
						}],
					};
				}
				case "variables": {
					const fid = frameId ?? 0;
					const scopes = await dap.getScopes(fid);
					const result: Record<string, unknown[]> = {};
					for (const scope of scopes) {
						const vars = await dap.getVariables(scope.variablesReference);
						result[scope.name] = vars.map((v) => ({
							name: v.name,
							value: v.value,
							type: v.type,
						}));
					}
					return { content: [{ type: "text", text: JSON.stringify({ frameId: fid, scopes: result }, null, 2) }] };
				}
				case "evaluate": {
					if (!expression) {
						return { content: [{ type: "text", text: "Expression is required for 'evaluate' action." }], isError: true };
					}
					const evalResult = await dap.evaluate(expression, frameId);
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								expression,
								result: evalResult.result,
								type: evalResult.type,
							}, null, 2),
						}],
					};
				}
			}
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }; }
	});
}
