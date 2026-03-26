/**
 * Project Management Tool — Single tool with action-based routing.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseProjectGodot } from "../../parsers/project-godot/parser.js";
import { writeProjectGodot } from "../../parsers/project-godot/writer.js";
import type { ToolContext } from "../registry.js";
import { getAllNodeTypes } from "../../utils/validation.js";

export function registerProjectMgmtTools(server: McpServer, ctx: ToolContext): void {
	server.tool("godot_project",
		`Project management operations. Actions:
- input_map: Add/remove input actions. Params: inputAction (name), operation (add|remove), deadzone
- autoloads: Add/remove autoload singletons. Params: autoloadName, operation (add|remove), autoloadPath (res://)
- settings: Read/write project.godot settings. Params: section, key, value
- groups: List or find node groups across scenes. Params: groupOperation (list|find), groupName
- class_ref: Look up Godot class info. Params: className, categoryName`,
		{
			action: z.enum(["input_map", "autoloads", "settings", "groups", "class_ref"]),
			inputAction: z.string().optional(), operation: z.enum(["add", "remove"]).optional(), deadzone: z.number().optional(),
			autoloadName: z.string().optional(), autoloadPath: z.string().optional(),
			section: z.string().optional(), key: z.string().optional(), value: z.string().optional(),
			groupOperation: z.enum(["list", "find"]).optional(), groupName: z.string().optional(),
			className: z.string().optional(), categoryName: z.string().optional(),
		},
		async (p) => {
			try {
				switch (p.action) {
					case "input_map": {
						if (!p.inputAction || !p.operation) return { content: [{ type: "text", text: "inputAction and operation required" }], isError: true };
						const configPath = join(ctx.projectRoot, "project.godot");
						const config = parseProjectGodot(readFileSync(configPath, "utf-8"));
						if (!config.sections.input) config.sections.input = {};
						if (p.operation === "add") {
							config.sections.input[p.inputAction] = `{"deadzone": ${p.deadzone ?? 0.5}, "events": []}` as unknown as import("../../parsers/tscn/types.js").GodotVariant;
						} else { delete config.sections.input[p.inputAction]; }
						writeFileSync(configPath, writeProjectGodot(config), "utf-8");
						ctx.getProject().load();
						return { content: [{ type: "text", text: `${p.operation === "add" ? "Added" : "Removed"} input action "${p.inputAction}"` }] };
					}
					case "autoloads": {
						if (!p.autoloadName || !p.operation) return { content: [{ type: "text", text: "autoloadName and operation required" }], isError: true };
						const configPath = join(ctx.projectRoot, "project.godot");
						const config = parseProjectGodot(readFileSync(configPath, "utf-8"));
						if (!config.sections.autoload) config.sections.autoload = {};
						if (p.operation === "add") {
							if (!p.autoloadPath) return { content: [{ type: "text", text: "autoloadPath required for add" }], isError: true };
							config.sections.autoload[p.autoloadName] = `*${p.autoloadPath}`;
						} else { delete config.sections.autoload[p.autoloadName]; }
						writeFileSync(configPath, writeProjectGodot(config), "utf-8");
						ctx.getProject().load();
						return { content: [{ type: "text", text: `${p.operation === "add" ? "Added" : "Removed"} autoload "${p.autoloadName}"` }] };
					}
					case "settings": {
						if (!p.section) return { content: [{ type: "text", text: "section required" }], isError: true };
						const configPath = join(ctx.projectRoot, "project.godot");
						const config = parseProjectGodot(readFileSync(configPath, "utf-8"));
						if (!p.key) return { content: [{ type: "text", text: JSON.stringify(config.sections[p.section] ?? {}, null, 2) }] };
						if (p.value !== undefined) {
							if (!config.sections[p.section]) config.sections[p.section] = {};
							config.sections[p.section][p.key] = p.value as unknown as import("../../parsers/tscn/types.js").GodotVariant;
							writeFileSync(configPath, writeProjectGodot(config), "utf-8");
							ctx.getProject().load();
							return { content: [{ type: "text", text: `Set [${p.section}] ${p.key} = ${p.value}` }] };
						}
						return { content: [{ type: "text", text: JSON.stringify(config.sections[p.section]?.[p.key] ?? null) }] };
					}
					case "groups": {
						const scenes = ctx.getAssetManager().byCategory("scene");
						const groups = new Map<string, Array<{ scene: string; node: string }>>();
						for (const s of scenes) {
							try {
								const doc = (await import("../../parsers/tscn/parser.js")).parseTscn(readFileSync(s.absPath, "utf-8"));
								for (const n of doc.nodes) { if (n.groups) { for (const g of n.groups) { if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push({ scene: s.resPath, node: n.name }); } } }
							} catch { /* skip */ }
						}
						if ((p.groupOperation ?? "list") === "find" && p.groupName) {
							return { content: [{ type: "text", text: JSON.stringify(groups.get(p.groupName) ?? [], null, 2) }] };
						}
						const summary: Record<string, number> = {};
						for (const [g, nodes] of groups) summary[g] = nodes.length;
						return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
					}
					case "class_ref": {
						const { NODE_TYPES, getNodeCategory } = await import("../../utils/validation.js");
						if (p.className) {
							const cat = getNodeCategory(p.className);
							return { content: [{ type: "text", text: JSON.stringify({ type: p.className, category: cat, known: cat !== null || getAllNodeTypes().includes(p.className) }) }] };
						}
						if (p.categoryName && p.categoryName in NODE_TYPES) {
							return { content: [{ type: "text", text: JSON.stringify((NODE_TYPES as Record<string, readonly string[]>)[p.categoryName], null, 2) }] };
						}
						return { content: [{ type: "text", text: JSON.stringify(Object.keys(NODE_TYPES)) }] };
					}
				}
			} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
		},
	);
}
