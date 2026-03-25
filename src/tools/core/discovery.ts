/**
 * Core Discovery Tools — Always exposed.
 *
 * project_info, list_scenes, list_scripts, list_resources, list_assets, search, catalog
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { readFileSync } from "node:fs";
import { searchProject } from "../../engine/search.js";
import {
	activateGroup,
	getCatalog,
	type ToolContext,
} from "../registry.js";

export function registerDiscoveryTools(server: McpServer, ctx: ToolContext): void {
	// ── godot_project_info ─────────────────────────────────────
	server.tool(
		"godot_project_info",
		"Get Godot project metadata: name, version, renderer, main scene, autoloads, input actions, features. Always call this first to understand the project.",
		{},
		async () => {
			const info = ctx.getProject().getInfo();
			return {
				content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
			};
		},
	);

	// ── godot_list_scenes ──────────────────────────────────────
	server.tool(
		"godot_list_scenes",
		"List all .tscn scene files in the project with metadata (root node type, node count). Use to understand project structure.",
		{},
		async () => {
			const scenes = ctx.getAssetManager().byCategory("scene");
			const results = scenes.map((s) => {
				let rootType = "unknown";
				let nodeCount = 0;
				try {
					const content = readFileSync(s.absPath, "utf-8");
					const doc = parseTscn(content);
					if (doc.nodes.length > 0) {
						rootType = doc.nodes[0].type ?? "inherited";
					}
					nodeCount = doc.nodes.length;
				} catch {
					// skip parse errors
				}
				return {
					path: s.resPath,
					rootType,
					nodeCount,
					size: s.size,
				};
			});

			return {
				content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
			};
		},
	);

	// ── godot_list_scripts ─────────────────────────────────────
	server.tool(
		"godot_list_scripts",
		"List all GDScript (.gd) and C# (.cs) files with class names and extends info.",
		{},
		async () => {
			const scripts = ctx.getAssetManager().byCategory("script");
			const results = scripts.map((s) => {
				let className = "";
				let extendsType = "";
				let exportCount = 0;

				try {
					const content = readFileSync(s.absPath, "utf-8");
					const lines = content.split("\n");
					for (const line of lines) {
						const trimmed = line.trim();
						if (trimmed.startsWith("class_name ")) {
							className = trimmed.slice("class_name ".length).trim();
						}
						if (trimmed.startsWith("extends ")) {
							extendsType = trimmed.slice("extends ".length).trim();
						}
						if (trimmed.startsWith("@export")) {
							exportCount++;
						}
					}
				} catch {
					// skip
				}

				return {
					path: s.resPath,
					className: className || undefined,
					extends: extendsType || undefined,
					exportCount,
					size: s.size,
				};
			});

			return {
				content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
			};
		},
	);

	// ── godot_list_resources ───────────────────────────────────
	server.tool(
		"godot_list_resources",
		"List all .tres resource files with their types.",
		{},
		async () => {
			const resources = ctx.getAssetManager().byCategory("resource");
			const results = resources.map((r) => {
				let resourceType = "unknown";
				try {
					const content = readFileSync(r.absPath, "utf-8");
					const match = content.match(/\[gd_resource\s+type="([^"]+)"/);
					if (match) resourceType = match[1];
				} catch {
					// skip
				}
				return {
					path: r.resPath,
					type: resourceType,
					size: r.size,
				};
			});

			return {
				content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
			};
		},
	);

	// ── godot_list_assets ──────────────────────────────────────
	server.tool(
		"godot_list_assets",
		"List non-code assets: textures, models, audio, fonts. Shows path, type, and size.",
		{
			category: z
				.enum(["texture", "model", "audio", "font", "shader"])
				.optional()
				.describe("Filter by asset category"),
		},
		async ({ category }) => {
			let assets = ctx.getAssetManager().getAssets();
			const nonCodeCategories = new Set(["texture", "model", "audio", "font", "shader"]);

			if (category) {
				assets = assets.filter((a) => a.category === category);
			} else {
				assets = assets.filter((a) => nonCodeCategories.has(a.category));
			}

			const results = assets.map((a) => ({
				path: a.resPath,
				category: a.category,
				ext: a.ext,
				size: a.size,
			}));

			return {
				content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
			};
		},
	);

	// ── godot_search ───────────────────────────────────────────
	server.tool(
		"godot_search",
		"Full-text search across all project files (scenes, scripts, resources, shaders). Returns matching lines with context.",
		{
			query: z.string().describe("Search query (text or regex)"),
			category: z
				.enum(["scene", "script", "resource", "shader"])
				.optional()
				.describe("Filter by file category"),
			extension: z.string().optional().describe("Filter by file extension (e.g., '.gd')"),
			ignoreCase: z.boolean().optional().default(true).describe("Case-insensitive search"),
			regex: z.boolean().optional().default(false).describe("Treat query as regex"),
			maxResults: z.number().optional().default(50).describe("Maximum matches to return"),
		},
		async ({ query, category, extension, ignoreCase, regex, maxResults }) => {
			const results = searchProject(ctx.getAssetManager(), query, {
				category,
				extension,
				ignoreCase,
				regex,
				maxResults,
			});

			const summary = results.map((r) => ({
				path: r.resPath,
				category: r.category,
				matchCount: r.matches.length,
				matches: r.matches.slice(0, 10).map((m) => ({
					line: m.line,
					text: m.context,
				})),
			}));

			return {
				content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
			};
		},
	);

	// ── godot_catalog ──────────────────────────────────────────
	server.tool(
		"godot_catalog",
		`Browse and activate specialized tool groups. Groups provide domain-specific tools for shader authoring, animation, physics, UI, audio, tilemap, 3D, AI/behavior, debugging, project management, and refactoring. Call with no arguments to list available groups, or provide a group name to activate it.`,
		{
			activate: z
				.string()
				.optional()
				.describe("Group name to activate (e.g., 'shader', 'animation', 'physics')"),
		},
		async ({ activate }) => {
			if (activate) {
				const success = activateGroup(activate, server, ctx);
				if (!success) {
					return {
						content: [
							{
								type: "text",
								text: `Failed to activate group "${activate}". It may not exist or may require the editor plugin to be connected.`,
							},
						],
						isError: true,
					};
				}
				const catalog = getCatalog();
				const group = catalog.find((g) => g.name === activate);
				return {
					content: [
						{
							type: "text",
							text: `Activated "${activate}" group (${group?.toolCount ?? 0} tools). These tools are now available.`,
						},
					],
				};
			}

			const catalog = getCatalog();
			return {
				content: [{ type: "text", text: JSON.stringify(catalog, null, 2) }],
			};
		},
	);
}
