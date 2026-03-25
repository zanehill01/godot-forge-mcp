/**
 * MCP Prompts — Guided workflow templates.
 *
 * These are exposed as MCP Prompts that users can invoke to walk through
 * common game development workflows.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
	server.prompt(
		"new_game_setup",
		"Walk through creating a complete Godot game project scaffold.",
		{
			genre: z.string().describe("Game genre (platformer, rpg, puzzle, shooter, racing, sandbox)"),
			dimension: z.enum(["2d", "3d"]).describe("2D or 3D game"),
			name: z.string().describe("Project/game name"),
		},
		({ genre, dimension, name }) => ({
			messages: [{
				role: "user",
				content: {
					type: "text",
					text: `I want to scaffold a complete ${dimension.toUpperCase()} ${genre} game called "${name}" using the Godot Forge MCP tools.

Please create the full project structure:

1. **Main Scene** — Create the root scene at res://scenes/main.tscn with appropriate root node type (Node2D for 2D, Node3D for 3D)
2. **Player Scene** — Create res://scenes/player.tscn with a ${dimension === "2d" ? "CharacterBody2D" : "CharacterBody3D"} root, collision shape, and sprite/mesh
3. **Player Script** — Generate a complete player controller at res://scripts/player.gd with movement, ${dimension === "2d" ? "jumping, gravity" : "WASD movement, mouse look"}
4. **UI Layer** — Create res://scenes/ui/hud.tscn with basic HUD (health bar, score label)
5. **Game Manager** — Create an autoload singleton at res://scripts/game_manager.gd for score, lives, game state
6. **Input Map** — Configure input actions: move_left, move_right, ${dimension === "2d" ? "jump, attack" : "move_forward, move_backward, jump, attack"}
7. **Camera** — Set up appropriate camera (Camera2D following player, or Camera3D with the right rig)

Use godot_create_scene, godot_write_script, godot_add_node, godot_connect_signal, godot_configure_input_map, and godot_manage_autoloads.

Genre-specific additions for ${genre}:
${genre === "platformer" ? "- Add ground/platform StaticBody nodes with collision\n- Add parallax background layers" : ""}
${genre === "rpg" ? "- Add NPC scene template\n- Add inventory autoload\n- Add dialogue system setup" : ""}
${genre === "shooter" ? "- Add projectile scene template\n- Add enemy spawner\n- Add weapon system base" : ""}
${genre === "puzzle" ? "- Add interactable object base scene\n- Add level manager autoload\n- Add win condition checker" : ""}

Start with godot_project_info to understand the current state, then build each piece.`,
				},
			}],
		}),
	);

	server.prompt(
		"player_controller",
		"Generate a complete player controller with movement, input handling, and animation.",
		{
			dimension: z.enum(["2d", "3d"]),
			style: z.enum(["platformer", "top_down", "first_person", "third_person"]),
			features: z.string().optional().describe("Comma-separated features: jump, dash, double_jump, wall_jump, crouch, sprint"),
		},
		({ dimension, style, features }) => ({
			messages: [{
				role: "user",
				content: {
					type: "text",
					text: `Generate a complete ${dimension.toUpperCase()} ${style} player controller using Godot Forge MCP tools.

Requirements:
- ${dimension === "2d" ? "CharacterBody2D" : "CharacterBody3D"} base
- Movement style: ${style}
- Features: ${features ?? "basic movement"}
- Input handling via Input.get_axis / Input.is_action_just_pressed
- Export variables for speed, acceleration, friction
- Physics-based movement with move_and_slide()

Steps:
1. Create player scene at res://scenes/player.tscn with godot_create_scene
2. Add collision shape with godot_add_node
3. ${dimension === "2d" ? "Add Sprite2D or AnimatedSprite2D" : "Add MeshInstance3D or model instance"}
4. Generate the controller script with godot_write_script
5. ${style === "first_person" ? "Add Camera3D as child" : style === "third_person" ? "Generate camera rig script" : "Add Camera2D following player"}
6. Configure input actions with godot_configure_input_map
7. Wire signals (if AnimatedSprite2D, connect animation_finished)

The script should be production-quality with typed GDScript, proper state management, and clean separation of concerns.`,
				},
			}],
		}),
	);

	server.prompt(
		"enemy_ai",
		"Build an enemy with state machine AI (patrol, chase, attack).",
		{
			dimension: z.enum(["2d", "3d"]),
			behavior: z.enum(["patrol", "chase", "ranged", "boss"]),
			name: z.string().optional().default("Enemy"),
		},
		({ dimension, behavior, name }) => ({
			messages: [{
				role: "user",
				content: {
					type: "text",
					text: `Create a complete ${dimension.toUpperCase()} ${behavior} enemy called "${name}" using Godot Forge MCP tools.

Steps:
1. Activate the ai_behavior tool group with godot_catalog
2. Create enemy scene at res://scenes/enemies/${name.toLowerCase()}.tscn
3. Generate state machine script using godot_create_state_machine with states: idle, ${behavior === "patrol" ? "patrol, return" : behavior === "chase" ? "patrol, chase, attack" : behavior === "ranged" ? "patrol, chase, aim, shoot, retreat" : "phase1, phase2, phase3, enrage"}
4. Add detection Area${dimension === "2d" ? "2D" : "3D"} for player detection
5. Add collision shape
6. ${dimension === "2d" ? "Add AnimatedSprite2D with placeholder" : "Add MeshInstance3D"}
7. Wire area_entered/area_exited signals for state transitions
8. ${behavior === "ranged" || behavior === "boss" ? "Create projectile scene" : ""}
9. Add to main scene using godot_instance_scene

The AI should use NavigationAgent for pathfinding and have configurable exports for speed, detection range, and attack damage.`,
				},
			}],
		}),
	);

	server.prompt(
		"ui_screen",
		"Design and generate a complete UI screen.",
		{
			screenType: z.enum(["main_menu", "hud", "inventory", "dialogue", "settings", "pause", "game_over"]),
			style: z.string().optional().describe("Visual style description"),
		},
		({ screenType, style }) => ({
			messages: [{
				role: "user",
				content: {
					type: "text",
					text: `Create a complete ${screenType.replace("_", " ")} UI screen using Godot Forge MCP tools.

Steps:
1. Activate the ui tool group with godot_catalog
2. Create the UI scene using godot_create_ui_layout
3. ${screenType === "main_menu" ? "Add title label, play button, settings button, quit button in a VBoxContainer" : ""}
${screenType === "hud" ? "Add health bar (ProgressBar), score label, ammo counter, minimap placeholder" : ""}
${screenType === "inventory" ? "Add GridContainer for item slots, item detail panel, drag-and-drop support structure" : ""}
${screenType === "dialogue" ? "Add portrait TextureRect, name label, dialogue RichTextLabel with BBCode, choice buttons" : ""}
${screenType === "settings" ? "Add volume sliders, resolution dropdown, fullscreen toggle, keybind section, apply/cancel buttons" : ""}
${screenType === "pause" ? "Add semi-transparent background, resume/settings/quit buttons, paused label" : ""}
${screenType === "game_over" ? "Add game over label, score display, retry/menu buttons" : ""}
4. Configure anchor presets for responsive layout
5. Generate the UI controller script
6. Wire button signals
7. ${style ? `Apply visual style: ${style}` : "Use clean, readable defaults"}
8. Configure focus chain for gamepad navigation with godot_ui_focus_chain`,
				},
			}],
		}),
	);

	server.prompt(
		"shader_from_effect",
		"Describe a visual effect and get a complete .gdshader implementation.",
		{
			effect: z.string().describe("Description of the desired visual effect"),
			shaderType: z.enum(["spatial", "canvas_item"]).optional().default("spatial"),
		},
		({ effect, shaderType }) => ({
			messages: [{
				role: "user",
				content: {
					type: "text",
					text: `Create a complete .gdshader for this visual effect: "${effect}"

Steps:
1. Activate the shader tool group with godot_catalog
2. Check godot_shader_templates for any matching base template
3. Create the .gdshader at res://shaders/ using godot_create_shader (type: ${shaderType})
4. Create a ShaderMaterial .tres using godot_create_shader_material
5. Validate with godot_validate_shader
6. List the parameters with godot_list_shader_params so the user knows what to tweak

The shader should:
- Have clear, descriptive uniform names
- Include hint annotations for editor usability (source_color, hint_range)
- Have sensible defaults
- Be well-commented explaining the technique
- Be optimized (avoid unnecessary calculations in fragment())`,
				},
			}],
		}),
	);

	server.prompt(
		"level_from_description",
		"Convert a natural language level description into a Godot scene.",
		{
			description: z.string().describe("Natural language description of the level layout"),
			dimension: z.enum(["2d", "3d"]).optional().default("2d"),
		},
		({ description, dimension }) => ({
			messages: [{
				role: "user",
				content: {
					type: "text",
					text: `Convert this level description into a Godot scene using MCP tools:

"${description}"

Steps:
1. Analyze the description and identify: terrain/platforms, spawn points, collectibles, obstacles, triggers, boundaries
2. Create the level scene with godot_create_scene (root: ${dimension === "2d" ? "Node2D" : "Node3D"})
3. Add static geometry (${dimension === "2d" ? "StaticBody2D with CollisionShape2D for platforms/walls" : "CSG or MeshInstance3D nodes for terrain"})
4. Add player spawn point (Marker${dimension === "2d" ? "2D" : "3D"})
5. Add collectibles/pickups as Area${dimension === "2d" ? "2D" : "3D"} nodes
6. Add obstacles and hazards
7. Add trigger zones for events
8. Set up camera bounds / world boundaries
9. ${dimension === "3d" ? "Set up environment (sky, lighting, fog) using godot_setup_environment" : "Consider parallax background"}
10. Wire signals for triggers and collectibles

Position nodes based on the spatial relationships described. Use reasonable scale (${dimension === "2d" ? "16-32px grid" : "1 unit = 1 meter"}).`,
				},
			}],
		}),
	);

	server.prompt(
		"debug_performance",
		"Guided performance investigation workflow.",
		{
			symptom: z.string().optional().describe("Performance symptom (low FPS, stuttering, high memory)"),
		},
		({ symptom }) => ({
			messages: [{
				role: "user",
				content: {
					type: "text",
					text: `Help me investigate a performance issue in my Godot project${symptom ? `: ${symptom}` : ""}.

Investigation workflow:
1. Run godot_project_info to understand the project
2. Run godot_list_scenes to find large/complex scenes
3. Activate the refactor group and run godot_dependency_graph to find heavily-connected scenes
4. Run godot_find_unused to identify dead weight
5. Check for performance-impacting patterns:
   - Scenes with too many nodes (>100)
   - Scripts with _process() that could use _physics_process() or signals
   - Large textures without mipmaps
   - 3D scenes without LOD setup
6. If editor plugin is connected, check godot_performance_metrics for live data
7. Suggest specific optimizations based on findings
8. Help implement the fixes using the appropriate tools

Focus on the biggest impact optimizations first.`,
				},
			}],
		}),
	);

	server.prompt(
		"refactor_scene",
		"Analyze and clean up a messy scene.",
		{
			scenePath: z.string().describe("Scene to analyze (res://)"),
		},
		({ scenePath }) => ({
			messages: [{
				role: "user",
				content: {
					type: "text",
					text: `Analyze and refactor the scene at ${scenePath} using Godot Forge MCP tools.

Steps:
1. Read the scene with godot_read_scene to understand structure
2. Analyze for issues:
   - Deep nesting (>5 levels) — suggest flattening
   - Missing node types (nodes without types = broken instances)
   - Disconnected signals (signal connections to non-existent methods)
   - Large number of direct children (>20) — suggest grouping
   - Unused nodes (no script, no children, no connections)
   - Duplicate node names at the same level
3. Read attached scripts with godot_read_script to check for issues
4. Activate the refactor group and run godot_dependency_graph for this scene
5. Suggest and apply fixes:
   - Extract repeated patterns into reusable scenes
   - Group related nodes under organizational parents
   - Remove dead nodes
   - Fix signal connections
6. Report before/after metrics (node count, depth, connection count)`,
				},
			}],
		}),
	);
}
