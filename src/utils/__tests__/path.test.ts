/**
 * Tests for path utilities — especially path traversal protection.
 */

import { describe, it, expect } from "vitest";
import { resToAbsolute, absoluteToRes, isInProject, findProjectRoot, safeResolvePath, generateResourceId } from "../path.js";
import { join, resolve, sep } from "node:path";

const PROJECT_ROOT = resolve("/tmp/test-project");

describe("resToAbsolute", () => {
	it("converts a simple res:// path", () => {
		const result = resToAbsolute("res://scenes/main.tscn", PROJECT_ROOT);
		expect(result).toBe(resolve(join(PROJECT_ROOT, "scenes", "main.tscn")));
	});

	it("converts res:// root path", () => {
		const result = resToAbsolute("res://project.godot", PROJECT_ROOT);
		expect(result).toBe(resolve(join(PROJECT_ROOT, "project.godot")));
	});

	it("throws on non-res:// path", () => {
		expect(() => resToAbsolute("/absolute/path", PROJECT_ROOT)).toThrow("Not a res:// path");
	});

	it("throws on path traversal attempt", () => {
		expect(() => resToAbsolute("res://../../../etc/passwd", PROJECT_ROOT)).toThrow("Path traversal detected");
	});

	it("throws on traversal hidden in deeper path", () => {
		expect(() => resToAbsolute("res://scenes/../../..", PROJECT_ROOT)).toThrow("Path traversal detected");
	});

	it("allows paths that look similar to parent but are within project", () => {
		const result = resToAbsolute("res://scenes/../assets/icon.png", PROJECT_ROOT);
		// This resolves to PROJECT_ROOT/assets/icon.png which is still in project
		expect(result).toBe(resolve(join(PROJECT_ROOT, "assets", "icon.png")));
	});
});

describe("absoluteToRes", () => {
	it("converts absolute path to res://", () => {
		const abs = join(PROJECT_ROOT, "scenes", "main.tscn");
		const result = absoluteToRes(abs, PROJECT_ROOT);
		expect(result).toBe("res://scenes/main.tscn");
	});

	it("converts project root to res://", () => {
		const result = absoluteToRes(join(PROJECT_ROOT, "project.godot"), PROJECT_ROOT);
		expect(result).toBe("res://project.godot");
	});
});

describe("isInProject", () => {
	it("returns true for paths within project", () => {
		expect(isInProject(join(PROJECT_ROOT, "scenes", "main.tscn"), PROJECT_ROOT)).toBe(true);
	});

	it("returns true for project root itself", () => {
		expect(isInProject(PROJECT_ROOT, PROJECT_ROOT)).toBe(true);
	});

	it("returns false for paths outside project", () => {
		expect(isInProject("/etc/passwd", PROJECT_ROOT)).toBe(false);
	});

	it("returns false for sibling directories with similar names", () => {
		// /tmp/test-project-v2 should NOT match /tmp/test-project
		expect(isInProject(resolve("/tmp/test-project-v2/file.txt"), PROJECT_ROOT)).toBe(false);
	});
});

describe("safeResolvePath", () => {
	it("resolves valid paths", () => {
		const result = safeResolvePath("res://main.gd", PROJECT_ROOT);
		expect(result).toBe(resolve(join(PROJECT_ROOT, "main.gd")));
	});

	it("throws on traversal", () => {
		expect(() => safeResolvePath("res://../../secret", PROJECT_ROOT)).toThrow("Path traversal");
	});
});

describe("generateResourceId", () => {
	it("generates unique IDs", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 100; i++) {
			ids.add(generateResourceId());
		}
		expect(ids.size).toBe(100);
	});

	it("respects prefix", () => {
		const id = generateResourceId("ext");
		expect(id.startsWith("ext_")).toBe(true);
	});
});
