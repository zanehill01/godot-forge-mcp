import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTscn } from "../parser.js";
import { writeTscn } from "../writer.js";

const FIXTURES = join(__dirname, "../../../../test/fixtures/minimal-project");

describe("TSCN Round-trip", () => {
	it("parse → write produces valid output", () => {
		const original = readFileSync(join(FIXTURES, "scenes/main.tscn"), "utf-8");
		const doc = parseTscn(original);
		const written = writeTscn(doc);

		// Re-parse the written output
		const reparsed = parseTscn(written);

		// Should have the same structure
		expect(reparsed.descriptor).toEqual(doc.descriptor);
		expect(reparsed.extResources.length).toBe(doc.extResources.length);
		expect(reparsed.subResources.length).toBe(doc.subResources.length);
		expect(reparsed.nodes.length).toBe(doc.nodes.length);
		expect(reparsed.connections.length).toBe(doc.connections.length);

		// Node names and types should match
		for (let i = 0; i < doc.nodes.length; i++) {
			expect(reparsed.nodes[i].name).toBe(doc.nodes[i].name);
			expect(reparsed.nodes[i].type).toBe(doc.nodes[i].type);
			expect(reparsed.nodes[i].parent).toBe(doc.nodes[i].parent);
		}

		// Connections should match
		for (let i = 0; i < doc.connections.length; i++) {
			expect(reparsed.connections[i].signal).toBe(doc.connections[i].signal);
			expect(reparsed.connections[i].from).toBe(doc.connections[i].from);
			expect(reparsed.connections[i].to).toBe(doc.connections[i].to);
			expect(reparsed.connections[i].method).toBe(doc.connections[i].method);
		}
	});

	it("simple scene round-trips exactly", () => {
		const original = `[gd_scene format=3 uid="uid://test123"]

[node name="Root" type="Node2D"]

[node name="Child" type="Sprite2D" parent="."]
position = Vector2(10, 20)
`;

		const doc = parseTscn(original);
		const written = writeTscn(doc);
		const reparsed = parseTscn(written);

		expect(reparsed.nodes.length).toBe(2);
		expect(reparsed.nodes[0].name).toBe("Root");
		expect(reparsed.nodes[1].name).toBe("Child");
		expect(reparsed.nodes[1].properties.position).toEqual({
			type: "Vector2",
			x: 10,
			y: 20,
		});
	});
});
