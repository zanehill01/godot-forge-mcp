/**
 * TileMap Tool Group — 6 tools.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute } from "../../utils/path.js";
import type { ToolContext } from "../registry.js";

export function registerTileMapTools(server: McpServer, ctx: ToolContext): void {
	server.tool("godot_create_tileset", "Generate GDScript to create a TileSet from an atlas texture.", {
		texturePath: z.string(), tileSize: z.number().optional().default(16),
		columns: z.number().optional(), rows: z.number().optional(),
	}, async ({ texturePath, tileSize, columns, rows }) => {
		const code = `# TileSet creation from atlas
var tileset := TileSet.new()
tileset.tile_size = Vector2i(${tileSize}, ${tileSize})
var source := TileSetAtlasSource.new()
source.texture = preload("${texturePath}")
source.texture_region_size = Vector2i(${tileSize}, ${tileSize})
tileset.add_source(source)
${columns && rows ? `# Create tiles for ${columns}x${rows} grid\nfor y in ${rows}:\n\tfor x in ${columns}:\n\t\tsource.create_tile(Vector2i(x, y))` : "# Call source.create_tile(Vector2i(x, y)) for each tile position"}`;
		return { content: [{ type: "text", text: code }] };
	});

	server.tool("godot_configure_tiles", "Generate GDScript to configure tile properties.", {
		sourceId: z.number().optional().default(0),
		tiles: z.array(z.object({
			coords: z.string().describe("Tile coords as 'x,y'"),
			physicsLayer: z.number().optional(),
			navigationLayer: z.number().optional(),
			customData: z.record(z.string(), z.string()).optional(),
		})),
	}, async ({ sourceId, tiles }) => {
		const lines = [`# Configure tiles on source ${sourceId}`];
		for (const t of tiles) {
			const [x, y] = t.coords.split(",").map(Number);
			if (t.physicsLayer !== undefined) lines.push(`source.get_tile_data(Vector2i(${x}, ${y}), 0).set_collision_polygon_points(${t.physicsLayer}, 0, PackedVector2Array(...))`);
			if (t.customData) { for (const [k, v] of Object.entries(t.customData)) lines.push(`source.get_tile_data(Vector2i(${x}, ${y}), 0).set_custom_data("${k}", ${v})`); }
		}
		return { content: [{ type: "text", text: lines.join("\n") }] };
	});

	server.tool("godot_paint_tilemap", "Generate GDScript to programmatically place tiles.", {
		layerIndex: z.number().optional().default(0),
		tiles: z.array(z.object({ x: z.number(), y: z.number(), sourceId: z.number().optional().default(0), atlasX: z.number(), atlasY: z.number() })),
	}, async ({ layerIndex, tiles }) => {
		const lines = [`# Paint tiles on layer ${layerIndex}`];
		for (const t of tiles) lines.push(`tilemap.set_cell(${layerIndex}, Vector2i(${t.x}, ${t.y}), ${t.sourceId}, Vector2i(${t.atlasX}, ${t.atlasY}))`);
		return { content: [{ type: "text", text: lines.join("\n") }] };
	});

	server.tool("godot_autotile_rules", "Generate GDScript for terrain set configuration.", {
		terrainSetIndex: z.number().optional().default(0),
		terrains: z.array(z.object({ name: z.string(), color: z.string().optional() })),
	}, async ({ terrainSetIndex, terrains }) => {
		const lines = [`# Terrain setup for terrain set ${terrainSetIndex}`, `tileset.add_terrain_set()`, `tileset.set_terrain_set_mode(${terrainSetIndex}, TileSet.TERRAIN_MODE_MATCH_CORNERS_AND_SIDES)`];
		for (let i = 0; i < terrains.length; i++) {
			lines.push(`tileset.add_terrain(${terrainSetIndex})`);
			lines.push(`tileset.set_terrain_name(${terrainSetIndex}, ${i}, "${terrains[i].name}")`);
			if (terrains[i].color) lines.push(`tileset.set_terrain_color(${terrainSetIndex}, ${i}, ${terrains[i].color})`);
		}
		return { content: [{ type: "text", text: lines.join("\n") }] };
	});

	server.tool("godot_tilemap_layers", "Add TileMapLayer nodes to a scene.", {
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

	server.tool("godot_generate_tilemap", "Generate GDScript for procedural tilemap generation.", {
		algorithm: z.enum(["noise", "random", "cellular_automata"]),
		width: z.number(), height: z.number(),
		fillPercent: z.number().optional().default(45).describe("Fill percentage for cellular automata"),
	}, async ({ algorithm, width, height, fillPercent }) => {
		let code: string;
		switch (algorithm) {
			case "noise":
				code = `# Noise-based tilemap generation\nvar noise := FastNoiseLite.new()\nnoise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH\nnoise.frequency = 0.05\nnoise.seed = randi()\n\nfor y in ${height}:\n\tfor x in ${width}:\n\t\tvar value := noise.get_noise_2d(x, y)\n\t\tif value > 0.0:\n\t\t\ttilemap.set_cell(0, Vector2i(x, y), 0, Vector2i(0, 0)) # Ground\n\t\telse:\n\t\t\ttilemap.set_cell(0, Vector2i(x, y), 0, Vector2i(1, 0)) # Wall`; break;
			case "cellular_automata":
				code = `# Cellular automata cave generation\nvar grid: Array[Array] = []\nfor y in ${height}:\n\tvar row: Array[bool] = []\n\tfor x in ${width}:\n\t\trow.append(randi() % 100 < ${fillPercent})\n\tgrid.append(row)\n\n# Smooth passes\nfor _pass in 5:\n\tvar new_grid: Array[Array] = []\n\tfor y in ${height}:\n\t\tvar row: Array[bool] = []\n\t\tfor x in ${width}:\n\t\t\tvar neighbors := 0\n\t\t\tfor dy in range(-1, 2):\n\t\t\t\tfor dx in range(-1, 2):\n\t\t\t\t\tif dx == 0 and dy == 0: continue\n\t\t\t\t\tvar nx := x + dx\n\t\t\t\t\tvar ny := y + dy\n\t\t\t\t\tif nx < 0 or nx >= ${width} or ny < 0 or ny >= ${height}:\n\t\t\t\t\t\tneighbors += 1\n\t\t\t\t\telif grid[ny][nx]:\n\t\t\t\t\t\tneighbors += 1\n\t\t\trow.append(neighbors >= 5)\n\t\tnew_grid.append(row)\n\tgrid = new_grid\n\n# Apply to tilemap\nfor y in ${height}:\n\tfor x in ${width}:\n\t\tvar tile := Vector2i(0, 0) if grid[y][x] else Vector2i(1, 0)\n\t\ttilemap.set_cell(0, Vector2i(x, y), 0, tile)`; break;
			default:
				code = `# Random tilemap fill\nfor y in ${height}:\n\tfor x in ${width}:\n\t\tvar tile_idx := randi() % 4\n\t\ttilemap.set_cell(0, Vector2i(x, y), 0, Vector2i(tile_idx, 0))`;
		}
		return { content: [{ type: "text", text: code }] };
	});
}
