/**
 * Core Scene Operations — Always exposed.
 *
 * Single unified tool: godot_scene
 * Actions: read, create, add_node, modify_node, remove_node,
 *          connect_signal, disconnect_signal, instance_scene
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
	server.tool(
		"godot_scene",
		[
			"Unified scene operations for .tscn files.",
			"",
			"Actions and their parameters:",
			"",
			'  read — Parse a scene into JSON. Params: path (required).',
			'  create — Create a new scene. Params: path (required), rootType (required), rootName, scriptPath, children.',
			'  add_node — Add a node to a scene. Params: scenePath (required), name (required), type (required), parent, properties, groups.',
			'  modify_node — Modify node properties. Params: scenePath (required), nodePath (required), properties (required).',
			'  remove_node — Remove a node and its subtree. Params: scenePath (required), nodePath (required).',
			'  connect_signal — Connect a signal. Params: scenePath (required), signal (required), from (required), to (required), method (required).',
			'  disconnect_signal — Disconnect a signal. Params: scenePath (required), signal (required), from (required), to (required), method (required).',
			'  instance_scene — Instance a PackedScene as a child. Params: scenePath (required), instancePath (required), name (required), parent, properties.',
		].join("\n"),
		{
			action: z
				.enum([
					"read",
					"create",
					"add_node",
					"modify_node",
					"remove_node",
					"connect_signal",
					"disconnect_signal",
					"instance_scene",
				])
				.describe("The scene operation to perform"),

			// read
			path: z
				.string()
				.optional()
				.describe('Scene path in res:// format. Used by: read, create.'),

			// create
			rootType: z
				.string()
				.optional()
				.describe('Root node type (e.g., "Node2D", "CharacterBody3D"). Used by: create.'),
			rootName: z
				.string()
				.optional()
				.describe("Root node name (defaults to filename). Used by: create."),
			scriptPath: z
				.string()
				.optional()
				.describe("res:// path to a GDScript to attach to root. Used by: create."),
			children: z
				.array(
					z.object({
						name: z.string(),
						type: z.string(),
						properties: z.record(z.string(), z.string()).optional(),
					}),
				)
				.optional()
				.describe("Child nodes to add under root. Used by: create."),

			// add_node, modify_node, remove_node, connect_signal, disconnect_signal, instance_scene
			scenePath: z
				.string()
				.optional()
				.describe("Scene path in res:// format. Used by: add_node, modify_node, remove_node, connect_signal, disconnect_signal, instance_scene."),

			// add_node, instance_scene
			name: z
				.string()
				.optional()
				.describe('Node name. Used by: add_node, instance_scene.'),

			// add_node
			type: z
				.string()
				.optional()
				.describe('Node type (e.g., "Sprite2D"). Used by: add_node.'),

			// add_node, instance_scene
			parent: z
				.string()
				.optional()
				.describe('Parent node path relative to root (e.g., ".", "Body/Arm"). Used by: add_node, instance_scene. Defaults to ".".'),

			// add_node, modify_node, instance_scene
			properties: z
				.record(z.string(), z.string())
				.optional()
				.describe("Properties as key-value pairs (values in Godot Variant format). Used by: add_node, modify_node, instance_scene."),

			// add_node
			groups: z
				.array(z.string())
				.optional()
				.describe("Node groups. Used by: add_node."),

			// modify_node, remove_node
			nodePath: z
				.string()
				.optional()
				.describe('Node path (e.g., "." for root, "Player/Sprite"). Used by: modify_node, remove_node.'),

			// connect_signal, disconnect_signal
			signal: z
				.string()
				.optional()
				.describe('Signal name (e.g., "body_entered", "pressed"). Used by: connect_signal, disconnect_signal.'),
			from: z
				.string()
				.optional()
				.describe('Source node path. Used by: connect_signal, disconnect_signal.'),
			to: z
				.string()
				.optional()
				.describe('Target node path. Used by: connect_signal, disconnect_signal.'),
			method: z
				.string()
				.optional()
				.describe('Method name on target. Used by: connect_signal, disconnect_signal.'),

			// instance_scene
			instancePath: z
				.string()
				.optional()
				.describe('Scene to instance (res:// path). Used by: instance_scene.'),
		},
		async (params) => {
			switch (params.action) {
				// ── read ──────────────────────────────────────────
				case "read": {
					const path = requireParam(params.path, "path", "read");
					try {
						const absPath = resToAbsolute(path, ctx.projectRoot);
						const content = readFileSync(absPath, "utf-8");
						const doc = parseTscn(content);
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
				}

				// ── create ───────────────────────────────────────
				case "create": {
					const path = requireParam(params.path, "path", "create");
					const rootType = requireParam(params.rootType, "rootType", "create");
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

						const rootNode: TscnNode = {
							name: params.rootName ?? baseName,
							type: rootType,
							properties: {},
						};

						if (params.scriptPath) {
							const scriptId = generateResourceId();
							doc.extResources.push({
								type: "Script",
								uid: generateUid(),
								path: params.scriptPath,
								id: scriptId,
							});
							rootNode.properties.script = { type: "ExtResource", id: scriptId };
						}

						doc.nodes.push(rootNode);

						if (params.children) {
							for (const child of params.children) {
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
									text: `Created scene at ${path} with root ${rootType} "${rootNode.name}" and ${(params.children?.length ?? 0)} children.`,
								},
							],
						};
					} catch (e) {
						return {
							content: [{ type: "text", text: `Error creating scene: ${e}` }],
							isError: true,
						};
					}
				}

				// ── add_node ─────────────────────────────────────
				case "add_node": {
					const scenePath = requireParam(params.scenePath, "scenePath", "add_node");
					const name = requireParam(params.name, "name", "add_node");
					const type = requireParam(params.type, "type", "add_node");
					const parent = params.parent ?? ".";
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

						if (params.properties) {
							for (const [k, v] of Object.entries(params.properties)) {
								node.properties[k] = parseVariant(v);
							}
						}

						if (params.groups && params.groups.length > 0) {
							node.groups = params.groups;
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
				}

				// ── modify_node ──────────────────────────────────
				case "modify_node": {
					const scenePath = requireParam(params.scenePath, "scenePath", "modify_node");
					const nodePath = requireParam(params.nodePath, "nodePath", "modify_node");
					const properties = requireParam(params.properties, "properties", "modify_node");
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
				}

				// ── remove_node ──────────────────────────────────
				case "remove_node": {
					const scenePath = requireParam(params.scenePath, "scenePath", "remove_node");
					const nodePath = requireParam(params.nodePath, "nodePath", "remove_node");
					try {
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const content = readFileSync(absPath, "utf-8");
						const doc = parseTscn(content);

						const fullPath = resolveFullNodePath(doc, nodePath);
						const before = doc.nodes.length;

						doc.nodes = doc.nodes.filter((n) => {
							const nPath = getNodeFullPath(doc, n);
							return nPath !== fullPath && !nPath.startsWith(`${fullPath}/`);
						});

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
				}

				// ── connect_signal ────────────────────────────────
				case "connect_signal": {
					const scenePath = requireParam(params.scenePath, "scenePath", "connect_signal");
					const signal = requireParam(params.signal, "signal", "connect_signal");
					const from = requireParam(params.from, "from", "connect_signal");
					const to = requireParam(params.to, "to", "connect_signal");
					const method = requireParam(params.method, "method", "connect_signal");
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
				}

				// ── disconnect_signal ─────────────────────────────
				case "disconnect_signal": {
					const scenePath = requireParam(params.scenePath, "scenePath", "disconnect_signal");
					const signal = requireParam(params.signal, "signal", "disconnect_signal");
					const from = requireParam(params.from, "from", "disconnect_signal");
					const to = requireParam(params.to, "to", "disconnect_signal");
					const method = requireParam(params.method, "method", "disconnect_signal");
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
				}

				// ── instance_scene ────────────────────────────────
				case "instance_scene": {
					const scenePath = requireParam(params.scenePath, "scenePath", "instance_scene");
					const instancePath = requireParam(params.instancePath, "instancePath", "instance_scene");
					const name = requireParam(params.name, "name", "instance_scene");
					const parent = params.parent ?? ".";
					try {
						const absPath = resToAbsolute(scenePath, ctx.projectRoot);
						const content = readFileSync(absPath, "utf-8");
						const doc = parseTscn(content);

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

						if (params.properties) {
							for (const [k, v] of Object.entries(params.properties)) {
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
				}
			}
		},
	);
}

// ── Param validation helper ────────────────────────────────────

function requireParam<T>(value: T | undefined, name: string, action: string): T {
	if (value === undefined) {
		throw new Error(`Missing required parameter "${name}" for action "${action}".`);
	}
	return value;
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
