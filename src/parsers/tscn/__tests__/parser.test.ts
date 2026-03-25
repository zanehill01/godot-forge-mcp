import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTscn } from "../parser.js";
import { tokenize } from "../lexer.js";

const FIXTURES = join(__dirname, "../../../../test/fixtures/minimal-project");

describe("TSCN Lexer", () => {
	it("tokenizes a scene file", () => {
		const content = readFileSync(join(FIXTURES, "scenes/main.tscn"), "utf-8");
		const tokens = tokenize(content);

		// Should have section headers, properties, and blank lines
		const headers = tokens.filter((t) => t.type === "SectionHeader");
		expect(headers.length).toBeGreaterThan(0);

		// First header should be gd_scene
		const first = headers[0];
		expect(first.type).toBe("SectionHeader");
		if (first.type === "SectionHeader") {
			expect(first.sectionType).toBe("gd_scene");
			expect(first.attributes.format).toBe("3");
		}
	});

	it("parses section attributes correctly", () => {
		const content = '[ext_resource type="Script" uid="uid://abc123" path="res://test.gd" id="1_abc"]';
		const tokens = tokenize(content);
		expect(tokens.length).toBe(1);

		const token = tokens[0];
		expect(token.type).toBe("SectionHeader");
		if (token.type === "SectionHeader") {
			expect(token.sectionType).toBe("ext_resource");
			expect(token.attributes.type).toBe("Script");
			expect(token.attributes.uid).toBe("uid://abc123");
			expect(token.attributes.path).toBe("res://test.gd");
			expect(token.attributes.id).toBe("1_abc");
		}
	});
});

describe("TSCN Parser", () => {
	it("parses the minimal project main scene", () => {
		const content = readFileSync(join(FIXTURES, "scenes/main.tscn"), "utf-8");
		const doc = parseTscn(content);

		// Descriptor
		expect(doc.descriptor.type).toBe("gd_scene");
		expect(doc.descriptor.format).toBe(3);
		expect(doc.descriptor.uid).toBe("uid://cecaux1sm7mo0");

		// External resources
		expect(doc.extResources.length).toBe(2);
		expect(doc.extResources[0].type).toBe("Script");
		expect(doc.extResources[0].path).toBe("res://scripts/player.gd");
		expect(doc.extResources[1].type).toBe("Texture2D");

		// Sub-resources
		expect(doc.subResources.length).toBe(2);
		expect(doc.subResources[0].type).toBe("CapsuleShape2D");
		expect(doc.subResources[0].properties.radius).toBe(16);
		expect(doc.subResources[0].properties.height).toBe(32);
		expect(doc.subResources[1].type).toBe("RectangleShape2D");

		// Nodes (Main, Player, Sprite, CollisionShape, Ground, GroundShape)
		expect(doc.nodes.length).toBe(6);

		// Root node
		expect(doc.nodes[0].name).toBe("Main");
		expect(doc.nodes[0].type).toBe("Node2D");
		expect(doc.nodes[0].parent).toBeUndefined();

		// Player node
		expect(doc.nodes[1].name).toBe("Player");
		expect(doc.nodes[1].type).toBe("CharacterBody2D");
		expect(doc.nodes[1].parent).toBe(".");

		// Player should have position and script properties
		const playerProps = doc.nodes[1].properties;
		expect(playerProps.position).toEqual({ type: "Vector2", x: 100, y: 200 });
		expect(playerProps.script).toEqual({ type: "ExtResource", id: "1_abc" });

		// Sprite node
		expect(doc.nodes[2].name).toBe("Sprite");
		expect(doc.nodes[2].parent).toBe("Player");

		// Connections
		expect(doc.connections.length).toBe(1);
		expect(doc.connections[0].signal).toBe("body_entered");
		expect(doc.connections[0].from).toBe("Player");
		expect(doc.connections[0].to).toBe(".");
		expect(doc.connections[0].method).toBe("_on_player_body_entered");
	});

	it("handles empty scene", () => {
		const content = '[gd_scene format=3 uid="uid://test123"]\n\n[node name="Root" type="Node"]\n';
		const doc = parseTscn(content);

		expect(doc.descriptor.format).toBe(3);
		expect(doc.nodes.length).toBe(1);
		expect(doc.nodes[0].name).toBe("Root");
		expect(doc.nodes[0].type).toBe("Node");
		expect(doc.extResources.length).toBe(0);
		expect(doc.subResources.length).toBe(0);
		expect(doc.connections.length).toBe(0);
	});
});
