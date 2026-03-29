/**
 * AI/Behavior Tool Group — Unified action-routed tool for game AI patterns.
 *
 * Covers: state machines, behavior trees, dialogue, pathfinding,
 * steering behaviors, spawn systems, and director systems.
 * Full 2D/3D support for all actions.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../registry.js";
import { ScriptManager } from "../../engine/script-manager.js";

export function registerAIBehaviorTools(server: McpServer, ctx: ToolContext): void {
	const scriptMgr = new ScriptManager(ctx.projectRoot);

	server.tool(
		"godot_ai",
		`AI and behavior pattern generator. Actions:

• state_machine — Generate a finite state machine GDScript.
    path (required), extends (default CharacterBody3D), states (required, string[]), className, is3d (default true)

• behavior_tree — Generate a behavior tree GDScript skeleton.
    path (required), className (default BehaviorTree), tree {type: selector|sequence|action|condition, name, children?: [{type, name}]}

• dialogue — Generate dialogue data (JSON) + reader script.
    dataPath (required), scriptPath (required), dialogues (required): [{id, speaker, text, choices?: [{text, nextId}], nextId?}]

• pathfinding — Generate NavigationAgent setup GDScript.
    is3d (default true)

• steering — Generate steering behavior implementations.
    behaviors (required): seek|flee|arrive|pursue|evade|wander|flock[], is3d (default true)

• spawn — Generate spawner GDScript (wave/pool/random patterns).
    path (required), pattern (required: wave|pool|random), scenePath (required), maxCount, spawnInterval, is3d (default true)

• director — Generate a RoR2-style Director system for time-based difficulty + spawn budgeting.
    path (required), is3d (default true)`,
		{
			action: z.enum(["state_machine", "behavior_tree", "dialogue", "pathfinding", "steering", "spawn", "director"]),
			path: z.string().optional().describe("Output script path (res://)"),
			extends: z.string().optional().describe("Base class for state machine (default CharacterBody3D)"),
			states: z.array(z.string()).optional().describe("State names for FSM (e.g., idle, patrol, chase, attack)"),
			className: z.string().optional().describe("Class name for generated script"),
			is3d: z.boolean().optional().default(true).describe("3D (true) or 2D (false) — defaults to 3D"),
			tree: z.object({
				type: z.enum(["selector", "sequence", "action", "condition"]),
				name: z.string(),
				children: z.array(z.object({ type: z.string(), name: z.string() })).optional(),
			}).optional().describe("Behavior tree root definition"),
			dataPath: z.string().optional().describe("Dialogue JSON output path"),
			scriptPath: z.string().optional().describe("Dialogue reader script output path"),
			dialogues: z.array(z.object({
				id: z.string(), speaker: z.string(), text: z.string(),
				choices: z.array(z.object({ text: z.string(), nextId: z.string() })).optional(),
				nextId: z.string().optional(),
			})).optional(),
			behaviors: z.array(z.enum(["seek", "flee", "arrive", "pursue", "evade", "wander", "flock"])).optional(),
			pattern: z.enum(["wave", "pool", "random"]).optional().describe("Spawn pattern type"),
			scenePath: z.string().optional().describe("Scene to spawn (res://)"),
			maxCount: z.number().optional().default(10),
			spawnInterval: z.number().optional().default(1.0),
		},
		async (args) => {
			try {
				const dim3d = args.is3d !== false;
				const vec = dim3d ? "Vector3" : "Vector2";
				const bodyType = dim3d ? "CharacterBody3D" : "CharacterBody2D";
				const nodeType = dim3d ? "Node3D" : "Node2D";

				switch (args.action) {
					// ── state_machine ──────────────────────────────────────
					case "state_machine": {
						if (!args.path || !args.states?.length) return { content: [{ type: "text" as const, text: "path and states[] required" }], isError: true };
						const ext = args.extends ?? bodyType;
						const stateEnum = args.states.map((s) => s.toUpperCase()).join(", ");
						const stateHandlers = args.states.map((s) => `\t\tState.${s.toUpperCase()}:\n\t\t\t_${s}_state(delta)`).join("\n");
						const stateMethods = args.states.map((s) =>
							`func _${s}_state(delta: float) -> void:\n\tpass\n\nfunc _enter_${s}_state() -> void:\n\tpass\n\nfunc _exit_${s}_state() -> void:\n\tpass`
						).join("\n\n");

						const code = `${args.className ? `class_name ${args.className}\n` : ""}extends ${ext}

enum State { ${stateEnum} }

var current_state: State = State.${args.states[0].toUpperCase()}
var previous_state: State = State.${args.states[0].toUpperCase()}

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
${args.states.map((s) => `\t\tState.${s.toUpperCase()}:\n\t\t\t_enter_${s}_state()`).join("\n")}

func _exit_state(state: State) -> void:
\tmatch state:
${args.states.map((s) => `\t\tState.${s.toUpperCase()}:\n\t\t\t_exit_${s}_state()`).join("\n")}

${stateMethods}
`;
						scriptMgr.write(args.path, code);
						return { content: [{ type: "text" as const, text: `Created FSM at ${args.path} (${ext}) with states: ${args.states.join(", ")}` }] };
					}

					// ── behavior_tree ──────────────────────────────────────
					case "behavior_tree": {
						if (!args.path || !args.tree) return { content: [{ type: "text" as const, text: "path and tree required" }], isError: true };
						const cn = args.className ?? "BehaviorTree";
						const code = `class_name ${cn}
extends Node

## Behavior Tree Node base
class BTNode:
\tvar name: String
\tfunc tick(actor: Node, delta: float) -> int:
\t\treturn 0  # 0=running, 1=success, -1=failure

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

class BTAction extends BTNode:
\tvar action_callable: Callable
\tfunc tick(actor: Node, delta: float) -> int:
\t\tif action_callable.is_valid():
\t\t\treturn action_callable.call(actor, delta)
\t\treturn -1

class BTCondition extends BTNode:
\tvar condition_callable: Callable
\tfunc tick(actor: Node, delta: float) -> int:
\t\tif condition_callable.is_valid():
\t\t\treturn 1 if condition_callable.call(actor) else -1
\t\treturn -1

# Root: ${args.tree.type} "${args.tree.name}"
var root: BTNode

func _ready() -> void:
\troot = BT${args.tree.type.charAt(0).toUpperCase() + args.tree.type.slice(1)}.new()
\troot.name = "${args.tree.name}"

func _physics_process(delta: float) -> void:
\tif root:
\t\troot.tick(get_parent(), delta)
`;
						scriptMgr.write(args.path, code);
						return { content: [{ type: "text" as const, text: `Created behavior tree at ${args.path}` }] };
					}

					// ── dialogue ───────────────────────────────────────────
					case "dialogue": {
						if (!args.dataPath || !args.scriptPath || !args.dialogues) return { content: [{ type: "text" as const, text: "dataPath, scriptPath, dialogues required" }], isError: true };
						const { writeFileSync: wf, mkdirSync: mk } = await import("node:fs");
						const { dirname: dn } = await import("node:path");
						const { resToAbsolute } = await import("../../utils/path.js");

						const absData = resToAbsolute(args.dataPath, ctx.projectRoot);
						mk(dn(absData), { recursive: true });
						wf(absData, JSON.stringify(args.dialogues, null, 2), "utf-8");

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
						scriptMgr.write(args.scriptPath, readerCode);
						return { content: [{ type: "text" as const, text: `Created dialogue data at ${args.dataPath} (${args.dialogues.length} entries) and reader at ${args.scriptPath}` }] };
					}

					// ── pathfinding ────────────────────────────────────────
					case "pathfinding": {
						const code = `# NavigationAgent${dim3d ? "3D" : "2D"} setup — attach to your character
extends ${bodyType}

@export var move_speed: float = ${dim3d ? "5.0" : "200.0"}
@onready var nav_agent: NavigationAgent${dim3d ? "3D" : "2D"} = $NavigationAgent${dim3d ? "3D" : "2D"}

func _ready() -> void:
\tnav_agent.path_desired_distance = ${dim3d ? "0.5" : "4.0"}
\tnav_agent.target_desired_distance = ${dim3d ? "0.5" : "4.0"}
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
						return { content: [{ type: "text" as const, text: code }] };
					}

					// ── steering ───────────────────────────────────────────
					case "steering": {
						if (!args.behaviors?.length) return { content: [{ type: "text" as const, text: "behaviors[] required" }], isError: true };
						const parts: string[] = [`# Steering behaviors for ${vec}`, `extends Node`, "", `var max_speed: float = ${dim3d ? "5.0" : "200.0"}`, `var max_force: float = ${dim3d ? "1.0" : "10.0"}`, ""];
						for (const b of args.behaviors) {
							switch (b) {
								case "seek": parts.push(`static func seek(position: ${vec}, target: ${vec}, velocity: ${vec}, max_speed: float) -> ${vec}:\n\tvar desired := (target - position).normalized() * max_speed\n\treturn desired - velocity\n`); break;
								case "flee": parts.push(`static func flee(position: ${vec}, threat: ${vec}, velocity: ${vec}, max_speed: float) -> ${vec}:\n\tvar desired := (position - threat).normalized() * max_speed\n\treturn desired - velocity\n`); break;
								case "arrive": parts.push(`static func arrive(position: ${vec}, target: ${vec}, velocity: ${vec}, max_speed: float, slow_radius: float) -> ${vec}:\n\tvar to_target := target - position\n\tvar distance := to_target.length()\n\tvar speed := max_speed if distance > slow_radius else max_speed * (distance / slow_radius)\n\tvar desired := to_target.normalized() * speed\n\treturn desired - velocity\n`); break;
								case "pursue": parts.push(`static func pursue(position: ${vec}, target_pos: ${vec}, target_vel: ${vec}, velocity: ${vec}, max_speed: float) -> ${vec}:\n\tvar distance := (target_pos - position).length()\n\tvar prediction := distance / max_speed\n\tvar future_pos := target_pos + target_vel * prediction\n\treturn seek(position, future_pos, velocity, max_speed)\n`); break;
								case "evade": parts.push(`static func evade(position: ${vec}, threat_pos: ${vec}, threat_vel: ${vec}, velocity: ${vec}, max_speed: float) -> ${vec}:\n\tvar distance := (threat_pos - position).length()\n\tvar prediction := distance / max_speed\n\tvar future_pos := threat_pos + threat_vel * prediction\n\treturn flee(position, future_pos, velocity, max_speed)\n`); break;
								case "wander": parts.push(`static func wander(velocity: ${vec}, wander_radius: float, wander_distance: float) -> ${vec}:\n\tvar circle_center := velocity.normalized() * wander_distance\n\tvar angle := randf() * TAU\n\tvar offset := ${dim3d ? `Vector3(cos(angle), 0, sin(angle))` : `Vector2(cos(angle), sin(angle))`} * wander_radius\n\treturn circle_center + offset\n`); break;
								case "flock": parts.push(`static func flock(position: ${vec}, velocity: ${vec}, neighbors: Array[${bodyType}], separation_weight: float = 1.5, alignment_weight: float = 1.0, cohesion_weight: float = 1.0) -> ${vec}:\n\tif neighbors.is_empty():\n\t\treturn ${vec}.ZERO\n\tvar separation := ${vec}.ZERO\n\tvar alignment := ${vec}.ZERO\n\tvar center := ${vec}.ZERO\n\tfor neighbor in neighbors:\n\t\tvar diff := position - neighbor.global_position\n\t\tvar dist := diff.length()\n\t\tif dist > 0:\n\t\t\tseparation += diff.normalized() / dist\n\t\talignment += neighbor.velocity\n\t\tcenter += neighbor.global_position\n\talignment /= neighbors.size()\n\tcenter /= neighbors.size()\n\tvar cohesion := (center - position).normalized()\n\treturn separation * separation_weight + (alignment - velocity).normalized() * alignment_weight + cohesion * cohesion_weight\n`); break;
							}
						}
						return { content: [{ type: "text" as const, text: parts.join("\n") }] };
					}

					// ── spawn ──────────────────────────────────────────────
					case "spawn": {
						if (!args.path || !args.pattern || !args.scenePath) return { content: [{ type: "text" as const, text: "path, pattern, scenePath required" }], isError: true };
						const maxCount = args.maxCount ?? 10;
						const interval = args.spawnInterval ?? 1.0;
						let code: string;

						switch (args.pattern) {
							case "wave":
								code = `extends ${nodeType}

@export var enemy_scene: PackedScene = preload("${args.scenePath}")
@export var wave_size: int = 5
@export var waves: int = 3
@export var spawn_delay: float = ${interval}

var current_wave := 0
var spawned := 0

signal wave_started(wave_number: int)
signal wave_completed(wave_number: int)
signal enemy_spawned(instance: Node)

func start_wave() -> void:
\tcurrent_wave += 1
\tspawned = 0
\twave_started.emit(current_wave)
\tfor i in wave_size:
\t\tawait get_tree().create_timer(spawn_delay).timeout
\t\t_spawn()
\twave_completed.emit(current_wave)

func _spawn() -> void:
\tvar instance := enemy_scene.instantiate()
\tinstance.global_position = global_position + ${dim3d ? "Vector3(randf_range(-10, 10), 0, randf_range(-10, 10))" : "Vector2(randf_range(-100, 100), 0)"}
\tget_parent().add_child(instance)
\tspawned += 1
\tenemy_spawned.emit(instance)
`; break;
							case "pool":
								code = `extends ${nodeType}

@export var scene: PackedScene = preload("${args.scenePath}")
@export var pool_size: int = ${maxCount}

var _pool: Array[Node] = []
var _active: Array[Node] = []

func _ready() -> void:
\tfor i in pool_size:
\t\tvar instance := scene.instantiate()
\t\tinstance.visible = false
\t\tinstance.set_physics_process(false)
\t\tadd_child(instance)
\t\t_pool.append(instance)

func spawn(pos: ${vec}) -> Node:
\tif _pool.is_empty():
\t\treturn null
\tvar instance := _pool.pop_back()
\tinstance.global_position = pos
\tinstance.visible = true
\tinstance.set_physics_process(true)
\t_active.append(instance)
\treturn instance

func despawn(instance: Node) -> void:
\tinstance.visible = false
\tinstance.set_physics_process(false)
\t_active.erase(instance)
\t_pool.append(instance)

func get_active_count() -> int:
\treturn _active.size()
`; break;
							default:
								code = `extends ${nodeType}

@export var scene: PackedScene = preload("${args.scenePath}")
@export var max_count: int = ${maxCount}
@export var spawn_interval: float = ${interval}
@export var spawn_radius: float = ${dim3d ? "20.0" : "200.0"}

var _count := 0

signal enemy_spawned(instance: Node)

func _ready() -> void:
\tvar timer := Timer.new()
\ttimer.wait_time = spawn_interval
\ttimer.timeout.connect(_on_spawn_timer)
\tadd_child(timer)
\ttimer.start()

func _on_spawn_timer() -> void:
\tif _count >= max_count:
\t\treturn
\tvar instance := scene.instantiate()
\tvar angle := randf() * TAU
\tinstance.global_position = global_position + ${dim3d ? "Vector3(cos(angle), 0, sin(angle)) * randf_range(0, spawn_radius)" : "Vector2(cos(angle), sin(angle)) * randf_range(0, spawn_radius)"}
\tget_parent().add_child(instance)
\t_count += 1
\tenemy_spawned.emit(instance)
`;
						}
						scriptMgr.write(args.path, code);
						return { content: [{ type: "text" as const, text: `Created ${args.pattern} spawner at ${args.path} (${dim3d ? "3D" : "2D"})` }] };
					}

					// ── director ───────────────────────────────────────────
					case "director": {
						if (!args.path) return { content: [{ type: "text" as const, text: "path required" }], isError: true };
						const code = `class_name Director
extends Node

## RoR2-style Director system — time-based difficulty with spawn budgeting.
## Attach to a persistent node (autoload recommended).

# ── Signals ──────────────────────────────────────────────────────────
signal enemy_spawned(instance: Node, spawn_point: ${vec})
signal difficulty_changed(coefficient: float)
signal credits_spent(amount: float, remaining: float)

# ── Configuration ────────────────────────────────────────────────────
@export_group("Difficulty")
@export var base_difficulty: float = 1.0
@export var difficulty_scale_rate: float = 0.05  ## Coefficient increase per second
@export var player_count_factor: float = 1.0     ## Multiply for co-op scaling

@export_group("Spawn Budget")
@export var base_credits_per_second: float = 1.0
@export var spawn_tick_interval: float = 3.0     ## Seconds between spawn attempts
@export var max_credit_reserve: float = 100.0    ## Cap on banked credits

@export_group("Enemy Pool")
@export var enemy_scenes: Array[PackedScene] = []
@export var enemy_costs: Array[float] = []       ## Parallel array: cost per scene
@export var enemy_min_difficulty: Array[float] = []  ## Min difficulty to unlock each enemy

# ── Runtime State ────────────────────────────────────────────────────
var elapsed_time: float = 0.0
var difficulty_coefficient: float = 1.0
var credit_reserve: float = 0.0
var total_spawned: int = 0
var _active: bool = false
var _spawn_timer: Timer
var _spawn_points: Array[${vec}] = []

func _ready() -> void:
\t_spawn_timer = Timer.new()
\t_spawn_timer.wait_time = spawn_tick_interval
\t_spawn_timer.timeout.connect(_on_spawn_tick)
\tadd_child(_spawn_timer)

# ── Public API ───────────────────────────────────────────────────────

func start_director(spawn_points: Array[${vec}]) -> void:
\t_spawn_points = spawn_points
\t_active = true
\telapsed_time = 0.0
\tcredit_reserve = 0.0
\t_spawn_timer.start()

func stop_director() -> void:
\t_active = false
\t_spawn_timer.stop()

func pause_director() -> void:
\t_spawn_timer.paused = true

func resume_director() -> void:
\t_spawn_timer.paused = false

func set_spawn_points(points: Array[${vec}]) -> void:
\t_spawn_points = points

func get_difficulty() -> float:
\treturn difficulty_coefficient

func get_difficulty_label() -> String:
\tif difficulty_coefficient < 2.0: return "Easy"
\telif difficulty_coefficient < 5.0: return "Medium"
\telif difficulty_coefficient < 10.0: return "Hard"
\telif difficulty_coefficient < 20.0: return "Very Hard"
\telif difficulty_coefficient < 40.0: return "Insane"
\telse: return "HAHAHAHA"

# ── Tick Logic ───────────────────────────────────────────────────────

func _process(delta: float) -> void:
\tif not _active:
\t\treturn
\telapsed_time += delta
\tvar new_coeff := base_difficulty + elapsed_time * difficulty_scale_rate * player_count_factor
\tif absf(new_coeff - difficulty_coefficient) > 0.01:
\t\tdifficulty_coefficient = new_coeff
\t\tdifficulty_changed.emit(difficulty_coefficient)
\t# Accumulate credits
\tcredit_reserve = minf(credit_reserve + base_credits_per_second * difficulty_coefficient * delta, max_credit_reserve)

func _on_spawn_tick() -> void:
\tif not _active or _spawn_points.is_empty() or enemy_scenes.is_empty():
\t\treturn
\t# Try to spend credits on enemies
\tvar attempts := 0
\twhile credit_reserve > 0 and attempts < 5:
\t\tattempts += 1
\t\tvar idx := _pick_enemy()
\t\tif idx < 0:
\t\t\tbreak
\t\tvar cost := enemy_costs[idx] if idx < enemy_costs.size() else 1.0
\t\tif credit_reserve < cost:
\t\t\tbreak
\t\tcredit_reserve -= cost
\t\tvar point := _spawn_points[randi() % _spawn_points.size()]
\t\tvar instance := enemy_scenes[idx].instantiate()
\t\t${dim3d ? "instance.global_position = point" : "instance.global_position = point"}
\t\tget_parent().add_child(instance)
\t\ttotal_spawned += 1
\t\tenemy_spawned.emit(instance, point)
\t\tcredits_spent.emit(cost, credit_reserve)

func _pick_enemy() -> int:
\t## Weighted random selection from affordable + unlocked enemies
\tvar candidates: Array[int] = []
\tvar weights: Array[float] = []
\tfor i in enemy_scenes.size():
\t\tvar cost := enemy_costs[i] if i < enemy_costs.size() else 1.0
\t\tvar min_diff := enemy_min_difficulty[i] if i < enemy_min_difficulty.size() else 0.0
\t\tif cost <= credit_reserve and difficulty_coefficient >= min_diff:
\t\t\tcandidates.append(i)
\t\t\t# Heavier enemies are less common
\t\t\tweights.append(1.0 / maxf(cost, 0.1))
\tif candidates.is_empty():
\t\treturn -1
\tvar total_weight := 0.0
\tfor w in weights:
\t\ttotal_weight += w
\tvar roll := randf() * total_weight
\tvar cumulative := 0.0
\tfor j in candidates.size():
\t\tcumulative += weights[j]
\t\tif roll <= cumulative:
\t\t\treturn candidates[j]
\treturn candidates[candidates.size() - 1]
`;
						scriptMgr.write(args.path, code);
						return { content: [{ type: "text" as const, text: `Created Director system at ${args.path} (${dim3d ? "3D" : "2D"})` }] };
					}

					default:
						return { content: [{ type: "text" as const, text: `Unknown action: ${args.action}` }], isError: true };
				}
			} catch (e) {
				return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true };
			}
		},
	);
}
