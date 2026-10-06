class_name CameraRig
extends Node3D
## 三人称カメラ。プレイヤーを追いかけ、マウスで回転します。
## 構造: CameraRig(左右回転) → PitchPivot(上下回転) → SpringArm3D → Camera3D
## SpringArm3D は壁や地面にめり込みそうなとき自動でカメラを手前に引いてくれます。

const MOUSE_SENS := 0.0028
const PITCH_MIN := -1.25  # 真上から見下ろす限界
const PITCH_MAX := 0.30   # 下から見上げる限界
const ARM_LENGTH := 6.5

var target: Node3D
var yaw: float = 0.0
var pitch: float = -0.35
var camera: Camera3D

var _pivot: Node3D
var _arm: SpringArm3D


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
		global_position = global_position.lerp(goal, 1.0 - exp(-14.0 * delta))
	rotation.y = yaw
	_pivot.rotation.x = pitch
