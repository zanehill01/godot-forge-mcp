/**
 * Core Discovery Tools — Always exposed.
 *
 * Single unified tool: godot_discover
 * Actions: project_info, list_scenes, list_scripts, list_resources, list_assets, search, catalog
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
	server.tool(
		"godot_discover",
		`Discover and inspect the Godot project. One tool, many actions.

Actions & their parameters:
  "project_info"   — No extra params. Returns project metadata (name, version, renderer, main scene, autoloads, input actions, features).
  "list_scenes"    — No extra params. Lists all .tscn files with root node type and node count.
  "list_scripts"   — No extra params. Lists all GDScript/C# files with class names, extends info, export count.
  "list_resources" — No extra params. Lists all .tres resource files with their types.
  "list_assets"    — Optional: category (texture|model|audio|font|shader). Lists non-code assets.
  "search"         — Required: query. Optional: category (scene|script|resource|shader), extension, ignoreCase (default true), regex (default false), maxResults (default 50). Full-text search across project files.
  "catalog"        — Optional: activate (group name). Browse/activate specialized tool groups. No args = list groups.`,
		{
			action: z
				.enum(["project_info", "list_scenes", "list_scripts", "list_resources", "list_assets", "search", "catalog"])
				.describe("The discovery action to perform"),
			category: z
				.string()
				.optional()
				.describe("For list_assets: texture|model|audio|font|shader. For search: scene|script|resource|shader"),
			query: z
				.string()
				.optional()
				.describe("Search query (text or regex). Required for 'search' action"),
			extension: z
				.string()
				.optional()
				.describe("For search: filter by file extension (e.g., '.gd')"),
			ignoreCase: z
				.boolean()
				.optional()
				.default(true)
				.describe("For search: case-insensitive search (default true)"),
			regex: z
				.boolean()
				.optional()
				.default(false)
				.describe("For search: treat query as regex (default false)"),
			maxResults: z
				.number()
				.optional()
				.default(50)
				.describe("For search: maximum matches to return (default 50)"),
			activate: z
				.string()
				.optional()
				.describe("For catalog: group name to activate (e.g., 'shader', 'animation', 'physics')"),
		},
		async ({ action, category, query, extension, ignoreCase, regex, maxResults, activate }) => {
			switch (action) {
				// ── project_info ──────────────────────────────────────
				case "project_info": {
					const info = ctx.getProject().getInfo();
					return {
						content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
					};
				}

				// ── list_scenes ──────────────────────────────────────
				case "list_scenes": {
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
				}

				// ── list_scripts ─────────────────────────────────────
				case "list_scripts": {
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
				}

				// ── list_resources ────────────────────────────────────
				case "list_resources": {
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
				}

				// ── list_assets ──────────────────────────────────────
				case "list_assets": {
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
				}

				// ── search ───────────────────────────────────────────
				case "search": {
					if (!query) {
						return {
							content: [
								{
									type: "text",
									text: `The "query" parameter is required for the "search" action.`,
								},
							],
							isError: true,
						};
					}

					const searchCategory = category as
						| "scene"
						| "script"
						| "resource"
						| "shader"
						| undefined;

					const results = searchProject(ctx.getAssetManager(), query, {
						category: searchCategory,
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
				}

				// ── catalog ──────────────────────────────────────────
				case "catalog": {
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
				}
			}
		},
	);
}
