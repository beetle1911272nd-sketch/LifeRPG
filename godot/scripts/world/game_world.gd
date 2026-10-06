class_name GameWorld
extends Node3D
## 「はじまりの草原」の本体。各システムを組み立てて、プレイヤー・敵・UIを配置します。
## ここは「つなぎ役」で、中身の処理は各クラスに任せています。

const SPAWN_POINT := Vector2(0.0, 10.0)
const AUTOSAVE_INTERVAL := 30.0
const ENEMY_RESPAWN_TIME := 25.0
const SLIME_SPOTS := [
	Vector2(14, -8), Vector2(-18, -14), Vector2(26, 6),
	Vector2(-30, 12), Vector2(8, -34), Vector2(-12, 30),
]
const CREATURE_SPOTS := [
	{"kind": "bat", "spot": Vector2(18, -27)},
	{"kind": "boar", "spot": Vector2(-27, -8)},
	{"kind": "bat", "spot": Vector2(34, 12)},
	{"kind": "boar", "spot": Vector2(-36, 26)},
]
const MERCHANT_POSITION := Vector2(6.0, 4.0)

var player: PlayerController
var camera_rig: CameraRig
var ui: UiManager
var merchant: ShopMerchant

var _clouds: Node3D
var _time: float = 0.0
var _autosave_timer: float = 0.0


func _ready() -> void:
	EnvironmentBuilder.build(self)
	_clouds = EnvironmentBuilder.build_clouds(self)
	TerrainBuilder.build(self)
	_spawn_player()
	_spawn_enemies()
	_spawn_merchant()
	ui = UiManager.new()
	ui.name = "UiManager"
	add_child(ui)
	ui.setup(player)
	merchant.interacted.connect(ui.open_shop)
	merchant.proximity_changed.connect(ui.hud.show_shop_prompt)
	GameManager.stats.died.connect(_on_player_died)
	GameManager.begin_play()


func _process(delta: float) -> void:
	_time += delta
	_clouds.position.x = sin(_time * 0.03) * 80.0
	_autosave_timer += delta
	if _autosave_timer >= AUTOSAVE_INTERVAL:
		_autosave_timer = 0.0
		GameManager.save_game()


# ---------------------------------------------------------------- 配置
func _spawn_position() -> Vector3:
	return Vector3(SPAWN_POINT.x, TerrainBuilder.height_at(SPAWN_POINT.x, SPAWN_POINT.y) + 1.5, SPAWN_POINT.y)


func _spawn_player() -> void:
	player = PlayerController.new()
	player.name = "Player"
	add_child(player)
	player.global_position = _spawn_position()

	camera_rig = CameraRig.new()
	camera_rig.name = "CameraRig"
	camera_rig.target = player
	add_child(camera_rig)
	camera_rig.global_position = player.global_position
	player.camera_rig = camera_rig

	player.add_child(_make_motes())


func _make_motes() -> CPUParticles3D:
	# 周りをふわふわ漂う光の粒(神聖な雰囲気づくり)
	var p := CPUParticles3D.new()
	p.name = "LightMotes"
	p.amount = 36
	p.lifetime = 6.0
	p.preprocess = 3.0
	p.local_coords = false
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	p.emission_box_extents = Vector3(18, 5, 18)
	p.direction = Vector3.UP
	p.spread = 180.0
	p.gravity = Vector3(0, 0.15, 0)
	p.initial_velocity_min = 0.1
	p.initial_velocity_max = 0.6
	var mesh := SphereMesh.new()
	mesh.radius = 0.05
	mesh.height = 0.1
	mesh.radial_segments = 6
	mesh.rings = 3
	mesh.material = MeshUtil.material(Color(1.0, 0.95, 0.6), 0.5, Color(1.0, 0.9, 0.5), 4.0)
	p.mesh = mesh
	p.position = Vector3(0, 3, 0)
	return p


func _spawn_enemies() -> void:
	for spot in SLIME_SPOTS:
		_spawn_enemy("slime", spot)
	for spawn in CREATURE_SPOTS:
		var entry: Dictionary = spawn
		_spawn_enemy(String(entry["kind"]), entry["spot"])


func _spawn_enemy(kind: String, spot: Vector2) -> void:
	var enemy: EnemyBase
	if kind == "slime":
		enemy = Slime.new()
	else:
		var creature := CreatureEnemy.new()
		creature.creature_type = kind
		enemy = creature
	add_child(enemy)
	enemy.global_position = Vector3(spot.x, TerrainBuilder.height_at(spot.x, spot.y) + 0.8, spot.y)
	enemy.died.connect(_on_enemy_died.bind(spot, kind))


func _spawn_merchant() -> void:
	merchant = ShopMerchant.new()
	merchant.name = "TravelingMerchant"
	add_child(merchant)
	merchant.global_position = Vector3(
		MERCHANT_POSITION.x,
		TerrainBuilder.height_at(MERCHANT_POSITION.x, MERCHANT_POSITION.y),
		MERCHANT_POSITION.y
	)


# ---------------------------------------------------------------- イベント
func _on_enemy_died(enemy: EnemyBase, spot: Vector2, kind: String) -> void:
	# EXP獲得(レベルアップはPlayerStatsが判定)
	GameManager.stats.add_exp(enemy.exp_reward)
	DamagePopup.spawn(self, player.global_position + Vector3(0, 2.6, 0), "+%d EXP" % enemy.exp_reward, Color(0.5, 0.85, 1.0))

	# ドロップ抽選
	for entry in enemy.drops:
		var d: Dictionary = entry
		if randf() <= float(d["chance"]):
			var drop := ItemDrop.new()
			drop.setup(String(d["id"]), randi_range(int(d["min"]), int(d["max"])))
			add_child(drop)
			drop.global_position = enemy.global_position + Vector3(randf_range(-0.8, 0.8), 0.2, randf_range(-0.8, 0.8))

	GameManager.enemy_defeated.emit(enemy.enemy_name)
	# しばらくしたら同じ場所にまた出現(探索を続けられるように)
	get_tree().create_timer(ENEMY_RESPAWN_TIME).timeout.connect(_spawn_enemy.bind(kind, spot))


func _on_player_died() -> void:
	player.control_enabled = false
	ui.hud.show_message("YOU DIED ... 草原で目を覚まします", Color(1.0, 0.4, 0.4))
	await get_tree().create_timer(2.0).timeout
	if not is_inside_tree():
		return
	GameManager.stats.revive()
	player.global_position = _spawn_position()
	player.velocity = Vector3.ZERO
	player.control_enabled = true
