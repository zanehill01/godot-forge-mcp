/**
 * Tests for Godot UID generator.
 */

import { describe, it, expect } from "vitest";
import { generateUid, isValidUid } from "../uid.js";

describe("generateUid", () => {
	it("generates uid:// prefixed strings", () => {
		const uid = generateUid();
		expect(uid.startsWith("uid://")).toBe(true);
	});

	it("generates 13-char IDs after prefix", () => {
		const uid = generateUid();
		const id = uid.slice("uid://".length);
		expect(id.length).toBe(13);
	});

	it("generates unique UIDs", () => {
		const uids = new Set<string>();
		for (let i = 0; i < 1000; i++) {
			uids.add(generateUid());
		}
		expect(uids.size).toBe(1000);
	});

	it("only uses base62 characters", () => {
		const uid = generateUid();
		const id = uid.slice("uid://".length);
		expect(id).toMatch(/^[0-9a-z]+$/);
	});
});

describe("isValidUid", () => {
	it("validates correct UIDs", () => {
		expect(isValidUid("uid://cecaux1sm7mo0")).toBe(true);
		expect(isValidUid("uid://abc123def456g")).toBe(true);
	});

	it("rejects invalid UIDs", () => {
		expect(isValidUid("not-a-uid")).toBe(false);
		expect(isValidUid("uid://")).toBe(false);
		expect(isValidUid("uid://ABC")).toBe(false); // uppercase not in base62 charset
		expect(isValidUid("res://abc")).toBe(false);
	});
});
