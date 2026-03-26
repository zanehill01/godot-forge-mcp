/**
 * Godot Forge MCP Server
 *
 * Architecture: 17 smart tools with action-based routing.
 * Each tool group registers exactly 1 tool. The LLM picks the domain,
 * then specifies the action. This dramatically reduces context window
 * overhead vs. 115+ individual tools.
 *
 * Core (always on): godot_discover, godot_scene, godot_script, godot_execute
 * Groups (on-demand): godot_3d, godot_shader, godot_physics, godot_ui, etc.
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
		version: "0.3.0",
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

	// Core tools (always exposed) — 4 tools
	registerDiscoveryTools(server, toolCtx);   // godot_discover
	registerSceneOpsTools(server, toolCtx);    // godot_scene
	registerScriptOpsTools(server, toolCtx);   // godot_script
	registerExecutionTools(server, toolCtx);   // godot_execute

	// Core resources
	registerProjectResources(server, toolCtx);
	registerSceneResources(server, toolCtx);

	// Guided workflow prompts
	registerPrompts(server);

	// On-demand tool groups — each registers exactly 1 tool
	registerToolGroups();

	return server;
}

function registerToolGroups(): void {
	registerGroup({
		name: "three_d",
		description: "godot_3d: meshes, models, materials, environment, particles, lights, cameras, GI, fog, decals, paths, GridMap, MultiMesh, occluders, composite bodies",
		toolCount: 1,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/three-d.js").then((m) => m.registerThreeDTools(s, c)); },
	});

	registerGroup({
		name: "shader",
		description: "godot_shader: create/read/edit .gdshader files, ShaderMaterial resources, shader params, validation, templates",
		toolCount: 1,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/shader.js").then((m) => m.registerShaderTools(s, c)); },
	});

	registerGroup({
		name: "physics",
		description: "godot_physics: collision shapes, physics bodies, areas, raycasts, joints, navigation, physics materials, layer management",
		toolCount: 1,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/physics.js").then((m) => m.registerPhysicsTools(s, c)); },
	});

	registerGroup({
		name: "animation",
		description: "godot_animation: create Animation .tres, AnimationTree nodes, list/inspect animations",
		toolCount: 1,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/animation.js").then((m) => m.registerAnimationTools(s, c)); },
	});

	registerGroup({
		name: "ui",
		description: "godot_ui: Control layouts, themes, anchor presets, popup dialogs, focus chains",
		toolCount: 1,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/ui.js").then((m) => m.registerUITools(s, c)); },
	});

	registerGroup({
		name: "audio",
		description: "godot_audio: AudioStreamPlayer nodes (2D/3D), spatial audio configuration",
		toolCount: 1,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/audio.js").then((m) => m.registerAudioTools(s, c)); },
	});

	registerGroup({
		name: "tilemap",
		description: "godot_tilemap: TileMapLayer nodes (4.3+), tile painting",
		toolCount: 1,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/tilemap.js").then((m) => m.registerTileMapTools(s, c)); },
	});

	registerGroup({
		name: "intelligence",
		description: "godot_intelligence: LSP diagnostics/completions/hover/definition + DAP breakpoints/stepping/variables/evaluation",
		toolCount: 1,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/intelligence.js").then((m) => m.registerIntelligenceTools(s, c)); },
	});

	registerGroup({
		name: "debug",
		description: "godot_debug: screenshots, performance metrics, scene tree inspection, node properties, input injection (requires editor plugin)",
		toolCount: 1,
		requiresPlugin: true,
		register: (s, c) => { import("./tools/groups/debug.js").then((m) => m.registerDebugTools(s, c)); },
	});

	registerGroup({
		name: "game_essentials",
		description: "godot_game: SpriteFrames, input binding, Camera2D, scene validation, Curve/Gradient/StyleBox/AudioBusLayout, parallax, 2D lights, multiplayer, integrity checker",
		toolCount: 1,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/game-essentials.js").then((m) => m.registerGameEssentialsTools(s, c)); },
	});

	registerGroup({
		name: "project_mgmt",
		description: "godot_project: input map, autoloads, project settings, node groups, class reference",
		toolCount: 1,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/project-mgmt.js").then((m) => m.registerProjectMgmtTools(s, c)); },
	});

	registerGroup({
		name: "refactor",
		description: "godot_refactor: find unused assets, rename symbols across files, dependency graph",
		toolCount: 1,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/refactor.js").then((m) => m.registerRefactorTools(s, c)); },
	});

	registerGroup({
		name: "godot_standards",
		description: "godot_standards: UID management, export pipeline, CI/CD, GDExtension, plugin scaffolding, project linting, test frameworks, .gitignore, resource analysis",
		toolCount: 1,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/godot-standards.js").then((m) => m.registerGodotStandardsTools(s, c)); },
	});
}
