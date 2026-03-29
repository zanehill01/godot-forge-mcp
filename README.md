# Godot Forge MCP

The most comprehensive MCP server for Godot 4.x game development. 21 smart tools covering 130+ actions, 5 bridges, LSP + DAP integration, CC0 asset library, roguelike systems scaffolding, and platform-aware auto-detection.

Not a tool collection — a game development partner.

## Quick Start

```bash
# With Claude Code — auto-detects Godot binary
claude mcp add godot-forge -- npx godot-forge-mcp --project /path/to/your/godot/project

# Explicit Godot binary path
claude mcp add godot-forge -- npx godot-forge-mcp --project /path/to/project --godot /path/to/godot

# Or run directly
npx godot-forge-mcp --project /path/to/your/godot/project
```

The server automatically scans common Godot install locations across Windows, macOS, and Linux (including Steam, Scoop, Homebrew, Flatpak, Snap, and common download folders).

## Architecture

```
Claude / AI Client
        │ MCP Protocol (stdio)
        ▼
godot-forge-mcp v0.5.0 (TypeScript)
  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
  │   File   │ │   CLI    │ │  Socket  │ │   LSP    │ │   DAP    │
  │  Engine  │ │  Bridge  │ │  Bridge  │ │  Client  │ │  Client  │
  │ .tscn/.gd│ │ headless │ │ WebSocket│ │ GDScript │ │ debugger │
  │parse/wrt │ │ Godot    │ �� editor   │ │ lang srv │ │ adapter  │
  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
       │            │            │            │            │
       ▼            ▼            ▼            ▼            ▼
  Project      Godot 4.x    Editor      LSP :6005     DAP :6006
  files        CLI           Plugin
```

**Five-layer graceful degradation:**
- **File Engine** — Always works. Parses/writes .tscn, .tres, .gd, .gdshader, .gdextension directly.
- **CLI Bridge** — Works when Godot binary is available. Headless execution, screenshots, validation, export.
- **Socket Bridge** — Works when editor plugin is active. Real-time inspection, undo/redo, input injection.
- **LSP Client** — Works when Godot editor is running. GDScript diagnostics, completions, hover, go-to-definition.
- **DAP Client** — Works when debugging. Breakpoints, stepping, stack traces, variable inspection, expression evaluation.

## Tools (21 tools, 130+ actions)

Each tool covers a domain and accepts an `action` parameter. The LLM picks the domain, then specifies the action — dramatically reducing context window overhead vs. individual tools.

### Core (always available)

| Tool | Actions | What It Does |
|------|---------|-------------|
| `godot_discover` | 7 | Project info, list scenes/scripts/resources/assets, full-text search, catalog |
| `godot_scene` | 8 | Read/create scenes, add/modify/remove nodes, signals, scene instancing |
| `godot_script` | 3 | Read/write/analyze GDScript (extracts signals, exports, methods, enums, annotations) |
| `godot_execute` | 6 | Run project, stop, get debug output, execute GDScript headlessly, launch editor, get version |

### On-Demand Groups (activate via `godot_discover(action: "catalog", activate: "group_name")`)

| Tool | Group Name | Actions | What It Does |
|------|-----------|---------|-------------|
| `godot_3d` | `three_d` | 16 | Meshes, models (.glb), materials, environment (sky/fog/tonemap/SSAO/glow), particles (8 presets), lights, cameras, GI probes, fog volumes, decals, Path3D, GridMap, MultiMesh, composite bodies, occluders, import config |
| `godot_shader` | `shader` | 8 | Create/read/edit .gdshader, ShaderMaterial, shader params, validation, 8 templates (water, dissolve, outline, toon, hologram, pixelation, wind, glow) |
| `godot_physics` | `physics` | 8 | Collision shapes, physics bodies, areas, raycasts, joints, navigation, physics materials, layer management |
| `godot_game` | `game_essentials` | 12 | SpriteFrames, input binding (keys/gamepad/mouse), Camera2D, scene validation, Curve, Gradient, AudioBusLayout, parallax backgrounds, 2D lights, StyleBox, multiplayer nodes, project integrity checker |
| `godot_intelligence` | `intelligence` | 10 | LSP: connect, diagnostics, symbols, completions, hover, definition. DAP: connect, breakpoints, stepping, variable/stack inspection |
| `godot_standards` | `godot_standards` | 14 | UID management, export presets, CI/CD generation, GDExtension, plugin scaffolding, project linting, test frameworks (GUT/GdUnit4), .gitignore/.gitattributes, resource analysis |
| `godot_debug` | `debug` | 9 | Screenshots (plugin + CLI fallback), performance metrics, scene tree inspection, node inspection, property setting with undo, input injection, editor state, **state save/restore snapshots** |
| `godot_animation` | `animation` | 8 | Create Animation .tres, AnimationTree, list/inspect animations, add state machine states, add transitions, blend spaces (1D/2D), tween chain generation |
| `godot_audio` | `audio` | 5 | AudioStreamPlayer nodes (2D/3D), spatial audio, AudioBusLayout resources, runtime audio effects, audio pools with randomized pitch/volume |
| `godot_ui` | `ui` | 5 | Control layouts, themes, anchor presets, popup dialogs, focus chains |
| `godot_ai` | `ai_behavior` | 7 | State machines, behavior trees, dialogue trees, pathfinding (2D/3D), steering behaviors, spawn systems (wave/pool/random), **Director system** (RoR2-style time-based difficulty + spawn budgeting) |
| `godot_roguelike` | `roguelike` | 7 | Item resources (rarity/stacking/proc coefficient), loot tables (weighted random), inventory component, proc chain manager (on-hit/on-kill/on-crit with depth limiting), reusable components (health/hitbox/hurtbox/status effect/knockback), global event bus, stage chunk templates with spawn markers |
| `godot_assets` | `assets` | 6 | **CC0 Asset Library** — search/browse/download HDRIs, PBR textures, and 3D models from Poly Haven; browse Kenney game asset packs. All assets are public domain. |
| `godot_project` | `project_mgmt` | 5 | Input map, autoloads, project settings, node groups, class reference |
| `godot_refactor` | `refactor` | 3 | Find unused assets, rename symbols across files, dependency graph |
| `godot_tilemap` | `tilemap` | 2 | TileMapLayer nodes (4.3+ API), tile painting |

