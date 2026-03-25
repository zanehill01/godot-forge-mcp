/**
 * Tool Registry — Progressive Discovery System
 *
 * Manages the catalog of all tool groups and handles dynamic activation/deactivation.
 * Core tools are always registered. Group tools are registered on-demand via the catalog.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ToolGroup {
	name: string;
	description: string;
	toolCount: number;
	requiresPlugin: boolean;
	register: (server: McpServer, ctx: ToolContext) => void;
}

export interface ToolContext {
	projectRoot: string;
	godotBinary: string | null;
	pluginConnected: boolean;
	getProject: () => import("../engine/project.js").GodotProject;
	getAssetManager: () => import("../engine/asset-manager.js").AssetManager;
}

const registeredGroups = new Map<string, ToolGroup>();
const activeGroups = new Set<string>();

/**
 * Register a tool group in the catalog.
 */
export function registerGroup(group: ToolGroup): void {
	registeredGroups.set(group.name, group);
}

/**
 * Get all registered groups.
 */
export function getGroups(): ToolGroup[] {
	return Array.from(registeredGroups.values());
}

/**
 * Check if a group is active.
 */
export function isGroupActive(name: string): boolean {
	return activeGroups.has(name);
}

/**
 * Activate a tool group — registers its tools with the server.
 */
export function activateGroup(name: string, server: McpServer, ctx: ToolContext): boolean {
	const group = registeredGroups.get(name);
	if (!group) return false;

	if (group.requiresPlugin && !ctx.pluginConnected) {
		return false;
	}

	if (!activeGroups.has(name)) {
		group.register(server, ctx);
		activeGroups.add(name);
	}

	return true;
}

/**
 * Get catalog listing for the LLM.
 */
export function getCatalog(): Array<{
	name: string;
	description: string;
	toolCount: number;
	active: boolean;
	requiresPlugin: boolean;
}> {
	return Array.from(registeredGroups.values()).map((g) => ({
		name: g.name,
		description: g.description,
		toolCount: g.toolCount,
		active: activeGroups.has(g.name),
		requiresPlugin: g.requiresPlugin,
	}));
}
