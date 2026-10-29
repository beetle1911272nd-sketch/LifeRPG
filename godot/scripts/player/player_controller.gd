class_name PlayerController
extends CharacterBody3D
## プレイヤー本体。移動・ジャンプ・攻撃・回避を担当します。
## 見た目は PlayerVisual に任せています(モデル差し替えは _build_visual() だけ直せばOK)。
## ステータスは GameManager.stats(PlayerStats)を参照します。

const WALK_SPEED := 5.0
const SPRINT_SPEED := 8.5
const JUMP_VELOCITY := 7.0
const GRAVITY := 22.0
const DODGE_SPEED := 15.0
const DODGE_TIME := 0.22
const DODGE_COOLDOWN := 0.7
const INVINCIBLE_TIME := 0.4
const ATTACK_COOLDOWN := 0.5
const ATTACK_RANGE := 2.8
const ATTACK_ARC_DOT := 0.1  # 正面からどれくらいの角度まで当たるか(小さいほど広い)

var camera_rig: CameraRig
var model_root: Node3D
var visual: PlayerVisual
var control_enabled: bool = true

var _attack_timer: float = 0.0
var _dodge_timer: float = 0.0
var _dodge_cooldown: float = 0.0
var _invincible_timer: float = 0.0
var _dodge_dir: Vector3 = Vector3.ZERO


func _ready() -> void:
	add_to_group("player")
	collision_layer = 2          # プレイヤー
	collision_mask = 1 | 4       # 地形 + 敵
	floor_snap_length = 0.5      # 起伏の上を走っても接地を保つ
	floor_max_angle = deg_to_rad(55.0)

	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.4
	capsule.height = 1.8
	shape.shape = capsule
	shape.position = Vector3(0, 0.9, 0)
	add_child(shape)

	model_root = Node3D.new()
	model_root.name = "ModelRoot"
	add_child(model_root)
	_build_visual()


## 3Dモデルを差し替えたいときはここを書き換えます。
func _build_visual() -> void:
	visual = PlayerVisual.new()
	model_root.add_child(visual)


func _physics_process(delta: float) -> void:
	_attack_timer = maxf(0.0, _attack_timer - delta)
	_dodge_timer = maxf(0.0, _dodge_timer - delta)
	_dodge_cooldown = maxf(0.0, _dodge_cooldown - delta)
	_invincible_timer = maxf(0.0, _invincible_timer - delta)

	if not is_on_floor():
		velocity.y -= GRAVITY * delta

	var move_dir := Vector3.ZERO
	if control_enabled:
		var input_vec := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
		var yaw := camera_rig.yaw if camera_rig != null else 0.0
		move_dir = Basis(Vector3.UP, yaw) * Vector3(input_vec.x, 0.0, input_vec.y)

		if Input.is_action_just_pressed("jump") and is_on_floor():
			velocity.y = JUMP_VELOCITY
		if Input.is_action_just_pressed("dodge"):
			_try_dodge(move_dir)
		if Input.is_action_just_pressed("attack"):
			_try_attack()
		if Input.is_action_just_pressed("use_potion"):
			_use_potion()

	var horizontal := Vector3.ZERO
	var blend := 1.0 - exp(-14.0 * delta)
	if _dodge_timer > 0.0:
		horizontal = _dodge_dir * DODGE_SPEED
		blend = 1.0
	else:
		var speed := SPRINT_SPEED if Input.is_action_pressed("sprint") else WALK_SPEED
		horizontal = move_dir * speed
		if move_dir.length() > 0.1:
			_face(move_dir, delta)

	velocity.x = lerpf(velocity.x, horizontal.x, blend)
	velocity.z = lerpf(velocity.z, horizontal.z, blend)
	move_and_slide()
	_recover_if_below_terrain()
	visual.animate(Vector2(velocity.x, velocity.z).length() / SPRINT_SPEED, delta)


## 万一地形の下へ落ちた/めり込んだ場合は地表へ戻す。
func _recover_if_below_terrain() -> void:
	var ground := TerrainBuilder.height_at(global_position.x, global_position.z)
	if global_position.y < ground - 0.6:
		global_position.y = ground + 0.3
		velocity.y = 0.0


