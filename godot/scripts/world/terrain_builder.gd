class_name TerrainBuilder
extends RefCounted
## 「はじまりの草原」の地形を作ります。
## 地面(起伏あり)・湖・草・木・岩・遠くの山・見えない壁。城は CastleBuilder が作ります。
## height_at(x, z) で「その場所の地面の高さ」が分かるので、敵やプレイヤーの配置に使えます。

const WORLD_HALF := 220.0
const STEP := 2.5
const LAKE_CENTER := Vector2(48.0, 34.0)
const LAKE_RADIUS := 24.0
const CASTLE_POS := Vector2(0.0, -165.0)
const CASTLE_HEIGHT := 9.0

static var _noise: FastNoiseLite
static var _detail_noise: FastNoiseLite


static func _get_noise() -> FastNoiseLite:
	if _noise == null:
		_noise = FastNoiseLite.new()
		_noise.seed = 20260
		_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
		_noise.frequency = 0.011
		_noise.fractal_octaves = 3
	return _noise


static func _get_detail_noise() -> FastNoiseLite:
	if _detail_noise == null:
		_detail_noise = FastNoiseLite.new()
		_detail_noise.seed = 4127
		_detail_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX
		_detail_noise.frequency = 0.035
		_detail_noise.fractal_octaves = 2
	return _detail_noise


static func height_at(x: float, z: float) -> float:
	var h := _get_noise().get_noise_2d(x, z) * 6.6 + _get_detail_noise().get_noise_2d(x, z) * 0.85 + 3.0
	var pos := Vector2(x, z)
	# スタート地点の周りは平らに
	h = lerpf(0.5, h, smoothstep(10.0, 45.0, pos.length()))
	# 湖のくぼみ
	h = lerpf(-3.0, h, smoothstep(LAKE_RADIUS * 0.7, LAKE_RADIUS * 1.5, pos.distance_to(LAKE_CENTER)))
	# 世界の端はゆるやかに沈める
	h = lerpf(h, -6.0, smoothstep(180.0, 220.0, maxf(absf(x), absf(z))))
	# 城の土台は平らな高台
	h = lerpf(CASTLE_HEIGHT, h, smoothstep(34.0, 70.0, pos.distance_to(CASTLE_POS)))
	return h


static func is_free_spot(x: float, z: float, min_spawn_dist: float = 14.0) -> bool:
	var pos := Vector2(x, z)
	if pos.length() < min_spawn_dist:
		return false
	if pos.distance_to(LAKE_CENTER) < LAKE_RADIUS * 1.6:
		return false
	if pos.distance_to(CASTLE_POS) < 58.0:
		return false
	return height_at(x, z) > 0.2


static func build(parent: Node3D) -> void:
	_build_ground(parent)
	_build_water(parent)
	_build_boundaries(parent)
	_build_far_ground(parent)
	_build_mountains(parent)
	_scatter_grass(parent)
	_scatter_trees(parent)
	_scatter_rocks(parent)
	_scatter_flora(parent)
	_build_castle_trail(parent)
	CastleBuilder.build(parent)


# ---------------------------------------------------------------- 地面
static func _ground_color(x: float, z: float, h: float, slope: float) -> Color:
	var t := _get_noise().get_noise_2d(x * 3.1 + 100.0, z * 3.1) * 0.5 + 0.5
	var patch := _get_detail_noise().get_noise_2d(x * 2.4, z * 2.4) * 0.5 + 0.5
	var col := Color(0.18, 0.34, 0.19).lerp(Color(0.38, 0.54, 0.27), t)
	col = col.lerp(Color(0.48, 0.49, 0.25), smoothstep(0.68, 0.94, patch) * 0.28)
	col = col.lerp(Color(0.16, 0.3, 0.21), smoothstep(0.0, 0.28, patch) * 0.24)
	# 水辺は砂色
	col = col.lerp(Color(0.68, 0.6, 0.4), (1.0 - smoothstep(-0.6, 0.4, h)) * 0.9)
	# 急な斜面は岩肌
	col = col.lerp(Color(0.39, 0.4, 0.39), smoothstep(0.32, 0.72, slope))
	return col


