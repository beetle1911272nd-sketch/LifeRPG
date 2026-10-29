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


func _ready() -> void:
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


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		yaw -= event.relative.x * MOUSE_SENS
		pitch = clampf(pitch - event.relative.y * MOUSE_SENS, PITCH_MIN, PITCH_MAX)


func _process(delta: float) -> void:
	if target != null:
		var goal := target.global_position + Vector3(0.0, 1.6, 0.0)
		global_position = goal
	rotation.y = yaw
	pitch = clampf(pitch, PITCH_MIN, PITCH_MAX)
	_pivot.rotation.x = pitch
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
