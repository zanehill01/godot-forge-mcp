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

	server.tool(
		"godot_intelligence",
		`LSP + DAP code intelligence for Godot/GDScript. One tool, many actions.

Actions & params:
  lsp_connect        — Connect to GDScript Language Server. Params: port (default 6005)
  lsp_diagnostics    — Get errors/warnings for a file or all files. Params: scriptPath (res://, optional)
  lsp_symbols        — List symbols in a script. Params: scriptPath (res://)
  lsp_completions    — Get completions at a position. Params: scriptPath, line (1-based), character (0-based)
  lsp_hover          — Get type info/docs at a position. Params: scriptPath, line, character
  lsp_definition     — Go to definition of symbol. Params: scriptPath, line, character
  dap_connect        — Connect to Godot Debug Adapter. Params: port (default 6006)
  dap_breakpoints    — Set/clear breakpoints. Params: scriptPath, lines (number[]; empty clears)
  dap_step           — Execution control. Params: stepAction (continue|step_over|step_in|step_out|pause)
  dap_inspect        — Inspect stack/vars/eval. Params: inspectAction (stack_trace|variables|evaluate), frameId, expression`,
		{
			action: z.enum([
				"lsp_connect", "lsp_diagnostics", "lsp_symbols", "lsp_completions",
				"lsp_hover", "lsp_definition", "dap_connect", "dap_breakpoints",
				"dap_step", "dap_inspect",
			]).describe("Which intelligence action to perform"),
			port: z.number().optional().describe("LSP or DAP server port (default 6005 for LSP, 6006 for DAP)"),
			scriptPath: z.string().optional().describe("Script path (res://) for LSP/DAP file operations"),
			line: z.number().optional().describe("Line number (1-based) for completions, hover, definition"),
			character: z.number().optional().describe("Column position (0-based) for completions, hover, definition"),
			lines: z.array(z.number()).optional().describe("Breakpoint line numbers (empty array clears breakpoints)"),
			stepAction: z.enum(["continue", "step_over", "step_in", "step_out", "pause"]).optional().describe("Execution control action for dap_step"),
			inspectAction: z.enum(["stack_trace", "variables", "evaluate"]).optional().describe("Inspect mode for dap_inspect"),
			frameId: z.number().optional().describe("Stack frame ID for dap_inspect variables/evaluate"),
			expression: z.string().optional().describe("Expression to evaluate for dap_inspect evaluate"),
		},
		async (params) => {
			const { action, port, scriptPath, line, character, lines, stepAction, inspectAction, frameId, expression } = params;

			try {
				switch (action) {

					// ═══════════════════════════════════════════════════════════
					// LSP: Connect
					// ═══════════════════════════════════════════════════════════

					case "lsp_connect": {
						const lsp = getLsp(port ?? 6005);
						if (lsp.isConnected()) {
							return { content: [{ type: "text", text: "Already connected to GDScript LSP." }] };
						}
						const p = port ?? 6005;
						const success = await lsp.connect();
						if (!success) {
							return { content: [{ type: "text", text: `Failed to connect to GDScript LSP on port ${p}. Is the Godot editor running?` }], isError: true };
						}
						return { content: [{ type: "text", text: `Connected to GDScript LSP on port ${p}. Code intelligence is now active.` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// LSP: Diagnostics
					// ═══════════════════════════════════════════════════════════

					case "lsp_diagnostics": {
						const lsp = getLsp();
						if (!lsp.isConnected()) {
							return { content: [{ type: "text", text: "LSP not connected. Use action lsp_connect first." }], isError: true };
						}

						if (scriptPath) {
							const uri = resToFileUri(scriptPath, ctx.projectRoot);
							const absPath = resToAbsolute(scriptPath, ctx.projectRoot);
							const content = readFileSync(absPath, "utf-8");
							await lsp.openDocument(uri, content);

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
					}

					// ═══════════════════════════════════════════════════════════
					// LSP: Symbols
					// ═══════════════════════════════════════════════════════════

					case "lsp_symbols": {
						const lsp = getLsp();
						if (!lsp.isConnected()) {
							return { content: [{ type: "text", text: "LSP not connected. Use action lsp_connect first." }], isError: true };
						}
						if (!scriptPath) {
							return { content: [{ type: "text", text: "scriptPath is required for lsp_symbols." }], isError: true };
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
					}

					// ═══════════════════════════════════════════════════════════
					// LSP: Completions
					// ═══════════════════════════════════════════════════════════

					case "lsp_completions": {
						const lsp = getLsp();
						if (!lsp.isConnected()) {
							return { content: [{ type: "text", text: "LSP not connected." }], isError: true };
						}
						if (!scriptPath || line == null || character == null) {
							return { content: [{ type: "text", text: "scriptPath, line, and character are required for lsp_completions." }], isError: true };
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
					}

					// ═══════════════════════════════════════════════════════════
					// LSP: Hover
					// ═══════════════════════════════════════════════════════════

					case "lsp_hover": {
						const lsp = getLsp();
						if (!lsp.isConnected()) {
							return { content: [{ type: "text", text: "LSP not connected." }], isError: true };
						}
						if (!scriptPath || line == null || character == null) {
							return { content: [{ type: "text", text: "scriptPath, line, and character are required for lsp_hover." }], isError: true };
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
					}

					// ═══════════════════════════════════════════════════════════
					// LSP: Go to Definition
					// ═══════════════════════════════════════════════════════════

					case "lsp_definition": {
						const lsp = getLsp();
						if (!lsp.isConnected()) {
							return { content: [{ type: "text", text: "LSP not connected." }], isError: true };
						}
						if (!scriptPath || line == null || character == null) {
							return { content: [{ type: "text", text: "scriptPath, line, and character are required for lsp_definition." }], isError: true };
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
					}

					// ═══════════════════════════════════════════════════════════
					// DAP: Connect
					// ═══════════════════════════════════════════════════════════

					case "dap_connect": {
						const dap = getDap(port ?? 6006);
						if (dap.isConnected()) {
							return { content: [{ type: "text", text: "Already connected to Godot DAP." }] };
						}
						const p = port ?? 6006;
						const success = await dap.connect();
						if (!success) {
							return { content: [{ type: "text", text: `Failed to connect to Godot DAP on port ${p}. Is the Godot editor running with DAP enabled?` }], isError: true };
						}
						return { content: [{ type: "text", text: `Connected to Godot DAP on port ${p}. Debugging is now active.` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// DAP: Breakpoints
					// ═══════════════════════════════════════════════════════════

					case "dap_breakpoints": {
						const dap = getDap();
						if (!dap.isConnected()) {
							return { content: [{ type: "text", text: "DAP not connected. Use action dap_connect first." }], isError: true };
						}
						if (!scriptPath || !lines) {
							return { content: [{ type: "text", text: "scriptPath and lines are required for dap_breakpoints." }], isError: true };
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
					}

					// ═══════════════════════════════════════════════════════════
					// DAP: Execution Control
					// ═══════════════════════════════════════════════════════════

					case "dap_step": {
						const dap = getDap();
						if (!dap.isConnected()) {
							return { content: [{ type: "text", text: "DAP not connected." }], isError: true };
						}
						if (!stepAction) {
							return { content: [{ type: "text", text: "stepAction is required for dap_step." }], isError: true };
						}

						switch (stepAction) {
							case "continue": await dap.continue(); break;
							case "step_over": await dap.stepOver(); break;
							case "step_in": await dap.stepIn(); break;
							case "step_out": await dap.stepOut(); break;
							case "pause": await dap.pause(); break;
						}
						return { content: [{ type: "text", text: `Executed: ${stepAction}` }] };
					}

					// ═══════════════════════════════════════════════════════════
					// DAP: Stack Trace + Variables
					// ═══════════════════════════════════════════════════════════

					case "dap_inspect": {
						const dap = getDap();
						if (!dap.isConnected()) {
							return { content: [{ type: "text", text: "DAP not connected." }], isError: true };
						}
						if (!inspectAction) {
							return { content: [{ type: "text", text: "inspectAction is required for dap_inspect." }], isError: true };
						}

						switch (inspectAction) {
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
									return { content: [{ type: "text", text: "expression is required for dap_inspect evaluate." }], isError: true };
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
					}
				}
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);
}
