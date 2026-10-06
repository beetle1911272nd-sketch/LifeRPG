class_name EnemyBase
extends CharacterBody3D
## 全ての敵の共通部分(ステータス・被ダメージ・死亡)。
## 新しい敵を作るときは、これを継承して _setup_data() と _build_model() を書くだけ。
## 例: scripts/enemies/slime.gd
## 行動(AI)は EnemyAI が担当します。

signal died(enemy: EnemyBase)

var enemy_name: String = "ENEMY"
var level: int = 1
var max_hp: int = 100
var hp: int = 100
var atk: int = 10
var defense: int = 0
var exp_reward: int = 10
var drops: Array = []  # [{"id": "gold", "chance": 0.5, "min": 1, "max": 5}, ...]
var move_speed: float = 3.0
var detect_range: float = 12.0
var attack_range: float = 1.8
var attack_cooldown: float = 1.4
var body_radius: float = 0.5
var body_height: float = 1.2

var is_dead: bool = false
var model_root: Node3D
var knockback: Vector3 = Vector3.ZERO

var _flash_base: Dictionary = {}


func _ready() -> void:
	add_to_group("enemies")
	collision_layer = 4          # 敵
	collision_mask = 1 | 2       # 地形 + プレイヤー

	_setup_data()
	hp = max_hp

	model_root = Node3D.new()
	model_root.name = "ModelRoot"
	add_child(model_root)
	_build_model()

	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = body_radius
	capsule.height = maxf(body_height, body_radius * 2.0)
	shape.shape = capsule
	shape.position = Vector3(0, body_height * 0.5, 0)
	add_child(shape)

	var ai := EnemyAI.new()
	ai.name = "EnemyAI"
	ai.body = self
	add_child(ai)


func _process(delta: float) -> void:
	if not is_dead:
		_animate(delta)


# ---- 継承先で上書きする部分 ----
func _setup_data() -> void:
	pass


func _build_model() -> void:
	pass


func _animate(_delta: float) -> void:
	pass


func play_attack_anim() -> void:
	pass
# -------------------------------


func register_flash(mat: StandardMaterial3D) -> void:
	_flash_base[mat] = mat.albedo_color


func take_damage(amount: int, attacker: Node3D = null) -> void:
	if is_dead:
		return
	hp = maxi(0, hp - amount)
	DamagePopup.spawn(self, global_position + Vector3(0, body_height + 0.4, 0), str(amount), Color(1.0, 0.88, 0.3))
	_flash()
	if attacker != null:
		var dir := global_position - attacker.global_position
		dir.y = 0.0
		if dir.length() > 0.01:
			knockback = dir.normalized() * 6.0
	if hp <= 0:
		_die()


func _flash() -> void:
	for m in _flash_base:
		var mat := m as StandardMaterial3D
		var base: Color = _flash_base[m]
		mat.albedo_color = Color(1.0, 1.0, 1.0, base.a)
		var tw := create_tween()
		tw.tween_property(mat, "albedo_color", base, 0.2)


func face(dir: Vector3, delta: float) -> void:
	var target_angle := atan2(-dir.x, -dir.z)
	model_root.rotation.y = lerp_angle(model_root.rotation.y, target_angle, 1.0 - exp(-10.0 * delta))


func apply_movement(desired: Vector3, delta: float) -> void:
	if not is_on_floor():
		velocity.y -= 20.0 * delta
	knockback = knockback.move_toward(Vector3.ZERO, 18.0 * delta)
	velocity.x = desired.x + knockback.x
	velocity.z = desired.z + knockback.z
	move_and_slide()


func _die() -> void:
	is_dead = true
	remove_from_group("enemies")
	collision_layer = 0
	died.emit(self)
	var tw := create_tween()
	tw.tween_property(model_root, "scale", Vector3.ZERO, 0.4).set_ease(Tween.EASE_IN)
	tw.tween_callback(queue_free)
