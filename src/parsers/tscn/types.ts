/**
 * Type definitions for Godot's .tscn and .tres text formats.
 *
 * The .tscn format has 5 section types:
 * 1. File descriptor: [gd_scene format=3 uid="uid://..."]
 * 2. External resources: [ext_resource type="..." path="..." id="..."]
 * 3. Sub-resources: [sub_resource type="..." id="..."]
 * 4. Nodes: [node name="..." type="..." parent="..."]
 * 5. Connections: [connection signal="..." from="..." to="..." method="..."]
 */

// ── Variant Types ──────────────────────────────────────────────

export type GodotVariant =
	| string
	| number
	| boolean
	| null
	| GodotVector2
	| GodotVector3
	| GodotVector4
	| GodotColor
	| GodotRect2
	| GodotTransform2D
	| GodotTransform3D
	| GodotBasis
	| GodotQuaternion
	| GodotAABB
	| GodotPlane
	| GodotNodePath
	| GodotResourceRef
	| GodotPackedArray
	| GodotVariant[]
	| GodotDictionary;

export interface GodotVector2 {
	type: "Vector2" | "Vector2i";
	x: number;
	y: number;
}

export interface GodotVector3 {
	type: "Vector3" | "Vector3i";
	x: number;
	y: number;
	z: number;
}

export interface GodotVector4 {
	type: "Vector4" | "Vector4i";
	x: number;
	y: number;
	z: number;
	w: number;
}

export interface GodotColor {
	type: "Color";
	r: number;
	g: number;
	b: number;
	a: number;
}

export interface GodotRect2 {
	type: "Rect2" | "Rect2i";
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface GodotTransform2D {
	type: "Transform2D";
	xx: number;
	xy: number;
	yx: number;
	yy: number;
	ox: number;
	oy: number;
}

export interface GodotTransform3D {
	type: "Transform3D";
	basis: [number, number, number, number, number, number, number, number, number];
	origin: [number, number, number];
}

export interface GodotBasis {
	type: "Basis";
	values: [number, number, number, number, number, number, number, number, number];
}

export interface GodotQuaternion {
	type: "Quaternion";
	x: number;
	y: number;
	z: number;
	w: number;
}

export interface GodotAABB {
	type: "AABB";
	x: number;
	y: number;
	z: number;
	sx: number;
	sy: number;
	sz: number;
}

export interface GodotPlane {
	type: "Plane";
	a: number;
	b: number;
	c: number;
	d: number;
}

export interface GodotNodePath {
	type: "NodePath";
	path: string;
}

export interface GodotResourceRef {
	type: "ExtResource" | "SubResource";
	id: string;
}

export interface GodotPackedArray {
	type:
		| "PackedByteArray"
		| "PackedInt32Array"
		| "PackedInt64Array"
		| "PackedFloat32Array"
		| "PackedFloat64Array"
		| "PackedStringArray"
		| "PackedVector2Array"
		| "PackedVector3Array"
		| "PackedColorArray";
	values: number[] | string[];
}

export interface GodotDictionary {
	type: "Dictionary";
	entries: Array<{ key: GodotVariant; value: GodotVariant }>;
}

// ── Document Structure ─────────────────────────────────────────

export interface TscnDocument {
	/** "gd_scene" for .tscn, "gd_resource" for .tres */
	descriptor: FileDescriptor;
	extResources: ExtResource[];
	subResources: SubResource[];
	nodes: TscnNode[];
	connections: SignalConnection[];
}

export interface FileDescriptor {
	type: "gd_scene" | "gd_resource";
	format: number;
	uid?: string;
	/** For .tres: the resource type */
	resourceType?: string;
}

export interface ExtResource {
	type: string;
	uid?: string;
	path: string;
	id: string;
}

export interface SubResource {
	type: string;
	id: string;
	properties: Record<string, GodotVariant>;
}

export interface TscnNode {
	name: string;
	type?: string;
	parent?: string;
	/** Path to instanced scene */
	instance?: GodotResourceRef;
	/** Unique name marker (%) */
	uniqueNameInOwner?: boolean;
	/** Node index (ordering) */
	index?: number;
	/** Node groups */
	groups?: string[];
	/** Script or other resource references + properties */
	properties: Record<string, GodotVariant>;
}

export interface SignalConnection {
	signal: string;
	from: string;
	to: string;
	method: string;
	flags?: number;
	/** Binds (extra arguments) */
	binds?: GodotVariant[];
	/** Unbind count */
	unbinds?: number;
}

// ── .tres specific ─────────────────────────────────────────────

export interface TresDocument {
	descriptor: FileDescriptor;
	extResources: ExtResource[];
	subResources: SubResource[];
	/** The main [resource] section properties */
	resource: Record<string, GodotVariant>;
}

// ── Lexer Token Types ──────────────────────────────────────────

export enum TokenType {
	SectionHeader = "SectionHeader",
	Property = "Property",
	Comment = "Comment",
	BlankLine = "BlankLine",
}

export interface SectionHeaderToken {
	type: TokenType.SectionHeader;
	sectionType: string;
	attributes: Record<string, string>;
	line: number;
}

export interface PropertyToken {
	type: TokenType.Property;
	key: string;
	value: string;
	line: number;
}

export interface CommentToken {
	type: TokenType.Comment;
	text: string;
	line: number;
}

export interface BlankLineToken {
	type: TokenType.BlankLine;
	line: number;
}

export type Token = SectionHeaderToken | PropertyToken | CommentToken | BlankLineToken;
