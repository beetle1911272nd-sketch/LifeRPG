class_name CastleBuilder
extends RefCounted
## 遠くに見える巨大な城(今は外から見るだけ)。
## 入れる城にしたくなったら、この中身を本物のモデルやシーンに差し替えればOK。
## 城の正面は +Z 側(スタート地点のほう)を向いています。


static func build(parent: Node3D) -> void:
	var root := Node3D.new()
	root.name = "Castle"
	root.position = Vector3(TerrainBuilder.CASTLE_POS.x, TerrainBuilder.CASTLE_HEIGHT, TerrainBuilder.CASTLE_POS.y)
	root.scale = Vector3(1.28, 1.32, 1.28)
	parent.add_child(root)

	var stone := MeshUtil.material(Color(0.72, 0.7, 0.64), 0.88)
	var trim := MeshUtil.material(Color(0.84, 0.8, 0.68), 0.78)
	var roof := MeshUtil.material(Color(0.18, 0.25, 0.37), 0.56)
	var gold := MeshUtil.material(Color(0.82, 0.66, 0.34), 0.38, Color(0.72, 0.52, 0.22), 0.2)
	var glow := MeshUtil.material(Color(0.92, 0.79, 0.5), 0.5, Color(0.88, 0.66, 0.3), 0.8)
	var banner := MeshUtil.material(Color(0.34, 0.2, 0.38), 0.88)
	var gate_mat := MeshUtil.material(Color(0.12, 0.11, 0.15), 0.94)

	# 本丸(メインの建物)
	_box(root, Vector3(0, 1.5, 0), Vector3(32, 3, 24), trim)
	_box(root, Vector3(0, 17, 0), Vector3(26, 34, 18), stone)
	_box(root, Vector3(0, 3.4, 0), Vector3(28, 1.1, 20), trim)
	_box(root, Vector3(0, 31, 0), Vector3(28.5, 1.2, 20.5), trim)
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			_box(root, Vector3(12.2 * sx, 18, 8.6 * sz), Vector3(1.6, 29, 1.6), trim)
	# 中央の高い塔と屋根
	_cylinder(root, Vector3(0, 45, 0), 6.0, 22.0, stone)
	_cylinder(root, Vector3(0, 35.2, 0), 6.35, 0.9, trim)
	_cylinder(root, Vector3(0, 55.5, 0), 6.35, 0.9, trim)
	_cone(root, Vector3(0, 63, 0), 7.5, 16.0, roof)
	_cylinder(root, Vector3(0, 71.4, 0), 0.42, 2.0, gold)
	_cylinder(root, Vector3(0, 73.5, 0), 0.25, 6.0, gold)
	# 四隅の塔
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			var tx: float = 22.0 * sx
			var tz: float = 16.0 * sz
			_cylinder(root, Vector3(tx, 1.5, tz), 5.5, 3.0, trim)
			_cylinder(root, Vector3(tx, 20, tz), 5.0, 40.0, stone)
			_cylinder(root, Vector3(tx, 39.5, tz), 5.3, 1.1, trim)
			_cone(root, Vector3(tx, 46, tz), 6.5, 12.0, roof)
			_cylinder(root, Vector3(tx, 54.5, tz), 0.2, 5.0, gold)
	# 城壁
	_box(root, Vector3(0, 7, 16), Vector3(42, 14, 2.5), stone)
	_box(root, Vector3(0, 7, -16), Vector3(42, 14, 2.5), stone)
	_box(root, Vector3(22, 7, 0), Vector3(2.5, 14, 32), stone)
	_box(root, Vector3(-22, 7, 0), Vector3(2.5, 14, 32), stone)
	_box(root, Vector3(0, 13.8, 0), Vector3(43, 0.8, 33), trim)
	# 遠景でも城壁らしさが読める胸壁と門塔。
	for i in 8:
		var x := -18.0 + i * 5.2
		if absf(x) > 5.0:
			_box(root, Vector3(x, 15.2, 16), Vector3(1.8, 2.4, 2.2), trim)
		_box(root, Vector3(x, 15.2, -16), Vector3(1.8, 2.4, 2.2), trim)
	for side in [-1.0, 1.0]:
		for i in 6:
			var z := -12.0 + i * 4.8
			_box(root, Vector3(side * 22.0, 15.2, z), Vector3(2.2, 2.4, 1.8), trim)
		_cylinder(root, Vector3(side * 7.2, 10, 16.5), 2.0, 20.0, stone)
		_cone(root, Vector3(side * 7.2, 22, 16.5), 2.8, 5.0, roof)
	# 正門
	_box(root, Vector3(0, 4.6, 15.8), Vector3(6.5, 9.2, 0.3), gate_mat)
	_box(root, Vector3(-4.2, 6.5, 16.3), Vector3(1.4, 13, 3.2), trim)
	_box(root, Vector3(4.2, 6.5, 16.3), Vector3(1.4, 13, 3.2), trim)
	_box(root, Vector3(0, 13.3, 16.3), Vector3(9.8, 1.4, 3.2), trim)
	_box(root, Vector3(0, 11.6, 18.1), Vector3(8, 0.45, 0.35), gold)
	# 旗(本丸の正面)
	_cylinder(root, Vector3(-8, 24, 9.2), 0.09, 14.0, gold)
	_cylinder(root, Vector3(8, 24, 9.2), 0.09, 14.0, gold)
	_box(root, Vector3(-8, 22, 9.35), Vector3(2.7, 7.0, 0.18), banner)
	_box(root, Vector3(8, 22, 9.35), Vector3(2.7, 7.0, 0.18), banner)
	# 光る窓
	for wx in [-9.0, -3.0, 3.0, 9.0]:
		for wy in [14.0, 28.0]:
			_box(root, Vector3(wx, wy, 9.16), Vector3(1.9, 3.7, 0.38), trim)
			_box(root, Vector3(wx, wy, 9.38), Vector3(1.1, 2.8, 0.18), glow)
	for wx in [-10.0, 10.0]:
		_box(root, Vector3(wx, 19.5, -9.1), Vector3(1.2, 3.0, 0.18), glow)

	# 城に入れない代わりの当たり判定(大きな箱ひとつ)
	var body := StaticBody3D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(52, 30, 38)
	cs.shape = shape
	cs.position = Vector3(0, 15, 0)
	body.add_child(cs)
	root.add_child(body)


static func _box(parent: Node3D, pos: Vector3, size: Vector3, mat: Material) -> void:
	var mesh := BoxMesh.new()
	mesh.size = size
	parent.add_child(MeshUtil.instance(mesh, mat, pos))


static func _cylinder(parent: Node3D, pos: Vector3, radius: float, height: float, mat: Material) -> void:
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = 20
	parent.add_child(MeshUtil.instance(mesh, mat, pos))


static func _cone(parent: Node3D, pos: Vector3, radius: float, height: float, mat: Material) -> void:
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.0
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = 20
	parent.add_child(MeshUtil.instance(mesh, mat, pos))
