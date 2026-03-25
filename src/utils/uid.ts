/**
 * Godot UID generator.
 *
 * Godot 4.x uses uid:// URIs for resource identification.
 * Format: uid://<base62-encoded-random-id>
 */

const BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Generate a Godot-compatible UID.
 * Example output: "uid://cecaux1sm7mo0"
 */
export function generateUid(): string {
	let id = "";
	for (let i = 0; i < 13; i++) {
		id += BASE62_CHARS[Math.floor(Math.random() * BASE62_CHARS.length)];
	}
	return `uid://${id}`;
}

/**
 * Validate a UID string format.
 */
export function isValidUid(uid: string): boolean {
	if (!uid.startsWith("uid://")) return false;
	const id = uid.slice("uid://".length);
	return id.length > 0 && [...id].every((c) => BASE62_CHARS.includes(c));
}
