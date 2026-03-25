/**
 * Parser for Godot's .tscn text scene format.
 *
 * Takes a token stream from the lexer and produces a TscnDocument AST.
 */

import { parseVariant } from "../../utils/variant.js";
import { tokenize } from "./lexer.js";
import type {
	ExtResource,
	FileDescriptor,
	GodotVariant,
	SignalConnection,
	SubResource,
	TscnDocument,
	TscnNode,
	Token,
	TresDocument,
} from "./types.js";
import { TokenType } from "./types.js";

/**
 * Parse a .tscn file content string into a TscnDocument.
 */
export function parseTscn(content: string): TscnDocument {
	const tokens = tokenize(content);
	return buildDocument(tokens);
}

/**
 * Parse a .tres file content string into a TresDocument.
 */
export function parseTres(content: string): TresDocument {
	const tokens = tokenize(content);
	const doc = buildDocument(tokens);

	// Find the [resource] section — it's stored as a node with no parent in our generic parse,
	// or we need to extract it from properties that follow the [resource] header
	const resourceProps = extractResourceSection(tokens);

	return {
		descriptor: doc.descriptor,
		extResources: doc.extResources,
		subResources: doc.subResources,
		resource: resourceProps,
	};
}

function buildDocument(tokens: Token[]): TscnDocument {
	const doc: TscnDocument = {
		descriptor: { type: "gd_scene", format: 3 },
		extResources: [],
		subResources: [],
		nodes: [],
		connections: [],
	};

	let i = 0;

	while (i < tokens.length) {
		const token = tokens[i];

		if (token.type !== TokenType.SectionHeader) {
			i++;
			continue;
		}

		switch (token.sectionType) {
			case "gd_scene":
			case "gd_resource": {
				doc.descriptor = parseDescriptor(token);
				i++;
				break;
			}

			case "ext_resource": {
				doc.extResources.push(parseExtResource(token));
				i++;
				break;
			}

			case "sub_resource": {
				const { resource, nextIndex } = parseSubResource(tokens, i);
				doc.subResources.push(resource);
				i = nextIndex;
				break;
			}

			case "node": {
				const { node, nextIndex } = parseNode(tokens, i);
				doc.nodes.push(node);
				i = nextIndex;
				break;
			}

			case "connection": {
				doc.connections.push(parseConnection(token));
				i++;
				break;
			}

			case "resource": {
				// .tres [resource] section — skip header, properties handled elsewhere
				i++;
				break;
			}

			default:
				i++;
				break;
		}
	}

	return doc;
}

function parseDescriptor(token: Token & { type: TokenType.SectionHeader }): FileDescriptor {
	const attrs = token.attributes;
	const desc: FileDescriptor = {
		type: token.sectionType as "gd_scene" | "gd_resource",
		format: Number(attrs.format ?? "3"),
	};
	if (attrs.uid) desc.uid = attrs.uid;
	if (attrs.type) desc.resourceType = attrs.type;
	return desc;
}

function parseExtResource(token: Token & { type: TokenType.SectionHeader }): ExtResource {
	const attrs = token.attributes;
	return {
		type: attrs.type ?? "",
		uid: attrs.uid,
		path: attrs.path ?? "",
		id: attrs.id ?? "",
	};
}

function parseSubResource(
	tokens: Token[],
	startIndex: number,
): { resource: SubResource; nextIndex: number } {
	const header = tokens[startIndex];
	if (header.type !== TokenType.SectionHeader) {
		throw new Error(`Expected SectionHeader at index ${startIndex}`);
	}

	const resource: SubResource = {
		type: header.attributes.type ?? "",
		id: header.attributes.id ?? "",
		properties: {},
	};

	let i = startIndex + 1;
	while (i < tokens.length) {
		const token = tokens[i];
		if (token.type === TokenType.SectionHeader) break;
		if (token.type === TokenType.Property) {
			resource.properties[token.key] = parseVariant(token.value);
		}
		i++;
	}

	return { resource, nextIndex: i };
}

function parseNode(
	tokens: Token[],
	startIndex: number,
): { node: TscnNode; nextIndex: number } {
	const header = tokens[startIndex];
	if (header.type !== TokenType.SectionHeader) {
		throw new Error(`Expected SectionHeader at index ${startIndex}`);
	}

	const attrs = header.attributes;
	const node: TscnNode = {
		name: attrs.name ?? "",
		properties: {},
	};

	if (attrs.type) node.type = attrs.type;
	if (attrs.parent !== undefined) node.parent = attrs.parent;
	if (attrs.instance) {
		node.instance = { type: "ExtResource", id: attrs.instance.replace(/^ExtResource\("?|"?\)$/g, "") };
	}
	if (attrs.unique_name_in_owner === "true") node.uniqueNameInOwner = true;
	if (attrs.index) node.index = Number(attrs.index);
	if (attrs.groups) {
		// groups is a PackedStringArray in the header
		node.groups = parseGroupsAttribute(attrs.groups);
	}

	let i = startIndex + 1;
	while (i < tokens.length) {
		const token = tokens[i];
		if (token.type === TokenType.SectionHeader) break;
		if (token.type === TokenType.Property) {
			node.properties[token.key] = parseVariant(token.value);
		}
		i++;
	}

	return { node, nextIndex: i };
}

function parseConnection(token: Token & { type: TokenType.SectionHeader }): SignalConnection {
	const attrs = token.attributes;
	const conn: SignalConnection = {
		signal: attrs.signal ?? "",
		from: attrs.from ?? "",
		to: attrs.to ?? "",
		method: attrs.method ?? "",
	};
	if (attrs.flags) conn.flags = Number(attrs.flags);
	if (attrs.unbinds) conn.unbinds = Number(attrs.unbinds);
	if (attrs.binds) {
		conn.binds = parseVariant(attrs.binds) as GodotVariant[];
	}
	return conn;
}

function parseGroupsAttribute(value: string): string[] {
	// groups=PackedStringArray("enemies", "damageable")
	if (value.startsWith("PackedStringArray(")) {
		const inner = value.slice("PackedStringArray(".length, -1);
		if (inner.trim() === "") return [];
		return inner.split(",").map((s) => {
			const trimmed = s.trim();
			return trimmed.startsWith('"') ? trimmed.slice(1, -1) : trimmed;
		});
	}
	return [];
}

function extractResourceSection(tokens: Token[]): Record<string, GodotVariant> {
	const props: Record<string, GodotVariant> = {};
	let inResourceSection = false;

	for (const token of tokens) {
		if (token.type === TokenType.SectionHeader) {
			if (token.sectionType === "resource") {
				inResourceSection = true;
				continue;
			}
			if (inResourceSection) break; // hit next section
		}
		if (inResourceSection && token.type === TokenType.Property) {
			props[token.key] = parseVariant(token.value);
		}
	}

	return props;
}
