/**
 * Godot Variant type serializer/deserializer.
 *
 * Handles parsing and writing of Godot's typed values as they appear in .tscn/.tres files:
 * Vector2(1, 2), Color(1, 0, 0, 1), Transform3D(...), PackedStringArray("a", "b"), etc.
 */

import type {
	GodotAABB,
	GodotBasis,
	GodotColor,
	GodotDictionary,
	GodotNodePath,
	GodotPackedArray,
	GodotPlane,
	GodotQuaternion,
	GodotRect2,
	GodotResourceRef,
	GodotTransform2D,
	GodotTransform3D,
	GodotVariant,
	GodotVector2,
	GodotVector3,
	GodotVector4,
} from "../parsers/tscn/types.js";

/**
 * Parse a Godot Variant value string into a typed object.
 */
export function parseVariant(raw: string): GodotVariant {
	const trimmed = raw.trim();

	// null
	if (trimmed === "null") return null;

	// Boolean
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;

	// Quoted string
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return unescapeGodotString(trimmed.slice(1, -1));
	}

	// &"StringName" syntax
	if (trimmed.startsWith('&"') && trimmed.endsWith('"')) {
		return unescapeGodotString(trimmed.slice(2, -1));
	}

	// ^"NodePath" syntax
	if (trimmed.startsWith('^"') && trimmed.endsWith('"')) {
		return { type: "NodePath", path: unescapeGodotString(trimmed.slice(2, -1)) };
	}

	// NodePath("...")
	if (trimmed.startsWith("NodePath(")) {
		const inner = extractParens(trimmed, "NodePath");
		const path = inner.startsWith('"') ? unescapeGodotString(inner.slice(1, -1)) : inner;
		return { type: "NodePath", path } as GodotNodePath;
	}

	// Resource references
	if (trimmed.startsWith("ExtResource(")) {
		const inner = extractParens(trimmed, "ExtResource");
		const id = inner.startsWith('"') ? inner.slice(1, -1) : inner;
		return { type: "ExtResource", id } as GodotResourceRef;
	}
	if (trimmed.startsWith("SubResource(")) {
		const inner = extractParens(trimmed, "SubResource");
		const id = inner.startsWith('"') ? inner.slice(1, -1) : inner;
		return { type: "SubResource", id } as GodotResourceRef;
	}

	// Vector2/Vector2i
	if (trimmed.startsWith("Vector2(") || trimmed.startsWith("Vector2i(")) {
		const isInt = trimmed.startsWith("Vector2i");
		const inner = extractParens(trimmed, isInt ? "Vector2i" : "Vector2");
		const nums = parseNumberList(inner);
		return { type: isInt ? "Vector2i" : "Vector2", x: nums[0], y: nums[1] } as GodotVector2;
	}

	// Vector3/Vector3i
	if (trimmed.startsWith("Vector3(") || trimmed.startsWith("Vector3i(")) {
		const isInt = trimmed.startsWith("Vector3i");
		const inner = extractParens(trimmed, isInt ? "Vector3i" : "Vector3");
		const nums = parseNumberList(inner);
		return {
			type: isInt ? "Vector3i" : "Vector3",
			x: nums[0],
			y: nums[1],
			z: nums[2],
		} as GodotVector3;
	}

	// Vector4/Vector4i
	if (trimmed.startsWith("Vector4(") || trimmed.startsWith("Vector4i(")) {
		const isInt = trimmed.startsWith("Vector4i");
		const inner = extractParens(trimmed, isInt ? "Vector4i" : "Vector4");
		const nums = parseNumberList(inner);
		return {
			type: isInt ? "Vector4i" : "Vector4",
			x: nums[0],
			y: nums[1],
			z: nums[2],
			w: nums[3],
		} as GodotVector4;
	}

	// Color
	if (trimmed.startsWith("Color(")) {
		const inner = extractParens(trimmed, "Color");
		const nums = parseNumberList(inner);
		return {
			type: "Color",
			r: nums[0],
			g: nums[1],
			b: nums[2],
			a: nums[3] ?? 1,
		} as GodotColor;
	}

	// Rect2/Rect2i
	if (trimmed.startsWith("Rect2(") || trimmed.startsWith("Rect2i(")) {
		const isInt = trimmed.startsWith("Rect2i");
		const inner = extractParens(trimmed, isInt ? "Rect2i" : "Rect2");
		const nums = parseNumberList(inner);
		return {
			type: isInt ? "Rect2i" : "Rect2",
			x: nums[0],
			y: nums[1],
			w: nums[2],
			h: nums[3],
		} as GodotRect2;
	}

	// Transform2D
	if (trimmed.startsWith("Transform2D(")) {
		const inner = extractParens(trimmed, "Transform2D");
		const nums = parseNumberList(inner);
		return {
			type: "Transform2D",
			xx: nums[0],
			xy: nums[1],
			yx: nums[2],
			yy: nums[3],
			ox: nums[4],
			oy: nums[5],
		} as GodotTransform2D;
	}

	// Transform3D
	if (trimmed.startsWith("Transform3D(")) {
		const inner = extractParens(trimmed, "Transform3D");
		const nums = parseNumberList(inner);
		return {
			type: "Transform3D",
			basis: [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5], nums[6], nums[7], nums[8]],
			origin: [nums[9], nums[10], nums[11]],
		} as GodotTransform3D;
	}

	// Basis
	if (trimmed.startsWith("Basis(")) {
		const inner = extractParens(trimmed, "Basis");
		const nums = parseNumberList(inner);
		return {
			type: "Basis",
			values: [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5], nums[6], nums[7], nums[8]],
		} as GodotBasis;
	}

	// Quaternion
	if (trimmed.startsWith("Quaternion(")) {
		const inner = extractParens(trimmed, "Quaternion");
		const nums = parseNumberList(inner);
		return {
			type: "Quaternion",
			x: nums[0],
			y: nums[1],
			z: nums[2],
			w: nums[3],
		} as GodotQuaternion;
	}

	// AABB
	if (trimmed.startsWith("AABB(")) {
		const inner = extractParens(trimmed, "AABB");
		const nums = parseNumberList(inner);
		return {
			type: "AABB",
			x: nums[0],
			y: nums[1],
			z: nums[2],
			sx: nums[3],
			sy: nums[4],
			sz: nums[5],
		} as GodotAABB;
	}

	// Plane
	if (trimmed.startsWith("Plane(")) {
		const inner = extractParens(trimmed, "Plane");
		const nums = parseNumberList(inner);
		return {
			type: "Plane",
			a: nums[0],
			b: nums[1],
			c: nums[2],
			d: nums[3],
		} as GodotPlane;
	}

	// PackedArrays
	const packedTypes = [
		"PackedByteArray",
		"PackedInt32Array",
		"PackedInt64Array",
		"PackedFloat32Array",
		"PackedFloat64Array",
		"PackedStringArray",
		"PackedVector2Array",
		"PackedVector3Array",
		"PackedColorArray",
	] as const;

	for (const pType of packedTypes) {
		if (trimmed.startsWith(`${pType}(`)) {
			const inner = extractParens(trimmed, pType);
			if (inner.trim() === "") {
				return { type: pType, values: [] } as GodotPackedArray;
			}
			if (pType === "PackedStringArray") {
				return { type: pType, values: parseStringList(inner) } as GodotPackedArray;
			}
			return { type: pType, values: parseNumberList(inner) } as GodotPackedArray;
		}
	}

	// Array (bare [...])
	if (trimmed.startsWith("[")) {
		return parseArray(trimmed);
	}

	// Dictionary { key: value, ... }
	if (trimmed.startsWith("{")) {
		return parseDictionary(trimmed);
	}

	// Number (int or float)
	const num = Number(trimmed);
	if (!Number.isNaN(num)) return num;

	// Fallback: return as raw string
	return trimmed;
}

