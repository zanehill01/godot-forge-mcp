/**
 * Common GDShader templates for quick generation.
 */

export interface ShaderTemplate {
	name: string;
	description: string;
	shaderType: string;
	code: string;
}

export const SHADER_TEMPLATES: Record<string, ShaderTemplate> = {
	water: {
		name: "Water",
		description: "Animated water surface with sine displacement, fresnel, and transparency",
		shaderType: "spatial",
		code: `shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform vec4 water_color : source_color = vec4(0.1, 0.3, 0.5, 0.8);
uniform vec4 foam_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float wave_speed : hint_range(0.0, 5.0) = 1.0;
uniform float wave_amplitude : hint_range(0.0, 2.0) = 0.3;
uniform float wave_frequency : hint_range(0.0, 10.0) = 2.0;
uniform float fresnel_power : hint_range(0.1, 10.0) = 3.0;
uniform float roughness : hint_range(0.0, 1.0) = 0.05;
uniform float metallic : hint_range(0.0, 1.0) = 0.3;
uniform sampler2D noise_texture;

void vertex() {
	float wave = sin(VERTEX.x * wave_frequency + TIME * wave_speed) *
				 cos(VERTEX.z * wave_frequency * 0.7 + TIME * wave_speed * 0.8);
	VERTEX.y += wave * wave_amplitude;
	// Recalculate normal for lighting
	NORMAL = normalize(vec3(
		-cos(VERTEX.x * wave_frequency + TIME * wave_speed) * wave_amplitude * wave_frequency,
		1.0,
		sin(VERTEX.z * wave_frequency * 0.7 + TIME * wave_speed * 0.8) * wave_amplitude * wave_frequency * 0.7
	));
}

void fragment() {
	float fresnel = pow(1.0 - dot(NORMAL, VIEW), fresnel_power);
	ALBEDO = mix(water_color.rgb, foam_color.rgb, fresnel * 0.3);
	ALPHA = mix(water_color.a, 1.0, fresnel);
	ROUGHNESS = roughness;
	METALLIC = metallic;
}
`,
	},

	dissolve: {
		name: "Dissolve",
		description: "Noise-based dissolve effect with glowing edge",
		shaderType: "spatial",
		code: `shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back;

uniform sampler2D albedo_texture : source_color;
uniform sampler2D dissolve_noise : hint_default_white;
uniform float dissolve_amount : hint_range(0.0, 1.0) = 0.0;
uniform float edge_width : hint_range(0.0, 0.2) = 0.05;
uniform vec4 edge_color : source_color = vec4(1.0, 0.5, 0.0, 1.0);
uniform float edge_emission : hint_range(0.0, 10.0) = 3.0;

void fragment() {
	vec4 tex = texture(albedo_texture, UV);
	float noise = texture(dissolve_noise, UV).r;

	if (noise < dissolve_amount) {
		discard;
	}

	float edge = smoothstep(dissolve_amount, dissolve_amount + edge_width, noise);
	ALBEDO = mix(edge_color.rgb, tex.rgb, edge);
	EMISSION = edge_color.rgb * (1.0 - edge) * edge_emission;
}
`,
	},

	outline: {
		name: "Outline",
		description: "Inverted hull outline effect",
		shaderType: "spatial",
		code: `shader_type spatial;
render_mode unshaded, cull_front;

uniform vec4 outline_color : source_color = vec4(0.0, 0.0, 0.0, 1.0);
uniform float outline_width : hint_range(0.0, 0.1) = 0.02;

void vertex() {
	VERTEX += NORMAL * outline_width;
}

void fragment() {
	ALBEDO = outline_color.rgb;
	ALPHA = outline_color.a;
}
`,
	},

	toon: {
		name: "Toon / Cel Shading",
		description: "Cel-shaded look with step lighting and rim light",
		shaderType: "spatial",
		code: `shader_type spatial;

uniform vec4 albedo_color : source_color = vec4(1.0);
uniform sampler2D albedo_texture : source_color, filter_linear_mipmap;
uniform float shade_threshold : hint_range(0.0, 1.0) = 0.5;
uniform float shade_softness : hint_range(0.0, 0.5) = 0.05;
uniform vec4 shade_color : source_color = vec4(0.3, 0.3, 0.4, 1.0);
uniform float rim_amount : hint_range(0.0, 1.0) = 0.5;
uniform float rim_threshold : hint_range(0.0, 1.0) = 0.1;
uniform vec4 rim_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);

void fragment() {
	vec4 tex = texture(albedo_texture, UV) * albedo_color;
	ALBEDO = tex.rgb;
}

void light() {
	float NdotL = dot(NORMAL, LIGHT);
	float shade = smoothstep(shade_threshold - shade_softness, shade_threshold + shade_softness, NdotL);
	vec3 shaded = mix(shade_color.rgb * ALBEDO, ALBEDO, shade);

	float rim_dot = 1.0 - dot(NORMAL, VIEW);
	float rim = smoothstep(1.0 - rim_amount - rim_threshold, 1.0 - rim_amount + rim_threshold, rim_dot);
	rim *= NdotL;

	DIFFUSE_LIGHT += shaded * ATTENUATION * LIGHT_COLOR;
	DIFFUSE_LIGHT += rim * rim_color.rgb * ATTENUATION * LIGHT_COLOR;
}
`,
	},

	hologram: {
		name: "Hologram",
		description: "Holographic effect with scan lines, flicker, and transparency",
		shaderType: "spatial",
		code: `shader_type spatial;
render_mode blend_add, depth_draw_opaque, cull_back, unshaded;

uniform vec4 hologram_color : source_color = vec4(0.0, 0.8, 1.0, 1.0);
uniform float scan_line_speed : hint_range(0.0, 5.0) = 1.0;
uniform float scan_line_count : hint_range(10.0, 200.0) = 50.0;
uniform float scan_line_strength : hint_range(0.0, 1.0) = 0.3;
uniform float flicker_speed : hint_range(0.0, 20.0) = 8.0;
uniform float flicker_amount : hint_range(0.0, 1.0) = 0.1;
uniform float fresnel_power : hint_range(0.5, 5.0) = 2.0;
uniform float alpha : hint_range(0.0, 1.0) = 0.6;

void fragment() {
	float fresnel = pow(1.0 - abs(dot(NORMAL, VIEW)), fresnel_power);
	float scan = sin((UV.y + TIME * scan_line_speed) * scan_line_count * 3.14159) * 0.5 + 0.5;
	float flicker = 1.0 - flicker_amount * (sin(TIME * flicker_speed) * 0.5 + 0.5);

	ALBEDO = hologram_color.rgb;
	ALPHA = alpha * (1.0 - scan * scan_line_strength) * flicker * (0.5 + fresnel * 0.5);
	EMISSION = hologram_color.rgb * (0.5 + fresnel);
}
`,
	},

	pixelation: {
		name: "Pixelation",
		description: "Screen-space pixelation effect via UV snapping",
		shaderType: "canvas_item",
		code: `shader_type canvas_item;

uniform float pixel_size : hint_range(1.0, 64.0) = 8.0;
uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_nearest;

void fragment() {
	vec2 screen_size = 1.0 / SCREEN_PIXEL_SIZE;
	vec2 snapped = floor(SCREEN_UV * screen_size / pixel_size) * pixel_size / screen_size;
	COLOR = texture(SCREEN_TEXTURE, snapped);
}
`,
	},

	wind: {
		name: "Wind",
		description: "Vertex displacement for foliage/cloth wind animation",
		shaderType: "spatial",
		code: `shader_type spatial;
render_mode cull_disabled;

uniform sampler2D albedo_texture : source_color;
uniform float wind_strength : hint_range(0.0, 2.0) = 0.5;
uniform float wind_speed : hint_range(0.0, 5.0) = 1.5;
uniform float wind_frequency : hint_range(0.0, 10.0) = 3.0;
uniform vec3 wind_direction = vec3(1.0, 0.0, 0.3);

void vertex() {
	vec3 world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float height_factor = clamp(VERTEX.y, 0.0, 1.0);
	float wind = sin(dot(world_pos.xz, normalize(wind_direction.xz)) * wind_frequency + TIME * wind_speed);
	wind *= wind_strength * height_factor;
	VERTEX.x += wind * wind_direction.x;
	VERTEX.z += wind * wind_direction.z;
}

void fragment() {
	vec4 tex = texture(albedo_texture, UV);
	ALBEDO = tex.rgb;
	ALPHA = tex.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
}
`,
	},

	glow: {
		name: "Glow / Emission Pulse",
		description: "Pulsating emission glow effect",
		shaderType: "spatial",
		code: `shader_type spatial;

uniform vec4 albedo_color : source_color = vec4(1.0);
uniform vec4 emission_color : source_color = vec4(0.0, 0.5, 1.0, 1.0);
uniform float emission_strength : hint_range(0.0, 16.0) = 2.0;
uniform float pulse_speed : hint_range(0.0, 10.0) = 2.0;
uniform float pulse_min : hint_range(0.0, 1.0) = 0.3;

void fragment() {
	float pulse = mix(pulse_min, 1.0, (sin(TIME * pulse_speed) * 0.5 + 0.5));
	ALBEDO = albedo_color.rgb;
	EMISSION = emission_color.rgb * emission_strength * pulse;
}
`,
	},
};

/**
 * Get a shader template by name.
 */
export function getShaderTemplate(name: string): ShaderTemplate | undefined {
	return SHADER_TEMPLATES[name.toLowerCase()];
}

/**
 * List all available template names.
 */
export function listShaderTemplates(): Array<{ name: string; description: string }> {
	return Object.values(SHADER_TEMPLATES).map((t) => ({
		name: t.name,
		description: t.description,
	}));
}
