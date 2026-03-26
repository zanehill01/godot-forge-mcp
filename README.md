# Godot Forge MCP

Intelligent MCP server for Godot 4.3+ game development. 17 smart tools covering 115 actions, 5 bridges, LSP + DAP integration.

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
godot-forge-mcp v0.3.0 (TypeScript)
  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
  │   File   │ │   CLI    │ │  Socket  │ │   LSP    │ │   DAP    │
  │  Engine  │ │  Bridge  │ │  Bridge  │ │  Client  │ │  Client  │
  │ .tscn/.gd│ │ headless │ │ WebSocket│ │ GDScript │ │ debugger │
  │parse/wrt │ │ Godot    │ │ editor   │ │ lang srv │ │ adapter  │
  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
       │            │            │            │            │
       ▼            ▼            ▼            ▼            ▼
  Project      Godot 4.3+   Editor      LSP :6005     DAP :6006
  files        CLI           Plugin
```

**Five-layer graceful degradation:**
- **File Engine** — Always works. Parses/writes .tscn, .tres, .gd, .gdshader, .gdextension directly.
- **CLI Bridge** — Works when Godot binary is available. Headless validation, export, script execution.
- **Socket Bridge** — Works when editor plugin is active. Real-time inspection, undo/redo, screenshots.
- **LSP Client** — Works when Godot editor is running. GDScript diagnostics, completions, hover, go-to-definition.
- **DAP Client** — Works when debugging. Breakpoints, stepping, stack traces, variable inspection, expression evaluation.

## Tools (17 tools, 115 actions)

Each tool covers a domain and accepts an `action` parameter. The LLM picks the domain, then specifies the action — dramatically reducing context window overhead vs. individual tools.

### Core (always available)

| Tool | Actions | What It Does |
|------|---------|-------------|
| `godot_discover` | 7 | Project info, list scenes/scripts/resources/assets, full-text search, catalog |
| `godot_scene` | 8 | Read/create scenes, add/modify/remove nodes, signals, scene instancing |
| `godot_script` | 3 | Read/write/analyze GDScript (extracts signals, exports, methods, enums, annotations) |
| `godot_execute` | 3 | Run project, stop project, execute GDScript headlessly |

### On-Demand Groups (activate via `godot_discover(action: "catalog", activate: "group_name")`)

| Tool | Group Name | Actions | What It Does |
|------|-----------|---------|-------------|
| `godot_3d` | `three_d` | 16 | Meshes, models (.glb), materials, environment (sky/fog/tonemap/SSAO/glow), particles (8 presets), lights, cameras, GI probes, fog volumes, decals, Path3D, GridMap, MultiMesh, composite bodies, occluders, import config |
| `godot_shader` | `shader` | 8 | Create/read/edit .gdshader, ShaderMaterial, shader params, validation, 8 templates (water, dissolve, outline, toon, hologram, pixelation, wind, glow) |
| `godot_physics` | `physics` | 8 | Collision shapes, physics bodies, areas, raycasts, joints, navigation, physics materials, layer management |
| `godot_game` | `game_essentials` | 12 | SpriteFrames, input binding (keys/gamepad/mouse), Camera2D, scene validation, Curve, Gradient, AudioBusLayout, parallax backgrounds, 2D lights, StyleBox, multiplayer nodes, project integrity checker |
| `godot_intelligence` | `intelligence` | 10 | LSP: connect, diagnostics, symbols, completions, hover, definition. DAP: connect, breakpoints, stepping, variable/stack inspection |
| `godot_standards` | `godot_standards` | 14 | UID management, export presets, CI/CD generation, GDExtension, plugin scaffolding, project linting, test frameworks (GUT/GdUnit4), .gitignore/.gitattributes, resource analysis |
| `godot_debug` | `debug` | 7 | Screenshots, performance metrics, scene tree, node properties, input injection, editor state (requires editor plugin) |
| `godot_ui` | `ui` | 5 | Control layouts, themes, anchor presets, popup dialogs, focus chains |
| `godot_animation` | `animation` | 4 | Create Animation .tres, AnimationTree, list/inspect animations |
| `godot_project` | `project_mgmt` | 5 | Input map, autoloads, project settings, node groups, class reference |
| `godot_refactor` | `refactor` | 3 | Find unused assets, rename symbols across files, dependency graph |
| `godot_audio` | `audio` | 2 | AudioStreamPlayer nodes (2D/3D), spatial audio |
| `godot_tilemap` | `tilemap` | 2 | TileMapLayer nodes (4.3+ API), tile painting |

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

MCP Resources for read-only data access:

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
- GDScript analyzer (class info, signals, exports, methods, enums, annotations, static vars, RPC)
- GDShader parser + 8 production shader templates
- 8 parsers: TSCN, project.godot, GDShader, .import, .gdextension, export_presets.cfg, plugin.cfg, .uid
- LSP client (JSON-RPC/TCP) for GDScript language server
- DAP client (DAP/TCP) for Godot debug adapter
- WebSocket bridge for editor plugin communication
- 139 tests across 16 test files

## License

MIT
