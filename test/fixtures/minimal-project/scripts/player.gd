class_name Player
extends CharacterBody2D

signal health_changed(new_health: int)
signal died

@export var speed: float = 300.0
@export var jump_force: float = -400.0
@export_range(0, 100, 1) var health: int = 100

@onready var sprite: Sprite2D = $Sprite
@onready var collision: CollisionShape2D = $CollisionShape

enum State { IDLE, RUNNING, JUMPING, FALLING }

const GRAVITY: float = 980.0

var current_state: State = State.IDLE

func _ready() -> void:
	health_changed.connect(_on_health_changed)

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y += GRAVITY * delta

	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_force

	var direction := Input.get_axis("move_left", "move_right")
	velocity.x = direction * speed

	move_and_slide()

func take_damage(amount: int) -> void:
	health -= amount
	health_changed.emit(health)
	if health <= 0:
		died.emit()

func _on_health_changed(new_health: int) -> void:
	pass
