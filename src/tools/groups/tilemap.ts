/**
 * TileMap Tool — Single tool with action-based routing.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute } from "../../utils/path.js";
import type { ToolContext } from "../registry.js";

export function registerTileMapTools(server: McpServer, ctx: ToolContext): void {
	server.tool("godot_tilemap",
		`TileMap operations (Godot 4.3+ TileMapLayer API). Actions:
- layers: Add TileMapLayer nodes to a scene. Params: scenePath, parent, layers[{name, zIndex?, ySort?}]
- paint: Set tile cells on a TileMapLayer. Params: scenePath, layerNodePath, tiles[{x, y, sourceId?, atlasX, atlasY}]`,
		{
			action: z.enum(["layers", "paint"]),
			scenePath: z.string(), parent: z.string().optional().default("."),
			layerNodePath: z.string().optional(),
			layers: z.array(z.object({ name: z.string(), zIndex: z.number().optional().default(0), ySort: z.boolean().optional().default(false) })).optional(),
			tiles: z.array(z.object({ x: z.number(), y: z.number(), sourceId: z.number().optional().default(0), atlasX: z.number(), atlasY: z.number() })).optional(),
		},
		async (p) => {
			try {
				const absPath = resToAbsolute(p.scenePath, ctx.projectRoot);
				const doc = parseTscn(readFileSync(absPath, "utf-8"));
				switch (p.action) {
					case "layers": {
						if (!p.layers) return { content: [{ type: "text", text: "layers required" }], isError: true };
						for (const l of p.layers) doc.nodes.push({ name: l.name, type: "TileMapLayer", parent: p.parent, properties: { z_index: l.zIndex, y_sort_enabled: l.ySort } });
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added ${p.layers.length} TileMapLayer(s)` }] };
					}
					case "paint": {
						if (!p.layerNodePath || !p.tiles) return { content: [{ type: "text", text: "layerNodePath and tiles required" }], isError: true };
						const node = doc.nodes.find((n) => (n.parent === undefined ? "." : n.parent === "." ? n.name : `${n.parent}/${n.name}`) === p.layerNodePath);
						if (!node) return { content: [{ type: "text", text: `Node not found: ${p.layerNodePath}` }], isError: true };
						node.properties.tile_map_data = { type: "PackedByteArray", values: [] } as unknown as import("../../parsers/tscn/types.js").GodotVariant;
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Painted ${p.tiles.length} tiles on "${p.layerNodePath}"` }] };
					}
				}
			} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
		},
	);
}
