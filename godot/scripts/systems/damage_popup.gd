class_name DamagePopup
extends RefCounted
## ダメージ数字などが上に浮かんで消える演出。


static func spawn(context: Node, world_pos: Vector3, text: String, color: Color = Color.WHITE) -> void:
	var scene := context.get_tree().current_scene
	if scene == null:
		return
	var label := Label3D.new()
	label.text = text
	label.font_size = 72
	label.outline_size = 16
	label.pixel_size = 0.006
	label.modulate = color
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	scene.add_child(label)
	label.global_position = world_pos
	var tw := label.create_tween()
	tw.set_parallel(true)
	tw.tween_property(label, "global_position:y", world_pos.y + 1.4, 0.8)
	tw.tween_property(label, "modulate:a", 0.0, 0.6).set_delay(0.3)
	tw.chain().tween_callback(label.queue_free)
