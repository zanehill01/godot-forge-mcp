/**
 * Tests for asset manager.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AssetManager } from "../asset-manager.js";
import { resolve } from "node:path";

// Use the test fixtures directory
const FIXTURES_ROOT = resolve(__dirname, "../../../test/fixtures/minimal-project");

describe("AssetManager", () => {
	let manager: AssetManager;

	beforeEach(() => {
		manager = new AssetManager(FIXTURES_ROOT);
	});

	it("scans project files", () => {
		const assets = manager.scan();
		expect(assets.length).toBeGreaterThan(0);
	});

	it("caches scan results", () => {
		const first = manager.getAssets();
		const second = manager.getAssets();
		expect(first).toBe(second); // same reference = cached
	});

	it("invalidates cache", () => {
		const first = manager.getAssets();
		manager.invalidate();
		const second = manager.getAssets();
		expect(first).not.toBe(second); // different reference after invalidation
	});

	it("filters by category", () => {
		manager.scan();
		const scenes = manager.byCategory("scene");
		for (const s of scenes) {
			expect(s.ext).toMatch(/\.(tscn|scn)$/);
		}
	});

	it("filters by extension", () => {
		manager.scan();
		const gdScripts = manager.byExtension(".gd");
		for (const s of gdScripts) {
			expect(s.ext).toBe(".gd");
		}
	});

	it("finds by res:// path", () => {
		manager.scan();
		const scenes = manager.byCategory("scene");
		if (scenes.length > 0) {
			const found = manager.findByResPath(scenes[0].resPath);
			expect(found).toBeDefined();
			expect(found!.resPath).toBe(scenes[0].resPath);
		}
	});

	it("tracks file modification times", () => {
		const assets = manager.scan();
		for (const a of assets) {
			expect(a.mtime).toBeGreaterThan(0);
		}
	});

	it("provides summary", () => {
		manager.scan();
		const summary = manager.getSummary();
		expect(summary.total).toBeGreaterThan(0);
	});

	it("reports cache staleness", () => {
		expect(manager.isCacheStale()).toBe(true); // no cache yet
		manager.scan();
		expect(manager.isCacheStale()).toBe(false); // just scanned, default 30s maxAge
		// After invalidation, cache is stale again
		manager.invalidate();
		expect(manager.isCacheStale()).toBe(true);
	});

	it("supports async scan", async () => {
		const assets = await manager.scanAsync();
		expect(assets.length).toBeGreaterThan(0);
		// Results should be consistent with sync scan
		const syncAssets = new AssetManager(FIXTURES_ROOT).scan();
		expect(assets.length).toBe(syncAssets.length);
	});
});