/**
 * Serialize a GodotVariant back to .tscn format string.
 */
export function writeVariant(value: GodotVariant): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") return formatNumber(value);
	if (typeof value === "string") return `"${escapeGodotString(value)}"`;

	if (Array.isArray(value)) {
		return `[${value.map(writeVariant).join(", ")}]`;
	}

	if (typeof value === "object" && "type" in value) {
		switch (value.type) {
			case "Vector2":
			case "Vector2i":
				return `${value.type}(${formatNumber(value.x)}, ${formatNumber(value.y)})`;

			case "Vector3":
			case "Vector3i":
				return `${value.type}(${formatNumber(value.x)}, ${formatNumber(value.y)}, ${formatNumber(value.z)})`;

			case "Vector4":
			case "Vector4i":
				return `${value.type}(${formatNumber(value.x)}, ${formatNumber(value.y)}, ${formatNumber(value.z)}, ${formatNumber(value.w)})`;

			case "Color":
				return `Color(${formatNumber(value.r)}, ${formatNumber(value.g)}, ${formatNumber(value.b)}, ${formatNumber(value.a)})`;

			case "Rect2":
			case "Rect2i":
				return `${value.type}(${formatNumber(value.x)}, ${formatNumber(value.y)}, ${formatNumber(value.w)}, ${formatNumber(value.h)})`;

			case "Transform2D":
				return `Transform2D(${[value.xx, value.xy, value.yx, value.yy, value.ox, value.oy].map(formatNumber).join(", ")})`;

			case "Transform3D":
				return `Transform3D(${[...value.basis, ...value.origin].map(formatNumber).join(", ")})`;

			case "Basis":
				return `Basis(${value.values.map(formatNumber).join(", ")})`;

			case "Quaternion":
				return `Quaternion(${formatNumber(value.x)}, ${formatNumber(value.y)}, ${formatNumber(value.z)}, ${formatNumber(value.w)})`;

			case "AABB":
				return `AABB(${formatNumber(value.x)}, ${formatNumber(value.y)}, ${formatNumber(value.z)}, ${formatNumber(value.sx)}, ${formatNumber(value.sy)}, ${formatNumber(value.sz)})`;

			case "Plane":
				return `Plane(${formatNumber(value.a)}, ${formatNumber(value.b)}, ${formatNumber(value.c)}, ${formatNumber(value.d)})`;

			case "NodePath":
				return `NodePath("${escapeGodotString(value.path)}")`;

			case "ExtResource":
				return `ExtResource("${value.id}")`;

			case "SubResource":
				return `SubResource("${value.id}")`;

			case "PackedByteArray":
			case "PackedInt32Array":
			case "PackedInt64Array":
			case "PackedFloat32Array":
			case "PackedFloat64Array":
				return `${value.type}(${(value.values as number[]).map(formatNumber).join(", ")})`;

			case "PackedStringArray":
				return `${value.type}(${(value.values as string[]).map((s) => `"${escapeGodotString(s)}"`).join(", ")})`;

			case "PackedVector2Array":
			case "PackedVector3Array":
			case "PackedColorArray":
				return `${value.type}(${(value.values as number[]).map(formatNumber).join(", ")})`;

			case "Dictionary": {
				const dict = value as GodotDictionary;
				const entries = dict.entries.map(
					(e) => `${writeVariant(e.key)}: ${writeVariant(e.value)}`,
				);
				return `{${entries.join(", ")}}`;
			}
		}
	}

	return String(value);
}

