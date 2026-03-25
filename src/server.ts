/**
 * Godot Forge MCP Server
 *
 * Main server setup — registers core tools, resources, and the progressive discovery system.
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
		version: "0.1.0",
	});

	// Initialize engine components
	const project = new GodotProject(config.projectPath);
	const assetManager = new AssetManager(config.projectPath);

	// Tool context shared by all tools
	const toolCtx: ToolContext = {
		projectRoot: config.projectPath,
		godotBinary: config.godotBinary,
		pluginConnected: false,
		getProject: () => project,
		getAssetManager: () => assetManager,
	};

	// Register core tools (always exposed)
	registerDiscoveryTools(server, toolCtx);
	registerSceneOpsTools(server, toolCtx);
	registerScriptOpsTools(server, toolCtx);
	registerExecutionTools(server, toolCtx);

	// Register core resources
	registerProjectResources(server, toolCtx);
	registerSceneResources(server, toolCtx);

	// Register guided workflow prompts
	registerPrompts(server);

	// Register tool groups in the catalog (not activated yet — on-demand via godot_catalog)
	registerToolGroups();

	return server;
}

function registerToolGroups(): void {
	registerGroup({
		name: "shader",
		description: "Shader authoring: create, edit, validate .gdshader files, manage ShaderMaterials, templates (water, dissolve, outline, toon, hologram, pixelation, wind, glow)",
		toolCount: 8,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/shader.js").then((m) => m.registerShaderTools(s, c)); },
	});

	registerGroup({
		name: "animation",
		description: "Animation system: create animations, AnimationTree state machines, blend trees, transitions, tweens, spritesheet animation",
		toolCount: 10,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/animation.js").then((m) => m.registerAnimationTools(s, c)); },
	});

	registerGroup({
		name: "physics",
		description: "Physics: collision shapes, bodies, areas, raycasts, joints, navigation, physics materials, layer management",
		toolCount: 8,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/physics.js").then((m) => m.registerPhysicsTools(s, c)); },
	});

	registerGroup({
		name: "ui",
		description: "UI: Control layouts, themes, containers, anchors, RichTextLabel BBCode, popups, focus chains for gamepad",
		toolCount: 8,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/ui.js").then((m) => m.registerUITools(s, c)); },
	});

	registerGroup({
		name: "audio",
		description: "Audio: AudioStreamPlayers, bus layout, effects (reverb/chorus/delay/EQ), audio pools, spatial 3D audio",
		toolCount: 5,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/audio.js").then((m) => m.registerAudioTools(s, c)); },
	});

	registerGroup({
		name: "tilemap",
		description: "TileMap: create tilesets, configure tiles, paint tilemaps, autotile rules, tilemap layers, procedural generation",
		toolCount: 6,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/tilemap.js").then((m) => m.registerTileMapTools(s, c)); },
	});

	registerGroup({
		name: "three_d",
		description: "3D: procedural meshes, StandardMaterial3D, environment/sky, camera rigs, lights, LOD, import config",
		toolCount: 7,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/three-d.js").then((m) => m.registerThreeDTools(s, c)); },
	});

	registerGroup({
		name: "ai_behavior",
		description: "AI/behavior: finite state machines, behavior trees, dialogue trees, pathfinding, steering behaviors, spawn systems",
		toolCount: 6,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/ai-behavior.js").then((m) => m.registerAIBehaviorTools(s, c)); },
	});

	registerGroup({
		name: "debug",
		description: "Live debugging (requires editor plugin): screenshots, runtime node inspection, performance metrics, input injection",
		toolCount: 7,
		requiresPlugin: true,
		register: (_server, _ctx) => {},
	});

	registerGroup({
		name: "project_mgmt",
		description:
			"Project management: input map, autoloads, export presets, project settings, node groups, class reference",
		toolCount: 6,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/project-mgmt.js").then((m) => m.registerProjectMgmtTools(s, c)); },
	});

	registerGroup({
		name: "refactor",
		description: "Refactoring: find unused assets/scripts, rename symbols across files, extract/inline scenes, dependency graph",
		toolCount: 5,
		requiresPlugin: false,
		register: (s, c) => { import("./tools/groups/refactor.js").then((m) => m.registerRefactorTools(s, c)); },
	});
}
