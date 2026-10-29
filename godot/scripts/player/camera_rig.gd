class_name CameraRig
extends Node3D
## 三人称カメラ。プレイヤーを追いかけ、マウスで回転します。
## 構造: CameraRig(左右回転) → PitchPivot(上下回転) → SpringArm3D → Camera3D
## SpringArm3D は壁や地面にめり込みそうなとき自動でカメラを手前に引いてくれます。

const MOUSE_SENS := 0.0028
const PITCH_MIN := -1.25  # 真上から見下ろす限界
const PITCH_MAX := 1.2  # 少し見上げられる。地面との干渉は下のクリアランス補正で吸収
const MIN_CAMERA_CLEARANCE := 0.6  # カメラと地面の最低距離
const ARM_LENGTH := 6.5

var target: Node3D
var yaw: float = 0.0
var pitch: float = -0.35  # 起動時は PITCH_MIN〜PITCH_MAX の範囲内
var camera: Camera3D

var _pivot: Node3D
var _arm: SpringArm3D
var _lift: float = 0.0
var _view_model: Node3D
var _view_sword: Node3D
var _view_tween: Tween


func _ready() -> void:
	physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	_pivot = Node3D.new()
	_pivot.name = "PitchPivot"
	add_child(_pivot)

	_arm = SpringArm3D.new()
	_arm.spring_length = ARM_LENGTH
	_arm.margin = 0.3
	_arm.collision_mask = 1  # 地形・建物だけ判定
	_pivot.add_child(_arm)

	camera = Camera3D.new()
	camera.fov = 70.0
	camera.near = 0.15
	camera.far = 3000.0
	_arm.add_child(camera)
	camera.make_current()
	_build_view_model()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var k := MOUSE_SENS * GameSettings.look_sens
		yaw -= event.relative.x * k
		pitch = clampf(pitch - event.relative.y * k, _pitch_min(), _pitch_max())


func _process(delta: float) -> void:
	if target != null:
		# 物理補間済みの位置に追従させる(生の物理位置だと移動中に震える)
		var goal := target.get_global_transform_interpolated().origin + Vector3(0.0, 1.6, 0.0)
		global_position = goal
	rotation.y = yaw
	pitch = clampf(pitch, _pitch_min(), _pitch_max())
	_pivot.rotation.x = pitch
	if GameSettings.first_person:
		_apply_first_person(delta)
		return
	_set_first_person_visuals(false)
	_view_model.visible = false
	camera.near = 0.15
	# 見上げるときはカメラが地面に潜らないよう、腕を縮めて寄る
	var want := ARM_LENGTH
	if pitch > 0.05:
		want = clampf(1.0 / sin(pitch), 2.5, ARM_LENGTH)
	_arm.spring_length = lerpf(_arm.spring_length, want, 1.0 - exp(-12.0 * delta))
	_keep_camera_above_ground(delta)


## 起伏のある地形でもカメラが地面にめり込まないよう、足元の高さより上に持ち上げる。
func _keep_camera_above_ground(delta: float) -> void:
	if camera == null or not camera.is_inside_tree():
		return
	var cam_pos := camera.global_position
	var floor_y := TerrainBuilder.height_at(cam_pos.x, cam_pos.z) + MIN_CAMERA_CLEARANCE
	var need := maxf(floor_y - (cam_pos.y - _pivot.position.y), 0.0)
	# 持ち上げ量は上がる時は素早く、下がる時はゆっくり変化させ、移動中のガタつきを防ぐ
	var rate := 20.0 if need > _lift else 4.0
	_lift = lerpf(_lift, need, 1.0 - exp(-rate * delta))
	_pivot.position.y = _lift


func _pitch_min() -> float:
	return -1.45 if GameSettings.first_person else PITCH_MIN


func _pitch_max() -> float:
	return 1.45 if GameSettings.first_person else PITCH_MAX


