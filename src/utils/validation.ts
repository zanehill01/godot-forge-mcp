/**
 * Input validation helpers for Godot-specific constraints.
 */

/**
 * Common Godot node types organized by category.
 */
export const NODE_TYPES = {
	base: ["Node", "Node2D", "Node3D", "Control"],
	physics2d: [
		"CharacterBody2D",
		"RigidBody2D",
		"StaticBody2D",
		"AnimatableBody2D",
		"Area2D",
		"CollisionShape2D",
		"CollisionPolygon2D",
		"RayCast2D",
		"ShapeCast2D",
	],
	physics3d: [
		"CharacterBody3D",
		"RigidBody3D",
		"StaticBody3D",
		"AnimatableBody3D",
		"Area3D",
		"CollisionShape3D",
		"CollisionPolygon3D",
		"RayCast3D",
		"ShapeCast3D",
	],
	visual2d: [
		"Sprite2D",
		"AnimatedSprite2D",
		"Polygon2D",
		"Line2D",
		"MeshInstance2D",
		"MultiMeshInstance2D",
		"TileMapLayer",
		"Parallax2D",
		"ParallaxLayer",
		"Camera2D",
		"PointLight2D",
		"DirectionalLight2D",
		"CanvasModulate",
		"BackBufferCopy",
	],
	visual3d: [
		"MeshInstance3D",
		"MultiMeshInstance3D",
		"CSGBox3D",
		"CSGCylinder3D",
		"CSGSphere3D",
		"CSGTorus3D",
		"CSGMesh3D",
		"CSGCombiner3D",
		"CSGPolygon3D",
		"Camera3D",
		"DirectionalLight3D",
		"OmniLight3D",
		"SpotLight3D",
		"WorldEnvironment",
		"FogVolume",
		"GPUParticles3D",
		"CPUParticles3D",
		"Decal",
		"ReflectionProbe",
		"VoxelGI",
		"LightmapGI",
	],
	ui: [
		"Control",
		"Button",
		"Label",
		"LineEdit",
		"TextEdit",
		"RichTextLabel",
		"TextureRect",
		"Panel",
		"PanelContainer",
		"HBoxContainer",
		"VBoxContainer",
		"GridContainer",
		"MarginContainer",
		"CenterContainer",
		"ScrollContainer",
		"TabContainer",
		"SplitContainer",
		"HSplitContainer",
		"VSplitContainer",
		"ProgressBar",
		"HSlider",
		"VSlider",
		"SpinBox",
		"CheckBox",
		"CheckButton",
		"OptionButton",
		"MenuButton",
		"ColorPickerButton",
		"ItemList",
		"Tree",
		"ColorRect",
		"NinePatchRect",
		"SubViewportContainer",
		"AspectRatioContainer",
		"FlowContainer",
		"HFlowContainer",
		"VFlowContainer",
	],
	audio: ["AudioStreamPlayer", "AudioStreamPlayer2D", "AudioStreamPlayer3D", "AudioListener2D", "AudioListener3D"],
	animation: ["AnimationPlayer", "AnimationTree", "Tween"],
	navigation: [
		"NavigationRegion2D",
		"NavigationRegion3D",
		"NavigationAgent2D",
		"NavigationAgent3D",
		"NavigationObstacle2D",
		"NavigationObstacle3D",
		"NavigationLink2D",
		"NavigationLink3D",
	],
	misc: [
		"Timer",
		"Path2D",
		"Path3D",
		"PathFollow2D",
		"PathFollow3D",
		"RemoteTransform2D",
		"RemoteTransform3D",
		"Marker2D",
		"Marker3D",
		"SubViewport",
		"HTTPRequest",
		"ResourcePreloader",
		"MultiplayerSpawner",
		"MultiplayerSynchronizer",
	],
} as const;

/**
 * Get all known node type names as a flat array.
 */
export function getAllNodeTypes(): string[] {
	return Object.values(NODE_TYPES).flat();
}

/**
 * Check if a string is a valid Godot node type name.
 */
export function isValidNodeType(type: string): boolean {
	return getAllNodeTypes().includes(type) || /^[A-Z]\w*$/.test(type);
}

/**
 * Validate a res:// path.
 */
export function isValidResPath(path: string): boolean {
	return path.startsWith("res://") && path.length > "res://".length;
}

/**
 * Validate a node path (relative to scene root).
 */
export function isValidNodePath(path: string): boolean {
	if (path === ".") return true;
	return /^[\w/]+$/.test(path);
}

/**
 * Get the category for a node type.
 */
export function getNodeCategory(type: string): string | null {
	for (const [category, types] of Object.entries(NODE_TYPES)) {
		if ((types as readonly string[]).includes(type)) return category;
	}
	return null;
}