// ── Helpers ────────────────────────────────────────────────────

function extractParens(s: string, prefix: string): string {
	const start = prefix.length + 1; // skip "Type("
	let depth = 1;
	let i = start;
	while (i < s.length && depth > 0) {
		if (s[i] === "(") depth++;
		else if (s[i] === ")") depth--;
		i++;
	}
	return s.slice(start, i - 1);
}

function parseNumberList(s: string): number[] {
	if (s.trim() === "") return [];
	return s.split(",").map((n) => Number(n.trim()));
}

function parseStringList(s: string): string[] {
	const result: string[] = [];
	let i = 0;
	while (i < s.length) {
		// Find next quote
		const start = s.indexOf('"', i);
		if (start === -1) break;
		// Find closing quote (handle escapes)
		let end = start + 1;
		while (end < s.length) {
			if (s[end] === "\\") {
				end += 2;
				continue;
			}
			if (s[end] === '"') break;
			end++;
		}
		result.push(unescapeGodotString(s.slice(start + 1, end)));
		i = end + 1;
	}
	return result;
}

function parseArray(s: string): GodotVariant[] {
	// Remove outer brackets
	const inner = s.slice(1, -1).trim();
	if (inner === "") return [];

	const items: GodotVariant[] = [];
	let depth = 0;
	let start = 0;

	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === "(" || ch === "[" || ch === "{") depth++;
		else if (ch === ")" || ch === "]" || ch === "}") depth--;
		else if (ch === "," && depth === 0) {
			items.push(parseVariant(inner.slice(start, i)));
			start = i + 1;
		}
	}
	if (start < inner.length) {
		items.push(parseVariant(inner.slice(start)));
	}

	return items;
}

