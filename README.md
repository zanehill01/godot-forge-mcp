# Godot Forge MCP

Intelligent MCP server for Godot 4.3+ game development. 97 tools, progressive discovery, editor plugin.

Not a tool collection — a game development partner.

## Quick Start

```bash
# With Claude Code
claude mcp add godot-forge -- npx godot-forge-mcp --project /path/to/your/godot/project

# Or run directly
npx godot-forge-mcp --project /path/to/your/godot/project
```

## Architecture

```
Claude / AI Client
        │ MCP Protocol (stdio)
        ▼
godot-forge-mcp (TypeScript sidecar)
  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐
  │ File Engine  │ │  CLI Bridge  │ │ Socket Bridge │
  │ .tscn/.gd    │ │  headless    │ │  live editor  │
  │ parse/write  │ │  invocation  │ │  WebSocket    │
  └─────────────┘ └──────────────┘ └───────────────┘
        │                │                │
        ▼                ▼                ▼
  Project files    Godot 4.3+ CLI   Editor Plugin
```

**Three-layer graceful degradation:**
- **File Engine** — Always works. Parses/writes .tscn, .tres, .gd, .gdshader directly.
- **CLI Bridge** — Works when Godot binary is available. Headless validation, export, script execution.
- **Socket Bridge** — Works when editor plugin is active. Real-time inspection, undo/redo, screenshots.

## Tools (97 total)

### Always Available (21 core tools)

| Category | Tools |
|----------|-------|
| **Discovery** | `godot_project_info`, `godot_list_scenes`, `godot_list_scripts`, `godot_list_resources`, `godot_list_assets`, `godot_search`, `godot_catalog` |
| **Scene Ops** | `godot_read_scene`, `godot_create_scene`, `godot_add_node`, `godot_modify_node`, `godot_remove_node`, `godot_connect_signal`, `godot_disconnect_signal`, `godot_instance_scene` |
| **Script Ops** | `godot_read_script`, `godot_write_script`, `godot_edit_script` |
| **Execution** | `godot_run_project`, `godot_stop_project`, `godot_run_script` |

### On-Demand Groups (76 tools via `godot_catalog`)

| Group | Tools | What It Does |
|-------|-------|-------------|
| `shader` | 8 | Create, edit, validate .gdshader. 8 templates (water, dissolve, outline, toon, hologram, pixelation, wind, glow). ShaderMaterial management. |
| `animation` | 10 | Animations, AnimationTree state machines, blend trees, transitions, tween builder, spritesheet animation. |
| `physics` | 8 | Collision shapes, bodies, areas, raycasts, joints, navigation, physics materials, layers. |
| `ui` | 8 | Control layouts, themes, containers, anchors, RichTextLabel BBCode, popups, gamepad focus chains. |
| `audio` | 5 | Stream players, bus layout, effects, audio pools, spatial 3D audio. |
| `tilemap` | 6 | Tilesets, tile config, painting, autotile, layers, procedural generation. |
| `three_d` | 7 | Procedural meshes, materials, environment/sky, camera rigs, lights, LOD, import config. |
| `ai_behavior` | 6 | State machines, behavior trees, dialogue trees, pathfinding, steering behaviors, spawn systems. |
| `debug` | 7 | Screenshots, runtime inspection, performance metrics, input injection. (Requires editor plugin) |
| `project_mgmt` | 6 | Input map, autoloads, export presets, settings, groups, class reference. |
| `refactor` | 5 | Find unused, rename symbols, extract/inline scenes, dependency graph. |

### Guided Workflows (8 prompts)

- `new_game_setup` — Scaffold a complete game project
- `player_controller` — Generate 2D/3D player controllers
- `enemy_ai` — Build enemies with state machine AI
- `ui_screen` — Design complete UI screens
- `shader_from_effect` — Describe an effect, get a shader
- `level_from_description` — Natural language to scene structure
- `debug_performance` — Guided performance investigation
- `refactor_scene` — Scene analysis and cleanup

## Editor Plugin

Install the Godot plugin for live editor integration:

1. Copy `godot-plugin/addons/godot_forge/` to your project's `addons/` directory
2. Enable in Project > Project Settings > Plugins
3. The plugin opens a WebSocket server on `localhost:6100`
4. The MCP server auto-connects when available

The plugin enables:
- Live scene tree inspection
- Node property get/set with undo/redo
- Viewport screenshots
- Performance metrics
- Input injection for testing

## Configuration

```bash
# CLI flags
npx godot-forge-mcp --project /path/to/project  # Project root
npx godot-forge-mcp --godot /path/to/godot       # Godot binary
npx godot-forge-mcp --port 6100                   # Plugin WebSocket port
npx godot-forge-mcp --no-connect                  # Skip plugin auto-connection

# Environment variables
GODOT_PROJECT=/path/to/project
GODOT_BINARY=/path/to/godot
GODOT_FORGE_PORT=6100
```

## Resources

The server exposes MCP Resources for read-only data access:

| URI | Description |
|-----|-------------|
| `godot://project/info` | Project metadata |
| `godot://project/structure` | File tree by category |
| `godot://input_map` | Input actions and bindings |
| `godot://autoloads` | Autoload singletons |
| `godot://scene/{path}` | Parsed scene data |

## Tech Stack

- TypeScript + `@modelcontextprotocol/sdk`
- Custom TSCN/TRES parser with round-trip fidelity
- Godot Variant type serializer (19 types)
- GDScript analyzer (class info, signals, exports, methods)
- GDShader parser + 8 production shader templates
- WebSocket bridge for editor plugin communication

## License

MIT
