/**
 * Scene Manager — high-level scene operations built on the TSCN parser.
 *
 * Provides a clean API for scene manipulation without requiring callers
 * to understand the TSCN document model directly.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { parseTscn } from "../parsers/tscn/parser.js";
import { writeTscn } from "../parsers/tscn/writer.js";
import type {
	TscnDocument,
	TscnNode,
	GodotVariant,
} from "../parsers/tscn/types.js";
import { resToAbsolute } from "../utils/path.js";
import { generateUid } from "../utils/uid.js";
import { generateResourceId } from "../utils/path.js";

export class SceneManager {
	private projectRoot: string;

	constructor(projectRoot: string) {
		this.projectRoot = projectRoot;
	}

	/**
	 * Load and parse a scene file.
	 */
	load(resPath: string): TscnDocument {
		const absPath = resToAbsolute(resPath, this.projectRoot);
		const content = readFileSync(absPath, "utf-8");
		return parseTscn(content);
	}

	/**
	 * Save a scene document to disk.
	 */
	save(resPath: string, doc: TscnDocument): void {
		const absPath = resToAbsolute(resPath, this.projectRoot);
		const dir = dirname(absPath);
		mkdirSync(dir, { recursive: true });
		writeFileSync(absPath, writeTscn(doc), "utf-8");
	}

	/**
	 * Check if a scene file exists.
	 */
	exists(resPath: string): boolean {
		return existsSync(resToAbsolute(resPath, this.projectRoot));
	}

	/**
	 * Create a new empty scene with a root node.
	 */
	createScene(rootType: string, rootName: string): TscnDocument {
		return {
			descriptor: { type: "gd_scene", format: 3, uid: generateUid() },
			extResources: [],
			subResources: [],
			nodes: [{ name: rootName, type: rootType, properties: {} }],
			connections: [],
		};
	}

	/**
	 * Find a node by its path in the scene tree.
	 * "." = root, "Player" = direct child, "Player/Sprite" = nested child
	 */
	findNode(doc: TscnDocument, nodePath: string): TscnNode | undefined {
		if (nodePath === ".") return doc.nodes[0];
		return doc.nodes.find((n) => this.getNodePath(n) === nodePath);
	}

	/**
	 * Get the full path of a node (parent/name format).
	 */
	getNodePath(node: TscnNode): string {
		if (node.parent === undefined) return ".";
		if (node.parent === ".") return node.name;
		return `${node.parent}/${node.name}`;
	}

	/**
	 * Get all children of a node.
	 */
	getChildren(doc: TscnDocument, parentPath: string): TscnNode[] {
		return doc.nodes.filter((n) => n.parent === parentPath);
	}

	/**
	 * Get all descendants of a node (recursive).
	 */
	getDescendants(doc: TscnDocument, parentPath: string): TscnNode[] {
		const descendants: TscnNode[] = [];
		const directChildren = this.getChildren(doc, parentPath);

		for (const child of directChildren) {
			descendants.push(child);
			const childPath = parentPath === "." ? child.name : `${parentPath}/${child.name}`;
			descendants.push(...this.getDescendants(doc, childPath));
		}

		return descendants;
	}

	/**
	 * Add a node to a scene. Returns the modified document.
	 */
	addNode(
		doc: TscnDocument,
		node: {
			name: string;
			type: string;
			parent?: string;
			properties?: Record<string, GodotVariant>;
			groups?: string[];
		},
	): TscnDocument {
		const newNode: TscnNode = {
			name: node.name,
			type: node.type,
			parent: node.parent ?? ".",
			properties: node.properties ?? {},
		};
		if (node.groups && node.groups.length > 0) {
			newNode.groups = node.groups;
		}
		doc.nodes.push(newNode);
		return doc;
	}

	/**
	 * Remove a node and all its descendants. Cleans up signal connections.
	 */
	removeNode(doc: TscnDocument, nodePath: string): TscnDocument {
		const descendants = this.getDescendants(doc, nodePath);
		const removePaths = new Set([nodePath, ...descendants.map((d) => this.getNodePath(d))]);

		doc.nodes = doc.nodes.filter((n) => !removePaths.has(this.getNodePath(n)));

		// Clean up connections involving removed nodes
		doc.connections = doc.connections.filter(
			(c) => !removePaths.has(c.from) && !removePaths.has(c.to),
		);

		return doc;
	}

	/**
	 * Add an external resource reference and return its ID.
	 */
	addExtResource(
		doc: TscnDocument,
		type: string,
		path: string,
	): string {
		const id = generateResourceId();
		doc.extResources.push({
			type,
			uid: generateUid(),
			path,
			id,
		});
		return id;
	}

	/**
	 * Add a sub-resource and return its ID.
	 */
	addSubResource(
		doc: TscnDocument,
		type: string,
		properties: Record<string, GodotVariant>,
	): string {
		const id = `${type}_${generateResourceId()}`;
		doc.subResources.push({ type, id, properties });
		return id;
	}

	/**
	 * Connect a signal between nodes.
	 */
	connectSignal(
		doc: TscnDocument,
		signal: string,
		from: string,
		to: string,
		method: string,
	): TscnDocument {
		doc.connections.push({ signal, from, to, method });
		return doc;
	}

	/**
	 * Build a tree representation of the scene.
	 */
	buildTree(doc: TscnDocument): SceneTreeNode | null {
		if (doc.nodes.length === 0) return null;

		const root = doc.nodes[0];
		return this.buildTreeNode(doc, root, ".");
	}

	private buildTreeNode(doc: TscnDocument, node: TscnNode, _parentPath: string): SceneTreeNode {
		const myPath = node.parent === undefined ? "." : this.getNodePath(node);
		const children = doc.nodes.filter((n) => n.parent === (myPath === "." ? "." : myPath));

		return {
			name: node.name,
			type: node.type ?? (node.instance ? "[instance]" : "unknown"),
			path: myPath,
			properties: node.properties,
			groups: node.groups ?? [],
			children: children.map((c) => this.buildTreeNode(doc, c, myPath)),
		};
	}
}

export interface SceneTreeNode {
	name: string;
	type: string;
	path: string;
	properties: Record<string, GodotVariant>;
	groups: string[];
	children: SceneTreeNode[];
}
