class_name ShopMerchant
extends Area3D
## In-world interaction area and compact market stall for the traveling merchant.

signal interacted
signal proximity_changed(is_near: bool)

var _nearby_player: bool = false


func _ready() -> void:
	collision_layer = 0
	collision_mask = 2
	set_process_unhandled_input(true)
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)

	var trigger := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 9.0
	trigger.shape = sphere
	trigger.position.y = 1.0
	add_child(trigger)

	_add_model("res://assets/models/kenney_fantasy_town/stall.glb", Vector3.ZERO, 5.0)
	_add_model("res://assets/models/kenney_fantasy_town/stall-red.glb", Vector3(2.8, 0.0, -0.8), 4.2, Vector3(0.0, 0.45, 0.0))
	_add_model("res://assets/models/kenney_fantasy_town/stall-stool.glb", Vector3(-2.2, 0.0, 2.8), 2.5)
	_add_model("res://assets/models/kenney_fantasy_town/lantern.glb", Vector3(1.6, 2.2, -1.6), 2.2)

	var sign := Label3D.new()
	sign.text = "TRAVELING MERCHANT"
	sign.font_size = 48
	sign.pixel_size = 0.006
	sign.outline_size = 8
	sign.modulate = UiStyle.GOLD
	sign.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	sign.position = Vector3(0.0, 3.2, 0.0)
	add_child(sign)

	var lantern_light := OmniLight3D.new()
	lantern_light.light_color = Color(1.0, 0.69, 0.38)
	lantern_light.light_energy = 0.45
	lantern_light.omni_range = 8.0
	lantern_light.shadow_enabled = false
	lantern_light.position = Vector3(0.0, 2.1, 1.6)
	add_child(lantern_light)


func _unhandled_input(event: InputEvent) -> void:
	if _nearby_player and event.is_action_pressed("interact"):
		interacted.emit()
		get_viewport().set_input_as_handled()


func _on_body_entered(body: Node3D) -> void:
	if body is PlayerController and not _nearby_player:
		_nearby_player = true
		proximity_changed.emit(true)


func _on_body_exited(body: Node3D) -> void:
	if body is PlayerController and _nearby_player:
		_nearby_player = false
		proximity_changed.emit(false)


func _add_model(path: String, model_position: Vector3, model_scale: float, model_rotation: Vector3 = Vector3.ZERO) -> void:
	var packed_scene := load(path) as PackedScene
	assert(packed_scene != null, "Could not load merchant prop: %s" % path)
	var model := packed_scene.instantiate() as Node3D
	assert(model != null, "Merchant prop root must be Node3D")
	model.position = model_position
	model.scale = Vector3.ONE * model_scale
	model.rotation = model_rotation
	add_child(model)
