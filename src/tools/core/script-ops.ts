/**
 * Core Script Operations — Always exposed.
 *
 * read_script, write_script, edit_script
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { resToAbsolute } from "../../utils/path.js";
import type { ToolContext } from "../registry.js";

interface ScriptAnalysis {
	path: string;
	className: string | null;
	extends: string | null;
	isTool: boolean;
	signals: Array<{ name: string; params: string }>;
	exports: Array<{ name: string; type: string; annotation: string }>;
	methods: Array<{ name: string; params: string; returnType: string; isVirtual: boolean }>;
	enums: Array<{ name: string; values: string[] }>;
	constants: Array<{ name: string; value: string }>;
	onreadyVars: Array<{ name: string; type: string; path: string }>;
}

/**
 * Analyze a GDScript file and extract structured information.
 * Uses regex-based extraction (tree-sitter can be added later for deeper analysis).
 */
function analyzeGDScript(content: string): Omit<ScriptAnalysis, "path"> {
	const lines = content.split("\n");
	const result: Omit<ScriptAnalysis, "path"> = {
		className: null,
		extends: null,
		isTool: false,
		signals: [],
		exports: [],
		methods: [],
		enums: [],
		constants: [],
		onreadyVars: [],
	};

	let inEnum = false;
	let currentEnum = "";
	const enumValues: string[] = [];

	for (const rawLine of lines) {
		const line = rawLine.trim();

		// @tool
		if (line === "@tool") result.isTool = true;

		// class_name
		if (line.startsWith("class_name ")) {
			result.className = line.slice("class_name ".length).trim();
		}

		// extends
		if (line.startsWith("extends ")) {
			result.extends = line.slice("extends ".length).trim();
		}

		// signal
		const signalMatch = line.match(/^signal\s+(\w+)\s*(?:\(([^)]*)\))?/);
		if (signalMatch) {
			result.signals.push({
				name: signalMatch[1],
				params: signalMatch[2] ?? "",
			});
		}

		// @export
		const exportMatch = line.match(/^(@export\S*)\s+var\s+(\w+)\s*(?::\s*(\S+))?/);
		if (exportMatch) {
			result.exports.push({
				annotation: exportMatch[1],
				name: exportMatch[2],
				type: exportMatch[3] ?? "Variant",
			});
		}

		// @onready
		const onreadyMatch = line.match(
			/^@onready\s+var\s+(\w+)\s*(?::\s*(\S+))?\s*=\s*(.+)/,
		);
		if (onreadyMatch) {
			result.onreadyVars.push({
				name: onreadyMatch[1],
				type: onreadyMatch[2] ?? "Variant",
				path: onreadyMatch[3].trim(),
			});
		}

		// func
		const funcMatch = line.match(
			/^func\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\S+))?/,
		);
		if (funcMatch) {
			result.methods.push({
				name: funcMatch[1],
				params: funcMatch[2] ?? "",
				returnType: funcMatch[3] ?? "void",
				isVirtual: funcMatch[1].startsWith("_"),
			});
		}

		// enum
		const enumStart = line.match(/^enum\s+(\w+)\s*\{/);
		if (enumStart) {
			if (line.includes("}")) {
				// Single-line enum
				const valStr = line.slice(line.indexOf("{") + 1, line.indexOf("}"));
				result.enums.push({
					name: enumStart[1],
					values: valStr.split(",").map((v) => v.trim()).filter(Boolean),
				});
			} else {
				inEnum = true;
				currentEnum = enumStart[1];
			}
		} else if (inEnum) {
			if (line.includes("}")) {
				inEnum = false;
				result.enums.push({ name: currentEnum, values: [...enumValues] });
				enumValues.length = 0;
			} else if (line && !line.startsWith("#")) {
				enumValues.push(line.replace(",", "").trim());
			}
		}

		// const
		const constMatch = line.match(/^const\s+(\w+)\s*(?::\s*\S+)?\s*=\s*(.+)/);
		if (constMatch) {
			result.constants.push({
				name: constMatch[1],
				value: constMatch[2].trim(),
			});
		}
	}

	return result;
}