### CC0 Asset Library (godot_assets)

Download free, public domain assets directly into your project for rapid prototyping:

| Action | Source | What It Does |
|--------|--------|-------------|
| `search` | Poly Haven | Search HDRIs, textures, and 3D models by keyword |
| `browse` | Poly Haven | Browse by category (outdoor, indoor, nature, urban, etc.) with popularity sorting |
| `download_hdri` | Poly Haven | Download HDR/EXR skies at 1k/2k/4k resolution |
| `download_texture` | Poly Haven | Download full PBR texture sets (diffuse, normal, roughness, displacement, ARM) |
| `download_model` | Poly Haven | Download 3D models in glTF/FBX format with associated textures |
| `kenney` | Kenney.nl | Browse 12+ curated game asset packs (nature, dungeon, weapons, UI, characters, etc.) |

### Roguelike Systems (godot_roguelike)

Purpose-built for 3D roguelike development (Risk of Rain 2-style games):

| Action | What It Generates |
|--------|-------------------|
| `item_resource` | `ItemData` Resource class — rarity tiers (Common → Void), stacking, proc coefficients, item tags, economy |
| `loot_table` | `LootTable` Resource — weighted random rolls, unique rolls, filter by rarity/tag + `LootEntry` resource |
| `inventory` | `Inventory` component — item stacking, slot limits, add/remove/query, full signal coverage |
| `proc_chain` | `ProcChainManager` — on-hit/on-kill/on-crit/on-damaged event system with `DamageInfo`, proc depth limiting (max 5), crit processing, diminishing chain coefficients |
| `component` | 5 reusable components: **HealthComponent** (HP/shield/barrier/armor with regen), **HitboxComponent** (Area3D with team filtering), **HurtboxComponent** (receives hits, forwards to health), **StatusEffectManager** (buff/debuff stacking, tick damage, stun/slow), **KnockbackComponent** (impulse with decay) |
| `event_bus` | Global signal bus autoload — 12 roguelike signals (enemy_killed, item_picked_up, damage_dealt, difficulty_changed, etc.) |
| `stage_chunk` | Stage chunk .tscn + script — typed spawn markers (enemy/chest/shrine), cardinal connection points for procedural assembly, NavigationRegion3D |

### AI & Behavior (godot_ai)

All actions default to 3D (CharacterBody3D, Vector3, Node3D). Set `is3d: false` for 2D variants.

| Action | What It Generates |
|--------|-------------------|
| `state_machine` | Finite state machine GDScript with enum states, enter/exit callbacks, change_state() |
| `behavior_tree` | Behavior tree skeleton — BTSelector, BTSequence, BTAction, BTCondition nodes |
| `dialogue` | Branching dialogue data (JSON) + DialogueReader script with signals |
| `pathfinding` | NavigationAgent3D/2D setup with velocity-based following |
| `steering` | Steering behaviors: seek, flee, arrive, pursue, evade, wander, flock |
| `spawn` | Spawner patterns: wave (sequential), pool (object pooling), random (timer-based) |
| `director` | **RoR2-style Director** — time-based difficulty coefficient, credit budget accumulation, weighted enemy spawning from cost-gated pool, difficulty labels (Easy → HAHAHAHA) |

### Debug & Inspection (godot_debug)

Works with or without the editor plugin — gracefully degrades to CLI/file-based fallbacks:

| Action | Plugin Mode | CLI/File Fallback |
|--------|------------|-------------------|
| `screenshot` | Captures live viewport | Renders one frame via `--headless` |
| `scene_tree` | Live scene tree from editor/running game | Parses .tscn files |
| `inspect_node` | Live node property inspection | Reads node from .tscn |
| `input` | Injects events into running game | Generates GDScript input code |
| `save_state` | — | Serializes scene to JSON snapshot |
| `load_state` | — | Restores scene from JSON snapshot |
| `performance` | Real-time FPS/memory/render metrics | Requires plugin |
| `set_property` | Sets property with undo/redo | Requires plugin |
| `editor_state` | Open scenes, selected nodes, active script | Requires plugin |

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
npx godot-forge-mcp --project /path/to/project  # Project root (required)
npx godot-forge-mcp --godot /path/to/godot       # Godot binary (auto-detected if omitted)
npx godot-forge-mcp --port 6100                   # Plugin WebSocket port
npx godot-forge-mcp --no-connect                  # Skip plugin auto-connection

# Environment variables (alternative to CLI flags)
GODOT_PROJECT=/path/to/project
GODOT_BINARY=/path/to/godot
GODOT_FORGE_PORT=6100
```

### Auto-Detection

When `--godot` is not provided, the server automatically scans:

| Platform | Locations Checked |
|----------|-------------------|
| **Windows** | Program Files, LocalAppData, Scoop, Steam, Desktop, Downloads |
| **macOS** | Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`), `/Applications/*.app`, Steam |
| **Linux** | `/usr/bin`, `/usr/local/bin`, Flatpak, Snap, Steam, `~/Applications`, Desktop, Downloads |
| **All** | `PATH` lookup (`godot`, `godot4`, `Godot_v4`) |

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
- Poly Haven API integration for CC0 assets
- 139 tests across 16 test files

## License

MIT
