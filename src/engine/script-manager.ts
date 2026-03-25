/**
 * Script Manager — GDScript analysis and generation engine.
 *
 * Provides structured analysis of GDScript files and generation
 * of valid GDScript from specifications.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { resToAbsolute } from "../utils/path.js";

// ── Analysis Types ─────────────────────────────────────────────

export interface ScriptAnalysis {
	path: string;
	className: string | null;
	extends: string | null;
	isTool: boolean;
	isAbstract: boolean;
	iconPath: string | null;
	signals: SignalInfo[];
	exports: ExportInfo[];
	exportGroups: ExportGroupInfo[];
	methods: MethodInfo[];
	enums: EnumInfo[];
	constants: ConstantInfo[];
	onreadyVars: OnreadyVarInfo[];
	regularVars: VarInfo[];
	staticVars: VarInfo[];
	innerClasses: InnerClassInfo[];
	annotations: AnnotationInfo[];
	rpcMethods: RpcInfo[];
}

export interface SignalInfo {
	name: string;
	params: ParamInfo[];
	line: number;
}

export interface ParamInfo {
	name: string;
	type: string | null;
}

export interface ExportInfo {
	name: string;
	type: string | null;
	annotation: string;
	defaultValue: string | null;
	line: number;
}

export interface MethodInfo {
	name: string;
	params: ParamInfo[];
	returnType: string | null;
	isVirtual: boolean;
	isStatic: boolean;
	startLine: number;
	endLine: number;
	body: string;
}

export interface EnumInfo {
	name: string;
	values: string[];
	line: number;
}

export interface ConstantInfo {
	name: string;
	type: string | null;
	value: string;
	line: number;
}

export interface OnreadyVarInfo {
	name: string;
	type: string | null;
	expression: string;
	line: number;
}

export interface VarInfo {
	name: string;
	type: string | null;
	defaultValue: string | null;
	line: number;
}

export interface InnerClassInfo {
	name: string;
	extends: string | null;
	startLine: number;
	endLine: number;
}

export interface ExportGroupInfo {
	type: "group" | "subgroup" | "category";
	name: string;
	prefix: string;
	line: number;
}

export interface AnnotationInfo {
	name: string;
	args: string;
	line: number;
}

export interface RpcInfo {
	methodName: string;
	mode: string;
	args: string;
	line: number;
}

// ── Script Templates ───────────────────────────────────────────

export interface ScriptSpec {
	className?: string;
	extends: string;
	isTool?: boolean;
	signals?: Array<{ name: string; params?: string }>;
	exports?: Array<{ annotation?: string; name: string; type: string; default?: string }>;
	onreadyVars?: Array<{ name: string; type?: string; path: string }>;
	vars?: Array<{ name: string; type?: string; default?: string }>;
	constants?: Array<{ name: string; value: string }>;
	enums?: Array<{ name: string; values: string[] }>;
	methods?: Array<{
		name: string;
		params?: string;
		returnType?: string;
		isStatic?: boolean;
		body: string;
	}>;
}

export class ScriptManager {
	private projectRoot: string;

	constructor(projectRoot: string) {
		this.projectRoot = projectRoot;
	}

	/**
	 * Analyze a GDScript file.
	 */
	analyze(resPath: string): ScriptAnalysis {
		const absPath = resToAbsolute(resPath, this.projectRoot);
		const content = readFileSync(absPath, "utf-8");
		return this.analyzeContent(content, resPath);
	}

	/**
	 * Analyze GDScript content directly.
	 */
	analyzeContent(content: string, path: string = ""): ScriptAnalysis {
		const lines = content.split("\n");
		const analysis: ScriptAnalysis = {
			path,
			className: null,
			extends: null,
			isTool: false,
			isAbstract: false,
			iconPath: null,
			signals: [],
			exports: [],
			exportGroups: [],
			methods: [],
			enums: [],
			constants: [],
			onreadyVars: [],
			regularVars: [],
			staticVars: [],
			innerClasses: [],
			annotations: [],
			rpcMethods: [],
		};

		let pendingRpc: { args: string; line: number } | null = null;
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			const trimmed = line.trim();

			// @tool
			if (trimmed === "@tool") {
				analysis.isTool = true;
				analysis.annotations.push({ name: "tool", args: "", line: i + 1 });
				i++;
				continue;
			}

			// @abstract (4.5 preview)
			if (trimmed === "@abstract") {
				analysis.isAbstract = true;
				analysis.annotations.push({ name: "abstract", args: "", line: i + 1 });
				i++;
				continue;
			}

			// @icon
			const iconMatch = trimmed.match(/^@icon\("([^"]+)"\)/);
			if (iconMatch) {
				analysis.iconPath = iconMatch[1];
				analysis.annotations.push({ name: "icon", args: iconMatch[1], line: i + 1 });
				i++;
				continue;
			}

			// @warning_ignore
			const warningMatch = trimmed.match(/^@warning_ignore\(([^)]+)\)/);
			if (warningMatch) {
				analysis.annotations.push({ name: "warning_ignore", args: warningMatch[1], line: i + 1 });
				i++;
				continue;
			}

			// @static_unload
			if (trimmed === "@static_unload") {
				analysis.annotations.push({ name: "static_unload", args: "", line: i + 1 });
				i++;
				continue;
			}

			// @rpc — captures for the next func declaration
			const rpcMatch = trimmed.match(/^@rpc\(([^)]*)\)/);
			if (rpcMatch) {
				pendingRpc = { args: rpcMatch[1], line: i + 1 };
				analysis.annotations.push({ name: "rpc", args: rpcMatch[1], line: i + 1 });
				i++;
				continue;
			}
			if (trimmed === "@rpc") {
				pendingRpc = { args: "", line: i + 1 };
				analysis.annotations.push({ name: "rpc", args: "", line: i + 1 });
				i++;
				continue;
			}

			// @export_group / @export_subgroup / @export_category
			const groupMatch = trimmed.match(/^@export_(group|subgroup|category)\("([^"]*)"(?:\s*,\s*"([^"]*)")?\)/);
			if (groupMatch) {
				analysis.exportGroups.push({
					type: groupMatch[1] as "group" | "subgroup" | "category",
					name: groupMatch[2],
					prefix: groupMatch[3] ?? "",
					line: i + 1,
				});
				analysis.annotations.push({ name: `export_${groupMatch[1]}`, args: groupMatch[2], line: i + 1 });
				i++;
				continue;
			}

			// class_name
			if (trimmed.startsWith("class_name ")) {
				analysis.className = trimmed.slice("class_name ".length).trim();
				i++;
				continue;
			}

			// extends
			if (trimmed.startsWith("extends ")) {
				analysis.extends = trimmed.slice("extends ".length).trim();
				i++;
				continue;
			}

			// signal
			const signalMatch = trimmed.match(/^signal\s+(\w+)\s*(?:\(([^)]*)\))?/);
			if (signalMatch) {
				analysis.signals.push({
					name: signalMatch[1],
					params: parseParamList(signalMatch[2] ?? ""),
					line: i + 1,
				});
				i++;
				continue;
			}

			// @export variants — annotation may contain parens like @export_range(0, 100, 1)
			// Supports: @export, @export_range, @export_enum, @export_file, @export_dir,
			// @export_multiline, @export_placeholder, @export_color_no_alpha,
			// @export_node_path, @export_flags, @export_flags_2d_physics, etc.
			const exportMatch = trimmed.match(
				/^(@export\w*(?:\([^)]*\))?)\s+var\s+(\w+)\s*(?::\s*(.+?))?\s*(?:=\s*(.+))?$/,
			);
			if (exportMatch) {
				analysis.exports.push({
					annotation: exportMatch[1],
					name: exportMatch[2],
					type: exportMatch[3]?.trim() ?? null,
					defaultValue: exportMatch[4]?.trim() ?? null,
					line: i + 1,
				});
				i++;
				continue;
			}

			// @onready
			const onreadyMatch = trimmed.match(
				/^@onready\s+var\s+(\w+)\s*(?::\s*(.+?))?\s*=\s*(.+)$/,
			);
			if (onreadyMatch) {
				analysis.onreadyVars.push({
					name: onreadyMatch[1],
					type: onreadyMatch[2]?.trim() ?? null,
					expression: onreadyMatch[3].trim(),
					line: i + 1,
				});
				i++;
				continue;
			}

			// const
			const constMatch = trimmed.match(/^const\s+(\w+)\s*(?::\s*(.+?))?\s*=\s*(.+)$/);
			if (constMatch) {
				analysis.constants.push({
					name: constMatch[1],
					type: constMatch[2]?.trim() ?? null,
					value: constMatch[3].trim(),
					line: i + 1,
				});
				i++;
				continue;
			}

			// enum
			const enumMatch = trimmed.match(/^enum\s+(\w+)\s*\{/);
			if (enumMatch) {
				const { enumInfo, endLine } = parseEnum(lines, i, enumMatch[1]);
				analysis.enums.push(enumInfo);
				i = endLine + 1;
				continue;
			}

			// static var
			const staticVarMatch = trimmed.match(/^static\s+var\s+(\w+)\s*(?::\s*(.+?))?\s*(?:=\s*(.+))?$/);
			if (staticVarMatch) {
				analysis.staticVars.push({
					name: staticVarMatch[1],
					type: staticVarMatch[2]?.trim() ?? null,
					defaultValue: staticVarMatch[3]?.trim() ?? null,
					line: i + 1,
				});
				i++;
				continue;
			}

			// var (regular, not export/onready)
			// Supports typed arrays: Array[Node2D], typed dicts: Dictionary[String, int]
			const varMatch = trimmed.match(/^var\s+(\w+)\s*(?::\s*(.+?))?\s*(?:=\s*(.+))?$/);
			if (varMatch && !trimmed.startsWith("@")) {
				analysis.regularVars.push({
					name: varMatch[1],
					type: varMatch[2]?.trim() ?? null,
					defaultValue: varMatch[3]?.trim() ?? null,
					line: i + 1,
				});
				i++;
				continue;
			}

			// func
			const funcMatch = trimmed.match(
				/^(static\s+)?func\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(.+?))?\s*:/,
			);
			if (funcMatch) {
				const isStatic = !!funcMatch[1];
				const methodName = funcMatch[2];
				const params = parseParamList(funcMatch[3]);
				const returnType = funcMatch[4]?.trim() ?? null;
				const startLine = i + 1;

				// Find end of method
				const indent = line.match(/^\s*/)?.[0] ?? "";
				let endIdx = i + 1;
				while (endIdx < lines.length) {
					const nextLine = lines[endIdx];
					if (nextLine.trim() === "") {
						endIdx++;
						continue;
					}
					const nextIndent = nextLine.match(/^\s*/)?.[0] ?? "";
					if (nextIndent.length <= indent.length && nextLine.trim() !== "") {
						break;
					}
					endIdx++;
				}

				// Extract body
				const bodyLines = lines.slice(i + 1, endIdx);
				const body = bodyLines.join("\n");

				analysis.methods.push({
					name: methodName,
					params,
					returnType,
					isVirtual: methodName.startsWith("_"),
					isStatic,
					startLine,
					endLine: endIdx,
					body: body.trim(),
				});

				// Attach pending @rpc
				if (pendingRpc) {
					analysis.rpcMethods.push({
						methodName,
						mode: pendingRpc.args,
						args: pendingRpc.args,
						line: pendingRpc.line,
					});
					pendingRpc = null;
				}

				i = endIdx;
				continue;
			}

			// inner class
			const classMatch = trimmed.match(/^class\s+(\w+)\s*(?:extends\s+(\S+))?\s*:/);
			if (classMatch) {
				const indent = line.match(/^\s*/)?.[0] ?? "";
				let endIdx = i + 1;
				while (endIdx < lines.length) {
					const nextLine = lines[endIdx];
					if (nextLine.trim() === "") {
						endIdx++;
						continue;
					}
					const nextIndent = nextLine.match(/^\s*/)?.[0] ?? "";
					if (nextIndent.length <= indent.length && nextLine.trim() !== "") {
						break;
					}
					endIdx++;
				}

				analysis.innerClasses.push({
					name: classMatch[1],
					extends: classMatch[2] ?? null,
					startLine: i + 1,
					endLine: endIdx,
				});

				i = endIdx;
				continue;
			}

			// Reset pending rpc if we hit a non-annotation, non-func line
			if (pendingRpc && !trimmed.startsWith("@") && trimmed !== "") {
				pendingRpc = null;
			}

			i++;
		}

		return analysis;
	}

	/**
	 * Generate GDScript source from a specification.
	 */
	generate(spec: ScriptSpec): string {
		const lines: string[] = [];

		if (spec.isTool) lines.push("@tool");
		if (spec.className) lines.push(`class_name ${spec.className}`);
		lines.push(`extends ${spec.extends}`);
		lines.push("");

		// Signals
		if (spec.signals && spec.signals.length > 0) {
			for (const sig of spec.signals) {
				if (sig.params) {
					lines.push(`signal ${sig.name}(${sig.params})`);
				} else {
					lines.push(`signal ${sig.name}`);
				}
			}
			lines.push("");
		}

		// Enums
		if (spec.enums && spec.enums.length > 0) {
			for (const e of spec.enums) {
				lines.push(`enum ${e.name} { ${e.values.join(", ")} }`);
			}
			lines.push("");
		}

		// Constants
		if (spec.constants && spec.constants.length > 0) {
			for (const c of spec.constants) {
				lines.push(`const ${c.name} = ${c.value}`);
			}
			lines.push("");
		}

		// Exports
		if (spec.exports && spec.exports.length > 0) {
			for (const exp of spec.exports) {
				const annotation = exp.annotation ?? "@export";
				const type = exp.type ? `: ${exp.type}` : "";
				const def = exp.default ? ` = ${exp.default}` : "";
				lines.push(`${annotation} var ${exp.name}${type}${def}`);
			}
			lines.push("");
		}

		// Onready vars
		if (spec.onreadyVars && spec.onreadyVars.length > 0) {
			for (const v of spec.onreadyVars) {
				const type = v.type ? `: ${v.type}` : "";
				lines.push(`@onready var ${v.name}${type} = ${v.path}`);
			}
			lines.push("");
		}

		// Regular vars
		if (spec.vars && spec.vars.length > 0) {
			for (const v of spec.vars) {
				const type = v.type ? `: ${v.type}` : "";
				const def = v.default ? ` = ${v.default}` : "";
				lines.push(`var ${v.name}${type}${def}`);
			}
			lines.push("");
		}

		// Methods
		if (spec.methods && spec.methods.length > 0) {
			for (const m of spec.methods) {
				const staticPrefix = m.isStatic ? "static " : "";
				const params = m.params ?? "";
				const ret = m.returnType ? ` -> ${m.returnType}` : "";
				lines.push(`${staticPrefix}func ${m.name}(${params})${ret}:`);
				// Indent method body
				const bodyLines = m.body.split("\n");
				for (const bl of bodyLines) {
					lines.push(`\t${bl}`);
				}
				lines.push("");
			}
		}

		return lines.join("\n").trimEnd() + "\n";
	}

	/**
	 * Read a script file.
	 */
	read(resPath: string): string {
		const absPath = resToAbsolute(resPath, this.projectRoot);
		return readFileSync(absPath, "utf-8");
	}

	/**
	 * Write a script file.
	 */
	write(resPath: string, content: string): void {
		const absPath = resToAbsolute(resPath, this.projectRoot);
		const dir = dirname(absPath);
		mkdirSync(dir, { recursive: true });
		writeFileSync(absPath, content, "utf-8");
	}

	/**
	 * Check if a script exists.
	 */
	exists(resPath: string): boolean {
		return existsSync(resToAbsolute(resPath, this.projectRoot));
	}
}

