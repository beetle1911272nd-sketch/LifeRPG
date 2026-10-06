class_name ItemDrop
extends Area3D
## 地面に落ちるアイテム。プレイヤーが近づくと自動で拾われます。

var item_id: String = "gold"
var amount: int = 1

var _pivot: Node3D
var _t: float = 0.0
var _picked: bool = false


func setup(id: String, count: int) -> void:
	item_id = id
	amount = count


func _ready() -> void:
	collision_layer = 0
	collision_mask = 2  # プレイヤーだけ検知
	monitoring = false

	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 1.4
	shape.shape = sphere
	shape.position = Vector3(0, 0.6, 0)
	add_child(shape)

	var color := ItemData.color_of(item_id)
	var mat := MeshUtil.material(color, 0.3, color, 1.5)
	var mesh: Mesh
	var tilt := 0.0
	match item_id:
		"gold":
			var coin := CylinderMesh.new()
			coin.top_radius = 0.25
			coin.bottom_radius = 0.25
			coin.height = 0.05
			mesh = coin
			tilt = PI / 2.0
		"slime_core":
			var cube := BoxMesh.new()
			cube.size = Vector3(0.3, 0.3, 0.3)
			mesh = cube
		_:
			var orb := SphereMesh.new()
			orb.radius = 0.2
			orb.height = 0.4
			mesh = orb

	_pivot = Node3D.new()
	_pivot.position = Vector3(0, 0.6, 0)
	add_child(_pivot)
	var item_mesh := MeshUtil.instance(mesh, mat)
	item_mesh.rotation.x = tilt
	_pivot.add_child(item_mesh)

	var light := OmniLight3D.new()
	light.light_color = color
	light.omni_range = 3.0
	light.light_energy = 0.8
	light.position = Vector3(0, 0.8, 0)
	add_child(light)

	body_entered.connect(_on_body_entered)
	# 敵を倒した瞬間に拾ってしまわないよう、少し待ってから拾えるようにする
	await get_tree().create_timer(0.5).timeout
	if is_inside_tree():
		monitoring = true


func _process(delta: float) -> void:
	_t += delta
	_pivot.rotation.y += delta * 2.5
	_pivot.position.y = 0.6 + sin(_t * 3.0) * 0.12


func _on_body_entered(body: Node3D) -> void:
	if _picked or not body.is_in_group("player"):
		return
	_picked = true
	GameManager.pick_up(item_id, amount)
	queue_free()