static func _build_ground(parent: Node3D) -> void:
	var segs := int(WORLD_HALF * 2.0 / STEP)
	var row := segs + 1
	var heights := PackedFloat32Array()
	heights.resize(row * row)
	for iz in row:
		for ix in row:
			var x := -WORLD_HALF + ix * STEP
			var z := -WORLD_HALF + iz * STEP
			heights[iz * row + ix] = height_at(x, z)

	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for iz in row:
		for ix in row:
			var x := -WORLD_HALF + ix * STEP
			var z := -WORLD_HALF + iz * STEP
			var index := iz * row + ix
			var h := heights[index]
			var left := iz * row + maxi(ix - 1, 0)
			var right := iz * row + mini(ix + 1, segs)
			var near := maxi(iz - 1, 0) * row + ix
			var far := mini(iz + 1, segs) * row + ix
			var slope_x := (heights[right] - heights[left]) / (float(mini(ix + 1, segs) - maxi(ix - 1, 0)) * STEP)
			var slope_z := (heights[far] - heights[near]) / (float(mini(iz + 1, segs) - maxi(iz - 1, 0)) * STEP)
			st.set_color(_ground_color(x, z, h, Vector2(slope_x, slope_z).length()))
			st.set_uv(Vector2(ix, iz) * 0.1)
			st.add_vertex(Vector3(x, h, z))
	for iz in segs:
		for ix in segs:
			var a := iz * row + ix
			var b := a + 1
			var c := a + row + 1
			var d := a + row
			st.add_index(a)
			st.add_index(b)
			st.add_index(c)
			st.add_index(a)
			st.add_index(c)
			st.add_index(d)
	st.generate_normals()
	var mesh := st.commit()

	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 1.0
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mesh.surface_set_material(0, mat)

	var body := StaticBody3D.new()
	body.name = "Ground"
	body.collision_layer = 1
	body.collision_mask = 0
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	body.add_child(mi)
	var cs := CollisionShape3D.new()
	cs.shape = mesh.create_trimesh_shape()
	body.add_child(cs)
	parent.add_child(body)


static func _build_water(parent: Node3D) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var segments := 72
	var center := Vector3.ZERO
	var rng := RandomNumberGenerator.new()
	rng.seed = 81
	var edge: Array[Vector3] = []
	for i in segments:
		var angle := TAU * float(i) / float(segments)
		var radius := LAKE_RADIUS * 0.96 + sin(angle * 5.0 + 0.7) * 1.1 + sin(angle * 9.0) * 0.55
		radius += rng.randf_range(-0.25, 0.25)
		edge.append(Vector3(cos(angle) * radius, 0.0, sin(angle) * radius))
	for i in segments:
		var next := (i + 1) % segments
		st.set_color(Color(0.85, 0.93, 0.98, 1.0))
		st.add_vertex(center)
		st.add_vertex(edge[next])
		st.add_vertex(edge[i])
	st.generate_normals()
	var water_mesh := st.commit()
	var mat := MeshUtil.material(Color(0.26, 0.49, 0.65, 0.84), 0.2)
	mat.metallic = 0.12
	mat.clearcoat_enabled = true
	mat.clearcoat = 0.28
	water_mesh.surface_set_material(0, mat)
	var mi := MeshUtil.instance(water_mesh, mat, Vector3(LAKE_CENTER.x, -0.55, LAKE_CENTER.y))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.name = "Lake"
	parent.add_child(mi)


