class_name Slime
extends EnemyBase
## 最初の敵「スライム」。ゼリー状の簡易モデル。


var _t: float = 0.0


func _setup_data() -> void:
	enemy_name = "SLIME"
	level = 1
	max_hp = 100
	atk = 20
	defense = 10
	exp_reward = 30
	move_speed = 2.6
	detect_range = 11.0
	attack_range = 1.7
	attack_cooldown = 1.5
	body_radius = 0.6
	body_height = 1.2
	drops = [
		{"id": "small_potion", "chance": 0.35, "min": 1, "max": 1},
		{"id": "slime_core", "chance": 0.5, "min": 1, "max": 2},
		{"id": "gold", "chance": 0.9, "min": 8, "max": 25},
	]


func _build_model() -> void:
	var gel := MeshUtil.material(Color(0.3, 0.85, 0.6, 0.78), 0.12, Color(0.2, 0.8, 0.5), 0.25)
	register_flash(gel)
	var body_mesh := SphereMesh.new()
	body_mesh.radius = 0.65
	body_mesh.height = 1.0
	body_mesh.radial_segments = 24
	body_mesh.rings = 12
	model_root.add_child(MeshUtil.instance(body_mesh, gel, Vector3(0, 0.5, 0)))

	var core_mat := MeshUtil.material(Color(1.0, 0.9, 0.4), 0.3, Color(1.0, 0.85, 0.3), 1.2)
	var core := SphereMesh.new()
	core.radius = 0.14
	core.height = 0.28
	model_root.add_child(MeshUtil.instance(core, core_mat, Vector3(0, 0.45, 0.1)))

	var white := MeshUtil.material(Color.WHITE, 0.4)
	var black := MeshUtil.material(Color(0.05, 0.05, 0.08), 0.4)
	var eye := SphereMesh.new()
	eye.radius = 0.1
	eye.height = 0.2
	var pupil := SphereMesh.new()
	pupil.radius = 0.05
	pupil.height = 0.1
	for side in [-1.0, 1.0]:
		model_root.add_child(MeshUtil.instance(eye, white, Vector3(0.22 * side, 0.62, -0.5)))
		model_root.add_child(MeshUtil.instance(pupil, black, Vector3(0.22 * side, 0.62, -0.58)))


func _animate(delta: float) -> void:
	_t += delta * (4.0 + velocity.length() * 2.0)
	var moving := Vector2(velocity.x, velocity.z).length() > 0.3
	model_root.position.y = absf(sin(_t)) * 0.18 if moving else 0.0


func play_attack_anim() -> void:
	var tw := create_tween()
	tw.tween_property(model_root, "scale", Vector3(1.25, 0.7, 1.25), 0.25)
	tw.tween_property(model_root, "scale", Vector3(0.85, 1.3, 0.85), 0.08)
	tw.tween_property(model_root, "scale", Vector3.ONE, 0.2)
