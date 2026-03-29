/**
 * Audio Tool — Single tool with action-based routing.
 *
 * Covers: AudioStreamPlayer nodes (2D/3D), spatial audio configuration,
 * AudioBusLayout resources, runtime effects, and audio pool generation.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseTscn } from "../../parsers/tscn/parser.js";
import { writeTscn } from "../../parsers/tscn/writer.js";
import { resToAbsolute, generateResourceId } from "../../utils/path.js";
import { generateUid } from "../../utils/uid.js";
import type { ToolContext } from "../registry.js";
import { ScriptManager } from "../../engine/script-manager.js";

export function registerAudioTools(server: McpServer, ctx: ToolContext): void {
	const scriptMgr = new ScriptManager(ctx.projectRoot);

	server.tool("godot_audio",
		`Audio operations. Actions:

• add — Add AudioStreamPlayer (2D/3D) to a scene.
    scenePath (required), parent, dimension (none|2d|3d), streamPath, bus, autoplay, name

• spatial — Configure 3D spatial audio on an AudioStreamPlayer3D.
    scenePath (required), nodePath (required), maxDistance, attenuationModel (inverse_distance|inverse_square_distance|logarithmic), unitSize, maxDb

• bus_layout — Create an AudioBusLayout .tres resource.
    path (required), buses (required): [{name, solo?, mute?, volumeDb?, sendTo?, effects?: [{type, enabled?}]}]

• effects — Generate GDScript for adding audio effects to a bus at runtime.
    busName (required), effects (required): [{type, params?: Record<string,string>}]

• pool — Generate an AudioPool GDScript for randomized sound playback.
    path (required), poolSize, is3d, pitchMin, pitchMax, volumeMin, volumeMax, sounds (required): string[]`,
		{
			action: z.enum(["add", "spatial", "bus_layout", "effects", "pool"]),
			scenePath: z.string().optional(), nodePath: z.string().optional(), parent: z.string().optional().default("."),
			dimension: z.enum(["none", "2d", "3d"]).optional().default("none"),
			streamPath: z.string().optional(), bus: z.string().optional().default("Master"),
			autoplay: z.boolean().optional().default(false), name: z.string().optional().default("AudioPlayer"),
			maxDistance: z.number().optional(), attenuationModel: z.enum(["inverse_distance", "inverse_square_distance", "logarithmic"]).optional(),
			unitSize: z.number().optional(), maxDb: z.number().optional(),

			// bus_layout
			path: z.string().optional().describe("Output .tres or .gd path (res://)"),
			buses: z.array(z.object({
				name: z.string(),
				solo: z.boolean().optional().default(false),
				mute: z.boolean().optional().default(false),
				volumeDb: z.number().optional().default(0),
				sendTo: z.string().optional(),
				effects: z.array(z.object({
					type: z.enum(["Reverb", "Chorus", "Delay", "EQ", "Compressor", "Limiter", "Distortion", "Phaser", "LowPassFilter", "HighPassFilter", "BandPassFilter"]),
					enabled: z.boolean().optional().default(true),
				})).optional(),
			})).optional(),

			// effects
			busName: z.string().optional().describe("Target bus name for effects action"),
			effects: z.array(z.object({
				type: z.string().describe("Effect class: Reverb, Chorus, Delay, EQ, Compressor, Limiter, Distortion, Phaser"),
				params: z.record(z.string(), z.string()).optional().describe("Effect parameters (e.g., room_size, damping)"),
			})).optional(),

			// pool
			poolSize: z.number().optional().default(4).describe("Number of AudioStreamPlayer nodes in the pool"),
			is3d: z.boolean().optional().default(false),
			pitchMin: z.number().optional().default(0.9),
			pitchMax: z.number().optional().default(1.1),
			volumeMin: z.number().optional().default(-3),
			volumeMax: z.number().optional().default(3),
			sounds: z.array(z.string()).optional().describe("Array of audio file paths (res://)"),
		},
		async (p) => {
			try {
				switch (p.action) {
					// ── add ────────────────────────────────────────────────
					case "add": {
						if (!p.scenePath) return { content: [{ type: "text" as const, text: "scenePath required" }], isError: true };
						const absPath = resToAbsolute(p.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const typeMap = { none: "AudioStreamPlayer", "2d": "AudioStreamPlayer2D", "3d": "AudioStreamPlayer3D" };
						const props: Record<string, unknown> = { bus: p.bus, autoplay: p.autoplay };
						if (p.streamPath) {
							const id = generateResourceId();
							doc.extResources.push({ type: "AudioStream", uid: generateUid(), path: p.streamPath, id });
							props.stream = { type: "ExtResource", id };
						}
						doc.nodes.push({ name: p.name ?? "AudioPlayer", type: typeMap[p.dimension ?? "none"], parent: p.parent, properties: props as Record<string, import("../../parsers/tscn/types.js").GodotVariant> });
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Added ${typeMap[p.dimension ?? "none"]} "${p.name}" to ${p.scenePath}` }] };
					}

					// ── spatial ────────────────────────────────────────────
					case "spatial": {
						if (!p.scenePath || !p.nodePath) return { content: [{ type: "text" as const, text: "scenePath, nodePath required" }], isError: true };
						const absPath = resToAbsolute(p.scenePath, ctx.projectRoot);
						const doc = parseTscn(readFileSync(absPath, "utf-8"));
						const node = doc.nodes.find((n) => (n.parent === undefined ? "." : n.parent === "." ? n.name : `${n.parent}/${n.name}`) === p.nodePath);
						if (!node) return { content: [{ type: "text" as const, text: `Node not found: ${p.nodePath}` }], isError: true };
						if (p.maxDistance !== undefined) node.properties.max_distance = p.maxDistance;
						if (p.attenuationModel) { const map: Record<string, number> = { inverse_distance: 0, inverse_square_distance: 1, logarithmic: 2 }; node.properties.attenuation_model = map[p.attenuationModel]; }
						if (p.unitSize !== undefined) node.properties.unit_size = p.unitSize;
						if (p.maxDb !== undefined) node.properties.max_db = p.maxDb;
						writeFileSync(absPath, writeTscn(doc), "utf-8");
						return { content: [{ type: "text" as const, text: `Configured spatial audio on "${p.nodePath}"` }] };
					}

					// ── bus_layout ─────────────────────────────────────────
					case "bus_layout": {
						if (!p.path || !p.buses?.length) return { content: [{ type: "text" as const, text: "path and buses[] required" }], isError: true };
						const lines: string[] = [`[gd_resource type="AudioBusLayout" format=3]`, "", "[resource]"];

						for (let i = 0; i < p.buses.length; i++) {
							const bus = p.buses[i];
							lines.push(`bus/${i}/name = &"${bus.name}"`);
							lines.push(`bus/${i}/solo = ${bus.solo ?? false}`);
							lines.push(`bus/${i}/mute = ${bus.mute ?? false}`);
							lines.push(`bus/${i}/volume_db = ${bus.volumeDb ?? 0}`);
							if (bus.sendTo) lines.push(`bus/${i}/send = &"${bus.sendTo}"`);
							if (bus.effects) {
								for (let j = 0; j < bus.effects.length; j++) {
									const fx = bus.effects[j];
									lines.push(`bus/${i}/effect/${j}/effect = SubResource("AudioEffect${fx.type}_${generateResourceId()}")`);
									lines.push(`bus/${i}/effect/${j}/enabled = ${fx.enabled ?? true}`);
								}
							}
						}
						lines.push("");

						const absPath = resToAbsolute(p.path, ctx.projectRoot);
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, lines.join("\n"), "utf-8");
						return { content: [{ type: "text" as const, text: `Created AudioBusLayout at ${p.path} with ${p.buses.length} buses: ${p.buses.map((b) => b.name).join(", ")}` }] };
					}

					// ── effects ────────────────────────────────────────────
					case "effects": {
						if (!p.busName || !p.effects?.length) return { content: [{ type: "text" as const, text: "busName and effects[] required" }], isError: true };
						const lines: string[] = [
							`# Audio effects setup for bus "${p.busName}"`,
							`# Call this from _ready() or a setup function`,
							"",
							`func setup_${p.busName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_effects() -> void:`,
							`\tvar bus_idx := AudioServer.get_bus_index("${p.busName}")`,
							`\tif bus_idx < 0:`,
							`\t\tpush_warning("Bus '${p.busName}' not found")`,
							`\t\treturn`,
							"",
						];

						for (let i = 0; i < p.effects.length; i++) {
							const fx = p.effects[i];
							const varName = `fx_${fx.type.toLowerCase()}_${i}`;
							lines.push(`\t# Effect ${i}: ${fx.type}`);
							lines.push(`\tvar ${varName} := AudioEffect${fx.type}.new()`);
							if (fx.params) {
								for (const [k, v] of Object.entries(fx.params)) {
									lines.push(`\t${varName}.${k} = ${v}`);
								}
							}
							lines.push(`\tAudioServer.add_bus_effect(bus_idx, ${varName})`);
							lines.push("");
						}

						return { content: [{ type: "text" as const, text: lines.join("\n") }] };
					}

					// ── pool ───────────────────────────────────────────────
					case "pool": {
						if (!p.path || !p.sounds?.length) return { content: [{ type: "text" as const, text: "path and sounds[] required" }], isError: true };
						const poolSize = p.poolSize ?? 4;
						const playerType = p.is3d ? "AudioStreamPlayer3D" : "AudioStreamPlayer";
						const baseType = p.is3d ? "Node3D" : "Node";

						const preloads = p.sounds.map((s, i) => `var _stream_${i}: AudioStream = preload("${s}")`).join("\n");
						const streamArray = p.sounds.map((_, i) => `_stream_${i}`).join(", ");

						const code = `class_name AudioPool
extends ${baseType}

## Pooled audio player with randomized pitch/volume.
## Cycles through ${poolSize} players to handle overlapping sounds.

${preloads}
var _streams: Array[AudioStream] = [${streamArray}]

@export var pool_size: int = ${poolSize}
@export var pitch_min: float = ${p.pitchMin ?? 0.9}
@export var pitch_max: float = ${p.pitchMax ?? 1.1}
@export var volume_min: float = ${p.volumeMin ?? -3}
@export var volume_max: float = ${p.volumeMax ?? 3}
@export var bus: String = "Master"

var _players: Array[${playerType}] = []
var _next_player: int = 0

func _ready() -> void:
\tfor i in pool_size:
\t\tvar player := ${playerType}.new()
\t\tplayer.bus = bus
\t\tadd_child(player)
\t\t_players.append(player)

func play_random(${p.is3d ? "position: Vector3 = Vector3.ZERO" : ""}) -> void:
\tif _players.is_empty() or _streams.is_empty():
\t\treturn
\tvar player := _players[_next_player]
\t_next_player = (_next_player + 1) % _players.size()
\tplayer.stream = _streams[randi() % _streams.size()]
\tplayer.pitch_scale = randf_range(pitch_min, pitch_max)
\tplayer.volume_db = randf_range(volume_min, volume_max)
${p.is3d ? "\tplayer.global_position = position" : ""}
\tplayer.play()

func play_specific(index: int${p.is3d ? ", position: Vector3 = Vector3.ZERO" : ""}) -> void:
\tif index < 0 or index >= _streams.size():
\t\treturn
\tvar player := _players[_next_player]
\t_next_player = (_next_player + 1) % _players.size()
\tplayer.stream = _streams[index]
\tplayer.pitch_scale = randf_range(pitch_min, pitch_max)
\tplayer.volume_db = randf_range(volume_min, volume_max)
${p.is3d ? "\tplayer.global_position = position" : ""}
\tplayer.play()

func stop_all() -> void:
\tfor player in _players:
\t\tplayer.stop()
`;
						scriptMgr.write(p.path, code);
						return { content: [{ type: "text" as const, text: `Created AudioPool at ${p.path} (${poolSize} players, ${p.sounds.length} sounds, ${p.is3d ? "3D" : "non-spatial"})` }] };
					}

					default:
						return { content: [{ type: "text" as const, text: `Unknown action: ${p.action}` }], isError: true };
				}
			} catch (e) { return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true }; }
		},
	);
}
