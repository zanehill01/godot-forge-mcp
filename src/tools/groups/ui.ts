/**
 * UI Tool Group — 5 tools for Control node layouts, themes, and interaction.
 *
 * Removed: add_ui_control (redundant with core add_node), create_container_layout
 * (redundant with create_ui_layout), rich_text_bbcode (code-gen an LLM can do natively).
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
	server.tool("godot_create_ui_layout", "Create a complete UI scene with a Control node hierarchy. Supports nested containers and controls in one call.", {
		path: z.string().describe("Scene path (res://)"),
		rootType: z.enum(["Control", "PanelContainer", "MarginContainer", "CenterContainer"]).optional().default("Control"),
		children: z.array(z.object({
			name: z.string(), type: z.string(),
			text: z.string().optional(), parent: z.string().optional().default("."),
			properties: z.record(z.string(), z.string()).optional(),
		})).describe("UI nodes to create"),
	}, async ({ path, rootType, children }) => {
		try {
			const absPath = resToAbsolute(path, ctx.projectRoot);
			const doc: import("../../parsers/tscn/types.js").TscnDocument = {
				descriptor: { type: "gd_scene", format: 3 },
				extResources: [], subResources: [],
				nodes: [{ name: "UI", type: rootType as string, properties: { anchors_preset: 15 } }],
				connections: [],
			};
			for (const c of children) {
				const props: Record<string, unknown> = {};
				if (c.text) props.text = c.text;
				if (c.properties) { for (const [k, v] of Object.entries(c.properties)) props[k] = parseVariant(v); }
				doc.nodes.push({ name: c.name, type: c.type, parent: c.parent ?? ".", properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
			}
			const { mkdirSync } = await import("node:fs");
			const { dirname } = await import("node:path");
			mkdirSync(dirname(absPath), { recursive: true });
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Created UI layout at ${path} with ${children.length} controls` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_create_theme", "Create a Theme .tres resource with style overrides.", {
		path: z.string(), baseFont: z.string().optional(), fontSize: z.number().optional().default(16),
		colors: z.record(z.string(), z.string()).optional().describe("Color overrides (name → Color(...))"),
	}, async ({ path, baseFont: _baseFont, fontSize, colors }) => {
		try {
			const lines = [`[gd_resource type="Theme" format=3]`, "", "[resource]", `default_font_size = ${fontSize}`];
			if (colors) { for (const [k, v] of Object.entries(colors)) lines.push(`${k} = ${v}`); }
			lines.push("");
			const absPath = resToAbsolute(path, ctx.projectRoot);
			const { mkdirSync } = await import("node:fs");
			const { dirname } = await import("node:path");
			mkdirSync(dirname(absPath), { recursive: true });
			writeFileSync(absPath, lines.join("\n"), "utf-8");
			return { content: [{ type: "text", text: `Created Theme at ${path}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_configure_anchors", "Set anchor/margin presets on a Control node in a scene.", {
		scenePath: z.string(), nodePath: z.string(),
		preset: z.enum(["full_rect", "center", "top_left", "top_right", "bottom_left", "bottom_right", "center_left", "center_right", "center_top", "center_bottom", "top_wide", "bottom_wide", "left_wide", "right_wide"]),
	}, async ({ scenePath, nodePath, preset }) => {
		try {
			const presetMap: Record<string, number> = { full_rect: 15, center: 8, top_left: 0, top_right: 1, bottom_left: 2, bottom_right: 3, center_left: 4, center_right: 6, center_top: 5, center_bottom: 7, top_wide: 10, bottom_wide: 12, left_wide: 9, right_wide: 11 };
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const node = doc.nodes.find((n) => (n.parent === undefined ? "." : n.parent === "." ? n.name : `${n.parent}/${n.name}`) === nodePath);
			if (!node) return { content: [{ type: "text", text: `Node not found: ${nodePath}` }], isError: true };
			node.properties.anchors_preset = presetMap[preset] ?? 0;
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Set anchor preset "${preset}" on "${nodePath}"` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_create_popup_dialog", "Create a popup/dialog scene file.", {
		path: z.string(), type: z.enum(["confirm", "alert", "custom"]).optional().default("confirm"),
		title: z.string().optional().default("Dialog"), message: z.string().optional().default("Are you sure?"),
	}, async ({ path, type, title, message }) => {
		try {
			const dialogType = type === "confirm" ? "ConfirmationDialog" : "AcceptDialog";
			const lines = [`[gd_scene format=3]`, "", `[node name="${title}" type="${dialogType}"]`,
				`title = "${title}"`, `dialog_text = "${message}"`, ""];
			const absPath = resToAbsolute(path, ctx.projectRoot);
			const { mkdirSync } = await import("node:fs");
			const { dirname } = await import("node:path");
			mkdirSync(dirname(absPath), { recursive: true });
			writeFileSync(absPath, lines.join("\n"), "utf-8");
			return { content: [{ type: "text", text: `Created ${type} dialog at ${path}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_ui_focus_chain", "Configure focus neighbor paths for gamepad/keyboard navigation.", {
		scenePath: z.string(),
		chain: z.array(z.object({ nodePath: z.string(), left: z.string().optional(), right: z.string().optional(), top: z.string().optional(), bottom: z.string().optional(), next: z.string().optional(), previous: z.string().optional() })),
	}, async ({ scenePath, chain }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			for (const entry of chain) {
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
			return { content: [{ type: "text", text: `Configured focus chain for ${chain.length} nodes` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});
}