static func _build_boundaries(parent: Node3D) -> void:
	# 世界の端に見えない壁(外に落ちないように)
	var half := WORLD_HALF - 14.0
	var walls := [
		[Vector3(half + 1.0, 20, 0), Vector3(2, 80, half * 2.0)],
		[Vector3(-half - 1.0, 20, 0), Vector3(2, 80, half * 2.0)],
		[Vector3(0, 20, half + 1.0), Vector3(half * 2.0, 80, 2)],
		[Vector3(0, 20, -half - 1.0), Vector3(half * 2.0, 80, 2)],
	]
	var body := StaticBody3D.new()
	body.name = "InvisibleWalls"
	body.collision_layer = 1
	body.collision_mask = 0
	for w in walls:
		var cs := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = w[1]
		cs.shape = box
		cs.position = w[0]
		body.add_child(cs)
	parent.add_child(body)


static func _build_far_ground(parent: Node3D) -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(3000, 3000)
	var mi := MeshUtil.instance(plane, MeshUtil.material(Color(0.2, 0.38, 0.24), 1.0), Vector3(0, -6.3, 0))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)


static func _build_mountains(parent: Node3D) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 11
	var count := 26
	for i in count:
		var ang := TAU * i / float(count) + rng.randf_range(-0.12, 0.12)
		# 城の背後は稜線を左右に逃がし、遠景のランドマークを隠さない。
		var castle_sightline := wrapf(ang + PI * 0.5, -PI, PI)
		if absf(castle_sightline) < 0.25:
			ang += 0.34 if castle_sightline >= 0.0 else -0.34
		var dist := rng.randf_range(285.0, 375.0)
		var hgt := rng.randf_range(88.0, 168.0)
		var rad := rng.randf_range(54.0, 92.0)
		var base_pos := Vector3(cos(ang) * dist, 0.0, sin(ang) * dist)
		var mountain_mesh := _build_mountain_mesh(rad, hgt, rng)
		var rock_mat := MeshUtil.material(Color.WHITE, 1.0)
		rock_mat.vertex_color_use_as_albedo = true
		rock_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		var mountain := MeshUtil.instance(mountain_mesh, rock_mat, base_pos + Vector3(0.0, -6.0, 0.0))
		mountain.name = "DistantPeak%02d" % i
		mountain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		parent.add_child(mountain)


static func _build_mountain_mesh(radius: float, height: float, rng: RandomNumberGenerator) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var segments := rng.randi_range(9, 12)
	var base_ring: Array[Vector3] = []
	var middle_ring: Array[Vector3] = []
	var upper_ring: Array[Vector3] = []
	for i in segments:
		var angle := TAU * float(i) / float(segments) + rng.randf_range(-0.13, 0.13)
		var base_radius := radius * rng.randf_range(0.88, 1.12)
		base_ring.append(Vector3(cos(angle) * base_radius, rng.randf_range(-1.0, 2.0), sin(angle) * base_radius))
		var middle_radius := radius * rng.randf_range(0.57, 0.76)
		middle_ring.append(Vector3(cos(angle) * middle_radius, height * rng.randf_range(0.26, 0.4), sin(angle) * middle_radius))
		var upper_radius := radius * rng.randf_range(0.22, 0.38)
		upper_ring.append(Vector3(cos(angle) * upper_radius, height * rng.randf_range(0.61, 0.76), sin(angle) * upper_radius))

	var summit := Vector3(rng.randf_range(-radius * 0.12, radius * 0.12), height, rng.randf_range(-radius * 0.12, radius * 0.12))
	for i in segments:
		var next := (i + 1) % segments
		_add_mountain_face(st, base_ring[i], base_ring[next], middle_ring[next], height)
		_add_mountain_face(st, base_ring[i], middle_ring[next], middle_ring[i], height)
		_add_mountain_face(st, middle_ring[i], middle_ring[next], upper_ring[next], height)
		_add_mountain_face(st, middle_ring[i], upper_ring[next], upper_ring[i], height)
	for i in segments:
		var next := (i + 1) % segments
		_add_mountain_face(st, upper_ring[i], upper_ring[next], summit, height)
	st.generate_normals()
	return st.commit()


