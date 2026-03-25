/**
 * Lexer for Godot's .tscn/.tres text format.
 *
 * Tokenizes the file into section headers, properties, comments, and blank lines.
 * Section headers: [gd_scene format=3], [ext_resource type="Texture2D" ...], etc.
 * Properties: key = value (where value can be complex Variant expressions)
 */

import {
	type BlankLineToken,
	type CommentToken,
	type PropertyToken,
	type SectionHeaderToken,
	type Token,
	TokenType,
} from "./types.js";

/**
 * Tokenize a .tscn/.tres file content into a stream of tokens.
 */
export function tokenize(content: string): Token[] {
	const tokens: Token[] = [];
	const lines = content.split("\n");

	let lineNum = 0;
	while (lineNum < lines.length) {
		const line = lines[lineNum];
		const trimmed = line.trimEnd();

		// Blank line
		if (trimmed === "") {
			tokens.push({ type: TokenType.BlankLine, line: lineNum } satisfies BlankLineToken);
			lineNum++;
			continue;
		}

		// Comment
		if (trimmed.startsWith(";")) {
			tokens.push({
				type: TokenType.Comment,
				text: trimmed,
				line: lineNum,
			} satisfies CommentToken);
			lineNum++;
			continue;
		}

		// Section header: [section_type key="value" ...]
		if (trimmed.startsWith("[")) {
			const token = parseSectionHeader(trimmed, lineNum);
			if (token) {
				tokens.push(token);
				lineNum++;
				continue;
			}
		}

		// Property: key = value (may span multiple lines if value contains multiline constructs)
		const eqIdx = findPropertyEquals(trimmed);
		if (eqIdx !== -1) {
			const key = trimmed.slice(0, eqIdx).trim();
			let value = trimmed.slice(eqIdx + 1).trim();

			// Handle multi-line values: track bracket/paren depth
			let depth = computeDepth(value);
			while (depth > 0 && lineNum + 1 < lines.length) {
				lineNum++;
				const continuation = lines[lineNum];
				value += `\n${continuation}`;
				depth += computeDepth(continuation);
			}

			tokens.push({
				type: TokenType.Property,
				key,
				value,
				line: lineNum,
			} satisfies PropertyToken);
			lineNum++;
			continue;
		}

		// Unknown line — skip
		lineNum++;
	}

	return tokens;
}

/**
 * Parse a section header line like: [gd_scene format=3 uid="uid://abc"]
 */
function parseSectionHeader(line: string, lineNum: number): SectionHeaderToken | null {
	// Must start with [ and end with ]
	if (!line.startsWith("[") || !line.endsWith("]")) return null;

	const inner = line.slice(1, -1).trim();
	if (inner.length === 0) return null;

	// Extract section type (first word)
	const spaceIdx = inner.indexOf(" ");
	const sectionType = spaceIdx === -1 ? inner : inner.slice(0, spaceIdx);
	const attrStr = spaceIdx === -1 ? "" : inner.slice(spaceIdx + 1);

	// Parse attributes as key=value or key="value" pairs
	const attributes = parseAttributes(attrStr);

	return {
		type: TokenType.SectionHeader,
		sectionType,
		attributes,
		line: lineNum,
	};
}

/**
 * Parse attribute string like: format=3 uid="uid://abc" type="Texture2D"
 * into a Record<string, string>.
 *
 * Values may be quoted or unquoted. Quoted values can contain spaces.
 * Values can also be complex expressions like PackedStringArray("a", "b").
 */
function parseAttributes(s: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	let i = 0;

	while (i < s.length) {
		// Skip whitespace
		while (i < s.length && s[i] === " ") i++;
		if (i >= s.length) break;

		// Read key
		const keyStart = i;
		while (i < s.length && s[i] !== "=" && s[i] !== " ") i++;
		const key = s.slice(keyStart, i);
		if (key === "") break;

		// Skip =
		if (i < s.length && s[i] === "=") {
			i++;
		} else {
			// Key without value (like a flag)
			attrs[key] = "true";
			continue;
		}

		// Read value
		if (i < s.length && s[i] === '"') {
			// Quoted value
			i++; // skip opening quote
			let value = "";
			while (i < s.length) {
				if (s[i] === "\\" && i + 1 < s.length) {
					value += s[i] + s[i + 1];
					i += 2;
				} else if (s[i] === '"') {
					i++; // skip closing quote
					break;
				} else {
					value += s[i];
					i++;
				}
			}
			attrs[key] = value;
		} else {
			// Unquoted value — read until space, handling parens for complex types
			const valueStart = i;
			let depth = 0;
			while (i < s.length) {
				if (s[i] === "(") depth++;
				else if (s[i] === ")") depth--;
				else if (s[i] === " " && depth === 0) break;
				i++;
			}
			attrs[key] = s.slice(valueStart, i);
		}
	}

	return attrs;
}

/**
 * Find the first `=` in a property line that's the assignment operator.
 * Must not be inside quotes or brackets.
 * Must not be `==` (comparison).
 */
function findPropertyEquals(line: string): number {
	let inString = false;
	let depth = 0;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];

		if (ch === "\\" && inString) {
			i++; // skip escaped char
			continue;
		}

		if (ch === '"') {
			inString = !inString;
			continue;
		}

		if (inString) continue;

		if (ch === "(" || ch === "[" || ch === "{") depth++;
		else if (ch === ")" || ch === "]" || ch === "}") depth--;
		else if (ch === "=" && depth === 0) {
			// Make sure it's not == or !=
			if (i + 1 < line.length && line[i + 1] === "=") continue;
			if (i > 0 && line[i - 1] === "!") continue;
			return i;
		}
	}

	return -1;
}

/**
 * Compute the net bracket/paren depth change for a line.
 * Used to detect multi-line values.
 */
function computeDepth(line: string): number {
	let depth = 0;
	let inString = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === "\\" && inString) {
			i++;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;

		if (ch === "(" || ch === "[" || ch === "{") depth++;
		else if (ch === ")" || ch === "]" || ch === "}") depth--;
	}

	return depth;
}
