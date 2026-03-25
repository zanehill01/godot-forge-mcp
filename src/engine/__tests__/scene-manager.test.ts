import { describe, it, expect } from "vitest";
import { SceneManager } from "../scene-manager.js";
import { join } from "node:path";

const FIXTURES = join(__dirname, "../../../test/fixtures/minimal-project");

describe("SceneManager", () => {
	const manager = new SceneManager(FIXTURES);

	it("loads a scene", () => {
		const doc = manager.load("res://scenes/main.tscn");
		expect(doc.nodes.length).toBe(6);
		expect(doc.nodes[0].name).toBe("Main");
	});

	it("finds nodes by path", () => {
		const doc = manager.load("res://scenes/main.tscn");

		const root = manager.findNode(doc, ".");
		expect(root?.name).toBe("Main");

		const player = manager.findNode(doc, "Player");
		expect(player?.name).toBe("Player");
		expect(player?.type).toBe("CharacterBody2D");

		const sprite = manager.findNode(doc, "Player/Sprite");
		expect(sprite?.name).toBe("Sprite");
		expect(sprite?.type).toBe("Sprite2D");
	});

	it("gets children of a node", () => {
		const doc = manager.load("res://scenes/main.tscn");

		const rootChildren = manager.getChildren(doc, ".");
		const names = rootChildren.map((n) => n.name);
		expect(names).toContain("Player");
		expect(names).toContain("Ground");
	});

	it("gets descendants recursively", () => {
		const doc = manager.load("res://scenes/main.tscn");

		const descendants = manager.getDescendants(doc, ".");
		expect(descendants.length).toBe(5); // All nodes except root
	});

	it("creates a new scene", () => {
		const doc = manager.createScene("Node3D", "Level");
		expect(doc.nodes.length).toBe(1);
		expect(doc.nodes[0].name).toBe("Level");
		expect(doc.nodes[0].type).toBe("Node3D");
		expect(doc.descriptor.uid).toMatch(/^uid:\/\//);
	});

	it("adds nodes to a scene", () => {
		let doc = manager.createScene("Node2D", "Root");
		doc = manager.addNode(doc, { name: "Sprite", type: "Sprite2D" });
		doc = manager.addNode(doc, { name: "Body", type: "CollisionShape2D", parent: "." });

		expect(doc.nodes.length).toBe(3);
		expect(doc.nodes[1].name).toBe("Sprite");
		expect(doc.nodes[1].parent).toBe(".");
		expect(doc.nodes[2].name).toBe("Body");
	});

	it("removes nodes and their descendants", () => {
		const doc = manager.load("res://scenes/main.tscn");
		const before = doc.nodes.length;

		// Remove Player (should also remove Sprite and CollisionShape)
		manager.removeNode(doc, "Player");

		expect(doc.nodes.length).toBe(before - 3); // Player, Sprite, CollisionShape
	});

	it("builds a scene tree", () => {
		const doc = manager.load("res://scenes/main.tscn");
		const tree = manager.buildTree(doc);

		expect(tree).not.toBeNull();
		expect(tree!.name).toBe("Main");
		expect(tree!.children.length).toBe(2); // Player and Ground
		expect(tree!.children[0].name).toBe("Player");
		expect(tree!.children[0].children.length).toBe(2); // Sprite and CollisionShape
	});

	it("connects signals", () => {
		let doc = manager.createScene("Node2D", "Root");
		doc = manager.addNode(doc, { name: "Button", type: "Button" });
		doc = manager.connectSignal(doc, "pressed", "Button", ".", "_on_button_pressed");

		expect(doc.connections.length).toBe(1);
		expect(doc.connections[0].signal).toBe("pressed");
		expect(doc.connections[0].from).toBe("Button");
	});
});