static func _add_mountain_face(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, height: float) -> void:
	var normal := (b - a).cross(c - a)
	var center := (a + b + c) / 3.0
	var radial := Vector3(center.x, 0.0, center.z)
	var p1 := b
	var p2 := c
	if normal.dot(radial) < 0.0:
		p1 = c
		p2 = b
	var elevation := clampf(center.y / height, 0.0, 1.0)
	var rock := Color(0.31, 0.39, 0.49).lerp(Color(0.68, 0.74, 0.77), smoothstep(0.55, 0.94, elevation) * 0.84)
	var shade := 0.88 + clampf(normal.normalized().dot(Vector3(0.35, 0.8, 0.2)), -0.5, 0.5) * 0.16
	rock *= shade
	st.set_color(rock)
	st.add_vertex(a)
	st.add_vertex(p1)
	st.add_vertex(p2)


# ---------------------------------------------------------------- 草・木・岩
static func _multimesh(mesh: Mesh, mat: Material, xforms: Array[Transform3D], colors: Array[Color] = []) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = colors.size() == xforms.size() and colors.size() > 0
	mm.mesh = mesh
	mm.instance_count = xforms.size()
	for i in xforms.size():
		mm.set_instance_transform(i, xforms[i])
		if mm.use_colors:
			mm.set_instance_color(i, colors[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.material_override = mat
	return mmi


static func _scatter_grass(parent: Node3D) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 3
	var blade := PrismMesh.new()
	blade.size = Vector3(0.12, 0.55, 0.02)
	var mat := MeshUtil.material(Color.WHITE, 1.0)
	mat.vertex_color_use_as_albedo = true
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED

	var xforms: Array[Transform3D] = []
	var colors: Array[Color] = []
	for i in 1800:
		var cx := rng.randf_range(-120.0, 120.0)
		var cz := rng.randf_range(-120.0, 120.0)
		var h := height_at(cx, cz)
		if h < 0.0 or Vector2(cx, cz).distance_to(CASTLE_POS) < 50.0 or _near_castle_trail(cx, cz, 8.5):
			continue
		for k in 3:
			var x := cx + rng.randf_range(-0.5, 0.5)
			var z := cz + rng.randf_range(-0.5, 0.5)
			var s := rng.randf_range(0.8, 1.7)
			var basis := Basis.from_euler(Vector3(rng.randf_range(-0.25, 0.25), rng.randf() * TAU, 0.0)).scaled(Vector3(s, s, s))
			xforms.append(Transform3D(basis, Vector3(x, height_at(x, z) + 0.27 * s, z)))
			colors.append(Color(rng.randf_range(0.22, 0.42), rng.randf_range(0.55, 0.82), rng.randf_range(0.14, 0.3)))
	var mmi := _multimesh(blade, mat, xforms, colors)
	mmi.name = "Grass"
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mmi)


static func _scatter_trees(parent: Node3D) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	var forest_centers: Array[Vector2] = [
		Vector2(-105.0, -112.0), Vector2(102.0, -126.0),
		Vector2(-126.0, 94.0), Vector2(122.0, 92.0),
		Vector2(-170.0, -26.0), Vector2(170.0, 18.0),
	]

	var trunk_mesh := CylinderMesh.new()
	trunk_mesh.top_radius = 0.18
	trunk_mesh.bottom_radius = 0.28
	trunk_mesh.height = 2.4
	trunk_mesh.radial_segments = 8
	var cone_a := CylinderMesh.new()
	cone_a.top_radius = 0.0
	cone_a.bottom_radius = 1.8
	cone_a.height = 3.2
	cone_a.radial_segments = 8
	var cone_b := CylinderMesh.new()
	cone_b.top_radius = 0.0
	cone_b.bottom_radius = 1.3
	cone_b.height = 2.6
	cone_b.radial_segments = 8
	var broadleaf := SphereMesh.new()
	broadleaf.radius = 1.9
	broadleaf.height = 3.2
	broadleaf.radial_segments = 10
	broadleaf.rings = 5
	var blossom := SphereMesh.new()
	blossom.radius = 2.0
	blossom.height = 3.6
	blossom.radial_segments = 12
	blossom.rings = 6

	var trunks: Array[Transform3D] = []
	var cones_a: Array[Transform3D] = []
	var cones_b: Array[Transform3D] = []
	var bare_branches: Array[Transform3D] = []
	var broadleaves: Array[Transform3D] = []
	var blossoms: Array[Transform3D] = []
	var trunk_colors: Array[Color] = []
	var branch_colors: Array[Color] = []
	var leaf_colors: Array[Color] = []
	var upper_leaf_colors: Array[Color] = []
	var broadleaf_colors: Array[Color] = []
	var blossom_colors: Array[Color] = []
	var tree_positions: Array[Vector2] = []
	var branch_mesh := CylinderMesh.new()
	branch_mesh.top_radius = 0.035
	branch_mesh.bottom_radius = 0.085
	branch_mesh.height = 1.35
	branch_mesh.radial_segments = 6

	var body := StaticBody3D.new()
	body.name = "TreeColliders"
	body.collision_layer = 1
	body.collision_mask = 0

	var placed := 0
	var attempts := 0
	while placed < 160 and attempts < 2000:
		attempts += 1
		var spot := Vector2.ZERO
		if rng.randf() < 0.82:
			var center := forest_centers[rng.randi_range(0, forest_centers.size() - 1)]
			var angle := rng.randf() * TAU
			var distance := rng.randf_range(12.0, 44.0)
			spot = center + Vector2(cos(angle), sin(angle)) * distance
		else:
			spot = Vector2(rng.randf_range(-190.0, 190.0), rng.randf_range(-190.0, 190.0))
		var x := spot.x
		var z := spot.y
		if not is_free_spot(x, z):
			continue
		if _near_castle_trail(x, z, 10.0):
			continue
		var too_close := false
		for previous in tree_positions:
			if previous.distance_to(spot) < 4.8:
				too_close = true
				break
		if too_close:
			continue
		var h := height_at(x, z)
		var s := rng.randf_range(0.8, 1.7)
		var yaw := rng.randf() * TAU
		var basis := Basis(Vector3.UP, yaw).scaled(Vector3(s, s, s))
		trunks.append(Transform3D(basis, Vector3(x, h + 1.2 * s, z)))
		var bark_tint := Color(0.82, 0.9, 1.0) * rng.randf_range(0.9, 1.0)
		trunk_colors.append(bark_tint)
		var canopy_position := Vector3(x, h + 3.8 * s, z)
		if placed % 11 == 0:
			# 枝だけの木を少数混ぜ、森のシルエットに変化をつける。
			for side in [-1.0, 1.0]:
				var branch_basis := Basis(Vector3.UP, yaw) * Basis(Vector3.FORWARD, side * rng.randf_range(0.38, 0.72))
				branch_basis = branch_basis.scaled(Vector3(s, s, s))
				bare_branches.append(Transform3D(branch_basis, Vector3(x + side * 0.28 * s, h + 3.0 * s, z)))
				branch_colors.append(bark_tint * 0.88)
		elif placed % 5 == 0:
			broadleaves.append(Transform3D(basis, canopy_position))
			broadleaf_colors.append(Color(rng.randf_range(0.78, 0.95), rng.randf_range(0.82, 0.98), rng.randf_range(0.72, 0.9)))
		elif placed % 7 == 0:
			blossoms.append(Transform3D(basis, canopy_position))
			blossom_colors.append(Color(rng.randf_range(0.88, 1.0), rng.randf_range(0.78, 0.9), rng.randf_range(0.84, 0.98)))
		else:
			cones_a.append(Transform3D(basis, Vector3(x, h + 3.6 * s, z)))
			cones_b.append(Transform3D(basis, Vector3(x, h + 5.2 * s, z)))
			var canopy_tint := Color(rng.randf_range(0.76, 1.0), rng.randf_range(0.84, 1.0), rng.randf_range(0.78, 0.94))
			leaf_colors.append(canopy_tint)
			upper_leaf_colors.append(canopy_tint * rng.randf_range(0.92, 1.08))
		var cs := CollisionShape3D.new()
		var cyl := CylinderShape3D.new()
		cyl.radius = 0.4 * s
		cyl.height = 3.0 * s
		cs.shape = cyl
		cs.position = Vector3(x, h + 1.5 * s, z)
		body.add_child(cs)
		tree_positions.append(spot)
		placed += 1

	parent.add_child(body)
	var trunk_mat := MeshUtil.material(Color.WHITE, 1.0)
	trunk_mat.vertex_color_use_as_albedo = true
	var leaf_mat := MeshUtil.material(Color.WHITE, 0.92)
	leaf_mat.vertex_color_use_as_albedo = true
	var blossom_mat := MeshUtil.material(Color.WHITE, 0.82)
	blossom_mat.vertex_color_use_as_albedo = true
	var parts := [
		[trunk_mesh, trunk_mat, trunks, trunk_colors, "Trunks"],
		[branch_mesh, trunk_mat, bare_branches, branch_colors, "BareBranches"],
		[cone_a, leaf_mat, cones_a, leaf_colors, "LeavesA"],
		[cone_b, leaf_mat, cones_b, upper_leaf_colors, "LeavesB"],
		[broadleaf, leaf_mat, broadleaves, broadleaf_colors, "BroadleafCanopies"],
		[blossom, blossom_mat, blossoms, blossom_colors, "Blossoms"],
	]
	for p in parts:
		var xf: Array[Transform3D] = p[2]
		if xf.is_empty():
			continue
		var colors: Array[Color] = p[3]
		var inst := _multimesh(p[0], p[1], xf, colors)
		inst.name = p[4]
		inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if inst.name != "Trunks" else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		parent.add_child(inst)


static func _trail_center_x(z: float) -> float:
	return sin((z + 12.0) * 0.015) * 7.5 + sin(z * 0.043) * 1.3


static func _near_castle_trail(x: float, z: float, width: float) -> bool:
	return z <= 18.0 and z >= -174.0 and absf(x - _trail_center_x(z)) < width


static func _scatter_flora(parent: Node3D) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 27
	var flower_centers: Array[Vector2] = [
		Vector2(-48.0, -42.0), Vector2(62.0, -18.0), Vector2(108.0, 42.0),
		Vector2(-86.0, 48.0), Vector2(-156.0, -12.0), Vector2(150.0, 145.0),
		Vector2(-132.0, -150.0), Vector2(112.0, -176.0),
	]
	var stem_mesh := CylinderMesh.new()
	stem_mesh.top_radius = 0.018
	stem_mesh.bottom_radius = 0.032
	stem_mesh.height = 0.34
	stem_mesh.radial_segments = 5
	var petal_mesh := SphereMesh.new()
	petal_mesh.radius = 0.1
	petal_mesh.height = 0.075
	petal_mesh.radial_segments = 7
	petal_mesh.rings = 4
	var flower_center_mesh := SphereMesh.new()
	flower_center_mesh.radius = 0.055
	flower_center_mesh.height = 0.06
	flower_center_mesh.radial_segments = 6
	flower_center_mesh.rings = 3
	var bush_mesh := SphereMesh.new()
	bush_mesh.radius = 0.52
	bush_mesh.height = 0.72
	bush_mesh.radial_segments = 8
	bush_mesh.rings = 4

	var stems: Array[Transform3D] = []
	var petals: Array[Transform3D] = []
	var flower_centers_xforms: Array[Transform3D] = []
	var bushes: Array[Transform3D] = []
	var stem_colors: Array[Color] = []
	var petal_colors: Array[Color] = []
	var flower_center_colors: Array[Color] = []
	var bush_colors: Array[Color] = []
	var attempts := 0
	while stems.size() < 520 and attempts < 1800:
		attempts += 1
		var center := flower_centers[rng.randi_range(0, flower_centers.size() - 1)]
		var x := center.x + rng.randf_range(-23.0, 23.0)
		var z := center.y + rng.randf_range(-21.0, 21.0)
		if not is_free_spot(x, z, 8.0) or _near_castle_trail(x, z, 7.0):
			continue
		var h := height_at(x, z)
		var s := rng.randf_range(0.72, 1.32)
		var yaw := rng.randf() * TAU
		var basis := Basis(Vector3.UP, yaw).scaled(Vector3(s, s, s))
		stems.append(Transform3D(basis, Vector3(x, h + 0.16 * s, z)))
		stem_colors.append(Color(rng.randf_range(0.72, 0.92), rng.randf_range(0.82, 1.0), rng.randf_range(0.68, 0.82)))
		var palette: Array[Color] = [
			Color(0.94, 0.85, 0.68), Color(0.72, 0.7, 0.88),
			Color(0.88, 0.65, 0.68), Color(0.96, 0.91, 0.78),
		]
		var flower_color := palette[rng.randi_range(0, palette.size() - 1)]
		for petal_index in 5:
			var petal_angle := TAU * float(petal_index) / 5.0 + yaw
			var petal_basis := Basis(Vector3.UP, petal_angle).scaled(Vector3(s * 0.82, s * 0.76, s * 1.15))
			var petal_position := Vector3(x + cos(petal_angle) * 0.105 * s, h + 0.34 * s, z + sin(petal_angle) * 0.105 * s)
			petals.append(Transform3D(petal_basis, petal_position))
			petal_colors.append(flower_color)
		flower_centers_xforms.append(Transform3D(basis, Vector3(x, h + 0.36 * s, z)))
		flower_center_colors.append(Color(0.94, 0.76, 0.38))

	for i in 130:
		var center := flower_centers[rng.randi_range(0, flower_centers.size() - 1)]
		var x := center.x + rng.randf_range(-28.0, 28.0)
		var z := center.y + rng.randf_range(-25.0, 25.0)
		if not is_free_spot(x, z, 8.0) or _near_castle_trail(x, z, 8.0):
			continue
		var h := height_at(x, z)
		var scale := rng.randf_range(0.7, 1.45)
		var basis := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(scale * 1.2, scale, scale * 1.1))
		bushes.append(Transform3D(basis, Vector3(x, h + 0.32 * scale, z)))
		bush_colors.append(Color(rng.randf_range(0.66, 0.82), rng.randf_range(0.76, 0.91), rng.randf_range(0.62, 0.78)))

	var stem_mat := MeshUtil.material(Color.WHITE, 1.0)
	stem_mat.vertex_color_use_as_albedo = true
	var petal_mat := MeshUtil.material(Color.WHITE, 0.82)
	petal_mat.vertex_color_use_as_albedo = true
	var flower_center_mat := MeshUtil.material(Color.WHITE, 0.8)
	flower_center_mat.vertex_color_use_as_albedo = true
	var bush_mat := MeshUtil.material(Color.WHITE, 0.95)
	bush_mat.vertex_color_use_as_albedo = true
	for part in [
		[stem_mesh, stem_mat, stems, stem_colors, "WildflowerStems"],
		[petal_mesh, petal_mat, petals, petal_colors, "Wildflowers"],
		[flower_center_mesh, flower_center_mat, flower_centers_xforms, flower_center_colors, "WildflowerCenters"],
		[bush_mesh, bush_mat, bushes, bush_colors, "MeadowShrubs"],
	]:
		var transforms: Array[Transform3D] = part[2]
		if transforms.is_empty():
			continue
		var colors: Array[Color] = part[3]
		var instance := _multimesh(part[0], part[1], transforms, colors)
		instance.name = part[4]
		instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		parent.add_child(instance)


