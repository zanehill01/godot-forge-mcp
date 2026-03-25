import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { ScriptManager } from "../script-manager.js";

const FIXTURES = join(__dirname, "../../../test/fixtures/minimal-project");

describe("ScriptManager", () => {
	const manager = new ScriptManager(FIXTURES);

	describe("analyze", () => {
		it("analyzes the player script", () => {
			const analysis = manager.analyze("res://scripts/player.gd");

			expect(analysis.className).toBe("Player");
			expect(analysis.extends).toBe("CharacterBody2D");
			expect(analysis.isTool).toBe(false);
		});

		it("extracts signals", () => {
			const analysis = manager.analyze("res://scripts/player.gd");

			expect(analysis.signals.length).toBe(2);
			expect(analysis.signals[0].name).toBe("health_changed");
			expect(analysis.signals[0].params.length).toBe(1);
			expect(analysis.signals[0].params[0].name).toBe("new_health");
			expect(analysis.signals[0].params[0].type).toBe("int");
			expect(analysis.signals[1].name).toBe("died");
			expect(analysis.signals[1].params.length).toBe(0);
		});

		it("extracts exports", () => {
			const analysis = manager.analyze("res://scripts/player.gd");

			expect(analysis.exports.length).toBe(3);
			expect(analysis.exports[0].name).toBe("speed");
			expect(analysis.exports[0].type).toBe("float");
			expect(analysis.exports[0].defaultValue).toBe("300.0");
			expect(analysis.exports[1].name).toBe("jump_force");
			expect(analysis.exports[2].name).toBe("health");
			expect(analysis.exports[2].annotation).toBe("@export_range(0, 100, 1)");
		});

		it("extracts onready vars", () => {
			const analysis = manager.analyze("res://scripts/player.gd");

			expect(analysis.onreadyVars.length).toBe(2);
			expect(analysis.onreadyVars[0].name).toBe("sprite");
			expect(analysis.onreadyVars[0].type).toBe("Sprite2D");
			expect(analysis.onreadyVars[0].expression).toBe("$Sprite");
		});

		it("extracts methods", () => {
			const analysis = manager.analyze("res://scripts/player.gd");

			const methodNames = analysis.methods.map((m) => m.name);
			expect(methodNames).toContain("_ready");
			expect(methodNames).toContain("_physics_process");
			expect(methodNames).toContain("take_damage");
			expect(methodNames).toContain("_on_health_changed");

			const ready = analysis.methods.find((m) => m.name === "_ready");
			expect(ready?.isVirtual).toBe(true);
			expect(ready?.returnType).toBe("void");

			const takeDamage = analysis.methods.find((m) => m.name === "take_damage");
			expect(takeDamage?.params.length).toBe(1);
			expect(takeDamage?.params[0].name).toBe("amount");
			expect(takeDamage?.params[0].type).toBe("int");
		});

		it("extracts enums", () => {
			const analysis = manager.analyze("res://scripts/player.gd");

			expect(analysis.enums.length).toBe(1);
			expect(analysis.enums[0].name).toBe("State");
			expect(analysis.enums[0].values).toContain("IDLE");
			expect(analysis.enums[0].values).toContain("RUNNING");
		});

		it("extracts constants", () => {
			const analysis = manager.analyze("res://scripts/player.gd");

			expect(analysis.constants.length).toBe(1);
			expect(analysis.constants[0].name).toBe("GRAVITY");
			expect(analysis.constants[0].value).toBe("980.0");
		});
	});

	describe("generate", () => {
		it("generates a basic script", () => {
			const source = manager.generate({
				extends: "Node2D",
				methods: [
					{
						name: "_ready",
						returnType: "void",
						body: "pass",
					},
				],
			});

			expect(source).toContain("extends Node2D");
			expect(source).toContain("func _ready() -> void:");
			expect(source).toContain("\tpass");
		});

		it("generates a complete script", () => {
			const source = manager.generate({
				className: "Enemy",
				extends: "CharacterBody2D",
				isTool: true,
				signals: [{ name: "died" }, { name: "health_changed", params: "new_health: int" }],
				enums: [{ name: "State", values: ["IDLE", "CHASE", "ATTACK"] }],
				constants: [{ name: "SPEED", value: "200.0" }],
				exports: [
					{ name: "max_health", type: "int", default: "100" },
					{ annotation: "@export_range(0, 360, 1)", name: "rotation_speed", type: "float", default: "90.0" },
				],
				onreadyVars: [{ name: "sprite", type: "Sprite2D", path: "$Sprite" }],
				vars: [{ name: "current_state", type: "State", default: "State.IDLE" }],
				methods: [
					{
						name: "_ready",
						returnType: "void",
						body: "pass",
					},
					{
						name: "take_damage",
						params: "amount: int",
						returnType: "void",
						body: 'max_health -= amount\nif max_health <= 0:\n\tdied.emit()',
					},
				],
			});

			expect(source).toContain("@tool");
			expect(source).toContain("class_name Enemy");
			expect(source).toContain("extends CharacterBody2D");
			expect(source).toContain("signal died");
			expect(source).toContain("signal health_changed(new_health: int)");
			expect(source).toContain("enum State { IDLE, CHASE, ATTACK }");
			expect(source).toContain("const SPEED = 200.0");
			expect(source).toContain("@export var max_health: int = 100");
			expect(source).toContain("@export_range(0, 360, 1) var rotation_speed: float = 90.0");
			expect(source).toContain("@onready var sprite: Sprite2D = $Sprite");
			expect(source).toContain("var current_state: State = State.IDLE");
		});
	});
});
