/**
 * Tests for validation utilities.
 */

import { describe, it, expect } from "vitest";
import { getAllNodeTypes, isValidNodeType, isValidResPath, isValidNodePath, getNodeCategory } from "../validation.js";

describe("getAllNodeTypes", () => {
	it("returns a flat array of all node types", () => {
		const types = getAllNodeTypes();
		expect(types.length).toBeGreaterThan(100);
		expect(types).toContain("Node");
		expect(types).toContain("Node2D");
		expect(types).toContain("CharacterBody3D");
		expect(types).toContain("Button");
	});
});

describe("isValidNodeType", () => {
	it("recognizes known node types", () => {
		expect(isValidNodeType("Node")).toBe(true);
		expect(isValidNodeType("Sprite2D")).toBe(true);
		expect(isValidNodeType("CharacterBody3D")).toBe(true);
	});

	it("accepts PascalCase custom types", () => {
		expect(isValidNodeType("MyCustomNode")).toBe(true);
		expect(isValidNodeType("PlayerController")).toBe(true);
	});

	it("rejects invalid type names", () => {
		expect(isValidNodeType("")).toBe(false);
		expect(isValidNodeType("lowercase")).toBe(false);
		expect(isValidNodeType("with spaces")).toBe(false);
		expect(isValidNodeType("123Number")).toBe(false);
	});
});

describe("isValidResPath", () => {
	it("validates res:// paths", () => {
		expect(isValidResPath("res://main.tscn")).toBe(true);
		expect(isValidResPath("res://scenes/level1.tscn")).toBe(true);
	});

	it("rejects invalid paths", () => {
		expect(isValidResPath("")).toBe(false);
		expect(isValidResPath("/absolute/path")).toBe(false);
		expect(isValidResPath("res://")).toBe(false);
		expect(isValidResPath("relative/path")).toBe(false);
	});
});

describe("isValidNodePath", () => {
	it("validates node paths", () => {
		expect(isValidNodePath(".")).toBe(true);
		expect(isValidNodePath("Player")).toBe(true);
		expect(isValidNodePath("Level/Enemies/Boss")).toBe(true);
	});

	it("rejects invalid node paths", () => {
		expect(isValidNodePath("")).toBe(false);
		expect(isValidNodePath("has spaces/here")).toBe(false);
	});
});

describe("getNodeCategory", () => {
	it("returns correct categories", () => {
		expect(getNodeCategory("Node")).toBe("base");
		expect(getNodeCategory("CharacterBody2D")).toBe("physics2d");
		expect(getNodeCategory("Button")).toBe("ui");
		expect(getNodeCategory("AudioStreamPlayer")).toBe("audio");
		expect(getNodeCategory("Timer")).toBe("misc");
	});

	it("returns null for unknown types", () => {
		expect(getNodeCategory("MyCustomNode")).toBeNull();
		expect(getNodeCategory("NotAType")).toBeNull();
	});
});
