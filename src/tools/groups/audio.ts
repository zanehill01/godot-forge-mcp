/**
 * Audio Tool Group — 5 tools for audio setup.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute } from "../../utils/path.js";
import { generateResourceId } from "../../utils/path.js";
import { generateUid } from "../../utils/uid.js";
import type { ToolContext } from "../registry.js";

export function registerAudioTools(server: McpServer, ctx: ToolContext): void {
	server.tool("godot_add_audio", "Add an AudioStreamPlayer (2D/3D) to a scene.", {
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

	server.tool("godot_create_audio_bus", "Generate GDScript to configure audio bus layout.", {
		buses: z.array(z.object({ name: z.string(), volume_db: z.number().optional().default(0), effects: z.array(z.string()).optional() })),
	}, async ({ buses }) => {
		const lines = ["# Audio bus configuration — run in _ready() of an autoload"];
		for (let i = 0; i < buses.length; i++) {
			const b = buses[i];
			if (i > 0) lines.push(`AudioServer.add_bus(${i})`);
			lines.push(`AudioServer.set_bus_name(${i}, "${b.name}")`);
			lines.push(`AudioServer.set_bus_volume_db(${i}, ${b.volume_db})`);
			if (b.effects) {
				for (let j = 0; j < b.effects.length; j++) {
					lines.push(`AudioServer.add_bus_effect(${i}, AudioEffect${b.effects[j]}.new(), ${j})`);
				}
			}
		}
		return { content: [{ type: "text", text: lines.join("\n") }] };
	});

	server.tool("godot_audio_effects", "Generate GDScript for adding audio effects to a bus.", {
		busIndex: z.number(), effects: z.array(z.object({
			type: z.enum(["Reverb", "Chorus", "Delay", "EQ", "Compressor", "Limiter", "Distortion", "Phaser", "LowPassFilter", "HighPassFilter", "BandPassFilter", "NotchFilter"]),
			params: z.record(z.string(), z.string()).optional(),
		})),
	}, async ({ busIndex, effects }) => {
		const lines: string[] = [];
		for (let i = 0; i < effects.length; i++) {
			const e = effects[i];
			lines.push(`var fx_${i} := AudioEffect${e.type}.new()`);
			if (e.params) { for (const [k, v] of Object.entries(e.params)) lines.push(`fx_${i}.${k} = ${v}`); }
			lines.push(`AudioServer.add_bus_effect(${busIndex}, fx_${i}, ${i})`);
		}
		return { content: [{ type: "text", text: lines.join("\n") }] };
	});

	server.tool("godot_create_audio_pool", "Generate GDScript for a randomized audio pool with pitch/volume variance.", {
		sounds: z.array(z.string()).describe("Res paths to audio files"),
		pitchVariance: z.number().optional().default(0.1),
		volumeVariance: z.number().optional().default(2.0),
	}, async ({ sounds, pitchVariance, volumeVariance }) => {
		const code = `# Audio pool with randomization
var _audio_pool: Array[AudioStream] = [
${sounds.map((s) => `\tpreload("${s}"),`).join("\n")}
]
var _audio_player: AudioStreamPlayer

func _ready() -> void:
\t_audio_player = AudioStreamPlayer.new()
\tadd_child(_audio_player)

func play_random() -> void:
\t_audio_player.stream = _audio_pool.pick_random()
\t_audio_player.pitch_scale = randf_range(${1 - pitchVariance}, ${1 + pitchVariance})
\t_audio_player.volume_db = randf_range(-${volumeVariance}, ${volumeVariance})
\t_audio_player.play()`;
		return { content: [{ type: "text", text: code }] };
	});

	server.tool("godot_spatial_audio", "Configure 3D spatial audio parameters on an AudioStreamPlayer3D.", {
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
