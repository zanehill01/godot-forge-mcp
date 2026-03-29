/**
 * Roguelike Systems Tool Group — scaffolding for RoR2-style roguelike games.
 *
 * Covers: item resources, loot tables, inventory, proc chains, reusable
 * components (health/hitbox/hurtbox/status/knockback), global event bus,
 * and stage chunk templates.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resToAbsolute } from "../../utils/path.js";
import type { ToolContext } from "../registry.js";
import { ScriptManager } from "../../engine/script-manager.js";

export function registerRoguelikeTools(server: McpServer, ctx: ToolContext): void {
	const scriptMgr = new ScriptManager(ctx.projectRoot);

	server.tool(
		"godot_roguelike",
		`Roguelike game systems generator. Actions:

• item_resource — Generate an ItemData Resource class script.
    path (required)

• loot_table — Generate a LootTable Resource class with weighted random selection.
    path (required)

• inventory — Generate an Inventory component script.
    path (required), maxSlots (optional, -1 for unlimited)

• proc_chain — Generate a proc chain event manager for on-hit/on-kill item effects.
    path (required)

• component — Generate a reusable game component script.
    path (required), componentType (required: health|hitbox|hurtbox|status_effect|knockback)

• event_bus — Generate a global EventBus autoload script with roguelike signals.
    path (required), events (optional, additional signal definitions)

• stage_chunk — Generate a stage chunk scene (.tscn) + script with spawn markers.
    scenePath (required), scriptPath (required), chunkType (arena|corridor|platform|hub), spawnPoints, chestPoints, shrinePoints`,
		{
			action: z.enum(["item_resource", "loot_table", "inventory", "proc_chain", "component", "event_bus", "stage_chunk"]),
			path: z.string().optional().describe("Output script path (res://)"),
			maxSlots: z.number().optional().default(-1).describe("Max inventory slots (-1 = unlimited)"),
			componentType: z.enum(["health", "hitbox", "hurtbox", "status_effect", "knockback"]).optional(),
			events: z.array(z.object({
				name: z.string(), params: z.string().optional(),
			})).optional().describe("Additional signal definitions for event bus"),
			scenePath: z.string().optional().describe("Output scene .tscn path"),
			scriptPath: z.string().optional().describe("Output script .gd path for stage chunk"),
			chunkType: z.enum(["arena", "corridor", "platform", "hub"]).optional().default("arena"),
			spawnPoints: z.number().optional().default(4).describe("Number of enemy spawn markers"),
			chestPoints: z.number().optional().default(2),
			shrinePoints: z.number().optional().default(1),
		},
		async (args) => {
			try {
				switch (args.action) {
					// ── item_resource ──────────────────────────────────────
					case "item_resource": {
						if (!args.path) return { content: [{ type: "text" as const, text: "path required" }], isError: true };
						const code = `class_name ItemData
extends Resource

## Base resource for all game items.
## Create .tres instances with specific values for each item.

enum Rarity {
\tCOMMON,
\tUNCOMMON,
\tLEGENDARY,
\tBOSS,
\tLUNAR,
\tVOID,
}

@export_group("Identity")
@export var id: String = ""
@export var display_name: String = ""
@export_multiline var description: String = ""
@export var icon: Texture2D

@export_group("Classification")
@export var rarity: Rarity = Rarity.COMMON
@export var item_tags: Array[String] = []  ## e.g., "damage", "healing", "utility"
@export var is_consumable: bool = false

@export_group("Stacking")
@export var max_stack: int = -1  ## -1 = infinite stacking
@export var proc_coefficient: float = 1.0  ## Scales trigger chance for proc chains

@export_group("Economy")
@export var base_cost: int = 25

func get_rarity_color() -> Color:
\tmatch rarity:
\t\tRarity.COMMON: return Color.WHITE
\t\tRarity.UNCOMMON: return Color.GREEN
\t\tRarity.LEGENDARY: return Color.RED
\t\tRarity.BOSS: return Color.YELLOW
\t\tRarity.LUNAR: return Color.CYAN
\t\tRarity.VOID: return Color(0.6, 0.2, 0.8)
\treturn Color.WHITE

func get_rarity_name() -> String:
\tmatch rarity:
\t\tRarity.COMMON: return "Common"
\t\tRarity.UNCOMMON: return "Uncommon"
\t\tRarity.LEGENDARY: return "Legendary"
\t\tRarity.BOSS: return "Boss"
\t\tRarity.LUNAR: return "Lunar"
\t\tRarity.VOID: return "Void"
\treturn "Unknown"
`;
						scriptMgr.write(args.path, code);
						return { content: [{ type: "text" as const, text: `Created ItemData resource script at ${args.path}` }] };
					}

					// ── loot_table ─────────────────────────────────────────
					case "loot_table": {
						if (!args.path) return { content: [{ type: "text" as const, text: "path required" }], isError: true };
						const code = `class_name LootTable
extends Resource

## Weighted random loot table.
## Assign ItemData resources with weights, then call roll() to select items.

@export var entries: Array[LootEntry] = []

func roll() -> ItemData:
\t## Roll once and return a random item based on weights.
\tif entries.is_empty():
\t\treturn null
\tvar total_weight := 0.0
\tfor entry in entries:
\t\ttotal_weight += entry.weight
\tvar roll_value := randf() * total_weight
\tvar cumulative := 0.0
\tfor entry in entries:
\t\tcumulative += entry.weight
\t\tif roll_value <= cumulative:
\t\t\treturn entry.item
\treturn entries[entries.size() - 1].item

func roll_n(count: int) -> Array[ItemData]:
\t## Roll multiple times. May return duplicates.
\tvar results: Array[ItemData] = []
\tfor i in count:
\t\tvar item := roll()
\t\tif item:
\t\t\tresults.append(item)
\treturn results

func roll_unique(count: int) -> Array[ItemData]:
\t## Roll without replacement (no duplicates).
\tvar available := entries.duplicate()
\tvar results: Array[ItemData] = []
\tfor i in count:
\t\tif available.is_empty():
\t\t\tbreak
\t\tvar total_weight := 0.0
\t\tfor entry in available:
\t\t\ttotal_weight += entry.weight
\t\tvar roll_value := randf() * total_weight
\t\tvar cumulative := 0.0
\t\tfor j in available.size():
\t\t\tcumulative += available[j].weight
\t\t\tif roll_value <= cumulative:
\t\t\t\tresults.append(available[j].item)
\t\t\t\tavailable.remove_at(j)
\t\t\t\tbreak
\treturn results

func filter_by_rarity(rarity: int) -> Array[LootEntry]:
\t## Get entries matching a specific rarity.
\tvar filtered: Array[LootEntry] = []
\tfor entry in entries:
\t\tif entry.item and entry.item.rarity == rarity:
\t\t\tfiltered.append(entry)
\treturn filtered

func filter_by_tag(tag: String) -> Array[LootEntry]:
\t## Get entries where item has a specific tag.
\tvar filtered: Array[LootEntry] = []
\tfor entry in entries:
\t\tif entry.item and entry.item.item_tags.has(tag):
\t\t\tfiltered.append(entry)
\treturn filtered
`;
						scriptMgr.write(args.path, code);

						// Also create the LootEntry inner resource
						const entryPath = args.path.replace(/[^/]+$/, "loot_entry.gd");
						const entryCode = `class_name LootEntry
extends Resource

## Single entry in a LootTable with an item reference and weight.

@export var item: ItemData
@export var weight: float = 1.0
`;
						scriptMgr.write(entryPath, entryCode);
						return { content: [{ type: "text" as const, text: `Created LootTable at ${args.path} and LootEntry at ${entryPath}` }] };
					}

					// ── inventory ──────────────────────────────────────────
					case "inventory": {
						if (!args.path) return { content: [{ type: "text" as const, text: "path required" }], isError: true };
						const maxSlots = args.maxSlots ?? -1;
						const code = `class_name Inventory
extends Node

## Item inventory with stacking support.
## Tracks item_id -> stack_count. Emits signals on every change.

signal item_added(item_id: String, new_count: int)
signal item_removed(item_id: String, remaining: int)
signal inventory_changed()
signal inventory_full()

@export var max_slots: int = ${maxSlots}  ## -1 = unlimited

var _items: Dictionary = {}  ## { item_id: int (stack_count) }

func add_item(item_id: String, count: int = 1) -> bool:
\t## Add items to inventory. Returns false if inventory is full.
\tif not _items.has(item_id):
\t\tif max_slots > 0 and _items.size() >= max_slots:
\t\t\tinventory_full.emit()
\t\t\treturn false
\t\t_items[item_id] = 0
\t_items[item_id] += count
\titem_added.emit(item_id, _items[item_id])
\tinventory_changed.emit()
\treturn true

func remove_item(item_id: String, count: int = 1) -> bool:
\t## Remove items. Returns false if insufficient quantity.
\tif not _items.has(item_id) or _items[item_id] < count:
\t\treturn false
\t_items[item_id] -= count
\tvar remaining: int = _items[item_id]
\tif remaining <= 0:
\t\t_items.erase(item_id)
\t\tremaining = 0
\titem_removed.emit(item_id, remaining)
\tinventory_changed.emit()
\treturn true

func has_item(item_id: String) -> bool:
\treturn _items.has(item_id) and _items[item_id] > 0

func get_count(item_id: String) -> int:
\treturn _items.get(item_id, 0)

func get_all_items() -> Dictionary:
\treturn _items.duplicate()

func get_unique_count() -> int:
\treturn _items.size()

func get_total_count() -> int:
\tvar total := 0
\tfor count in _items.values():
\t\ttotal += count
\treturn total

func clear() -> void:
\t_items.clear()
\tinventory_changed.emit()
`;
						scriptMgr.write(args.path, code);
						return { content: [{ type: "text" as const, text: `Created Inventory at ${args.path} (max_slots: ${maxSlots === -1 ? "unlimited" : maxSlots})` }] };
					}

					// ── proc_chain ─────────────────────────────────────────
					case "proc_chain": {
						if (!args.path) return { content: [{ type: "text" as const, text: "path required" }], isError: true };
						const code = `class_name ProcChainManager
extends Node

## Proc chain system for RoR2-style on-hit/on-kill item effects.
## Items register callbacks that fire on combat events.
## Proc depth is tracked to prevent infinite chains (max 5).

const MAX_PROC_DEPTH: int = 5

# ── Combat Event Signals ─────────────────────────────────────────────
signal on_hit(damage_info: DamageInfo)
signal on_crit(damage_info: DamageInfo)
signal on_kill(attacker: Node, target: Node, damage_info: DamageInfo)
signal on_damaged(target: Node, damage_info: DamageInfo)
signal on_heal(target: Node, amount: float, source: Node)
signal on_ability_used(entity: Node, ability_id: String)

# ── DamageInfo ───────────────────────────────────────────────────────
class DamageInfo:
\tvar base_damage: float = 0.0
\tvar final_damage: float = 0.0
\tvar is_crit: bool = false
\tvar crit_multiplier: float = 2.0
\tvar proc_coefficient: float = 1.0
\tvar proc_depth: int = 0
\tvar damage_type: String = "generic"
\tvar attacker: Node = null
\tvar target: Node = null
\tvar ability_id: String = ""
\tvar hit_position: Vector3 = Vector3.ZERO
\tvar hit_normal: Vector3 = Vector3.UP

\tfunc can_proc() -> bool:
\t\treturn proc_depth < ProcChainManager.MAX_PROC_DEPTH and proc_coefficient > 0.0

\tfunc create_chain() -> DamageInfo:
\t\t## Create a new DamageInfo for a chained proc (inherits context, increments depth).
\t\tvar chained := DamageInfo.new()
\t\tchained.attacker = attacker
\t\tchained.proc_depth = proc_depth + 1
\t\tchained.proc_coefficient = proc_coefficient * 0.5  # Diminish chain procs
\t\treturn chained

# ── On-Hit Effect Registry ───────────────────────────────────────────
var _on_hit_effects: Array[Callable] = []
var _on_kill_effects: Array[Callable] = []
var _on_damaged_effects: Array[Callable] = []

func register_on_hit(callback: Callable) -> void:
\t_on_hit_effects.append(callback)

func register_on_kill(callback: Callable) -> void:
\t_on_kill_effects.append(callback)

func register_on_damaged(callback: Callable) -> void:
\t_on_damaged_effects.append(callback)

func unregister_on_hit(callback: Callable) -> void:
\t_on_hit_effects.erase(callback)

func unregister_on_kill(callback: Callable) -> void:
\t_on_kill_effects.erase(callback)

func unregister_on_damaged(callback: Callable) -> void:
\t_on_damaged_effects.erase(callback)

# ── Process Hit ──────────────────────────────────────────────────────
func process_hit(damage_info: DamageInfo) -> void:
\t## Main entry point: call this when an attack lands.
\t## Applies crit, emits signals, and triggers registered proc effects.
\t
\t# Apply crit
\tif damage_info.is_crit:
\t\tdamage_info.final_damage = damage_info.base_damage * damage_info.crit_multiplier
\t\ton_crit.emit(damage_info)
\telse:
\t\tdamage_info.final_damage = damage_info.base_damage
\t
\t# Emit signal
\ton_hit.emit(damage_info)
\t
\t# Run registered on-hit effects (proc chain)
\tif damage_info.can_proc():
\t\tfor effect in _on_hit_effects:
\t\t\tif effect.is_valid():
\t\t\t\t# Each effect decides whether to trigger based on proc_coefficient
\t\t\t\teffect.call(damage_info)

func process_kill(attacker: Node, target: Node, damage_info: DamageInfo) -> void:
\ton_kill.emit(attacker, target, damage_info)
\tfor effect in _on_kill_effects:
\t\tif effect.is_valid():
\t\t\teffect.call(attacker, target, damage_info)

func process_damaged(target: Node, damage_info: DamageInfo) -> void:
\ton_damaged.emit(target, damage_info)
\tfor effect in _on_damaged_effects:
\t\tif effect.is_valid():
\t\t\teffect.call(target, damage_info)

# ── Utility ──────────────────────────────────────────────────────────
func create_damage_info(attacker: Node, base_damage: float, proc_coeff: float = 1.0) -> DamageInfo:
\tvar info := DamageInfo.new()
\tinfo.attacker = attacker
\tinfo.base_damage = base_damage
\tinfo.proc_coefficient = proc_coeff
\treturn info

func roll_crit(damage_info: DamageInfo, crit_chance: float) -> void:
\tif randf() < crit_chance:
\t\tdamage_info.is_crit = true
`;
						scriptMgr.write(args.path, code);
						return { content: [{ type: "text" as const, text: `Created ProcChainManager at ${args.path}` }] };
					}

					// ── component ──────────────────────────────────────────
					case "component": {
						if (!args.path || !args.componentType) return { content: [{ type: "text" as const, text: "path and componentType required" }], isError: true };
						let code: string;

						switch (args.componentType) {
							case "health":
								code = `class_name HealthComponent
extends Node

## Manages HP, shield, barrier, and armor for any entity.
## Attach as a child node of the entity.

signal health_changed(current: float, maximum: float)
signal shield_changed(current: float, maximum: float)
signal barrier_changed(current: float)
signal damaged(amount: float, source: Node)
signal healed(amount: float, source: Node)
signal died(killer: Node)

@export_group("Health")
@export var max_health: float = 100.0
@export var health_regen: float = 0.0  ## HP per second

@export_group("Defense")
@export var armor: float = 0.0  ## Flat damage reduction
@export var armor_coefficient: float = 100.0  ## Higher = less reduction per armor point

@export_group("Shields")
@export var max_shield: float = 0.0
@export var shield_regen_delay: float = 5.0  ## Seconds after damage before shield regens
@export var shield_regen_rate: float = 10.0

var current_health: float
var current_shield: float
var barrier: float = 0.0
var is_dead: bool = false
var _shield_regen_timer: float = 0.0

func _ready() -> void:
\tcurrent_health = max_health
\tcurrent_shield = max_shield

func _process(delta: float) -> void:
\tif is_dead:
\t\treturn
\t# Health regen
\tif health_regen > 0 and current_health < max_health:
\t\tcurrent_health = minf(current_health + health_regen * delta, max_health)
\t\thealth_changed.emit(current_health, max_health)
\t# Shield regen
\tif max_shield > 0 and current_shield < max_shield:
\t\t_shield_regen_timer -= delta
\t\tif _shield_regen_timer <= 0:
\t\t\tcurrent_shield = minf(current_shield + shield_regen_rate * delta, max_shield)
\t\t\tshield_changed.emit(current_shield, max_shield)

func take_damage(amount: float, source: Node = null) -> float:
\t## Apply damage with armor reduction. Returns actual damage dealt.
\tif is_dead or amount <= 0:
\t\treturn 0.0
\t# Armor reduction: damage * 100 / (100 + armor)
\tvar reduced := amount * armor_coefficient / (armor_coefficient + maxf(armor, 0.0))
\tvar remaining := reduced
\t# Barrier absorbs first (no reduction)
\tif barrier > 0:
\t\tvar absorbed := minf(barrier, remaining)
\t\tbarrier -= absorbed
\t\tremaining -= absorbed
\t\tbarrier_changed.emit(barrier)
\t# Shield absorbs next
\tif current_shield > 0 and remaining > 0:
\t\tvar absorbed := minf(current_shield, remaining)
\t\tcurrent_shield -= absorbed
\t\tremaining -= absorbed
\t\t_shield_regen_timer = shield_regen_delay
\t\tshield_changed.emit(current_shield, max_shield)
\t# Health takes the rest
\tif remaining > 0:
\t\tcurrent_health -= remaining
\t\thealth_changed.emit(current_health, max_health)
\tdamaged.emit(reduced, source)
\tif current_health <= 0:
\t\tcurrent_health = 0
\t\tis_dead = true
\t\tdied.emit(source)
\treturn reduced

func heal(amount: float, source: Node = null) -> float:
\tif is_dead or amount <= 0:
\t\treturn 0.0
\tvar actual := minf(amount, max_health - current_health)
\tcurrent_health += actual
\thealth_changed.emit(current_health, max_health)
\thealed.emit(actual, source)
\treturn actual

func add_shield(amount: float) -> void:
\tcurrent_shield = minf(current_shield + amount, max_shield)
\tshield_changed.emit(current_shield, max_shield)

func add_barrier(amount: float) -> void:
\tbarrier += amount
\tbarrier_changed.emit(barrier)

func get_health_percent() -> float:
\treturn current_health / max_health if max_health > 0 else 0.0
`; break;

							case "hitbox":
								code = `class_name HitboxComponent
extends Area3D

## Offensive hitbox — attach to attacks, projectiles, abilities.
## Detects overlap with HurtboxComponent areas.

enum Team { PLAYER, ENEMY, NEUTRAL }

signal hit_landed(hurtbox: Node)

@export var damage: float = 10.0
@export var knockback_force: float = 5.0
@export var proc_coefficient: float = 1.0
@export var team: Team = Team.PLAYER
@export var knockback_direction: Vector3 = Vector3.ZERO  ## Zero = auto (away from hitbox)

func _ready() -> void:
\tarea_entered.connect(_on_area_entered)

func _on_area_entered(area: Area3D) -> void:
\tif area is HurtboxComponent:
\t\tvar hurtbox := area as HurtboxComponent
\t\tif hurtbox.team == team:
\t\t\treturn  # Same team, skip
\t\thit_landed.emit(hurtbox)
\t\tvar kb_dir := knockback_direction
\t\tif kb_dir == Vector3.ZERO:
\t\t\tkb_dir = (hurtbox.global_position - global_position).normalized()
\t\thurtbox.receive_hit(damage, knockback_force, kb_dir, proc_coefficient, get_parent())
`; break;

							case "hurtbox":
								code = `class_name HurtboxComponent
extends Area3D

## Defensive hurtbox — attach to entities that can take damage.
## Receives hits from HitboxComponent and forwards to HealthComponent.

enum Team { PLAYER, ENEMY, NEUTRAL }

signal hit_received(damage: float, source: Node)

@export var team: Team = Team.ENEMY
@export var health_component_path: NodePath = ""

var _health_component: Node = null

func _ready() -> void:
\tif health_component_path:
\t\t_health_component = get_node_or_null(health_component_path)
\telse:
\t\t# Auto-find HealthComponent on parent
\t\tvar parent := get_parent()
\t\tif parent:
\t\t\tfor child in parent.get_children():
\t\t\t\tif child is HealthComponent:
\t\t\t\t\t_health_component = child
\t\t\t\t\tbreak

func receive_hit(damage: float, knockback_force: float, knockback_dir: Vector3, proc_coefficient: float, source: Node) -> void:
\thit_received.emit(damage, source)
\tif _health_component and _health_component.has_method("take_damage"):
\t\t_health_component.take_damage(damage, source)
\t# Apply knockback if parent is CharacterBody3D
\tvar parent := get_parent()
\tif parent is CharacterBody3D and knockback_force > 0:
\t\tparent.velocity += knockback_dir * knockback_force
`; break;

							case "status_effect":
								code = `class_name StatusEffectManager
extends Node

## Manages active status effects (buffs/debuffs) on an entity.
## Effects tick over time and can stack by duration refresh or intensity.

signal effect_applied(effect_id: String, stacks: int)
signal effect_removed(effect_id: String)
signal effect_ticked(effect_id: String, tick_damage: float)

var _effects: Dictionary = {}  ## { effect_id: StatusEffect }

class StatusEffect:
\tvar id: String = ""
\tvar display_name: String = ""
\tvar duration: float = 5.0
\tvar remaining: float = 5.0
\tvar tick_interval: float = 1.0
\tvar tick_timer: float = 0.0
\tvar stacks: int = 1
\tvar max_stacks: int = -1  ## -1 = unlimited
\tvar tick_damage: float = 0.0
\tvar slow_percent: float = 0.0
\tvar stun: bool = false
\t
\t## Stacking mode: "refresh" resets duration, "intensity" increases stacks
\tvar stack_mode: String = "refresh"

func _process(delta: float) -> void:
\tvar expired: Array[String] = []
\tfor effect_id in _effects:
\t\tvar effect: StatusEffect = _effects[effect_id]
\t\teffect.remaining -= delta
\t\tif effect.remaining <= 0:
\t\t\texpired.append(effect_id)
\t\t\tcontinue
\t\t# Tick damage/effects
\t\teffect.tick_timer -= delta
\t\tif effect.tick_timer <= 0:
\t\t\teffect.tick_timer = effect.tick_interval
\t\t\t_on_tick(effect)
\tfor eid in expired:
\t\tremove_effect(eid)

func apply_effect(effect: StatusEffect) -> void:
\tif _effects.has(effect.id):
\t\tvar existing: StatusEffect = _effects[effect.id]
\t\tif effect.stack_mode == "refresh":
\t\t\texisting.remaining = effect.duration
\t\telif effect.stack_mode == "intensity":
\t\t\tif existing.max_stacks < 0 or existing.stacks < existing.max_stacks:
\t\t\t\texisting.stacks += 1
\t\t\texisting.remaining = effect.duration
\t\teffect_applied.emit(effect.id, existing.stacks)
\telse:
\t\t_effects[effect.id] = effect
\t\teffect_applied.emit(effect.id, effect.stacks)

func remove_effect(effect_id: String) -> void:
\tif _effects.has(effect_id):
\t\t_effects.erase(effect_id)
\t\teffect_removed.emit(effect_id)

func has_effect(effect_id: String) -> bool:
\treturn _effects.has(effect_id)

func get_effect(effect_id: String) -> StatusEffect:
\treturn _effects.get(effect_id)

func get_stacks(effect_id: String) -> int:
\tvar effect := _effects.get(effect_id) as StatusEffect
\treturn effect.stacks if effect else 0

func is_stunned() -> bool:
\tfor effect_id in _effects:
\t\tvar effect: StatusEffect = _effects[effect_id]
\t\tif effect.stun:
\t\t\treturn true
\treturn false

func get_total_slow() -> float:
\tvar total := 0.0
\tfor effect_id in _effects:
\t\tvar effect: StatusEffect = _effects[effect_id]
\t\ttotal += effect.slow_percent * effect.stacks
\treturn minf(total, 0.9)  ## Cap at 90% slow

func clear_all() -> void:
\tvar ids := _effects.keys()
\t_effects.clear()
\tfor eid in ids:
\t\teffect_removed.emit(eid)

func _on_tick(effect: StatusEffect) -> void:
\tvar tick_dmg := effect.tick_damage * effect.stacks
\tif tick_dmg > 0:
\t\teffect_ticked.emit(effect.id, tick_dmg)
\t\t# Apply tick damage to HealthComponent if sibling exists
\t\tvar parent := get_parent()
\t\tif parent:
\t\t\tfor child in parent.get_children():
\t\t\t\tif child is HealthComponent:
\t\t\t\t\tchild.take_damage(tick_dmg)
\t\t\t\t\tbreak
`; break;

							case "knockback":
								code = `class_name KnockbackComponent
extends Node

## Applies knockback impulses to a CharacterBody3D parent.
## Smoothly decays knockback velocity over time.

signal knockback_applied(direction: Vector3, force: float)
signal knockback_finished()

@export var decay_rate: float = 8.0  ## How fast knockback decays
@export var mass: float = 1.0  ## Higher = less knockback

var knockback_velocity: Vector3 = Vector3.ZERO
var _is_knocked: bool = false

func _physics_process(delta: float) -> void:
\tif not _is_knocked:
\t\treturn
\tknockback_velocity = knockback_velocity.lerp(Vector3.ZERO, decay_rate * delta)
\tvar parent := get_parent()
\tif parent is CharacterBody3D:
\t\tparent.velocity += knockback_velocity
\tif knockback_velocity.length() < 0.1:
\t\tknockback_velocity = Vector3.ZERO
\t\t_is_knocked = false
\t\tknockback_finished.emit()

func apply_knockback(direction: Vector3, force: float) -> void:
\tvar actual_force := force / maxf(mass, 0.1)
\tknockback_velocity += direction.normalized() * actual_force
\t_is_knocked = true
\tknockback_applied.emit(direction, actual_force)

func apply_knockback_from(source_position: Vector3, force: float) -> void:
\tvar parent := get_parent()
\tif parent is Node3D:
\t\tvar direction := (parent.global_position - source_position).normalized()
\t\tdirection.y = 0.3  # Slight upward launch
\t\tapply_knockback(direction.normalized(), force)
`; break;

							default:
								return { content: [{ type: "text" as const, text: `Unknown component type: ${args.componentType}` }], isError: true };
						}

						scriptMgr.write(args.path, code);
						return { content: [{ type: "text" as const, text: `Created ${args.componentType} component at ${args.path}` }] };
					}

					// ── event_bus ──────────────────────────────────────────
					case "event_bus": {
						if (!args.path) return { content: [{ type: "text" as const, text: "path required" }], isError: true };

						const defaultEvents = [
							{ name: "enemy_spawned", params: "enemy: Node, position: Vector3" },
							{ name: "enemy_killed", params: "enemy: Node, killer: Node, damage_info: RefCounted" },
							{ name: "damage_dealt", params: "attacker: Node, target: Node, amount: float, is_crit: bool" },
							{ name: "item_picked_up", params: "entity: Node, item_id: String, stack_count: int" },
							{ name: "chest_opened", params: "chest: Node, entity: Node" },
							{ name: "shrine_activated", params: "shrine: Node, entity: Node" },
							{ name: "teleporter_charged", params: "stage_number: int" },
							{ name: "stage_completed", params: "stage_number: int" },
							{ name: "difficulty_changed", params: "coefficient: float" },
							{ name: "ability_used", params: "entity: Node, ability_id: String" },
							{ name: "player_leveled_up", params: "player: Node, new_level: int" },
							{ name: "gold_changed", params: "entity: Node, new_amount: int, delta: int" },
						];

						const allEvents = [...defaultEvents, ...(args.events ?? [])];

						const signalLines = allEvents.map((e) =>
							`signal ${e.name}(${e.params ?? ""})`
						).join("\n");

						const code = `extends Node

## Global event bus for decoupled game systems.
## Register as an autoload (Project > Project Settings > Autoload).
## Any system can emit or connect to these signals without direct references.

${signalLines}
`;
						scriptMgr.write(args.path, code);
						return { content: [{ type: "text" as const, text: `Created EventBus at ${args.path} with ${allEvents.length} signals` }] };
					}

					// ── stage_chunk ────────────────────────────────────────
					case "stage_chunk": {
						if (!args.scenePath || !args.scriptPath) return { content: [{ type: "text" as const, text: "scenePath and scriptPath required" }], isError: true };
						const chunkType = args.chunkType ?? "arena";
						const spawnPts = args.spawnPoints ?? 4;
						const chestPts = args.chestPoints ?? 2;
						const shrinePts = args.shrinePoints ?? 1;

						// Build .tscn scene
						const lines: string[] = [];

						// Header
						lines.push(`[gd_scene load_steps=2 format=3]`);
						lines.push("");
						lines.push(`[ext_resource type="Script" path="${args.scriptPath}" id="1"]`);
						lines.push("");

						// Root node
						lines.push(`[node name="StageChunk" type="Node3D"]`);
						lines.push(`script = ExtResource("1")`);
						lines.push(`metadata/chunk_type = "${chunkType}"`);
						lines.push("");

						// NavigationRegion3D
						lines.push(`[node name="NavigationRegion" type="NavigationRegion3D" parent="."]`);
						lines.push("");

						// Spawn point containers
						lines.push(`[node name="SpawnPoints" type="Node3D" parent="."]`);
						lines.push("");

						// Enemy spawn markers
						for (let i = 1; i <= spawnPts; i++) {
							const angle = (i / spawnPts) * Math.PI * 2;
							const radius = chunkType === "arena" ? 12 : 8;
							const x = Math.round(Math.cos(angle) * radius * 100) / 100;
							const z = Math.round(Math.sin(angle) * radius * 100) / 100;
							lines.push(`[node name="EnemySpawn${i}" type="Marker3D" parent="SpawnPoints"]`);
							lines.push(`transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${x}, 0, ${z})`);
							lines.push(`metadata/spawn_type = "enemy"`);
							lines.push("");
						}

						// Chest spawn markers
						for (let i = 1; i <= chestPts; i++) {
							const angle = (i / chestPts) * Math.PI * 2 + 0.5;
							const x = Math.round(Math.cos(angle) * 8 * 100) / 100;
							const z = Math.round(Math.sin(angle) * 8 * 100) / 100;
							lines.push(`[node name="ChestSpawn${i}" type="Marker3D" parent="SpawnPoints"]`);
							lines.push(`transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${x}, 0.5, ${z})`);
							lines.push(`metadata/spawn_type = "chest"`);
							lines.push("");
						}

						// Shrine spawn markers
						for (let i = 1; i <= shrinePts; i++) {
							lines.push(`[node name="ShrineSpawn${i}" type="Marker3D" parent="SpawnPoints"]`);
							lines.push(`transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.5, ${i * 5})`);
							lines.push(`metadata/spawn_type = "shrine"`);
							lines.push("");
						}

						// Connection points (cardinal directions for chunk stitching)
						lines.push(`[node name="ConnectionPoints" type="Node3D" parent="."]`);
						lines.push("");
						const connections = [
							{ name: "North", pos: `0, 0, -20` },
							{ name: "South", pos: `0, 0, 20` },
							{ name: "East", pos: `20, 0, 0` },
							{ name: "West", pos: `-20, 0, 0` },
						];
						for (const conn of connections) {
							lines.push(`[node name="${conn.name}" type="Marker3D" parent="ConnectionPoints"]`);
							lines.push(`transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${conn.pos})`);
							lines.push(`metadata/connection_dir = "${conn.name.toLowerCase()}"`);
							lines.push("");
						}

						const absScene = resToAbsolute(args.scenePath, ctx.projectRoot);
						mkdirSync(dirname(absScene), { recursive: true });
						writeFileSync(absScene, lines.join("\n"), "utf-8");

						// Build chunk script
						const script = `class_name StageChunk
extends Node3D

## Stage chunk with typed spawn points and connection markers.
## Used by the stage generator to assemble levels from prefab chunks.

@export var chunk_type: String = "${chunkType}"
@export var difficulty_tier: int = 1  ## Min difficulty level to use this chunk

func get_spawn_points(type: String) -> Array[Marker3D]:
\t## Get all spawn markers of a given type ("enemy", "chest", "shrine").
\tvar points: Array[Marker3D] = []
\tvar container := get_node_or_null("SpawnPoints")
\tif not container:
\t\treturn points
\tfor child in container.get_children():
\t\tif child is Marker3D and child.get_meta("spawn_type", "") == type:
\t\t\tpoints.append(child)
\treturn points

func get_enemy_spawns() -> Array[Marker3D]:
\treturn get_spawn_points("enemy")

func get_chest_spawns() -> Array[Marker3D]:
\treturn get_spawn_points("chest")

func get_shrine_spawns() -> Array[Marker3D]:
\treturn get_spawn_points("shrine")

func get_connection_points() -> Array[Marker3D]:
\tvar points: Array[Marker3D] = []
\tvar container := get_node_or_null("ConnectionPoints")
\tif not container:
\t\treturn points
\tfor child in container.get_children():
\t\tif child is Marker3D:
\t\t\tpoints.append(child)
\treturn points

func get_connection_point(direction: String) -> Marker3D:
\t## Get a specific connection point by direction ("north", "south", "east", "west").
\tvar container := get_node_or_null("ConnectionPoints")
\tif container:
\t\tfor child in container.get_children():
\t\t\tif child is Marker3D and child.get_meta("connection_dir", "") == direction:
\t\t\t\treturn child
\treturn null

func get_all_spawn_positions(type: String) -> Array[Vector3]:
\tvar positions: Array[Vector3] = []
\tfor marker in get_spawn_points(type):
\t\tpositions.append(marker.global_position)
\treturn positions
`;
						scriptMgr.write(args.scriptPath, script);
						return { content: [{ type: "text" as const, text: `Created stage chunk scene at ${args.scenePath} (${chunkType}: ${spawnPts} enemy, ${chestPts} chest, ${shrinePts} shrine spawns) and script at ${args.scriptPath}` }] };
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
