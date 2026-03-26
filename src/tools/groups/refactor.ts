/**
 * Refactor Tool — Single tool with action-based routing.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { escapeRegex } from "../../utils/path.js";
import type { ToolContext } from "../registry.js";

export function registerRefactorTools(server: McpServer, ctx: ToolContext): void {
	server.tool("godot_refactor",
		`Project refactoring operations. Actions:
- find_unused: Find orphaned scripts/resources/assets not referenced by any scene. Params: category (script|resource|texture|audio|all)
- rename_symbol: Rename a class/variable/signal/method across all files. Params: oldName, newName, symbolType (class_name|variable|method|signal|any), dryRun (default true)
- dependency_graph: Map all dependencies between scenes, scripts, and resources. No params.`,
		{
			action: z.enum(["find_unused", "rename_symbol", "dependency_graph"]),
			category: z.enum(["script", "resource", "texture", "audio", "all"]).optional(),
			oldName: z.string().optional(), newName: z.string().optional(),
			symbolType: z.enum(["class_name", "variable", "method", "signal", "any"]).optional(),
			dryRun: z.boolean().optional(),
		},
		async (p) => {
			try {
				switch (p.action) {
					case "find_unused": {
						const cat = p.category ?? "all";
						const assets = ctx.getAssetManager().getAssets();
						const scenes = assets.filter((a) => a.ext === ".tscn" || a.ext === ".scn");
						const referenced = new Set<string>();
						for (const s of scenes) {
							try {
								const content = readFileSync(s.absPath, "utf-8");
								for (const m of content.matchAll(/path="(res:\/\/[^"]+)"/g)) referenced.add(m[1]);
								for (const m of content.matchAll(/(?:pre)?load\("(res:\/\/[^"]+)"\)/g)) referenced.add(m[1]);
							} catch { /* skip */ }
						}
						const scripts = assets.filter((a) => a.ext === ".gd" || a.ext === ".cs");
						for (const s of scripts) {
							try { for (const m of readFileSync(s.absPath, "utf-8").matchAll(/(?:pre)?load\("(res:\/\/[^"]+)"\)/g)) referenced.add(m[1]); } catch { /* skip */ }
						}
						const categories = cat === "all" ? ["script", "resource", "texture", "audio", "shader", "font", "model"] : [cat];
						const unused = assets.filter((a) => categories.includes(a.category) && !referenced.has(a.resPath) && !a.resPath.includes("autoload") && a.ext !== ".tscn" && a.ext !== ".scn" && !a.resPath.startsWith("res://addons/"));
						return { content: [{ type: "text", text: JSON.stringify({ unusedCount: unused.length, totalScanned: assets.length, unused: unused.map((a) => ({ path: a.resPath, category: a.category, size: a.size })) }, null, 2) }] };
					}
					case "rename_symbol": {
						if (!p.oldName || !p.newName) return { content: [{ type: "text", text: "oldName and newName required" }], isError: true };
						const type = p.symbolType ?? "any"; const dryRun = p.dryRun ?? true;
						const assets = ctx.getAssetManager().getAssets();
						const textFiles = assets.filter((a) => [".gd", ".cs", ".tscn", ".tres", ".cfg"].includes(a.ext));
						const changes: Array<{ path: string; line: number; before: string; after: string }> = [];
						const patterns: RegExp[] = [];
						if (type === "class_name" || type === "any") patterns.push(new RegExp(`\\b${escapeRegex(p.oldName)}\\b`, "g"));
						else if (type === "method") patterns.push(new RegExp(`\\b${escapeRegex(p.oldName)}\\s*\\(`, "g"), new RegExp(`\\.${escapeRegex(p.oldName)}\\b`, "g"));
						else if (type === "signal") patterns.push(new RegExp(`signal\\s+${escapeRegex(p.oldName)}\\b`, "g"), new RegExp(`\\.${escapeRegex(p.oldName)}\\.(?:connect|emit|disconnect)`, "g"));
						else patterns.push(new RegExp(`\\b${escapeRegex(p.oldName)}\\b`, "g"));
						for (const f of textFiles) {
							try {
								const lines = readFileSync(f.absPath, "utf-8").split("\n");
								for (let i = 0; i < lines.length; i++) { for (const pat of patterns) { pat.lastIndex = 0; if (pat.test(lines[i])) changes.push({ path: f.resPath, line: i + 1, before: lines[i].trim(), after: lines[i].replace(new RegExp(`\\b${escapeRegex(p.oldName)}\\b`, "g"), p.newName).trim() }); } }
							} catch { /* skip */ }
						}
						if (!dryRun && changes.length > 0) {
							const { writeFileSync: wf } = await import("node:fs");
							const processed = new Set<string>();
							for (const c of changes) { if (processed.has(c.path)) continue; processed.add(c.path); const abs = ctx.getAssetManager().findByResPath(c.path)?.absPath; if (!abs) continue; wf(abs, readFileSync(abs, "utf-8").replace(new RegExp(`\\b${escapeRegex(p.oldName)}\\b`, "g"), p.newName), "utf-8"); }
						}
						return { content: [{ type: "text", text: JSON.stringify({ dryRun, changeCount: changes.length, filesAffected: new Set(changes.map((c) => c.path)).size, changes: changes.slice(0, 50) }, null, 2) }] };
					}
					case "dependency_graph": {
						const assets = ctx.getAssetManager().getAssets();
						const graph: Record<string, string[]> = {};
						for (const a of assets) {
							if (![".tscn", ".tres", ".gd"].includes(a.ext)) continue;
							try {
								const content = readFileSync(a.absPath, "utf-8");
								const deps: string[] = [];
								for (const m of content.matchAll(/path="(res:\/\/[^"]+)"/g)) deps.push(m[1]);
								for (const m of content.matchAll(/(?:pre)?load\("(res:\/\/[^"]+)"\)/g)) deps.push(m[1]);
								if (deps.length > 0) graph[a.resPath] = [...new Set(deps)];
							} catch { /* skip */ }
						}
						const totalDeps = Object.values(graph).reduce((sum, d) => sum + d.length, 0);
						return { content: [{ type: "text", text: JSON.stringify({ fileCount: Object.keys(graph).length, totalDependencies: totalDeps, graph }, null, 2) }] };
					}
				}
			} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
		},
	);
}