// ── Helpers ────────────────────────────────────────────────────

function parseParamList(s: string): ParamInfo[] {
	if (!s || s.trim() === "") return [];

	return s.split(",").map((p) => {
		const trimmed = p.trim();
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) {
			// Remove default value if present
			const eqIdx = trimmed.indexOf("=");
			const name = eqIdx === -1 ? trimmed : trimmed.slice(0, eqIdx).trim();
			return { name, type: null };
		}
		const name = trimmed.slice(0, colonIdx).trim();
		let type = trimmed.slice(colonIdx + 1).trim();
		// Remove default value if present
		const eqIdx = type.indexOf("=");
		if (eqIdx !== -1) {
			type = type.slice(0, eqIdx).trim();
		}
		return { name, type: type || null };
	});
}

function parseEnum(
	lines: string[],
	startIdx: number,
	name: string,
): { enumInfo: EnumInfo; endLine: number } {
	const firstLine = lines[startIdx].trim();
	const values: string[] = [];

	if (firstLine.includes("}")) {
		// Single-line enum
		const content = firstLine.slice(firstLine.indexOf("{") + 1, firstLine.indexOf("}"));
		for (const v of content.split(",")) {
			const trimmed = v.trim();
			if (trimmed) values.push(trimmed);
		}
		return { enumInfo: { name, values, line: startIdx + 1 }, endLine: startIdx };
	}

	// Multi-line enum
	let i = startIdx + 1;
	while (i < lines.length) {
		const line = lines[i].trim();
		if (line.includes("}")) {
			// May have values on closing line
			const before = line.slice(0, line.indexOf("}"));
			for (const v of before.split(",")) {
				const trimmed = v.trim();
				if (trimmed) values.push(trimmed);
			}
			break;
		}
		if (line && !line.startsWith("#")) {
			const val = line.replace(",", "").trim();
			if (val) values.push(val);
		}
		i++;
	}

	return { enumInfo: { name, values, line: startIdx + 1 }, endLine: i };
}