export function registerScriptOpsTools(server: McpServer, ctx: ToolContext): void {
	// ── godot_read_script ──────────────────────────────────────
	server.tool(
		"godot_read_script",
		"Read a GDScript file with structural analysis: class name, extends, signals, exports, methods, enums, constants, onready vars.",
		{
			path: z.string().describe('Script path (res:// format, e.g., "res://scripts/player.gd")'),
		},
		async ({ path }) => {
			try {
				const absPath = resToAbsolute(path, ctx.projectRoot);
				const content = readFileSync(absPath, "utf-8");
				const analysis = analyzeGDScript(content);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									path,
									...analysis,
									source: content,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error reading script: ${e}` }],
					isError: true,
				};
			}
		},
	);

	// ── godot_write_script ─────────────────────────────────────
	server.tool(
		"godot_write_script",
		"Create or overwrite a GDScript file. Provide the full script content.",
		{
			path: z.string().describe("Script path (res:// format)"),
			content: z.string().describe("Full GDScript source code"),
		},
		async ({ path, content }) => {
			try {
				const absPath = resToAbsolute(path, ctx.projectRoot);

				// Ensure directory exists
				const dir = dirname(absPath);
				mkdirSync(dir, { recursive: true });

				writeFileSync(absPath, content, "utf-8");
				ctx.getAssetManager().invalidate();

				return {
					content: [{ type: "text", text: `Wrote script to ${path} (${content.length} chars).` }],
				};
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error writing script: ${e}` }],
					isError: true,
				};
			}
		},
	);

	// ── godot_edit_script ──────────────────────────────────────
	server.tool(
		"godot_edit_script",
		"Surgically edit a GDScript: add/replace a method, add an export, add a signal, add an onready var. Safer than full rewrites.",
		{
			path: z.string().describe("Script path (res:// format)"),
			operation: z
				.enum(["add_method", "replace_method", "add_signal", "add_export", "add_onready", "add_constant", "insert_at_line"])
				.describe("Type of edit operation"),
			name: z.string().optional().describe("Name of the method/signal/variable to add/replace"),
			code: z.string().describe("Code to insert (full method definition, signal declaration, etc.)"),
			line: z.number().optional().describe("Line number for insert_at_line operation"),
		},
		async ({ path, operation, name, code, line }) => {
			try {
				const absPath = resToAbsolute(path, ctx.projectRoot);
				let content = readFileSync(absPath, "utf-8");
				const lines = content.split("\n");

				switch (operation) {
					case "add_method": {
						// Append method at the end
						content = `${content.trimEnd()}\n\n${code}\n`;
						break;
					}

					case "replace_method": {
						if (!name) {
							return {
								content: [{ type: "text", text: "name is required for replace_method" }],
								isError: true,
							};
						}
						// Find the method and replace it
						const funcRegex = new RegExp(`^(\\s*)func\\s+${escapeRegex(name)}\\s*\\(`);
						let startIdx = -1;
						let indent = "";

						for (let i = 0; i < lines.length; i++) {
							const match = lines[i].match(funcRegex);
							if (match) {
								startIdx = i;
								indent = match[1];
								break;
							}
						}

						if (startIdx === -1) {
							return {
								content: [{ type: "text", text: `Method "${name}" not found.` }],
								isError: true,
							};
						}

						// Find end of method (next line at same or lower indent, or end of file)
						let endIdx = startIdx + 1;
						while (endIdx < lines.length) {
							const l = lines[endIdx];
							if (l.trim() === "") {
								endIdx++;
								continue;
							}
							const currentIndent = l.match(/^\s*/)?.[0] ?? "";
							if (currentIndent.length <= indent.length && l.trim() !== "") {
								break;
							}
							endIdx++;
						}

						// Replace
						const newLines = [...lines.slice(0, startIdx), code, ...lines.slice(endIdx)];
						content = newLines.join("\n");
						break;
					}

					case "add_signal": {
						// Insert after the last signal or after extends/class_name
						let insertIdx = findInsertPoint(lines, "signal");
						lines.splice(insertIdx, 0, code);
						content = lines.join("\n");
						break;
					}

					case "add_export": {
						let insertIdx = findInsertPoint(lines, "export");
						lines.splice(insertIdx, 0, code);
						content = lines.join("\n");
						break;
					}

					case "add_onready": {
						let insertIdx = findInsertPoint(lines, "onready");
						lines.splice(insertIdx, 0, code);
						content = lines.join("\n");
						break;
					}

					case "add_constant": {
						let insertIdx = findInsertPoint(lines, "const");
						lines.splice(insertIdx, 0, code);
						content = lines.join("\n");
						break;
					}

					case "insert_at_line": {
						if (line === undefined) {
							return {
								content: [{ type: "text", text: "line is required for insert_at_line" }],
								isError: true,
							};
						}
						lines.splice(line - 1, 0, code);
						content = lines.join("\n");
						break;
					}
				}

				writeFileSync(absPath, content, "utf-8");

				return {
					content: [
						{
							type: "text",
							text: `Applied ${operation}${name ? ` for "${name}"` : ""} in ${path}.`,
						},
					],
				};
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error editing script: ${e}` }],
					isError: true,
				};
			}
		},
	);
}

function findInsertPoint(
	lines: string[],
	type: "signal" | "export" | "onready" | "const",
): number {
	// Find the last occurrence of similar declarations, or after extends/class_name
	const patterns: Record<string, RegExp> = {
		signal: /^signal\s/,
		export: /^@export/,
		onready: /^@onready/,
		const: /^const\s/,
	};
	const pattern = patterns[type];
	let lastIdx = -1;

	for (let i = 0; i < lines.length; i++) {
		if (pattern.test(lines[i].trim())) {
			lastIdx = i;
		}
	}

	if (lastIdx !== -1) return lastIdx + 1;

	// Fallback: after extends or class_name
	for (let i = 0; i < lines.length; i++) {
		const t = lines[i].trim();
		if (t.startsWith("extends ") || t.startsWith("class_name ")) {
			lastIdx = i;
		}
	}

	return lastIdx !== -1 ? lastIdx + 2 : 2; // Leave a blank line
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