func _face(dir: Vector3, delta: float) -> void:
	var target_angle := atan2(-dir.x, -dir.z)
	model_root.rotation.y = lerp_angle(model_root.rotation.y, target_angle, 1.0 - exp(-16.0 * delta))


# ---------------------------------------------------------------- 回避
func _try_dodge(move_dir: Vector3) -> void:
	if _dodge_cooldown > 0.0 or _dodge_timer > 0.0:
		return
	if move_dir.length() > 0.1:
		_dodge_dir = move_dir.normalized()
	else:
		_dodge_dir = -model_root.global_transform.basis.z
	_dodge_dir.y = 0.0
	_dodge_dir = _dodge_dir.normalized()
	_dodge_timer = DODGE_TIME
	_dodge_cooldown = DODGE_COOLDOWN
	_invincible_timer = INVINCIBLE_TIME
	visual.play_dodge()


# ---------------------------------------------------------------- 攻撃
func _try_attack() -> void:
	if _attack_timer > 0.0 or _dodge_timer > 0.0:
		return
	_attack_timer = ATTACK_COOLDOWN

	# 近くに敵がいれば自動でそちらを向く(アシスト)
	var target := find_nearest_enemy(ATTACK_RANGE + 1.5)
	if target != null:
		var to_target := target.global_position - global_position
		to_target.y = 0.0
		if to_target.length() > 0.05:
			model_root.rotation.y = atan2(-to_target.x, -to_target.z)

	visual.play_attack()
	await get_tree().create_timer(0.12).timeout
	if not is_inside_tree():
		return
	_apply_attack_hits()


func _apply_attack_hits() -> void:
	var forward := -model_root.global_transform.basis.z
	forward.y = 0.0
	forward = forward.normalized()
	for node in get_tree().get_nodes_in_group("enemies"):
		var enemy := node as EnemyBase
		if enemy == null or enemy.is_dead:
			continue
		var to_enemy := enemy.global_position - global_position
		to_enemy.y = 0.0
		var dist := to_enemy.length()
		if dist > ATTACK_RANGE + enemy.body_radius:
			continue
		if dist > 0.01 and forward.dot(to_enemy / dist) < ATTACK_ARC_DOT:
			continue
		var damage := CombatSystem.calc_damage(
			GameManager.stats.atk + GameManager.equipment_bonus("atk"),
			enemy.defense
		)
		enemy.take_damage(damage, self)


func find_nearest_enemy(max_dist: float) -> EnemyBase:
	var best: EnemyBase = null
	var best_dist := max_dist
	for node in get_tree().get_nodes_in_group("enemies"):
		var enemy := node as EnemyBase
		if enemy == null or enemy.is_dead:
			continue
		var d := global_position.distance_to(enemy.global_position)
		if d < best_dist:
			best_dist = d
			best = enemy
	return best


# ---------------------------------------------------------------- 被ダメージ・回復
func take_hit(amount: int) -> void:
	if _invincible_timer > 0.0 or GameManager.stats.hp <= 0:
		return
	GameManager.stats.take_damage(amount)
	_invincible_timer = 0.3  # 連続ヒットを防ぐ短い無敵
	visual.flash_hit()
	DamagePopup.spawn(self, global_position + Vector3(0, 2.2, 0), str(amount), Color(1.0, 0.35, 0.35))


func _use_potion() -> void:
	var stats := GameManager.stats
	if stats.hp <= 0 or stats.hp >= GameManager.effective_max_hp():
		return
	var potion_id := "small_potion"
	if GameManager.inventory.count(potion_id) == 0:
		potion_id = "large_potion"
	if GameManager.inventory.remove_item(potion_id, 1):
		var amount := ItemData.heal_amount(potion_id)
		GameManager.heal_player(amount)
		DamagePopup.spawn(self, global_position + Vector3(0, 2.2, 0), "+%d" % amount, Color(0.4, 1.0, 0.5))
