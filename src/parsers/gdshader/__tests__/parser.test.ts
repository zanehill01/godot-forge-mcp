/**
 * Tests for GDShader parser.
 */

import { describe, it, expect } from "vitest";
import { analyzeShader } from "../parser.js";

describe("analyzeShader", () => {
	it("returns defaults for empty content", () => {
		const result = analyzeShader("");
		expect(result.shaderType).toBe("spatial");
		expect(result.uniforms).toHaveLength(0);
		expect(result.functions).toHaveLength(0);
	});

	it("returns defaults for whitespace-only content", () => {
		const result = analyzeShader("   \n\n\t  \n");
		expect(result.shaderType).toBe("spatial");
	});

	it("parses shader_type", () => {
		const result = analyzeShader("shader_type canvas_item;");
		expect(result.shaderType).toBe("canvas_item");
	});

	it("parses render_mode", () => {
		const result = analyzeShader(`
shader_type spatial;
render_mode unshaded, cull_disabled;
`);
		expect(result.renderModes).toEqual(["unshaded", "cull_disabled"]);
	});

	it("parses uniforms", () => {
		const result = analyzeShader(`
shader_type spatial;
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform float roughness = 0.5;
uniform sampler2D noise_texture;
`);
		expect(result.uniforms).toHaveLength(3);
		expect(result.uniforms[0].type).toBe("vec4");
		expect(result.uniforms[0].name).toBe("albedo_color");
		expect(result.uniforms[0].hint).toBe("source_color");
		expect(result.uniforms[1].defaultValue).toBe("0.5");
		expect(result.uniforms[2].hint).toBeNull();
	});

	it("parses varyings", () => {
		const result = analyzeShader(`
shader_type spatial;
varying vec2 uv_offset;
flat varying float height;
`);
		expect(result.varyings).toHaveLength(2);
		expect(result.varyings[0].type).toBe("vec2");
		expect(result.varyings[0].name).toBe("uv_offset");
		expect(result.varyings[0].interpolation).toBeNull();
		expect(result.varyings[1].interpolation).toBe("flat");
	});

	it("parses single-line functions", () => {
		const result = analyzeShader(`
shader_type spatial;
void fragment() {
	ALBEDO = vec3(1.0);
}
`);
		expect(result.functions).toHaveLength(1);
		expect(result.functions[0].name).toBe("fragment");
		expect(result.functions[0].returnType).toBe("void");
	});

	it("parses functions with parameters", () => {
		const result = analyzeShader(`
shader_type spatial;
float calculate_fresnel(float amount, float power) {
	return pow(1.0 - amount, power);
}
`);
		// The function parser finds the function signature
		const fn = result.functions.find((f) => f.name === "calculate_fresnel");
		expect(fn).toBeDefined();
		expect(fn!.params).toHaveLength(2);
		expect(fn!.params[0]).toEqual({ type: "float", name: "amount" });
	});

	it("parses multiline function signatures", () => {
		const result = analyzeShader(`
shader_type spatial;
void fragment(
	) {
	ALBEDO = vec3(1.0);
}
`);
		expect(result.functions).toHaveLength(1);
		expect(result.functions[0].name).toBe("fragment");
	});

	it("parses #include directives", () => {
		const result = analyzeShader(`
shader_type spatial;
#include "res://shaders/common.gdshaderinc"
`);
		expect(result.includes).toEqual(["res://shaders/common.gdshaderinc"]);
	});

	it("skips line comments", () => {
		const result = analyzeShader(`
shader_type spatial;
// uniform float hidden;
uniform float visible = 1.0;
`);
		expect(result.uniforms).toHaveLength(1);
		expect(result.uniforms[0].name).toBe("visible");
	});

	it("handles a complete shader", () => {
		const result = analyzeShader(`
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform vec4 albedo : source_color;
uniform float metallic : hint_range(0, 1) = 0.0;
uniform float roughness : hint_range(0, 1) = 1.0;
uniform sampler2D texture_normal : hint_normal;

varying vec3 world_pos;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	ALBEDO = albedo.rgb;
	METALLIC = metallic;
	ROUGHNESS = roughness;
	NORMAL_MAP = texture(texture_normal, UV).rgb;
}
`);
		expect(result.shaderType).toBe("spatial");
		expect(result.renderModes).toHaveLength(5);
		expect(result.uniforms).toHaveLength(4);
		expect(result.varyings).toHaveLength(1);
		expect(result.functions).toHaveLength(2);
	});
});
