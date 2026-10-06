class_name EnemyAI
extends Node
## 敵の行動(AI)。EnemyBase の子ノードとして動きます。
## 待機(IDLE) → プレイヤー発見で追跡(CHASE) → 近づいたら攻撃(ATTACK)
## プレイヤーが離れると待機に戻ります。

enum State { IDLE, CHASE, ATTACK }

const ATTACK_WINDUP := 0.35  # 攻撃モーション開始から当たり判定までの時間

var body: EnemyBase
var state: State = State.IDLE

var _attack_timer: float = 0.0
var _player: PlayerController


func _physics_process(delta: float) -> void:
	if body == null or body.is_dead:
		return
	if _player == null or not is_instance_valid(_player):
		_player = get_tree().get_first_node_in_group("player") as PlayerController
	_attack_timer = maxf(0.0, _attack_timer - delta)

	var to_player := Vector3.ZERO
	var dist := INF
	var player_alive := GameManager.stats.hp > 0
	if _player != null:
		to_player = _player.global_position - body.global_position
		to_player.y = 0.0
		dist = to_player.length()
	var dir := to_player.normalized()

	var desired := Vector3.ZERO
	match state:
		State.IDLE:
			if player_alive and dist <= body.detect_range:
				state = State.CHASE
		State.CHASE:
			if not player_alive or dist > body.detect_range * 1.6:
				state = State.IDLE
			elif dist <= body.attack_range:
				state = State.ATTACK
			else:
				desired = dir * body.move_speed
				body.face(dir, delta)
		State.ATTACK:
			if not player_alive:
				state = State.IDLE
			elif dist > body.attack_range * 1.4:
				state = State.CHASE
			else:
				body.face(dir, delta)
				if _attack_timer <= 0.0:
					_attack_timer = body.attack_cooldown
					_perform_attack()

	body.apply_movement(desired, delta)


func _perform_attack() -> void:
	body.play_attack_anim()
	await get_tree().create_timer(ATTACK_WINDUP).timeout
	if not is_instance_valid(body) or body.is_dead:
		return
	if _player == null or not is_instance_valid(_player):
		return
	# 待っている間にプレイヤーが離れていたら空振り
	if body.global_position.distance_to(_player.global_position) <= body.attack_range * 1.5:
		_player.take_hit(CombatSystem.calc_damage_to_player(
			body.atk,
			GameManager.stats.defense + GameManager.equipment_bonus("def")
		))
