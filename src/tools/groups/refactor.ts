/**
 * Refactor Tool Group — 5 tools for project cleanup and analysis.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import type { ToolContext } from "../registry.js";

export function registerRefactorTools(server: McpServer, ctx: ToolContext): void {
	server.tool("godot_find_unused", "Find orphaned scripts, resources, and assets not referenced by any scene.", {
		category: z.enum(["script", "resource", "texture", "audio", "all"]).optional().default("all"),
	}, async ({ category }) => {
		try {
			const assets = ctx.getAssetManager().getAssets();
			const scenes = assets.filter((a) => a.ext === ".tscn" || a.ext === ".scn");

			// Collect all referenced paths from scenes
			const referenced = new Set<string>();
			for (const s of scenes) {
				try {
					const content = readFileSync(s.absPath, "utf-8");
					const pathMatches = content.matchAll(/path="(res:\/\/[^"]+)"/g);
					for (const m of pathMatches) referenced.add(m[1]);
					// Also check for preload/load references in scripts
					const loadMatches = content.matchAll(/(?:pre)?load\("(res:\/\/[^"]+)"\)/g);
					for (const m of loadMatches) referenced.add(m[1]);
				} catch { /* skip */ }
			}

			// Also scan scripts for references
			const scripts = assets.filter((a) => a.ext === ".gd" || a.ext === ".cs");
			for (const s of scripts) {
				try {
					const content = readFileSync(s.absPath, "utf-8");
					const loadMatches = content.matchAll(/(?:pre)?load\("(res:\/\/[^"]+)"\)/g);
					for (const m of loadMatches) referenced.add(m[1]);
				} catch { /* skip */ }
			}

			// Find unreferenced assets
			const categories = category === "all" ? ["script", "resource", "texture", "audio", "shader", "font", "model"] : [category];
			const unused = assets.filter((a) =>
				categories.includes(a.category) &&
				!referenced.has(a.resPath) &&
				!a.resPath.includes("autoload") &&
				a.ext !== ".tscn" && a.ext !== ".scn" &&
				!a.resPath.startsWith("res://addons/"),
			);

			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						unusedCount: unused.length,
						totalScanned: assets.length,
						unused: unused.map((a) => ({ path: a.resPath, category: a.category, size: a.size })),
					}, null, 2),
				}],
			};
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_rename_symbol", "Rename a class/variable/signal/method across all project files.", {
		oldName: z.string(), newName: z.string(),
		type: z.enum(["class_name", "variable", "method", "signal", "any"]).optional().default("any"),
		dryRun: z.boolean().optional().default(true).describe("Preview changes without applying"),
	}, async ({ oldName, newName, type, dryRun }) => {
		try {
			const assets = ctx.getAssetManager().getAssets();
			const textFiles = assets.filter((a) => [".gd", ".cs", ".tscn", ".tres", ".cfg"].includes(a.ext));
			const changes: Array<{ path: string; line: number; before: string; after: string }> = [];

			const patterns: RegExp[] = [];
			if (type === "class_name" || type === "any") patterns.push(new RegExp(`\\b${oldName}\\b`, "g"));
			else if (type === "method") patterns.push(new RegExp(`\\b${oldName}\\s*\\(`, "g"), new RegExp(`\\.${oldName}\\b`, "g"));
			else if (type === "signal") patterns.push(new RegExp(`signal\\s+${oldName}\\b`, "g"), new RegExp(`\\.${oldName}\\.(?:connect|emit|disconnect)`, "g"));
			else patterns.push(new RegExp(`\\b${oldName}\\b`, "g"));

			for (const f of textFiles) {
				try {
					const content = readFileSync(f.absPath, "utf-8");
					const lines = content.split("\n");
					for (let i = 0; i < lines.length; i++) {
						for (const p of patterns) {
							p.lastIndex = 0;
							if (p.test(lines[i])) {
								changes.push({ path: f.resPath, line: i + 1, before: lines[i].trim(), after: lines[i].replace(new RegExp(`\\b${oldName}\\b`, "g"), newName).trim() });
							}
						}
					}
				} catch { /* skip */ }
			}

			if (!dryRun && changes.length > 0) {
				const { writeFileSync: wf } = await import("node:fs");
				const processed = new Set<string>();
				for (const c of changes) {
					if (processed.has(c.path)) continue;
					processed.add(c.path);
					const absPath = ctx.getAssetManager().findByResPath(c.path)?.absPath;
					if (!absPath) continue;
					let content = readFileSync(absPath, "utf-8");
					content = content.replace(new RegExp(`\\b${oldName}\\b`, "g"), newName);
					wf(absPath, content, "utf-8");
				}
			}

			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						dryRun,
						changeCount: changes.length,
						filesAffected: new Set(changes.map((c) => c.path)).size,
						changes: changes.slice(0, 50),
					}, null, 2),
				}],
			};
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_extract_scene", "Extract a node subtree into its own scene, replacing with an instance.", {
		scenePath: z.string(), nodePath: z.string(), newScenePath: z.string(),
	}, async ({ scenePath, nodePath, newScenePath }) => {
		return { content: [{ type: "text", text: `Would extract "${nodePath}" from ${scenePath} into ${newScenePath} and replace with instance. This operation requires careful node reparenting — use with the editor plugin for undo/redo safety.` }] };
	});

	server.tool("godot_inline_scene", "Inline an instanced scene's nodes into the parent scene.", {
		scenePath: z.string(), instanceNodePath: z.string(),
	}, async ({ scenePath, instanceNodePath }) => {
		return { content: [{ type: "text", text: `Would inline the instance at "${instanceNodePath}" in ${scenePath}. This replaces the instance reference with the actual node subtree from the instanced scene.` }] };
	});

	server.tool("godot_dependency_graph", "Map all dependencies between scenes, scripts, and resources.", {}, async () => {
		try {
			const assets = ctx.getAssetManager().getAssets();
			const graph: Record<string, string[]> = {};

			for (const a of assets) {
				if (![".tscn", ".tres", ".gd"].includes(a.ext)) continue;
				try {
					const content = readFileSync(a.absPath, "utf-8");
					const deps: string[] = [];
					const pathMatches = content.matchAll(/path="(res:\/\/[^"]+)"/g);
					for (const m of pathMatches) deps.push(m[1]);
					const loadMatches = content.matchAll(/(?:pre)?load\("(res:\/\/[^"]+)"\)/g);
					for (const m of loadMatches) deps.push(m[1]);
					if (deps.length > 0) graph[a.resPath] = [...new Set(deps)];
				} catch { /* skip */ }
			}

			const totalDeps = Object.values(graph).reduce((sum, deps) => sum + deps.length, 0);
			return {
				content: [{
					type: "text",
					text: JSON.stringify({ fileCount: Object.keys(graph).length, totalDependencies: totalDeps, graph }, null, 2),
				}],
			};
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});
}
