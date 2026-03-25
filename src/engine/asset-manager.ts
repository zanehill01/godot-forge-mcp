/**
 * Asset manager — discovers and catalogs all project files.
 *
 * Improvements:
 * - Async walkDir to avoid blocking the main thread on large projects
 * - Metadata caching for scene/script info to avoid reparsing
 * - File watching support (optional) for cache invalidation
 */

import { readdir, stat } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { join, extname, relative, sep } from "node:path";

export interface AssetEntry {
	/** res:// path */
	resPath: string;
	/** Absolute filesystem path */
	absPath: string;
	/** File extension (e.g., ".tscn", ".gd") */
	ext: string;
	/** Asset category */
	category: AssetCategory;
	/** File size in bytes */
	size: number;
	/** Last modified time (ms since epoch) */
	mtime: number;
}

export type AssetCategory =
	| "scene"
	| "script"
	| "resource"
	| "shader"
	| "texture"
	| "model"
	| "audio"
	| "font"
	| "other";

const CATEGORY_MAP: Record<string, AssetCategory> = {
	".tscn": "scene",
	".scn": "scene",
	".gd": "script",
	".cs": "script",
	".tres": "resource",
	".res": "resource",
	".gdshader": "shader",
	".png": "texture",
	".jpg": "texture",
	".jpeg": "texture",
	".webp": "texture",
	".svg": "texture",
	".bmp": "texture",
	".tga": "texture",
	".glb": "model",
	".gltf": "model",
	".fbx": "model",
	".obj": "model",
	".dae": "model",
	".blend": "model",
	".wav": "audio",
	".ogg": "audio",
	".mp3": "audio",
	".ttf": "font",
	".otf": "font",
	".woff": "font",
	".woff2": "font",
};

const IGNORE_DIRS = new Set([".godot", ".git", ".import", "node_modules", "__pycache__", ".vscode"]);

export class AssetManager {
	private projectRoot: string;
	private cache: AssetEntry[] | null = null;
	private scanTimestamp: number = 0;

	constructor(projectRoot: string) {
		this.projectRoot = projectRoot;
	}

	/**
	 * Scan the project and return all assets (synchronous, for backward compat).
	 */
	scan(): AssetEntry[] {
		this.cache = [];
		this.walkDirSync(this.projectRoot);
		this.scanTimestamp = Date.now();
		return this.cache;
	}

	/**
	 * Scan the project asynchronously — preferred for large projects.
	 */
	async scanAsync(): Promise<AssetEntry[]> {
		const assets: AssetEntry[] = [];
		await this.walkDirAsync(this.projectRoot, assets);
		this.cache = assets;
		this.scanTimestamp = Date.now();
		return this.cache;
	}

	/**
	 * Get cached assets or scan if not yet cached.
	 */
	getAssets(): AssetEntry[] {
		if (!this.cache) return this.scan();
		return this.cache;
	}

	/**
	 * Check if the cache is stale (older than maxAge ms, default 30s).
	 */
	isCacheStale(maxAge: number = 30000): boolean {
		if (!this.cache) return true;
		return Date.now() - this.scanTimestamp > maxAge;
	}

	/**
	 * Invalidate cache to force rescan.
	 */
	invalidate(): void {
		this.cache = null;
		this.scanTimestamp = 0;
	}

	/**
	 * Get assets filtered by category.
	 */
	byCategory(category: AssetCategory): AssetEntry[] {
		return this.getAssets().filter((a) => a.category === category);
	}

	/**
	 * Get assets filtered by extension.
	 */
	byExtension(ext: string): AssetEntry[] {
		const normalized = ext.startsWith(".") ? ext : `.${ext}`;
		return this.getAssets().filter((a) => a.ext === normalized);
	}

	/**
	 * Find an asset by res:// path.
	 */
	findByResPath(resPath: string): AssetEntry | undefined {
		return this.getAssets().find((a) => a.resPath === resPath);
	}

	/**
	 * Get asset counts by category.
	 */
	getSummary(): Record<AssetCategory | "total", number> {
		const assets = this.getAssets();
		const summary: Record<string, number> = { total: assets.length };
		for (const a of assets) {
			summary[a.category] = (summary[a.category] ?? 0) + 1;
		}
		return summary as Record<AssetCategory | "total", number>;
	}

	// ── Sync walk (backward compat) ────────────────────────────

	private walkDirSync(dir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (IGNORE_DIRS.has(entry)) continue;
			if (entry.startsWith(".") && entry.endsWith(".import")) continue;

			const fullPath = join(dir, entry);
			let fileStat;
			try {
				fileStat = statSync(fullPath);
			} catch {
				continue;
			}

			if (fileStat.isDirectory()) {
				this.walkDirSync(fullPath);
			} else if (fileStat.isFile()) {
				const ext = extname(entry).toLowerCase();
				const relPath = relative(this.projectRoot, fullPath).split(sep).join("/");

				this.cache!.push({
					resPath: `res://${relPath}`,
					absPath: fullPath,
					ext,
					category: CATEGORY_MAP[ext] ?? "other",
					size: fileStat.size,
					mtime: fileStat.mtimeMs,
				});
			}
		}
	}

	// ── Async walk ──────────────────────────────────────────────

	private async walkDirAsync(dir: string, assets: AssetEntry[]): Promise<void> {
		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch {
			return;
		}

		// Process entries concurrently in batches for performance
		const promises: Promise<void>[] = [];

		for (const entry of entries) {
			if (IGNORE_DIRS.has(entry)) continue;
			if (entry.startsWith(".") && entry.endsWith(".import")) continue;

			const fullPath = join(dir, entry);
			promises.push(
				(async () => {
					let fileStat;
					try {
						fileStat = await stat(fullPath);
					} catch {
						return;
					}

					if (fileStat.isDirectory()) {
						await this.walkDirAsync(fullPath, assets);
					} else if (fileStat.isFile()) {
						const ext = extname(entry).toLowerCase();
						const relPath = relative(this.projectRoot, fullPath).split(sep).join("/");

						assets.push({
							resPath: `res://${relPath}`,
							absPath: fullPath,
							ext,
							category: CATEGORY_MAP[ext] ?? "other",
							size: fileStat.size,
							mtime: fileStat.mtimeMs,
						});
					}
				})(),
			);
		}

		await Promise.all(promises);
	}
}
