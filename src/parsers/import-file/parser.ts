/**
 * Parser for Godot .import files.
 *
 * .import files are INI-format metadata files that Godot creates alongside
 * imported assets. They contain import settings, source/dest paths, and parameters.
 */

export interface ImportFile {
	remap: {
		importer: string;
		type: string;
		uid?: string;
		path: string;
	};
	deps: {
		sourceFile: string;
		destFiles: string[];
	};
	params: Record<string, string | number | boolean>;
}

/**
 * Parse a .import file.
 */
export function parseImportFile(content: string): ImportFile {
	const result: ImportFile = {
		remap: { importer: "", type: "", path: "" },
		deps: { sourceFile: "", destFiles: [] },
		params: {},
	};

	const lines = content.split("\n");
	let currentSection = "";

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith(";") || line.startsWith("#")) continue;

		if (line.startsWith("[") && line.endsWith("]")) {
			currentSection = line.slice(1, -1);
			continue;
		}

		const eqIdx = line.indexOf("=");
		if (eqIdx === -1) continue;

		const key = line.slice(0, eqIdx).trim();
		const rawValue = line.slice(eqIdx + 1).trim();

		switch (currentSection) {
			case "remap": {
				const value = unquote(rawValue);
				switch (key) {
					case "importer":
						result.remap.importer = value;
						break;
					case "type":
						result.remap.type = value;
						break;
					case "uid":
						result.remap.uid = value;
						break;
					case "path":
						result.remap.path = value;
						break;
				}
				break;
			}

			case "deps": {
				switch (key) {
					case "source_file":
						result.deps.sourceFile = unquote(rawValue);
						break;
					case "dest_files":
						result.deps.destFiles = parseStringArray(rawValue);
						break;
				}
				break;
			}

			case "params": {
				result.params[key] = parseSimpleValue(rawValue);
				break;
			}
		}
	}

	return result;
}

function unquote(s: string): string {
	if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
	return s;
}

function parseStringArray(s: string): string[] {
	// Format: ["path1", "path2"]
	const match = s.match(/\[([^\]]*)\]/);
	if (!match) return [];
	return match[1]
		.split(",")
		.map((item) => unquote(item.trim()))
		.filter(Boolean);
}

function parseSimpleValue(s: string): string | number | boolean {
	if (s === "true") return true;
	if (s === "false") return false;
	const num = Number(s);
	if (!Number.isNaN(num) && s !== "") return num;
	return unquote(s);
}
