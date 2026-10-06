class_name CreatureEnemy
extends EnemyBase
## CC0 glTF creatures configured as enemies while retaining the shared combat AI.

const CREATURES := {
	"bat": {
		"name": "DUSK BAT",
		"level": 2,
		"hp": 145,
		"atk": 17,
		"defense": 3,
		"exp": 55,
		"speed": 3.8,
		"detect": 16.0,
		"range": 1.8,
		"cooldown": 1.3,
		"radius": 0.48,
		"height": 1.3,
		"scale": 0.0035,
		"model": "res://assets/models/gobkit/gobkit-bat.glb",
		"drops": [
			{"id": "small_potion", "chance": 0.18, "min": 1, "max": 1},
			{"id": "gold", "chance": 1.0, "min": 15, "max": 32},
		],
	},
	"boar": {
		"name": "WILD BOAR",
		"level": 3,
		"hp": 235,
		"atk": 28,
		"defense": 8,
		"exp": 85,
		"speed": 3.0,
		"detect": 14.0,
		"range": 2.0,
		"cooldown": 1.65,
		"radius": 0.62,
		"height": 1.35,
		"scale": 0.38,
		"model": "res://assets/models/gobkit/gobkit-boar.glb",
		"drops": [
			{"id": "large_potion", "chance": 0.16, "min": 1, "max": 1},
			{"id": "gold", "chance": 1.0, "min": 22, "max": 45},
		],
	},
}

var creature_type: String = "bat"
var _animation_player: AnimationPlayer


func _setup_data() -> void:
	assert(CREATURES.has(creature_type), "Unknown creature type: %s" % creature_type)
	var data: Dictionary = CREATURES[creature_type]
	enemy_name = String(data["name"])
	level = int(data["level"])
	max_hp = int(data["hp"])
	atk = int(data["atk"])
	defense = int(data["defense"])
	exp_reward = int(data["exp"])
	move_speed = float(data["speed"])
	detect_range = float(data["detect"])
	attack_range = float(data["range"])
	attack_cooldown = float(data["cooldown"])
	body_radius = float(data["radius"])
	body_height = float(data["height"])
	drops = data["drops"]


func _build_model() -> void:
	var data: Dictionary = CREATURES[creature_type]
	var packed_scene := load(String(data["model"])) as PackedScene
	assert(packed_scene != null, "Could not load creature model for %s" % creature_type)
	var creature := packed_scene.instantiate() as Node3D
	assert(creature != null, "Creature model root must be Node3D")
	creature.scale = Vector3.ONE * float(data["scale"])
	creature.rotation.y = PI
	model_root.add_child(creature)
	_animation_player = creature.find_child("AnimationPlayer", true, false) as AnimationPlayer
	_play_animation("idle")


func _animate(_delta: float) -> void:
	if _animation_player == null:
		return
	if _animation_player.current_animation == "attack" and _animation_player.is_playing():
		return
	var moving := Vector2(velocity.x, velocity.z).length() > 0.35
	_play_animation("walk" if moving else "idle")


func play_attack_anim() -> void:
	_play_animation("attack")


func _play_animation(animation_name: String) -> void:
	if _animation_player == null or not _animation_player.has_animation(animation_name):
		return
	if _animation_player.current_animation != animation_name or not _animation_player.is_playing():
		_animation_player.play(animation_name, 0.12)
