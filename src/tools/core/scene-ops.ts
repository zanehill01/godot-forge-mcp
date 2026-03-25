/**
 * Core Scene Operations — Always exposed.
 *
 * read_scene, create_scene, add_node, modify_node, remove_node,
 * connect_signal, disconnect_signal, instance_scene
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import type { TscnDocument, TscnNode } from "../../parsers/tscn/types.js";
import { resToAbsolute, generateResourceId } from "../../utils/path.js";
import { generateUid } from "../../utils/uid.js";
import { parseVariant } from "../../utils/variant.js";
import type { ToolContext } from "../registry.js";

export function registerSceneOpsTools(server: McpServer, ctx: ToolContext): void {
	// ── godot_read_scene ───────────────────────────────────────
	server.tool(
		"godot_read_scene",
		"Parse a .tscn scene file into structured JSON showing the full node tree, properties, signal connections, and resources. Provide a res:// path.",
		{
			path: z.string().describe('Scene path (res:// format, e.g., "res://scenes/player.tscn")'),
		},
		async ({ path }) => {
			try {
				const absPath = resToAbsolute(path, ctx.projectRoot);
				const content = readFileSync(absPath, "utf-8");
				const doc = parseTscn(content);

				// Build a tree view for readability
				const tree = buildNodeTree(doc);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									path,
									descriptor: doc.descriptor,
									extResources: doc.extResources,
									subResources: doc.subResources,
									nodeTree: tree,
									connections: doc.connections,
									nodeCount: doc.nodes.length,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error reading scene: ${e}` }],
					isError: true,
				};
			}
		},
	);

	// ── godot_create_scene ─────────────────────────────────────
	server.tool(
		"godot_create_scene",
		"Create a new .tscn scene file with a root node. Optionally add child nodes and attach a script.",
		{
			path: z.string().describe('Scene path (res:// format, e.g., "res://scenes/enemy.tscn")'),
			rootType: z
				.string()
				.describe('Root node type (e.g., "Node2D", "CharacterBody3D", "Control")'),
			rootName: z.string().optional().describe("Root node name (defaults to filename)"),
			scriptPath: z.string().optional().describe("res:// path to a GDScript to attach to root"),
			children: z
				.array(
					z.object({
						name: z.string(),
						type: z.string(),
						properties: z.record(z.string(), z.string()).optional(),
					}),
				)
				.optional()
				.describe("Child nodes to add under root"),
		},
		async ({ path, rootType, rootName, scriptPath, children }) => {
			try {
				const absPath = resToAbsolute(path, ctx.projectRoot);
				const baseName = path.split("/").pop()?.replace(".tscn", "") ?? "Root";

				const doc: TscnDocument = {
					descriptor: { type: "gd_scene", format: 3, uid: generateUid() },
					extResources: [],
					subResources: [],
					nodes: [],
					connections: [],
				};

				// Root node
				const rootNode: TscnNode = {
					name: rootName ?? baseName,
					type: rootType,
					properties: {},
				};

				// Attach script if provided
				if (scriptPath) {
					const scriptId = generateResourceId();
					doc.extResources.push({
						type: "Script",
						uid: generateUid(),
						path: scriptPath,
						id: scriptId,
					});
					rootNode.properties.script = { type: "ExtResource", id: scriptId };
				}

				doc.nodes.push(rootNode);

				// Add children
				if (children) {
					for (const child of children) {
						const childNode: TscnNode = {
							name: child.name,
							type: child.type,
							parent: ".",
							properties: {},
						};
						if (child.properties) {
							for (const [k, v] of Object.entries(child.properties)) {
								childNode.properties[k] = parseVariant(v);
							}
						}
						doc.nodes.push(childNode);
					}
				}

				const output = writeTscn(doc);
				writeFileSync(absPath, output, "utf-8");
				ctx.getAssetManager().invalidate();

				return {
					content: [
						{
							type: "text",
							text: `Created scene at ${path} with root ${rootType} "${rootNode.name}" and ${(children?.length ?? 0)} children.`,
						},
					],
				};
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error creating scene: ${e}` }],
					isError: true,
				};
			}
		},
	);

	// ── godot_add_node ─────────────────────────────────────────
	server.tool(
		"godot_add_node",
		"Add a node to an existing scene. Specify the parent path relative to root.",
		{
			scenePath: z.string().describe("Scene path (res:// format)"),
			name: z.string().describe("Node name"),
			type: z.string().describe('Node type (e.g., "Sprite2D", "CollisionShape3D")'),
			parent: z
				.string()
				.optional()
				.default(".")
				.describe('Parent node path relative to root (e.g., ".", "Body/Arm")'),
			properties: z
				.record(z.string(), z.string())
				.optional()
				.describe("Properties as key-value pairs (values in Godot Variant format)"),
			groups: z.array(z.string()).optional().describe("Node groups to add to"),
		},
		async ({ scenePath, name, type, parent, properties, groups }) => {
			try {
				const absPath = resToAbsolute(scenePath, ctx.projectRoot);
				const content = readFileSync(absPath, "utf-8");
				const doc = parseTscn(content);

				const node: TscnNode = {
					name,
					type,
					parent,
					properties: {},
				};

				if (properties) {
					for (const [k, v] of Object.entries(properties)) {
						node.properties[k] = parseVariant(v);
					}
				}

				if (groups && groups.length > 0) {
					node.groups = groups;
				}

				doc.nodes.push(node);

				writeFileSync(absPath, writeTscn(doc), "utf-8");

				return {
					content: [
						{
							type: "text",
							text: `Added ${type} "${name}" under "${parent}" in ${scenePath}.`,
						},
					],
				};
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error adding node: ${e}` }],
					isError: true,
				};
			}
		},
	);

	// ── godot_modify_node ──────────────────────────────────────
	server.tool(
		"godot_modify_node",
		"Modify properties of an existing node in a scene.",
		{
			scenePath: z.string().describe("Scene path (res:// format)"),
			nodePath: z
				.string()
				.describe('Node path (e.g., "." for root, "Player", "Player/Sprite")'),
			properties: z
				.record(z.string(), z.string())
				.describe("Properties to set (values in Godot Variant format)"),
		},
		async ({ scenePath, nodePath, properties }) => {
			try {
				const absPath = resToAbsolute(scenePath, ctx.projectRoot);
				const content = readFileSync(absPath, "utf-8");
				const doc = parseTscn(content);

				const node = findNode(doc, nodePath);
				if (!node) {
					return {
						content: [{ type: "text", text: `Node "${nodePath}" not found in scene.` }],
						isError: true,
					};
				}

				for (const [k, v] of Object.entries(properties)) {
					node.properties[k] = parseVariant(v);
				}

				writeFileSync(absPath, writeTscn(doc), "utf-8");

				return {
					content: [
						{
							type: "text",
							text: `Modified ${Object.keys(properties).length} properties on "${nodePath}" in ${scenePath}.`,
						},
					],
				};
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error modifying node: ${e}` }],
					isError: true,
				};
			}
		},
	);

	// ── godot_remove_node ──────────────────────────────────────
	server.tool(
		"godot_remove_node",
		"Remove a node (and its entire subtree) from a scene. Also removes signal connections involving the node.",
		{
			scenePath: z.string().describe("Scene path (res:// format)"),
			nodePath: z.string().describe('Node path to remove (e.g., "Enemy", "UI/HealthBar")'),
		},
		async ({ scenePath, nodePath }) => {
			try {
				const absPath = resToAbsolute(scenePath, ctx.projectRoot);
				const content = readFileSync(absPath, "utf-8");
				const doc = parseTscn(content);

				const fullPath = resolveFullNodePath(doc, nodePath);
				const before = doc.nodes.length;

				// Remove the node and all children
				doc.nodes = doc.nodes.filter((n) => {
					const nPath = getNodeFullPath(doc, n);
					return nPath !== fullPath && !nPath.startsWith(`${fullPath}/`);
				});

				// Remove connections involving removed nodes
				doc.connections = doc.connections.filter(
					(c) => !isUnderPath(c.from, fullPath) && !isUnderPath(c.to, fullPath),
				);

				const removed = before - doc.nodes.length;
				writeFileSync(absPath, writeTscn(doc), "utf-8");

				return {
					content: [
						{
							type: "text",
							text: `Removed ${removed} node(s) at "${nodePath}" from ${scenePath}.`,
						},
					],
				};
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error removing node: ${e}` }],
					isError: true,
				};
			}
		},
	);

	// ── godot_connect_signal ───────────────────────────────────
	server.tool(
		"godot_connect_signal",
		"Connect a signal between nodes in a scene.",
		{
			scenePath: z.string().describe("Scene path (res:// format)"),
			signal: z.string().describe('Signal name (e.g., "body_entered", "pressed")'),
			from: z.string().describe('Source node path (e.g., ".", "Area2D")'),
			to: z.string().describe('Target node path (e.g., ".", "Player")'),
			method: z.string().describe('Method name on target (e.g., "_on_body_entered")'),
		},
		async ({ scenePath, signal, from, to, method }) => {
			try {
				const absPath = resToAbsolute(scenePath, ctx.projectRoot);
				const content = readFileSync(absPath, "utf-8");
				const doc = parseTscn(content);

				doc.connections.push({ signal, from, to, method });

				writeFileSync(absPath, writeTscn(doc), "utf-8");

				return {
					content: [
						{
							type: "text",
							text: `Connected ${signal} from "${from}" to "${to}::${method}" in ${scenePath}.`,
						},
					],
				};
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error connecting signal: ${e}` }],
					isError: true,
				};
			}
		},
	);

	// ── godot_disconnect_signal ────────────────────────────────
	server.tool(
		"godot_disconnect_signal",
		"Remove a signal connection from a scene.",
		{
			scenePath: z.string().describe("Scene path (res:// format)"),
			signal: z.string().describe("Signal name"),
			from: z.string().describe("Source node path"),
			to: z.string().describe("Target node path"),
			method: z.string().describe("Method name"),
		},
		async ({ scenePath, signal, from, to, method }) => {
			try {
				const absPath = resToAbsolute(scenePath, ctx.projectRoot);
				const content = readFileSync(absPath, "utf-8");
				const doc = parseTscn(content);

				const before = doc.connections.length;
				doc.connections = doc.connections.filter(
					(c) =>
						!(
							c.signal === signal &&
							c.from === from &&
							c.to === to &&
							c.method === method
						),
				);

				writeFileSync(absPath, writeTscn(doc), "utf-8");

				return {
					content: [
						{
							type: "text",
							text:
								before > doc.connections.length
									? `Disconnected ${signal} from "${from}" to "${to}::${method}".`
									: "No matching connection found.",
						},
					],
				};
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error disconnecting signal: ${e}` }],
					isError: true,
				};
			}
		},
	);

	// ── godot_instance_scene ───────────────────────────────────
	server.tool(
		"godot_instance_scene",
		"Add a scene instance (PackedScene) as a child node in another scene.",
		{
			scenePath: z.string().describe("Parent scene path (res:// format)"),
			instancePath: z
				.string()
				.describe('Scene to instance (res:// path, e.g., "res://scenes/enemy.tscn")'),
			name: z.string().describe("Instance node name"),
			parent: z
				.string()
				.optional()
				.default(".")
				.describe("Parent node path in the scene"),
			properties: z
				.record(z.string(), z.string())
				.optional()
				.describe("Property overrides for the instance"),
		},
		async ({ scenePath, instancePath, name, parent, properties }) => {
			try {
				const absPath = resToAbsolute(scenePath, ctx.projectRoot);
				const content = readFileSync(absPath, "utf-8");
				const doc = parseTscn(content);

				// Add ext_resource for the instanced scene
				const resId = generateResourceId();
				doc.extResources.push({
					type: "PackedScene",
					uid: generateUid(),
					path: instancePath,
					id: resId,
				});

				const node: TscnNode = {
					name,
					parent,
					instance: { type: "ExtResource", id: resId },
					properties: {},
				};

				if (properties) {
					for (const [k, v] of Object.entries(properties)) {
						node.properties[k] = parseVariant(v);
					}
				}

				doc.nodes.push(node);
				writeFileSync(absPath, writeTscn(doc), "utf-8");

				return {
					content: [
						{
							type: "text",
							text: `Added instance of ${instancePath} as "${name}" under "${parent}" in ${scenePath}.`,
						},
					],
				};
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error instancing scene: ${e}` }],
					isError: true,
				};
			}
		},
	);
}

// ── Helpers ────────────────────────────────────────────────────

function buildNodeTree(doc: TscnDocument): object {
	if (doc.nodes.length === 0) return {};

	const root = doc.nodes[0];
	const result: Record<string, unknown> = {
		name: root.name,
		type: root.type,
		properties: root.properties,
		children: [] as object[],
	};

	// Build children recursively
	const childrenOf = (parentPath: string): object[] => {
		return doc.nodes
			.filter((n) => n.parent === parentPath)
			.map((n) => {
				const myPath = parentPath === "." ? n.name : `${parentPath}/${n.name}`;
				return {
					name: n.name,
					type: n.type ?? (n.instance ? `[instance]` : "unknown"),
					parent: n.parent,
					properties: n.properties,
					groups: n.groups,
					children: childrenOf(myPath),
				};
			});
	};

	result.children = childrenOf(".");
	return result;
}

function findNode(doc: TscnDocument, path: string): TscnNode | undefined {
	if (path === ".") return doc.nodes[0];
	return doc.nodes.find((n) => {
		if (n.parent === undefined) return path === n.name;
		const fullPath = n.parent === "." ? n.name : `${n.parent}/${n.name}`;
		return fullPath === path;
	});
}

function getNodeFullPath(_doc: TscnDocument, node: TscnNode): string {
	if (node.parent === undefined) return ".";
	return node.parent === "." ? node.name : `${node.parent}/${node.name}`;
}

function resolveFullNodePath(_doc: TscnDocument, path: string): string {
	return path;
}

function isUnderPath(nodePath: string, targetPath: string): boolean {
	return nodePath === targetPath || nodePath.startsWith(`${targetPath}/`);
}
