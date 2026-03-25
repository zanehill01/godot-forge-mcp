/**
 * GDShader parser — extracts structure from .gdshader files.
 *
 * Parses shader_type, render_mode, uniforms, varyings, and function signatures.
 */

export interface ShaderAnalysis {
	shaderType: string; // spatial, canvas_item, particles, sky, fog
	renderModes: string[];
	uniforms: UniformInfo[];
	varyings: VaryingInfo[];
	functions: ShaderFunctionInfo[];
	includes: string[];
}

export interface UniformInfo {
	name: string;
	type: string;
	hint: string | null;
	defaultValue: string | null;
	line: number;
}

export interface VaryingInfo {
	name: string;
	type: string;
	interpolation: string | null;
	line: number;
}

export interface ShaderFunctionInfo {
	name: string;
	returnType: string;
	params: Array<{ name: string; type: string; qualifier?: string }>;
	line: number;
}

/**
 * Analyze a .gdshader file content.
 * Returns a structured analysis or an empty analysis for empty/whitespace-only files.
 */
export function analyzeShader(content: string): ShaderAnalysis {
	const analysis: ShaderAnalysis = {
		shaderType: "spatial",
		renderModes: [],
		uniforms: [],
		varyings: [],
		functions: [],
		includes: [],
	};

	// Handle empty or whitespace-only files
	if (!content || content.trim() === "") {
		return analysis;
	}

	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();

		// Skip comments and empty lines
		if (line.startsWith("//") || line === "") continue;

		// Skip block comments
		if (line.startsWith("/*")) {
			while (i < lines.length && !lines[i].includes("*/")) i++;
			continue;
		}

		// shader_type
		const shaderTypeMatch = line.match(/^shader_type\s+(\w+)\s*;/);
		if (shaderTypeMatch) {
			analysis.shaderType = shaderTypeMatch[1];
			continue;
		}

		// render_mode (may span multiple lines)
		if (line.startsWith("render_mode")) {
			let renderLine = line;
			while (!renderLine.includes(";") && i + 1 < lines.length) {
				i++;
				renderLine += " " + lines[i].trim();
			}
			const renderModeMatch = renderLine.match(/^render_mode\s+(.+);/);
			if (renderModeMatch) {
				analysis.renderModes = renderModeMatch[1].split(",").map((m) => m.trim());
			}
			continue;
		}

		// uniform
		const uniformMatch = line.match(
			/^uniform\s+(\w+)\s+(\w+)\s*(?::\s*([^=;]+))?\s*(?:=\s*([^;]+))?\s*;/,
		);
		if (uniformMatch) {
			analysis.uniforms.push({
				type: uniformMatch[1],
				name: uniformMatch[2],
				hint: uniformMatch[3]?.trim() ?? null,
				defaultValue: uniformMatch[4]?.trim() ?? null,
				line: i + 1,
			});
			continue;
		}

		// varying
		const varyingMatch = line.match(
			/^(?:(flat|smooth)\s+)?varying\s+(\w+)\s+(\w+)\s*;/,
		);
		if (varyingMatch) {
			analysis.varyings.push({
				interpolation: varyingMatch[1] ?? null,
				type: varyingMatch[2],
				name: varyingMatch[3],
				line: i + 1,
			});
			continue;
		}

		// function — handle both single-line and multiline signatures
		// Single line: void fragment() {
		// Multiline: void fragment(
		//     ) {
		const funcStartMatch = line.match(/^(\w+)\s+(\w+)\s*\(/);
		if (funcStartMatch) {
			let fullLine = line;
			// If the opening paren doesn't have a matching close paren on the same line, accumulate
			if (!fullLine.includes(")")) {
				let j = i + 1;
				while (j < lines.length && !fullLine.includes(")")) {
					fullLine += " " + lines[j].trim();
					j++;
				}
			}

			const funcMatch = fullLine.match(/^(\w+)\s+(\w+)\s*\(([^)]*)\)\s*\{?/);
			if (funcMatch) {
				const returnType = funcMatch[1];
				const name = funcMatch[2];
				// Skip keywords that look like functions
				if (!["if", "for", "while", "return", "else", "switch", "case"].includes(returnType)) {
					const paramStr = funcMatch[3];
					const params = parseShaderParams(paramStr);

					analysis.functions.push({
						returnType,
						name,
						params,
						line: i + 1,
					});
				}
			}
			continue;
		}

		// #include
		const includeMatch = line.match(/^#include\s+"([^"]+)"/);
		if (includeMatch) {
			analysis.includes.push(includeMatch[1]);
			continue;
		}
	}

	return analysis;
}

function parseShaderParams(
	s: string,
): Array<{ name: string; type: string; qualifier?: string }> {
	if (!s || s.trim() === "") return [];

	return s.split(",").map((p) => {
		const parts = p.trim().split(/\s+/);
		if (parts.length >= 3) {
			// qualifier type name (e.g., "in vec3 position")
			return { qualifier: parts[0], type: parts[1], name: parts[2] };
		}
		if (parts.length === 2) {
			return { type: parts[0], name: parts[1] };
		}
		return { type: "unknown", name: parts[0] };
	});
}
