/**
 * Asset Library Tool Group — CC0 asset integration for rapid prototyping.
 *
 * Integrates with free CC0 asset sources:
 * - Poly Haven: HDRIs, textures, 3D models (polyhaven.com/api)
 * - Kenney: Game assets (kenney.nl)
 * - Ambient CG: PBR materials (ambientcg.com/api)
 *
 * All downloaded assets are CC0 (public domain) — safe for any project.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resToAbsolute } from "../../utils/path.js";
import type { ToolContext } from "../registry.js";

const POLYHAVEN_API = "https://api.polyhaven.com";

async function fetchJson(url: string): Promise<unknown> {
	const resp = await fetch(url);
	if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
	return resp.json();
}

async function downloadFile(url: string, destPath: string): Promise<void> {
	const resp = await fetch(url);
	if (!resp.ok) throw new Error(`Download failed (${resp.status}): ${url}`);
	const buffer = Buffer.from(await resp.arrayBuffer());
	mkdirSync(dirname(destPath), { recursive: true });
	writeFileSync(destPath, buffer);
}

export function registerAssetTools(server: McpServer, ctx: ToolContext): void {
	server.tool(
		"godot_assets",
		`CC0 asset library for rapid prototyping. All assets are public domain (CC0).

Actions:

• search — Search for free CC0 assets across Poly Haven.
    query (required), assetType (hdris|textures|models), limit (default 10)

• download_hdri — Download an HDRI sky from Poly Haven.
    assetId (required), resolution (1k|2k|4k, default 1k), outputDir (default res://assets/hdri/)

• download_texture — Download a PBR texture set from Poly Haven.
    assetId (required), resolution (1k|2k|4k, default 1k), outputDir (default res://assets/textures/)
    Downloads: diffuse, normal, roughness, displacement, arm (ambient/roughness/metallic)

• download_model — Download a 3D model from Poly Haven.
    assetId (required), format (gltf|fbx, default gltf), resolution (1k|2k, default 1k), outputDir (default res://assets/models/)

• browse — Browse asset categories from Poly Haven. Returns popular assets.
    assetType (required: hdris|textures|models), category? (e.g., "outdoor", "indoor", "nature", "urban")

• kenney — List or download Kenney game asset packs.
    action (list|info), packName? (for info)`,
		{
			action: z.enum(["search", "download_hdri", "download_texture", "download_model", "browse", "kenney"]),
			query: z.string().optional().describe("Search query for assets"),
			assetId: z.string().optional().describe("Poly Haven asset ID (from search/browse results)"),
			assetType: z.enum(["hdris", "textures", "models"]).optional().describe("Asset category"),
			resolution: z.enum(["1k", "2k", "4k"]).optional().default("1k"),
			format: z.enum(["gltf", "fbx"]).optional().default("gltf"),
			outputDir: z.string().optional().describe("Output directory (res://)"),
			category: z.string().optional().describe("Filter by category"),
			packName: z.string().optional().describe("Kenney pack name"),
			limit: z.number().optional().default(10),
		},
		async (args) => {
			try {
				switch (args.action) {
					// ── search ─────────────────────────────────────────────
					case "search": {
						if (!args.query) return { content: [{ type: "text" as const, text: "query required" }], isError: true };
						const type = args.assetType ?? "textures";
						const data = await fetchJson(`${POLYHAVEN_API}/assets?t=${type}`) as Record<string, { name: string; categories: string[]; tags: string[]; download_count: number }>;

						const query = args.query.toLowerCase();
						const results = Object.entries(data)
							.filter(([id, asset]) =>
								id.includes(query) ||
								asset.name?.toLowerCase().includes(query) ||
								asset.tags?.some((t: string) => t.includes(query)) ||
								asset.categories?.some((c: string) => c.includes(query))
							)
							.sort((a, b) => (b[1].download_count ?? 0) - (a[1].download_count ?? 0))
							.slice(0, args.limit ?? 10)
							.map(([id, asset]) => ({
								id,
								name: asset.name,
								categories: asset.categories,
								tags: asset.tags?.slice(0, 5),
								downloads: asset.download_count,
							}));

						if (results.length === 0) {
							return { content: [{ type: "text" as const, text: `No ${type} found matching "${args.query}". Try broader terms or browse categories.` }] };
						}

						return { content: [{ type: "text" as const, text: `Found ${results.length} ${type} matching "${args.query}":\n\n${JSON.stringify(results, null, 2)}\n\nUse download_hdri/download_texture/download_model with the asset id to download.` }] };
					}

					// ── download_hdri ───────��──────────────────────────────
					case "download_hdri": {
						if (!args.assetId) return { content: [{ type: "text" as const, text: "assetId required" }], isError: true };
						const res = args.resolution ?? "1k";
						const data = await fetchJson(`${POLYHAVEN_API}/files/${args.assetId}`) as Record<string, Record<string, Record<string, { url: string }>>>;

						const hdriData = data?.hdri;
						if (!hdriData?.[res]?.hdr?.url) {
							// Try exr format
							const exrUrl = hdriData?.[res]?.exr?.url;
							if (!exrUrl) return { content: [{ type: "text" as const, text: `HDRI "${args.assetId}" not found at ${res} resolution. Try a different resolution.` }], isError: true };
						}

						const url = hdriData?.[res]?.hdr?.url ?? hdriData?.[res]?.exr?.url;
						if (!url) return { content: [{ type: "text" as const, text: `No download URL found for ${args.assetId}` }], isError: true };

						const ext = url.includes(".exr") ? "exr" : "hdr";
						const outDir = args.outputDir ?? "res://assets/hdri/";
						const outPath = `${outDir}${args.assetId}_${res}.${ext}`;
						const absPath = resToAbsolute(outPath, ctx.projectRoot);

						await downloadFile(url, absPath);
						return { content: [{ type: "text" as const, text: `Downloaded HDRI "${args.assetId}" (${res}) → ${outPath}\n\nUse with godot_3d environment action:\ngodot_3d(action: "environment", scenePath: "...", sky: {type: "panorama"})` }] };
					}

					// ── download_texture ────���──────────────────────────────
					case "download_texture": {
						if (!args.assetId) return { content: [{ type: "text" as const, text: "assetId required" }], isError: true };
						const res = args.resolution ?? "1k";
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const data = await fetchJson(`${POLYHAVEN_API}/files/${args.assetId}`) as any;

						// Poly Haven textures have maps: Diffuse, nor_gl, rough, disp, arm
						const maps: Record<string, string> = {};
						const mapTypes = ["Diffuse", "nor_gl", "rough", "disp", "arm"];
						const outDir = args.outputDir ?? `res://assets/textures/${args.assetId}/`;
						const downloaded: string[] = [];

						for (const mapType of mapTypes) {
							const url: string | undefined = data?.[mapType]?.[res]?.jpg?.url ?? data?.[mapType]?.[res]?.png?.url;
							if (url) {
								const ext = url.includes(".png") ? "png" : "jpg";
								const filename = `${args.assetId}_${mapType.toLowerCase()}_${res}.${ext}`;
								const outPath = `${outDir}${filename}`;
								const absPath = resToAbsolute(outPath, ctx.projectRoot);
								await downloadFile(url, absPath);
								maps[mapType] = outPath;
								downloaded.push(`  ${mapType} → ${outPath}`);
							}
						}

						if (downloaded.length === 0) {
							return { content: [{ type: "text" as const, text: `No texture maps found for "${args.assetId}" at ${res}. Check the asset ID.` }], isError: true };
						}

						return { content: [{ type: "text" as const, text: `Downloaded ${downloaded.length} texture maps for "${args.assetId}" (${res}):\n${downloaded.join("\n")}\n\nUse with godot_3d material action:\ngodot_3d(action: "material", path: "res://materials/${args.assetId}.tres", albedoTexture: "${maps.Diffuse ?? ""}", normalTexture: "${maps.nor_gl ?? ""}")` }] };
					}

					// ── download_model ──���──────────────────────────────────
					case "download_model": {
						if (!args.assetId) return { content: [{ type: "text" as const, text: "assetId required" }], isError: true };
						const res = args.resolution ?? "1k";
						const fmt = args.format ?? "gltf";
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const data = await fetchJson(`${POLYHAVEN_API}/files/${args.assetId}`) as any;

						const modelData = data?.[fmt];
						const modelRes = modelData?.[res] ?? modelData?.["1k"];
						const glbUrl: string | undefined = modelRes?.[fmt]?.url ?? modelRes?.gltf?.url;

						if (!glbUrl) {
							return { content: [{ type: "text" as const, text: `Model "${args.assetId}" not found in ${fmt} format at ${res}. Try format: "gltf" or a different resolution.` }], isError: true };
						}

						const outDir = args.outputDir ?? "res://assets/models/";
						const ext = fmt === "gltf" ? "glb" : "fbx";
						const outPath = `${outDir}${args.assetId}.${ext}`;
						const absPath = resToAbsolute(outPath, ctx.projectRoot);

						await downloadFile(glbUrl, absPath);

						// Download associated textures if included
						const includes = modelRes?.[fmt]?.include as Record<string, { url: string }> | undefined;
						let extraFiles = 0;
						if (includes && typeof includes === "object") {
							for (const [filename, fileData] of Object.entries(includes)) {
								if (fileData?.url) {
									const texPath = resToAbsolute(`${outDir}${filename}`, ctx.projectRoot);
									try {
										await downloadFile(fileData.url, texPath);
										extraFiles++;
									} catch { /* skip optional textures */ }
								}
							}
						}

						return { content: [{ type: "text" as const, text: `Downloaded model "${args.assetId}" → ${outPath}${extraFiles > 0 ? ` (+ ${extraFiles} texture files)` : ""}\n\nUse with godot_3d:\ngodot_3d(action: "add_model", scenePath: "...", modelPath: "${outPath}", name: "${args.assetId}")` }] };
					}

					// ── browse ─────────────────────────────────────────────
					case "browse": {
						if (!args.assetType) return { content: [{ type: "text" as const, text: "assetType required" }], isError: true };
						let url = `${POLYHAVEN_API}/assets?t=${args.assetType}`;
						if (args.category) url += `&c=${args.category}`;

						const data = await fetchJson(url) as Record<string, { name: string; categories: string[]; download_count: number }>;
						const sorted = Object.entries(data)
							.sort((a, b) => (b[1].download_count ?? 0) - (a[1].download_count ?? 0))
							.slice(0, args.limit ?? 10)
							.map(([id, asset]) => ({
								id,
								name: asset.name,
								categories: asset.categories,
								downloads: asset.download_count,
							}));

						// Get available categories
						const allCategories = new Set<string>();
						for (const [, asset] of Object.entries(data).slice(0, 100)) {
							if (asset.categories) {
								for (const c of asset.categories) allCategories.add(c);
							}
						}

						return { content: [{ type: "text" as const, text: `Top ${sorted.length} ${args.assetType}${args.category ? ` in "${args.category}"` : ""}:\n\n${JSON.stringify(sorted, null, 2)}\n\nCategories available: ${Array.from(allCategories).sort().join(", ")}` }] };
					}

					// ── kenney ─────────────────────────────────────────────
					case "kenney": {
						// Kenney doesn't have a public API, so provide curated list of popular packs
						const packs: Record<string, { name: string; url: string; description: string; assetCount: number }> = {
							"kenney-nature-kit": { name: "Nature Kit", url: "https://kenney.nl/assets/nature-kit", description: "Low-poly nature assets: trees, rocks, grass, flowers", assetCount: 52 },
							"kenney-city-kit": { name: "City Kit (Suburban)", url: "https://kenney.nl/assets/city-kit-suburban", description: "Suburban buildings, roads, vehicles, props", assetCount: 52 },
							"kenney-space-kit": { name: "Space Kit", url: "https://kenney.nl/assets/space-kit", description: "Spaceships, stations, asteroids, planets", assetCount: 73 },
							"kenney-dungeon-kit": { name: "Dungeon Kit", url: "https://kenney.nl/assets/dungeon-kit", description: "Dungeon rooms, walls, floors, props, characters", assetCount: 57 },
							"kenney-mini-dungeon": { name: "Mini Dungeon", url: "https://kenney.nl/assets/mini-dungeon", description: "Tiny dungeon tileset with characters and items", assetCount: 130 },
							"kenney-platformer-kit": { name: "Platformer Kit", url: "https://kenney.nl/assets/platformer-kit", description: "3D platformer blocks, ramps, obstacles", assetCount: 50 },
							"kenney-modular-characters": { name: "Modular Characters", url: "https://kenney.nl/assets/modular-characters", description: "Mix-and-match character parts", assetCount: 192 },
							"kenney-weapon-pack": { name: "Weapon Pack", url: "https://kenney.nl/assets/weapon-pack", description: "Swords, axes, bows, staffs, shields", assetCount: 70 },
							"kenney-particle-pack": { name: "Particle Pack", url: "https://kenney.nl/assets/particle-pack", description: "Fire, smoke, sparkles, explosions textures", assetCount: 64 },
							"kenney-ui-pack": { name: "UI Pack", url: "https://kenney.nl/assets/ui-pack", description: "Buttons, panels, sliders, icons for game UI", assetCount: 288 },
							"kenney-game-icons": { name: "Game Icons", url: "https://kenney.nl/assets/game-icons", description: "Flat game icons for inventory, skills, items", assetCount: 232 },
							"kenney-voxel-pack": { name: "Voxel Pack", url: "https://kenney.nl/assets/voxel-pack", description: "Voxel-style 3D models: characters, blocks, items", assetCount: 66 },
						};

						if (args.packName) {
							const pack = packs[args.packName];
							if (!pack) {
								return { content: [{ type: "text" as const, text: `Pack "${args.packName}" not found. Use kenney action without packName to list all packs.` }], isError: true };
							}
							return { content: [{ type: "text" as const, text: `${pack.name}\n${pack.description}\nAssets: ${pack.assetCount}\nDownload: ${pack.url}\n\nKenney assets are manually downloaded (no API). Visit the URL above, download the zip, and extract to your project's assets/ folder.` }] };
						}

						const list = Object.entries(packs).map(([id, p]) => `  ${id}: ${p.name} (${p.assetCount} assets) — ${p.description}`).join("\n");
						return { content: [{ type: "text" as const, text: `Kenney Asset Packs (all CC0, free):\n\n${list}\n\nUse kenney action with packName for details and download link.\nFor Poly Haven assets (auto-download), use search/download_hdri/download_texture/download_model actions.` }] };
					}

					default:
						return { content: [{ type: "text" as const, text: `Unknown action: ${args.action}` }], isError: true };
				}
			} catch (e) {
				return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);
}
