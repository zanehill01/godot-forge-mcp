/**
 * Audio Tool — Single tool with action-based routing.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute, generateResourceId } from "../../utils/path.js";
import { generateUid } from "../../utils/uid.js";
import type { ToolContext } from "../registry.js";

export function registerAudioTools(server: McpServer, ctx: ToolContext): void {
	server.tool("godot_audio",
		`Audio operations. Actions:
- add: Add AudioStreamPlayer (2D/3D) to a scene. Params: scenePath, parent, dimension (none|2d|3d), streamPath, bus, autoplay, name
- spatial: Configure 3D spatial audio on an AudioStreamPlayer3D. Params: scenePath, nodePath, maxDistance, attenuationModel, unitSize, maxDb`,
		{
			action: z.enum(["add", "spatial"]),
			scenePath: z.string(), nodePath: z.string().optional(), parent: z.string().optional().default("."),
			dimension: z.enum(["none", "2d", "3d"]).optional().default("none"),
			streamPath: z.string().optional(), bus: z.string().optional().default("Master"),
			autoplay: z.boolean().optional().default(false), name: z.string().optional().default("AudioPlayer"),
			maxDistance: z.number().optional(), attenuationModel: z.enum(["inverse_distance", "inverse_square_distance", "logarithmic"]).optional(),
			unitSize: z.number().optional(), maxDb: z.number().optional(),
		},
		async (p) => {
			try {
				const absPath = resToAbsolute(p.scenePath, ctx.projectRoot);
				const doc = parseTscn(readFileSync(absPath, "utf-8"));
				switch (p.action) {
					case "add": {
						const typeMap = { none: "AudioStreamPlayer", "2d": "AudioStreamPlayer2D", "3d": "AudioStreamPlayer3D" };
						const props: Record<string, unknown> = { bus: p.bus, autoplay: p.autoplay };
						if (p.streamPath) {
							const id = generateResourceId();
							doc.extResources.push({ type: "AudioStream", uid: generateUid(), path: p.streamPath, id });
							props.stream = { type: "ExtResource", id };
						}
						doc.nodes.push({ name: p.name ?? "AudioPlayer", type: typeMap[p.dimension ?? "none"], parent: p.parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Added ${typeMap[p.dimension ?? "none"]} "${p.name}" to ${p.scenePath}` }] };
					}
					case "spatial": {
						if (!p.nodePath) return { content: [{ type: "text", text: "nodePath required" }], isError: true };
						const node = doc.nodes.find((n) => (n.parent === undefined ? "." : n.parent === "." ? n.name : `${n.parent}/${n.name}`) === p.nodePath);
						if (!node) return { content: [{ type: "text", text: `Node not found: ${p.nodePath}` }], isError: true };
						if (p.maxDistance !== undefined) node.properties.max_distance = p.maxDistance;
						if (p.attenuationModel) { const map: Record<string, number> = { inverse_distance: 0, inverse_square_distance: 1, logarithmic: 2 }; node.properties.attenuation_model = map[p.attenuationModel]; }
						if (p.unitSize !== undefined) node.properties.unit_size = p.unitSize;
						if (p.maxDb !== undefined) node.properties.max_db = p.maxDb;
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text", text: `Configured spatial audio on "${p.nodePath}"` }] };
					}
				}
			} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
		},
	);
}
