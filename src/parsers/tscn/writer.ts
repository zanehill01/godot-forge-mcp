/**
 * Writer for Godot's .tscn/.tres text format.
 *
 * Serializes a TscnDocument/TresDocument back to valid .tscn/.tres text.
 * Designed for round-trip fidelity — parse → write should produce identical output.
 */

import { writeVariant } from "../../utils/variant.js";
import type {
	ExtResource,
	SignalConnection,
	SubResource,
	TresDocument,
	TscnDocument,
	TscnNode,
} from "./types.js";

/**
 * Write a TscnDocument to .tscn format string.
 */
export function writeTscn(doc: TscnDocument): string {
	const lines: string[] = [];

	// File descriptor
	lines.push(writeDescriptor(doc));
	lines.push("");

	// External resources
	for (const ext of doc.extResources) {
		lines.push(writeExtResource(ext));
	}
	if (doc.extResources.length > 0) lines.push("");

	// Sub-resources
	for (const sub of doc.subResources) {
		lines.push(writeSubResource(sub));
		lines.push("");
	}

	// Nodes
	for (const node of doc.nodes) {
		lines.push(writeNode(node));
		lines.push("");
	}

	// Connections
	for (const conn of doc.connections) {
		lines.push(writeConnection(conn));
	}
	if (doc.connections.length > 0) lines.push("");

	// Trim trailing blank lines, ensure single trailing newline
	let result = lines.join("\n");
	result = result.replace(/\n+$/, "\n");
	return result;
}

/**
 * Write a TresDocument to .tres format string.
 */
export function writeTres(doc: TresDocument): string {
	const lines: string[] = [];

	// File descriptor
	const descAttrs: string[] = [];
	if (doc.descriptor.resourceType) {
		descAttrs.push(`type="${doc.descriptor.resourceType}"`);
	}
	descAttrs.push(`format=${doc.descriptor.format}`);
	if (doc.descriptor.uid) {
		descAttrs.push(`uid="${doc.descriptor.uid}"`);
	}
	lines.push(`[gd_resource ${descAttrs.join(" ")}]`);
	lines.push("");

	// External resources
	for (const ext of doc.extResources) {
		lines.push(writeExtResource(ext));
	}
	if (doc.extResources.length > 0) lines.push("");

	// Sub-resources
	for (const sub of doc.subResources) {
		lines.push(writeSubResource(sub));
		lines.push("");
	}

	// Resource section
	lines.push("[resource]");
	for (const [key, value] of Object.entries(doc.resource)) {
		lines.push(`${key} = ${writeVariant(value)}`);
	}
	lines.push("");

	let result = lines.join("\n");
	result = result.replace(/\n+$/, "\n");
	return result;
}

function writeDescriptor(doc: TscnDocument): string {
	const attrs: string[] = [];
	attrs.push(`format=${doc.descriptor.format}`);
	if (doc.descriptor.uid) {
		attrs.push(`uid="${doc.descriptor.uid}"`);
	}
	return `[gd_scene ${attrs.join(" ")}]`;
}

function writeExtResource(ext: ExtResource): string {
	const parts: string[] = [];
	parts.push(`type="${ext.type}"`);
	if (ext.uid) {
		parts.push(`uid="${ext.uid}"`);
	}
	parts.push(`path="${ext.path}"`);
	parts.push(`id="${ext.id}"`);
	return `[ext_resource ${parts.join(" ")}]`;
}

function writeSubResource(sub: SubResource): string {
	const lines: string[] = [];
	lines.push(`[sub_resource type="${sub.type}" id="${sub.id}"]`);
	for (const [key, value] of Object.entries(sub.properties)) {
		lines.push(`${key} = ${writeVariant(value)}`);
	}
	return lines.join("\n");
}

function writeNode(node: TscnNode): string {
	const parts: string[] = [];
	parts.push(`name="${node.name}"`);

	if (node.type) {
		parts.push(`type="${node.type}"`);
	}

	if (node.parent !== undefined) {
		parts.push(`parent="${node.parent}"`);
	}

	if (node.instance) {
		parts.push(`instance=ExtResource("${node.instance.id}")`);
	}

	if (node.uniqueNameInOwner) {
		parts.push("unique_name_in_owner=true");
	}

	if (node.index !== undefined) {
		parts.push(`index=${node.index}`);
	}

	if (node.groups && node.groups.length > 0) {
		const groupStr = node.groups.map((g) => `"${g}"`).join(", ");
		parts.push(`groups=PackedStringArray(${groupStr})`);
	}

	const lines: string[] = [];
	lines.push(`[node ${parts.join(" ")}]`);

	for (const [key, value] of Object.entries(node.properties)) {
		lines.push(`${key} = ${writeVariant(value)}`);
	}

	return lines.join("\n");
}

function writeConnection(conn: SignalConnection): string {
	const parts: string[] = [];
	parts.push(`signal="${conn.signal}"`);
	parts.push(`from="${conn.from}"`);
	parts.push(`to="${conn.to}"`);
	parts.push(`method="${conn.method}"`);

	if (conn.flags !== undefined && conn.flags !== 0) {
		parts.push(`flags=${conn.flags}`);
	}

	if (conn.unbinds !== undefined && conn.unbinds > 0) {
		parts.push(`unbinds=${conn.unbinds}`);
	}

	if (conn.binds && conn.binds.length > 0) {
		parts.push(`binds=${writeVariant(conn.binds)}`);
	}

	return `[connection ${parts.join(" ")}]`;
}