static func _build_castle_trail(parent: Node3D) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rng := RandomNumberGenerator.new()
	rng.seed = 203
	var segments := 150
	for i in segments:
		var t0 := float(i) / float(segments)
		var t1 := float(i + 1) / float(segments)
		var z0 := lerpf(18.0, -174.0, t0)
		var z1 := lerpf(18.0, -174.0, t1)
		var width0 := lerpf(6.0, 8.5, sin(PI * t0))
		var width1 := lerpf(6.0, 8.5, sin(PI * t1))
		var x0 := _trail_center_x(z0)
		var x1 := _trail_center_x(z1)
		var left_near := Vector3(x0 - width0, height_at(x0 - width0, z0) + 0.055, z0)
		var right_near := Vector3(x0 + width0, height_at(x0 + width0, z0) + 0.055, z0)
		var left_far := Vector3(x1 - width1, height_at(x1 - width1, z1) + 0.055, z1)
		var right_far := Vector3(x1 + width1, height_at(x1 + width1, z1) + 0.055, z1)
		var variation := rng.randf_range(0.88, 1.08)
		st.set_color(Color(0.54, 0.46, 0.33) * variation)
		st.add_vertex(left_near)
		st.add_vertex(right_near)
		st.add_vertex(right_far)
		st.add_vertex(left_near)
		st.add_vertex(right_far)
		st.add_vertex(left_far)
	st.generate_normals()
	var trail_mesh := st.commit()
	var trail_mat := MeshUtil.material(Color.WHITE, 1.0)
	trail_mat.vertex_color_use_as_albedo = true
	trail_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	trail_mesh.surface_set_material(0, trail_mat)
	var trail := MeshUtil.instance(trail_mesh, trail_mat)
	trail.name = "CastleTrail"
	trail.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(trail)


