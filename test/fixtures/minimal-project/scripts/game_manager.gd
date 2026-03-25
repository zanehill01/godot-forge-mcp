extends Node

var score: int = 0
var is_paused: bool = false

func _ready() -> void:
	pass

func add_score(points: int) -> void:
	score += points

func reset() -> void:
	score = 0
	is_paused = false