function parseDictionary(s: string): GodotDictionary {
	const inner = s.slice(1, -1).trim();
	if (inner === "") return { type: "Dictionary", entries: [] };

	const entries: Array<{ key: GodotVariant; value: GodotVariant }> = [];
	// Split on commas at depth 0, then split each on first ": " at depth 0
	const parts = splitAtDepthZero(inner, ",");

	for (const part of parts) {
		const colonIdx = findColonAtDepthZero(part.trim());
		if (colonIdx === -1) continue;
		const key = parseVariant(part.trim().slice(0, colonIdx));
		const value = parseVariant(part.trim().slice(colonIdx + 1));
		entries.push({ key, value });
	}

	return { type: "Dictionary", entries };
}

function splitAtDepthZero(s: string, delimiter: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	let inString = false;

	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === "\\" && inString) {
			i++;
			continue;
		}
		if (ch === '"') inString = !inString;
		if (!inString) {
			if (ch === "(" || ch === "[" || ch === "{") depth++;
			else if (ch === ")" || ch === "]" || ch === "}") depth--;
			else if (depth === 0 && s.slice(i, i + delimiter.length) === delimiter) {
				parts.push(s.slice(start, i));
				start = i + delimiter.length;
			}
		}
	}
	if (start < s.length) parts.push(s.slice(start));
	return parts;
}

function findColonAtDepthZero(s: string): number {
	let depth = 0;
	let inString = false;

	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === "\\" && inString) {
			i++;
			continue;
		}
		if (ch === '"') inString = !inString;
		if (!inString) {
			if (ch === "(" || ch === "[" || ch === "{") depth++;
			else if (ch === ")" || ch === "]" || ch === "}") depth--;
			else if (ch === ":" && depth === 0) return i;
		}
	}
	return -1;
}

function formatNumber(n: number): string {
	if (Number.isInteger(n) && !Object.is(n, -0)) {
		// Godot writes floats with decimal points
		// If it's meant to be used in a float context, add .0
		return n.toString();
	}
	return n.toString();
}

function escapeGodotString(s: string): string {
	return s
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\t/g, "\\t")
		.replace(/\r/g, "\\r");
}

function unescapeGodotString(s: string): string {
	let result = "";
	for (let i = 0; i < s.length; i++) {
		if (s[i] === "\\" && i + 1 < s.length) {
			const next = s[i + 1];
			switch (next) {
				case "n":
					result += "\n";
					break;
				case "t":
					result += "\t";
					break;
				case "r":
					result += "\r";
					break;
				case "\\":
					result += "\\";
					break;
				case '"':
					result += '"';
					break;
				default:
					result += `\\${next}`;
					break;
			}
			i++;
		} else {
			result += s[i];
		}
	}
	return result;
}
