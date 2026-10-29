class_name PlayerVisual
extends Node3D
## プレイヤーの「見た目」だけを担当する簡易モデル(カプセルや球の組み合わせ)。
## 後で本物の3Dキャラ(.glb など)に差し替えるときは、このノードごと
## 同じ関数(animate / play_attack / play_dodge / flash_hit)を持つ別シーンに置き換えればOK。
## 「前」は -Z 方向です。

const SWORD_REST := -0.25

var _body_root: Node3D
var _left_leg: Node3D
var _right_leg: Node3D
var _sword_pivot: Node3D
var _attack_tween: Tween
signal attacked
var _flash_base: Dictionary = {}
var _t: float = 0.0


func _ready() -> void:
	_build()


func _build() -> void:
	var tunic := _flash_mat(Color(0.14, 0.24, 0.62), 0.7)
	var skin := _flash_mat(Color(0.96, 0.78, 0.65), 0.8)
	var hair := _flash_mat(Color(0.25, 0.15, 0.1), 0.9)
	var dark := _flash_mat(Color(0.12, 0.12, 0.18), 0.9)
	var cape := _flash_mat(Color(0.7, 0.12, 0.18), 0.8)
	var gold := MeshUtil.material(Color(0.95, 0.8, 0.35), 0.3, Color(0.9, 0.7, 0.2), 0.4)
	var steel := MeshUtil.material(Color(0.88, 0.92, 1.0), 0.2, Color(0.6, 0.75, 1.0), 0.5)

	_body_root = Node3D.new()
	_body_root.name = "Body"
	add_child(_body_root)

	# 胴体
	var torso := CapsuleMesh.new()
	torso.radius = 0.3
	torso.height = 1.0
	_body_root.add_child(MeshUtil.instance(torso, tunic, Vector3(0, 0.88, 0)))

	# ベルト
	var belt := CylinderMesh.new()
	belt.top_radius = 0.31
	belt.bottom_radius = 0.31
	belt.height = 0.08
	_body_root.add_child(MeshUtil.instance(belt, gold, Vector3(0, 0.72, 0)))

	# マント(背中側 = +Z)
	var cape_mesh := BoxMesh.new()
	cape_mesh.size = Vector3(0.55, 0.95, 0.05)
	var cape_node := MeshUtil.instance(cape_mesh, cape, Vector3(0, 0.95, 0.3))
	cape_node.rotation.x = deg_to_rad(8.0)
	_body_root.add_child(cape_node)

	# 頭・髪・目
	var head := SphereMesh.new()
	head.radius = 0.22
	head.height = 0.44
	_body_root.add_child(MeshUtil.instance(head, skin, Vector3(0, 1.58, 0)))
	var hair_mesh := SphereMesh.new()
	hair_mesh.radius = 0.24
	hair_mesh.height = 0.44
	_body_root.add_child(MeshUtil.instance(hair_mesh, hair, Vector3(0, 1.64, 0.04)))
	var eye := SphereMesh.new()
	eye.radius = 0.035
	eye.height = 0.07
	_body_root.add_child(MeshUtil.instance(eye, dark, Vector3(-0.08, 1.57, -0.19)))
	_body_root.add_child(MeshUtil.instance(eye, dark, Vector3(0.08, 1.57, -0.19)))

	# 脚(腰を支点に振る)
	var leg_mesh := CapsuleMesh.new()
	leg_mesh.radius = 0.1
	leg_mesh.height = 0.62
	_left_leg = Node3D.new()
	_left_leg.position = Vector3(-0.14, 0.62, 0)
	_left_leg.add_child(MeshUtil.instance(leg_mesh, dark, Vector3(0, -0.3, 0)))
	_body_root.add_child(_left_leg)
	_right_leg = Node3D.new()
	_right_leg.position = Vector3(0.14, 0.62, 0)
	_right_leg.add_child(MeshUtil.instance(leg_mesh, dark, Vector3(0, -0.3, 0)))
	_body_root.add_child(_right_leg)

	# 腕
	var arm_mesh := CapsuleMesh.new()
	arm_mesh.radius = 0.075
	arm_mesh.height = 0.55
	_body_root.add_child(MeshUtil.instance(arm_mesh, tunic, Vector3(-0.38, 0.98, 0)))
	_body_root.add_child(MeshUtil.instance(arm_mesh, tunic, Vector3(0.38, 0.98, 0)))

	# 剣(右手。握り部分を支点にして振る)
	_sword_pivot = Node3D.new()
	_sword_pivot.position = Vector3(0.4, 0.8, -0.05)
	_sword_pivot.rotation.x = SWORD_REST
	_body_root.add_child(_sword_pivot)
	var blade := BoxMesh.new()
	blade.size = Vector3(0.07, 0.95, 0.02)
	_sword_pivot.add_child(MeshUtil.instance(blade, steel, Vector3(0, 0.62, 0)))
	var guard := BoxMesh.new()
	guard.size = Vector3(0.28, 0.04, 0.06)
	_sword_pivot.add_child(MeshUtil.instance(guard, gold, Vector3(0, 0.14, 0)))
	var grip := CylinderMesh.new()
	grip.top_radius = 0.03
	grip.bottom_radius = 0.03
	grip.height = 0.2
	_sword_pivot.add_child(MeshUtil.instance(grip, dark, Vector3(0, 0.02, 0)))


func _flash_mat(color: Color, roughness: float) -> StandardMaterial3D:
	var m := MeshUtil.material(color, roughness)
	_flash_base[m] = color
	return m


func animate(speed_ratio: float, delta: float) -> void:
	_t += delta * (3.0 + speed_ratio * 9.0)
	var swing := sin(_t) * speed_ratio
	_left_leg.rotation.x = swing * 0.9
	_right_leg.rotation.x = -swing * 0.9
	_body_root.position.y = absf(sin(_t)) * 0.06 * speed_ratio


func play_attack() -> void:
	attacked.emit()
	if _attack_tween != null and _attack_tween.is_valid():
		_attack_tween.kill()
	_sword_pivot.rotation.x = SWORD_REST
	_attack_tween = create_tween()
	_attack_tween.tween_property(_sword_pivot, "rotation:x", -2.1, 0.09).set_ease(Tween.EASE_OUT)
	_attack_tween.tween_interval(0.08)
	_attack_tween.tween_property(_sword_pivot, "rotation:x", SWORD_REST, 0.22)


func play_dodge() -> void:
	scale = Vector3(1.2, 0.65, 1.2)
	var tw := create_tween()
	tw.tween_property(self, "scale", Vector3.ONE, 0.28)


func flash_hit() -> void:
	for m in _flash_base:
		var mat := m as StandardMaterial3D
		var base: Color = _flash_base[m]
		mat.albedo_color = Color(1.0, 0.4, 0.4)
		var tw := create_tween()
		tw.tween_property(mat, "albedo_color", base, 0.25)
