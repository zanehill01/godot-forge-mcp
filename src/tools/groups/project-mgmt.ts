/**
 * Project Management Tool Group — 6 tools.
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
	server.tool("godot_configure_input_map", "Add/modify/remove input actions in project.godot.", {
		action: z.string().describe("Input action name"),
		operation: z.enum(["add", "remove"]),
		deadzone: z.number().optional().default(0.5),
	}, async ({ action, operation, deadzone }) => {
		try {
			const configPath = join(ctx.projectRoot, "project.godot");
			const config = parseProjectGodot(readFileSync(configPath, "utf-8"));
			if (!config.sections.input) config.sections.input = {};
			if (operation === "add") {
				config.sections.input[action] = `{"deadzone": ${deadzone}, "events": []}` as unknown as import("../../parsers/tscn/types.js").GodotVariant;
			} else {
				delete config.sections.input[action];
			}
			writeFileSync(configPath, writeProjectGodot(config), "utf-8");
			ctx.getProject().load();
			return { content: [{ type: "text", text: `${operation === "add" ? "Added" : "Removed"} input action "${action}"` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_manage_autoloads", "Add/remove autoload singletons.", {
		name: z.string().describe("Autoload name"),
		operation: z.enum(["add", "remove"]),
		path: z.string().optional().describe("Script path for add (res://)"),
	}, async ({ name, operation, path }) => {
		try {
			const configPath = join(ctx.projectRoot, "project.godot");
			const config = parseProjectGodot(readFileSync(configPath, "utf-8"));
			if (!config.sections.autoload) config.sections.autoload = {};
			if (operation === "add") {
				if (!path) return { content: [{ type: "text", text: "path required for add" }], isError: true };
				config.sections.autoload[name] = `*${path}`;
			} else {
				delete config.sections.autoload[name];
			}
			writeFileSync(configPath, writeProjectGodot(config), "utf-8");
			ctx.getProject().load();
			return { content: [{ type: "text", text: `${operation === "add" ? "Added" : "Removed"} autoload "${name}"` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	// godot_export_presets removed — use godot_standards group for full export pipeline support

	server.tool("godot_project_settings", "Read/write project.godot settings.", {
		section: z.string().describe("Settings section (e.g., application, display, rendering)"),
		key: z.string().optional().describe("Setting key to read/write"),
		value: z.string().optional().describe("Value to set (omit to read)"),
	}, async ({ section, key, value }) => {
		try {
			const configPath = join(ctx.projectRoot, "project.godot");
			const config = parseProjectGodot(readFileSync(configPath, "utf-8"));
			if (!key) {
				return { content: [{ type: "text", text: JSON.stringify(config.sections[section] ?? {}, null, 2) }] };
			}
			if (value !== undefined) {
				if (!config.sections[section]) config.sections[section] = {};
				config.sections[section][key] = value as unknown as import("../../parsers/tscn/types.js").GodotVariant;
				writeFileSync(configPath, writeProjectGodot(config), "utf-8");
				ctx.getProject().load();
				return { content: [{ type: "text", text: `Set [${section}] ${key} = ${value}` }] };
			}
			return { content: [{ type: "text", text: JSON.stringify(config.sections[section]?.[key] ?? null) }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_manage_groups", "List or manage node groups across all scenes.", {
		operation: z.enum(["list", "find"]).optional().default("list"),
		groupName: z.string().optional().describe("Group name to search for"),
	}, async ({ operation, groupName }) => {
		try {
			const scenes = ctx.getAssetManager().byCategory("scene");
			const groups = new Map<string, Array<{ scene: string; node: string }>>();
			for (const s of scenes) {
				try {
					const doc = (await import("../../parsers/tscn/parser.js")).parseTscn(readFileSync(s.absPath, "utf-8"));
					for (const n of doc.nodes) {
						if (n.groups) {
							for (const g of n.groups) {
								if (!groups.has(g)) groups.set(g, []);
								groups.get(g)!.push({ scene: s.resPath, node: n.name });
							}
						}
					}
				} catch { /* skip */ }
			}
			if (operation === "find" && groupName) {
				return { content: [{ type: "text", text: JSON.stringify(groups.get(groupName) ?? [], null, 2) }] };
			}
			const summary: Record<string, number> = {};
			for (const [g, nodes] of groups) summary[g] = nodes.length;
			return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_class_reference", "Look up Godot class info (node types, categories, hierarchy).", {
		type: z.string().optional().describe("Class name to look up"),
		category: z.string().optional().describe("Category to list (base, physics2d, visual2d, ui, etc.)"),
	}, async ({ type, category }) => {
		const { NODE_TYPES, getNodeCategory } = await import("../../utils/validation.js");
		if (type) {
			const cat = getNodeCategory(type);
			return { content: [{ type: "text", text: JSON.stringify({ type, category: cat, known: cat !== null || getAllNodeTypes().includes(type) }) }] };
		}
		if (category && category in NODE_TYPES) {
			return { content: [{ type: "text", text: JSON.stringify((NODE_TYPES as Record<string, readonly string[]>)[category], null, 2) }] };
		}
		return { content: [{ type: "text", text: JSON.stringify(Object.keys(NODE_TYPES)) }] };
	});
}
