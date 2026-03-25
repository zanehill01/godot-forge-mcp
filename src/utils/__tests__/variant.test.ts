import { describe, it, expect } from "vitest";
import { parseVariant, writeVariant } from "../variant.js";

describe("Variant Parser", () => {
	it("parses primitives", () => {
		expect(parseVariant("null")).toBe(null);
		expect(parseVariant("true")).toBe(true);
		expect(parseVariant("false")).toBe(false);
		expect(parseVariant("42")).toBe(42);
		expect(parseVariant("3.14")).toBe(3.14);
		expect(parseVariant('"hello"')).toBe("hello");
	});

	it("parses Vector2", () => {
		expect(parseVariant("Vector2(10, 20)")).toEqual({ type: "Vector2", x: 10, y: 20 });
		expect(parseVariant("Vector2i(5, 10)")).toEqual({ type: "Vector2i", x: 5, y: 10 });
	});

	it("parses Vector3", () => {
		expect(parseVariant("Vector3(1, 2, 3)")).toEqual({ type: "Vector3", x: 1, y: 2, z: 3 });
	});

	it("parses Color", () => {
		expect(parseVariant("Color(1, 0, 0, 1)")).toEqual({
			type: "Color",
			r: 1,
			g: 0,
			b: 0,
			a: 1,
		});

		// 3-component Color (alpha defaults to 1)
		expect(parseVariant("Color(0.5, 0.5, 0.5)")).toEqual({
			type: "Color",
			r: 0.5,
			g: 0.5,
			b: 0.5,
			a: 1,
		});
	});

	it("parses Transform3D", () => {
		const t = parseVariant("Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0)");
		expect(t).toEqual({
			type: "Transform3D",
			basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
			origin: [0, 0, 0],
		});
	});

	it("parses ExtResource", () => {
		expect(parseVariant('ExtResource("1_abc")')).toEqual({
			type: "ExtResource",
			id: "1_abc",
		});
	});

	it("parses SubResource", () => {
		expect(parseVariant('SubResource("CapsuleShape2D_abc")')).toEqual({
			type: "SubResource",
			id: "CapsuleShape2D_abc",
		});
	});

	it("parses NodePath", () => {
		expect(parseVariant('NodePath("Player/Sprite")')).toEqual({
			type: "NodePath",
			path: "Player/Sprite",
		});
	});

	it("parses PackedStringArray", () => {
		expect(parseVariant('PackedStringArray("4.3", "Forward Plus")')).toEqual({
			type: "PackedStringArray",
			values: ["4.3", "Forward Plus"],
		});
	});

	it("parses empty PackedStringArray", () => {
		expect(parseVariant("PackedStringArray()")).toEqual({
			type: "PackedStringArray",
			values: [],
		});
	});

	it("parses arrays", () => {
		expect(parseVariant("[1, 2, 3]")).toEqual([1, 2, 3]);
		expect(parseVariant("[]")).toEqual([]);
	});

	it("parses string escape sequences", () => {
		expect(parseVariant('"hello\\nworld"')).toBe("hello\nworld");
		expect(parseVariant('"tab\\there"')).toBe("tab\there");
	});
});

describe("Variant Writer", () => {
	it("writes primitives", () => {
		expect(writeVariant(null)).toBe("null");
		expect(writeVariant(true)).toBe("true");
		expect(writeVariant(false)).toBe("false");
		expect(writeVariant(42)).toBe("42");
		expect(writeVariant("hello")).toBe('"hello"');
	});

	it("writes Vector2", () => {
		expect(writeVariant({ type: "Vector2", x: 10, y: 20 })).toBe("Vector2(10, 20)");
	});

	it("writes Color", () => {
		expect(writeVariant({ type: "Color", r: 1, g: 0, b: 0, a: 1 })).toBe(
			"Color(1, 0, 0, 1)",
		);
	});

	it("writes ExtResource", () => {
		expect(writeVariant({ type: "ExtResource", id: "1_abc" })).toBe(
			'ExtResource("1_abc")',
		);
	});

	it("round-trips variants", () => {
		const cases = [
			"Vector2(10.5, 20.3)",
			"Vector3(1, 2, 3)",
			"Color(0.5, 0.5, 0.5, 1)",
			'ExtResource("1_abc")',
			'SubResource("Shape_xyz")',
			'NodePath("Player/Sprite")',
			"Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 10, 15)",
		];

		for (const original of cases) {
			const parsed = parseVariant(original);
			const written = writeVariant(parsed);
			const reparsed = parseVariant(written);
			expect(reparsed).toEqual(parsed);
		}
	});
});
