import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProjectGodot, extractProjectMetadata } from "../parser.js";

const FIXTURES = join(__dirname, "../../../../test/fixtures/minimal-project");

describe("project.godot Parser", () => {
	it("parses the minimal project config", () => {
		const content = readFileSync(join(FIXTURES, "project.godot"), "utf-8");
		const config = parseProjectGodot(content);

		// Should have sections
		expect(config.sections.application).toBeDefined();
		expect(config.sections.display).toBeDefined();
		expect(config.sections.input).toBeDefined();
		expect(config.sections.autoload).toBeDefined();
	});

	it("extracts project metadata", () => {
		const content = readFileSync(join(FIXTURES, "project.godot"), "utf-8");
		const config = parseProjectGodot(content);
		const meta = extractProjectMetadata(config);

		expect(meta.name).toBe("Test Project");
		expect(meta.mainScene).toBe("res://scenes/main.tscn");
		expect(meta.viewport.width).toBe(1920);
		expect(meta.viewport.height).toBe(1080);
	});

	it("extracts autoloads", () => {
		const content = readFileSync(join(FIXTURES, "project.godot"), "utf-8");
		const config = parseProjectGodot(content);
		const meta = extractProjectMetadata(config);

		expect(meta.autoloads).toHaveProperty("GameManager");
		expect(meta.autoloads.GameManager).toBe("res://scripts/game_manager.gd");
	});

	it("extracts input actions", () => {
		const content = readFileSync(join(FIXTURES, "project.godot"), "utf-8");
		const config = parseProjectGodot(content);
		const meta = extractProjectMetadata(config);

		expect(meta.inputActions).toContain("move_left");
		expect(meta.inputActions).toContain("move_right");
		expect(meta.inputActions).toContain("jump");
	});
});