static func _scatter_rocks(parent: Node3D) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 9
	var rock := SphereMesh.new()
	rock.radius = 1.0
	rock.height = 2.0
	rock.radial_segments = 7
	rock.rings = 4

	var xforms: Array[Transform3D] = []
	var colors: Array[Color] = []
	var body := StaticBody3D.new()
	body.name = "RockColliders"
	body.collision_layer = 1
	body.collision_mask = 0

	var placed := 0
	var attempts := 0
	while placed < 55 and attempts < 500:
		attempts += 1
		var x := rng.randf_range(-190.0, 190.0)
		var z := rng.randf_range(-190.0, 190.0)
		if not is_free_spot(x, z, 10.0):
			continue
		if _near_castle_trail(x, z, 11.0):
			continue
		var h := height_at(x, z)
		var s := rng.randf_range(0.8, 2.4)
		var basis := Basis.from_euler(Vector3(0.0, rng.randf() * TAU, 0.0)).scaled(Vector3(1.3 * s, 0.8 * s, 1.0 * s))
		xforms.append(Transform3D(basis, Vector3(x, h + 0.2 * s, z)))
		colors.append(Color(rng.randf_range(0.78, 0.95), rng.randf_range(0.8, 0.96), rng.randf_range(0.84, 1.0)))
		var cs := CollisionShape3D.new()
		var sphere := SphereShape3D.new()
		sphere.radius = 0.9 * s
		cs.shape = sphere
		cs.position = Vector3(x, h + 0.2 * s, z)
		body.add_child(cs)
		placed += 1

	parent.add_child(body)
	var rock_mat := MeshUtil.material(Color.WHITE, 1.0)
	rock_mat.vertex_color_use_as_albedo = true
	var inst := _multimesh(rock, rock_mat, xforms, colors)
	inst.name = "Rocks"
	parent.add_child(inst)
