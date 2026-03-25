/**
 * AI/Behavior Tool Group — 6 tools for game AI patterns.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../registry.js";
import { ScriptManager } from "../../engine/script-manager.js";
import { resToAbsolute } from "../../utils/path.js";

export function registerAIBehaviorTools(server: McpServer, ctx: ToolContext): void {
	const scriptMgr = new ScriptManager(ctx.projectRoot);

	server.tool("godot_create_state_machine", "Generate a finite state machine GDScript pattern.", {
		path: z.string().describe("Output script path (res://)"),
		extends: z.string().optional().default("CharacterBody2D"),
		states: z.array(z.string()).describe("State names (e.g., idle, patrol, chase, attack)"),
		className: z.string().optional(),
	}, async ({ path, extends: ext, states, className }) => {
		try {
			const stateEnum = states.map((s) => s.toUpperCase()).join(", ");
			const stateHandlers = states.map((s) => `\t\tState.${s.toUpperCase()}:\n\t\t\t_${s}_state(delta)`).join("\n");
			const stateMethods = states.map((s) =>
				`func _${s}_state(delta: float) -> void:\n\tpass\n\nfunc _enter_${s}_state() -> void:\n\tpass\n\nfunc _exit_${s}_state() -> void:\n\tpass`
			).join("\n\n");

			const code = `${className ? `class_name ${className}\n` : ""}extends ${ext}

enum State { ${stateEnum} }

var current_state: State = State.${states[0].toUpperCase()}
var previous_state: State = State.${states[0].toUpperCase()}

func _physics_process(delta: float) -> void:
\tmatch current_state:
${stateHandlers}

func change_state(new_state: State) -> void:
\tif new_state == current_state:
\t\treturn
\tprevious_state = current_state
\t_exit_state(current_state)
\tcurrent_state = new_state
\t_enter_state(new_state)

func _enter_state(state: State) -> void:
\tmatch state:
${states.map((s) => `\t\tState.${s.toUpperCase()}:\n\t\t\t_enter_${s}_state()`).join("\n")}

func _exit_state(state: State) -> void:
\tmatch state:
${states.map((s) => `\t\tState.${s.toUpperCase()}:\n\t\t\t_exit_${s}_state()`).join("\n")}

${stateMethods}
`;
			scriptMgr.write(path, code);
			return { content: [{ type: "text", text: `Created FSM at ${path} with states: ${states.join(", ")}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_create_behavior_tree", "Generate a behavior tree implementation in GDScript.", {
		path: z.string(), className: z.string().optional().default("BehaviorTree"),
		tree: z.object({
			type: z.enum(["selector", "sequence", "action", "condition"]),
			name: z.string(),
			children: z.array(z.object({ type: z.string(), name: z.string() })).optional(),
		}),
	}, async ({ path, className, tree }) => {
		try {
			const code = `class_name ${className}
extends Node

## Behavior Tree Node base
class BTNode:
\tvar name: String
\tfunc tick(actor: Node, delta: float) -> int:
\t\treturn 0 # 0=running, 1=success, -1=failure

class BTSelector extends BTNode:
\tvar children: Array[BTNode] = []
\tfunc tick(actor: Node, delta: float) -> int:
\t\tfor child in children:
\t\t\tvar result := child.tick(actor, delta)
\t\t\tif result != -1:
\t\t\t\treturn result
\t\treturn -1

class BTSequence extends BTNode:
\tvar children: Array[BTNode] = []
\tfunc tick(actor: Node, delta: float) -> int:
\t\tfor child in children:
\t\t\tvar result := child.tick(actor, delta)
\t\t\tif result != 1:
\t\t\t\treturn result
\t\treturn 1

# Root: ${tree.type} "${tree.name}"
var root: BTNode

func _ready() -> void:
\troot = BT${tree.type.charAt(0).toUpperCase() + tree.type.slice(1)}.new()
\troot.name = "${tree.name}"

func _physics_process(delta: float) -> void:
\tif root:
\t\troot.tick(get_parent(), delta)
`;
			scriptMgr.write(path, code);
			return { content: [{ type: "text", text: `Created behavior tree at ${path}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_create_dialogue_tree", "Generate a branching dialogue data structure with reader.", {
		dataPath: z.string().describe("Output .json path for dialogue data"),
		scriptPath: z.string().describe("Output .gd path for dialogue reader"),
		dialogues: z.array(z.object({
			id: z.string(), speaker: z.string(), text: z.string(),
			choices: z.array(z.object({ text: z.string(), nextId: z.string() })).optional(),
			nextId: z.string().optional(),
		})),
	}, async ({ dataPath, scriptPath, dialogues }) => {
		try {
			const { writeFileSync: wf, mkdirSync: mk } = await import("node:fs");
			const { dirname: dn } = await import("node:path");
			// Write JSON data
			const absData = resToAbsolute(dataPath, ctx.projectRoot);
			mk(dn(absData), { recursive: true });
			wf(absData, JSON.stringify(dialogues, null, 2), "utf-8");

			// Write reader script
			const readerCode = `class_name DialogueReader
extends Node

signal dialogue_started(id: String)
signal dialogue_line(speaker: String, text: String, choices: Array)
signal dialogue_ended

var _data: Array = []
var _current_id: String = ""

func load_dialogue(path: String) -> void:
\tvar file := FileAccess.open(path, FileAccess.READ)
\tvar json := JSON.new()
\tjson.parse(file.get_as_text())
\t_data = json.data

func start(id: String) -> void:
\t_current_id = id
\tdialogue_started.emit(id)
\t_show_current()

func choose(choice_index: int) -> void:
\tvar entry := _find_entry(_current_id)
\tif entry and entry.has("choices") and choice_index < entry.choices.size():
\t\t_current_id = entry.choices[choice_index].nextId
\t\t_show_current()

func _show_current() -> void:
\tvar entry := _find_entry(_current_id)
\tif not entry:
\t\tdialogue_ended.emit()
\t\treturn
\tvar choices: Array = entry.get("choices", [])
\tdialogue_line.emit(entry.speaker, entry.text, choices)
\tif choices.is_empty() and entry.has("nextId"):
\t\t_current_id = entry.nextId

func _find_entry(id: String) -> Dictionary:
\tfor entry in _data:
\t\tif entry.id == id:
\t\t\treturn entry
\treturn {}
`;
			scriptMgr.write(scriptPath, readerCode);
			return { content: [{ type: "text", text: `Created dialogue data at ${dataPath} (${dialogues.length} entries) and reader at ${scriptPath}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});

	server.tool("godot_pathfinding_setup", "Generate complete NavigationServer setup GDScript.", {
		is3d: z.boolean().optional().default(false),
	}, async ({ is3d }) => {
		const dim = is3d ? "3D" : "2D";
		const vec = is3d ? "Vector3" : "Vector2";
		const code = `# NavigationAgent${dim} setup — attach to your character
extends CharacterBody${dim}

@export var move_speed: float = 200.0
@onready var nav_agent: NavigationAgent${dim} = $NavigationAgent${dim}

func _ready() -> void:
\tnav_agent.path_desired_distance = 4.0
\tnav_agent.target_desired_distance = 4.0
\tnav_agent.velocity_computed.connect(_on_velocity_computed)

func set_target(target: ${vec}) -> void:
\tnav_agent.target_position = target

func _physics_process(_delta: float) -> void:
\tif nav_agent.is_navigation_finished():
\t\treturn
\tvar next_pos := nav_agent.get_next_path_position()
\tvar direction := (next_pos - global_position).normalized()
\tnav_agent.velocity = direction * move_speed

func _on_velocity_computed(safe_velocity: ${vec}) -> void:
\tvelocity = safe_velocity
\tmove_and_slide()
`;
		return { content: [{ type: "text", text: code }] };
	});

	server.tool("godot_steering_behaviors", "Generate GDScript steering behavior implementations.", {
		behaviors: z.array(z.enum(["seek", "flee", "arrive", "pursue", "evade", "wander", "flock"])),
		is3d: z.boolean().optional().default(false),
	}, async ({ behaviors, is3d }) => {
		const vec = is3d ? "Vector3" : "Vector2";
		const parts: string[] = [`# Steering behaviors for ${vec}`, `extends Node`, "", `var max_speed: float = 200.0`, `var max_force: float = 10.0`, ""];
		for (const b of behaviors) {
			switch (b) {
				case "seek": parts.push(`static func seek(position: ${vec}, target: ${vec}, velocity: ${vec}, max_speed: float) -> ${vec}:\n\tvar desired := (target - position).normalized() * max_speed\n\treturn desired - velocity\n`); break;
				case "flee": parts.push(`static func flee(position: ${vec}, threat: ${vec}, velocity: ${vec}, max_speed: float) -> ${vec}:\n\tvar desired := (position - threat).normalized() * max_speed\n\treturn desired - velocity\n`); break;
				case "arrive": parts.push(`static func arrive(position: ${vec}, target: ${vec}, velocity: ${vec}, max_speed: float, slow_radius: float) -> ${vec}:\n\tvar to_target := target - position\n\tvar distance := to_target.length()\n\tvar speed := max_speed if distance > slow_radius else max_speed * (distance / slow_radius)\n\tvar desired := to_target.normalized() * speed\n\treturn desired - velocity\n`); break;
				case "wander": parts.push(`static func wander(velocity: ${vec}, wander_radius: float, wander_distance: float) -> ${vec}:\n\tvar circle_center := velocity.normalized() * wander_distance\n\tvar angle := randf() * TAU\n\tvar offset := ${vec === "Vector3" ? `Vector3(cos(angle), 0, sin(angle))` : `Vector2(cos(angle), sin(angle))`} * wander_radius\n\treturn circle_center + offset\n`); break;
				default: parts.push(`# ${b}: implement custom\n`);
			}
		}
		return { content: [{ type: "text", text: parts.join("\n") }] };
	});

	server.tool("godot_spawn_system", "Generate a spawner GDScript with wave/pool/random patterns.", {
		path: z.string(), pattern: z.enum(["wave", "pool", "random"]),
		scenePath: z.string().describe("Scene to spawn (res://)"),
		maxCount: z.number().optional().default(10),
		spawnInterval: z.number().optional().default(1.0),
	}, async ({ path, pattern, scenePath, maxCount, spawnInterval }) => {
		try {
			let code: string;
			switch (pattern) {
				case "wave":
					code = `extends Node2D\n\n@export var enemy_scene: PackedScene = preload("${scenePath}")\n@export var wave_size: int = 5\n@export var waves: int = 3\n@export var spawn_delay: float = ${spawnInterval}\n\nvar current_wave := 0\nvar spawned := 0\n\nfunc start_wave() -> void:\n\tcurrent_wave += 1\n\tspawned = 0\n\tfor i in wave_size:\n\t\tawait get_tree().create_timer(spawn_delay).timeout\n\t\t_spawn()\n\nfunc _spawn() -> void:\n\tvar instance := enemy_scene.instantiate()\n\tinstance.global_position = global_position + Vector2(randf_range(-100, 100), 0)\n\tget_parent().add_child(instance)\n\tspawned += 1\n`; break;
				case "pool":
					code = `extends Node2D\n\n@export var scene: PackedScene = preload("${scenePath}")\n@export var pool_size: int = ${maxCount}\n\nvar _pool: Array[Node] = []\nvar _active: Array[Node] = []\n\nfunc _ready() -> void:\n\tfor i in pool_size:\n\t\tvar instance := scene.instantiate()\n\t\tinstance.visible = false\n\t\tadd_child(instance)\n\t\t_pool.append(instance)\n\nfunc spawn(pos: Vector2) -> Node:\n\tif _pool.is_empty():\n\t\treturn null\n\tvar instance := _pool.pop_back()\n\tinstance.global_position = pos\n\tinstance.visible = true\n\t_active.append(instance)\n\treturn instance\n\nfunc despawn(instance: Node) -> void:\n\tinstance.visible = false\n\t_active.erase(instance)\n\t_pool.append(instance)\n`; break;
				default:
					code = `extends Node2D\n\n@export var scene: PackedScene = preload("${scenePath}")\n@export var max_count: int = ${maxCount}\n@export var spawn_interval: float = ${spawnInterval}\n@export var spawn_radius: float = 200.0\n\nvar _count := 0\n\nfunc _ready() -> void:\n\tvar timer := Timer.new()\n\ttimer.wait_time = spawn_interval\n\ttimer.timeout.connect(_on_spawn_timer)\n\tadd_child(timer)\n\ttimer.start()\n\nfunc _on_spawn_timer() -> void:\n\tif _count >= max_count:\n\t\treturn\n\tvar instance := scene.instantiate()\n\tvar angle := randf() * TAU\n\tinstance.global_position = global_position + Vector2(cos(angle), sin(angle)) * randf_range(0, spawn_radius)\n\tget_parent().add_child(instance)\n\t_count += 1\n`;
			}
			scriptMgr.write(path, code);
			return { content: [{ type: "text", text: `Created ${pattern} spawner at ${path}` }] };
		} catch (e) { return { content: [{ type: "text", text: `Error: ${e}` }], isError: true }; }
	});
}
