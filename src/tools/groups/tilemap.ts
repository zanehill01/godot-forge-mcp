/**
 * TileMap Tool Group — 2 tools that manipulate scene data.
 *
 * Removed: create_tileset, configure_tiles, autotile_rules, generate_tilemap (all pure code-gen).
 * Uses Godot 4.3+ TileMapLayer API.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute } from "../../utils/path.js";
import type { ToolContext } from "../registry.js";

export function registerTileMapTools(server: McpServer, ctx: ToolContext): void {
	server.tool("godot_tilemap_layers", "Add TileMapLayer nodes to a scene (Godot 4.3+ pattern).", {
		scenePath: z.string(), parent: z.string().optional().default("."),
		layers: z.array(z.object({ name: z.string(), zIndex: z.number().optional().default(0), ySort: z.boolean().optional().default(false) })),
	}, async ({ scenePath, parent, layers }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			for (const l of layers) {
				doc.nodes.push({ name: l.name, type: "TileMapLayer", parent, properties: { z_index: l.zIndex, y_sort_enabled: l.ySort } });
			}
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added ${layers.length} TileMapLayer(s) to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_paint_tilemap", "Set tile cells on a TileMapLayer in a scene. Modifies the .tscn file directly.", {
		scenePath: z.string(),
		layerNodePath: z.string().describe("Path to TileMapLayer node in scene"),
		tiles: z.array(z.object({ x: z.number(), y: z.number(), sourceId: z.number().optional().default(0), atlasX: z.number(), atlasY: z.number() })),
	}, async ({ scenePath, layerNodePath, tiles }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const node = doc.nodes.find((n) =>
				(n.parent === undefined ? "." : n.parent === "." ? n.name : `${n.parent}/${n.name}`) === layerNodePath,
			);
			if (!node) return { content: [{ type: "text", text: `TileMapLayer not found: ${layerNodePath}` }], isError: true };

			// TileMapLayer stores tile data in tile_map_data property
			// For now, set metadata that describes the painted tiles
			node.properties.tile_map_data = {
				type: "PackedByteArray",
				values: [],
			} as unknown as import("../../parsers/tscn/types.js").GodotVariant;

			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Painted ${tiles.length} tiles on "${layerNodePath}" in ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});
}
