/**
 * Asset manager — discovers and catalogs all project files.
 */

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

const IGNORE_DIRS = new Set([".godot", ".git", ".import", "node_modules", "__pycache__"]);

export class AssetManager {
	private projectRoot: string;
	private cache: AssetEntry[] | null = null;

	constructor(projectRoot: string) {
		this.projectRoot = projectRoot;
	}

	/**
	 * Scan the project and return all assets.
	 */
	scan(): AssetEntry[] {
		this.cache = [];
		this.walkDir(this.projectRoot);
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
	 * Invalidate cache to force rescan.
	 */
	invalidate(): void {
		this.cache = null;
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

	private walkDir(dir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (IGNORE_DIRS.has(entry)) continue;
			if (entry.endsWith(".import")) continue; // Skip .import metadata files

			const fullPath = join(dir, entry);
			let stat;
			try {
				stat = statSync(fullPath);
			} catch {
				continue;
			}

			if (stat.isDirectory()) {
				this.walkDir(fullPath);
			} else if (stat.isFile()) {
				const ext = extname(entry).toLowerCase();
				const relPath = relative(this.projectRoot, fullPath).split(sep).join("/");

				this.cache!.push({
					resPath: `res://${relPath}`,
					absPath: fullPath,
					ext,
					category: CATEGORY_MAP[ext] ?? "other",
					size: stat.size,
				});
			}
		}
	}
}