## 一人称: 腕を0にして頭の位置にカメラを置き、自キャラを隠す。
func _apply_first_person(delta: float) -> void:
	_arm.spring_length = lerpf(_arm.spring_length, 0.0, 1.0 - exp(-20.0 * delta))
	_pivot.position.y = 0.0
	_lift = 0.0
	camera.near = 0.05
	_set_first_person_visuals(true)
	_view_model.visible = true
	_connect_attack()


func _set_first_person_visuals(on: bool) -> void:
	var p := target as PlayerController
	if p != null and p.visual != null:
		p.visual.visible = not on


## 一人称で視界に入る腕と剣。カメラに固定し、攻撃時に振る。
func _build_view_model() -> void:
	_view_model = Node3D.new()
	_view_model.visible = false
	camera.add_child(_view_model)
	var tunic := MeshUtil.material(Color(0.14, 0.24, 0.62), 0.7)
	var skin := MeshUtil.material(Color(0.96, 0.78, 0.65), 0.8)
	var steel := MeshUtil.material(Color(0.88, 0.92, 1.0), 0.2, Color(0.6, 0.75, 1.0), 0.5)
	var gold := MeshUtil.material(Color(0.95, 0.8, 0.35), 0.3, Color(0.9, 0.7, 0.2), 0.4)

	var arm_mesh := CapsuleMesh.new()
	arm_mesh.radius = 0.06
	arm_mesh.height = 0.55
	var hand_mesh := SphereMesh.new()
	hand_mesh.radius = 0.065
	hand_mesh.height = 0.13
	# 左腕(下がっている)
	var left := MeshUtil.instance(arm_mesh, tunic, Vector3(-0.32, -0.34, -0.5))
	left.rotation_degrees = Vector3(-70.0, 0.0, -12.0)
	_view_model.add_child(left)
	_view_model.add_child(MeshUtil.instance(hand_mesh, skin, Vector3(-0.28, -0.3, -0.76)))
	# 右腕 + 剣(支点を握りに置いて振る)
	var right := MeshUtil.instance(arm_mesh, tunic, Vector3(0.3, -0.34, -0.5))
	right.rotation_degrees = Vector3(-70.0, 0.0, 12.0)
	_view_model.add_child(right)
	_view_sword = Node3D.new()
	_view_sword.position = Vector3(0.27, -0.3, -0.76)
	_view_sword.rotation_degrees = Vector3(-20.0, 0.0, -8.0)
	_view_model.add_child(_view_sword)
	_view_sword.add_child(MeshUtil.instance(hand_mesh, skin, Vector3.ZERO))
	var blade := BoxMesh.new()
	blade.size = Vector3(0.05, 0.7, 0.015)
	_view_sword.add_child(MeshUtil.instance(blade, steel, Vector3(0, 0.45, 0)))
	var guard := BoxMesh.new()
	guard.size = Vector3(0.2, 0.03, 0.04)
	_view_sword.add_child(MeshUtil.instance(guard, gold, Vector3(0, 0.1, 0)))
	for m in _view_model.get_children():
		_no_shadow(m)


func _no_shadow(n: Node) -> void:
	var gi := n as GeometryInstance3D
	if gi != null:
		gi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for c in n.get_children():
		_no_shadow(c)


func _on_attacked() -> void:
	if _view_sword == null:
		return
	if _view_tween != null and _view_tween.is_valid():
		_view_tween.kill()
	var rest := Vector3(-20.0, 0.0, -8.0)
	_view_sword.rotation_degrees = rest
	_view_tween = create_tween()
	_view_tween.tween_property(_view_sword, "rotation_degrees", Vector3(-95.0, 0.0, 25.0), 0.09).set_ease(Tween.EASE_OUT)
	_view_tween.tween_interval(0.06)
	_view_tween.tween_property(_view_sword, "rotation_degrees", rest, 0.2)


func _connect_attack() -> void:
	var p := target as PlayerController
	if p != null and p.visual != null and not p.visual.attacked.is_connected(_on_attacked):
		p.visual.attacked.connect(_on_attacked)
