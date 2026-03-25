/**
 * Audio Tool Group — 2 tools that manipulate scene data.
 *
 * Removed: create_audio_bus, audio_effects, create_audio_pool (all pure code-gen).
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
	server.tool("godot_add_audio", "Add an AudioStreamPlayer (2D/3D) node to a scene with an audio stream resource.", {
		scenePath: z.string(), parent: z.string().optional().default("."),
		dimension: z.enum(["none", "2d", "3d"]).optional().default("none"),
		streamPath: z.string().optional().describe("Audio file path (res://)"),
		bus: z.string().optional().default("Master"),
		autoplay: z.boolean().optional().default(false),
		name: z.string().optional().default("AudioPlayer"),
	}, async ({ scenePath, parent, dimension, streamPath, bus, autoplay, name }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const typeMap = { none: "AudioStreamPlayer", "2d": "AudioStreamPlayer2D", "3d": "AudioStreamPlayer3D" };
			const props: Record<string, unknown> = { bus, autoplay };
			if (streamPath) {
				const id = generateResourceId();
				doc.extResources.push({ type: "AudioStream", uid: generateUid(), path: streamPath, id });
				props.stream = { type: "ExtResource", id };
			}
			doc.nodes.push({ name, type: typeMap[dimension], parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Added ${typeMap[dimension]} "${name}" to ${scenePath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_spatial_audio", "Configure 3D spatial audio parameters on an AudioStreamPlayer3D node in a scene.", {
		scenePath: z.string(), nodePath: z.string(),
		maxDistance: z.number().optional(), attenuationModel: z.enum(["inverse_distance", "inverse_square_distance", "logarithmic"]).optional(),
		unitSize: z.number().optional(), maxDb: z.number().optional(),
	}, async ({ scenePath, nodePath, maxDistance, attenuationModel, unitSize, maxDb }) => {
		try {
			const absPath = resToAbsolute(scenePath, ctx.projectRoot);
			const doc = parseTscn(readFileSync(absPath, "utf-8"));
			const node = doc.nodes.find((n) => (n.parent === undefined ? "." : n.parent === "." ? n.name : `${n.parent}/${n.name}`) === nodePath);
			if (!node) return { content: [{ type: "text", text: `Node not found: ${nodePath}` }], isError: true };
			if (maxDistance !== undefined) node.properties.max_distance = maxDistance;
			if (attenuationModel) { const map: Record<string, number> = { inverse_distance: 0, inverse_square_distance: 1, logarithmic: 2 }; node.properties.attenuation_model = map[attenuationModel]; }
			if (unitSize !== undefined) node.properties.unit_size = unitSize;
			if (maxDb !== undefined) node.properties.max_db = maxDb;
			writeFileSync(absPath, writeTscn(doc), "utf-8");
			return { content: [{ type: "text", text: `Configured spatial audio on "${nodePath}"` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});
}
