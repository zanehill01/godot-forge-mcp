/**
 * Godot Forge MCP Server
 *
 * Main server setup — registers core tools, resources, and the progressive discovery system.
 *
 * Tool philosophy: Every tool must manipulate state (files, scenes, config) or bridge
 * to Godot (CLI, editor plugin). No code-generation wrappers — the LLM can write code natively.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GodotProject } from "./engine/project.js";
import { AssetManager } from "./engine/asset-manager.js";
import type { ForgeConfig } from "./config.js";
import { registerDiscoveryTools } from "./tools/core/discovery.js";
import { registerSceneOpsTools } from "./tools/core/scene-ops.js";
import { registerScriptOpsTools } from "./tools/core/script-ops.js";
import { registerExecutionTools } from "./tools/core/execution.js";
import { registerGroup, type ToolContext } from "./tools/registry.js";
import { registerProjectResources } from "./resources/project-resources.js";
import { registerSceneResources } from "./resources/scene-resources.js";
import { registerPrompts } from "./prompts/index.js";

export function createServer(config: ForgeConfig): McpServer {
	const server = new McpServer({
		name: "godot-forge-mcp",
		version: "0.2.0",
	});

	const project = new GodotProject(config.projectPath);
	const assetManager = new AssetManager(config.projectPath);

	const toolCtx: ToolContext = {
		projectRoot: config.projectPath,
		godotBinary: config.godotBinary,
		pluginConnected: false,
		getProject: () => project,
		getAssetManager: () => assetManager,
	};

	// Core tools (always exposed) — 21 tools
	registerDiscoveryTools(server, toolCtx);
	registerSceneOpsTools(server, toolCtx);
	registerScriptOpsTools(server, toolCtx);
	registerExecutionTools(server, toolCtx);

	// Core resources
	registerProjectResources(server, toolCtx);
	registerSceneResources(server, toolCtx);

	// Guided workflow prompts
	registerPrompts(server);

	// On-demand tool groups (activated via godot_catalog)
	registerToolGroups();

	return server;
}

function registerToolGroups(): void {
	registerGroup({
		name: "shader",
		description: "Shader authoring: create/edit/validate .gdshader files, ShaderMaterials, templates",
		toolCount: 8,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/shader.js").then((m) => m.registerShaderTools(s, c)); },
	});

	registerGroup({
		name: "animation",
		description: "Animation system: create Animation .tres resources, AnimationTree nodes, list/inspect animations across project",
		toolCount: 4,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/animation.js").then((m) => m.registerAnimationTools(s, c)); },
	});

	registerGroup({
		name: "physics",
		description: "Physics: collision shapes/bodies/areas, raycasts, joints, navigation, physics materials, layer management",
		toolCount: 8,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/physics.js").then((m) => m.registerPhysicsTools(s, c)); },
	});

	registerGroup({
		name: "ui",
		description: "UI: create layouts with Control hierarchies, themes, anchor presets, popup dialogs, focus chains",
		toolCount: 5,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/ui.js").then((m) => m.registerUITools(s, c)); },
	});

	registerGroup({
		name: "audio",
		description: "Audio: add AudioStreamPlayer nodes (2D/3D) to scenes, configure spatial audio properties",
		toolCount: 2,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/audio.js").then((m) => m.registerAudioTools(s, c)); },
	});

	registerGroup({
		name: "tilemap",
		description: "TileMap: add TileMapLayer nodes (4.3+ API), paint tiles in scenes",
		toolCount: 2,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/tilemap.js").then((m) => m.registerTileMapTools(s, c)); },
	});

	registerGroup({
		name: "three_d",
		description: "3D: meshes, model instancing (.glb/.gltf), materials, environment (sky/fog/tonemap/SSAO/glow), particles (fire/smoke/rain/snow/sparks), lights, import config",
		toolCount: 7,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/three-d.js").then((m) => m.registerThreeDTools(s, c)); },
	});

	registerGroup({
		name: "debug",
		description: "Live debugging (requires editor plugin): screenshots, scene tree inspection, node properties, input injection, performance metrics",
		toolCount: 7,
		requiresPlugin: true,
		register: (s, c) => { import("./tools/groups/debug.js").then((m) => m.registerDebugTools(s, c)); },
	});

	registerGroup({
		name: "project_mgmt",
		description: "Project management: input map actions, autoloads, project.godot settings, node groups, class reference",
		toolCount: 5,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/project-mgmt.js").then((m) => m.registerProjectMgmtTools(s, c)); },
	});

	registerGroup({
		name: "refactor",
		description: "Refactoring: find unused assets/scripts, rename symbols across files, dependency graph analysis",
		toolCount: 3,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/refactor.js").then((m) => m.registerRefactorTools(s, c)); },
	});

	registerGroup({
		name: "godot_standards",
		description: "Godot 4.3/4.4: UID integrity/generation, export pipeline, CI/CD, GDExtension, plugin scaffolding, project linting, test frameworks (GUT/GdUnit4), .gitignore/.gitattributes, resource type analysis",
		toolCount: 14,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/godot-standards.js").then((m) => m.registerGodotStandardsTools(s, c)); },
	});
}
