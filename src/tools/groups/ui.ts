/**
 * UI Tool — Single tool with action-based routing.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute } from "../../utils/path.js";
import { parseVariant } from "../../utils/variant.js";
import type { ToolContext } from "../registry.js";

export function registerUITools(server: McpServer, ctx: ToolContext): void {
	server.tool("godot_ui",
		`UI operations. Actions:
- layout: Create a UI scene with Control hierarchy. Params: path, rootType, children[{name,type,text?,parent?,properties?}]
- theme: Create a Theme .tres. Params: path, fontSize, colors
- anchors: Set anchor preset on a Control. Params: scenePath, nodePath, preset (full_rect|center|top_left|...)
- popup: Create a dialog scene. Params: path, dialogType (confirm|alert), title, message
- focus_chain: Configure gamepad/keyboard navigation. Params: scenePath, chain[{nodePath,left?,right?,top?,bottom?,next?,previous?}]`,
		{
			action: z.enum(["layout", "theme", "anchors", "popup", "focus_chain"]),
			path: z.string().optional(), scenePath: z.string().optional(), nodePath: z.string().optional(),
			rootType: z.enum(["Control", "PanelContainer", "MarginContainer", "CenterContainer"]).optional(),
			children: z.array(z.object({ name: z.string(), type: z.string(), text: z.string().optional(), parent: z.string().optional(), properties: z.record(z.string(), z.string()).optional() })).optional(),
			fontSize: z.number().optional(), colors: z.record(z.string(), z.string()).optional(),
			preset: z.enum(["full_rect", "center", "top_left", "top_right", "bottom_left", "bottom_right", "center_left", "center_right", "center_top", "center_bottom", "top_wide", "bottom_wide", "left_wide", "right_wide"]).optional(),
			dialogType: z.enum(["confirm", "alert", "custom"]).optional(), title: z.string().optional(), message: z.string().optional(),
			chain: z.array(z.object({ nodePath: z.string(), left: z.string().optional(), right: z.string().optional(), top: z.string().optional(), bottom: z.string().optional(), next: z.string().optional(), previous: z.string().optional() })).optional(),
		},
		async (params) => {
			try {
				switch (params.action) {
					case "layout": {
						if (!params.path || !params.children) return { content: [{ type: "text", text: "path and children required" }], isError: true };
						const absPath = resToAbsolute(params.path, ctx.projectRoot);
						const doc: import("../../parsers/tscn/types.js").TscnDocument = { descriptor: { type: "gd_scene", format: 3 }, extResources: [], subResources: [], nodes: [{ name: "UI", type: (params.rootType ?? "Control") as string, properties: { anchors_preset: 15 } }], connections: [] };
						for (const c of params.children) {
							const props: Record<string, unknown> = {};
							if (c.text) props.text = c.text;
							if (c.properties) { for (const [k, v] of Object.entries(c.properties)) props[k] = parseVariant(v); }
							doc.nodes.push({ name: c.name, type: c.type, parent: c.parent ?? ".", properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
						}
						const { mkdirSync } = await import("node:fs"); const { dirname } = await import("node:path");
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Created UI layout at ${params.path} with ${params.children.length} controls` }] };
					}
					case "theme": {
						if (!params.path) return { content: [{ type: "text", text: "path required" }], isError: true };
						const lines = [`[gd_resource type="Theme" format=3]`, "", "[resource]", `default_font_size = ${params.fontSize ?? 16}`];
						if (params.colors) { for (const [k, v] of Object.entries(params.colors)) lines.push(`${k} = ${v}`); }
						lines.push("");
						const absPath = resToAbsolute(params.path, ctx.projectRoot);
						const { mkdirSync } = await import("node:fs"); const { dirname } = await import("node:path");
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, lines.join("\n"), "utf-8");
						return { content: [{ type: "text", text: `Created Theme at ${params.path}` }] };
					}
					case "anchors": {
						if (!params.scenePath || !params.nodePath || !params.preset) return { content: [{ type: "text", text: "scenePath, nodePath, preset required" }], isError: true };
						const presetMap: Record<string, number> = { full_rect: 15, center: 8, top_left: 0, top_right: 1, bottom_left: 2, bottom_right: 3, center_left: 4, center_right: 6, center_top: 5, center_bottom: 7, top_wide: 10, bottom_wide: 12, left_wide: 9, right_wide: 11 };
						const absPath = resToAbsolute(params.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const node = doc.nodes.find((n) => (n.parent === undefined ? "." : n.parent === "." ? n.name : `${n.parent}/${n.name}`) === params.nodePath);
						if (!node) return { content: [{ type: "text", text: `Node not found: ${params.nodePath}` }], isError: true };
						node.properties.anchors_preset = presetMap[params.preset] ?? 0;
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Set anchor "${params.preset}" on "${params.nodePath}"` }] };
					}
					case "popup": {
						if (!params.path) return { content: [{ type: "text", text: "path required" }], isError: true };
						const dt = (params.dialogType ?? "confirm") === "confirm" ? "ConfirmationDialog" : "AcceptDialog";
						const t = params.title ?? "Dialog"; const m = params.message ?? "Are you sure?";
						const lines = [`[gd_scene format=3]`, "", `[node name="${t}" type="${dt}"]`, `title = "${t}"`, `dialog_text = "${m}"`, ""];
						const absPath = resToAbsolute(params.path, ctx.projectRoot);
						const { mkdirSync } = await import("node:fs"); const { dirname } = await import("node:path");
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, lines.join("\n"), "utf-8");
						return { content: [{ type: "text", text: `Created ${params.dialogType ?? "confirm"} dialog at ${params.path}` }] };
					}
					case "focus_chain": {
						if (!params.scenePath || !params.chain) return { content: [{ type: "text", text: "scenePath and chain required" }], isError: true };
						const absPath = resToAbsolute(params.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						for (const entry of params.chain) {
							const node = doc.nodes.find((n) => (n.parent === undefined ? "." : n.parent === "." ? n.name : `${n.parent}/${n.name}`) === entry.nodePath);
							if (!node) continue;
							if (entry.left) node.properties.focus_neighbor_left = { type: "NodePath", path: entry.left };
							if (entry.right) node.properties.focus_neighbor_right = { type: "NodePath", path: entry.right };
							if (entry.top) node.properties.focus_neighbor_top = { type: "NodePath", path: entry.top };
							if (entry.bottom) node.properties.focus_neighbor_bottom = { type: "NodePath", path: entry.bottom };
							if (entry.next) node.properties.focus_next = { type: "NodePath", path: entry.next };
							if (entry.previous) node.properties.focus_previous = { type: "NodePath", path: entry.previous };
						}
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Configured focus chain for ${params.chain.length} nodes` }] };
					}
				}
			} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
		},
	);
}
