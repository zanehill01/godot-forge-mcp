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

	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();

		// Skip comments
		if (line.startsWith("//")) continue;

		// shader_type
		const shaderTypeMatch = line.match(/^shader_type\s+(\w+)\s*;/);
		if (shaderTypeMatch) {
			analysis.shaderType = shaderTypeMatch[1];
			continue;
		}

		// render_mode
		const renderModeMatch = line.match(/^render_mode\s+(.+);/);
		if (renderModeMatch) {
			analysis.renderModes = renderModeMatch[1].split(",").map((m) => m.trim());
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

		// function
		const funcMatch = line.match(
			/^(\w+)\s+(\w+)\s*\(([^)]*)\)\s*\{/,
		);
		if (funcMatch) {
			const returnType = funcMatch[1];
			const name = funcMatch[2];
			const paramStr = funcMatch[3];
			const params = parseShaderParams(paramStr);

			analysis.functions.push({
				returnType,
				name,
				params,
				line: i + 1,
			});
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
