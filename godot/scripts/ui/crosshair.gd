class_name Crosshair
extends Control
## 一人称視点のときだけ画面中央に出るエイム用の十字。


func _process(_delta: float) -> void:
	var show_it := GameSettings.first_person and GameManager.is_in_game and not get_tree().paused
	if visible != show_it:
		visible = show_it
	if show_it:
		queue_redraw()


func _draw() -> void:
	var c := size * 0.5
	var col := Color(1, 1, 1, 0.9)
	var shade := Color(0, 0, 0, 0.55)
	for off in [Vector2(1, 1), Vector2.ZERO]:
		var k: Color = shade if off != Vector2.ZERO else col
		draw_line(c + off + Vector2(-12, 0), c + off + Vector2(-4, 0), k, 2.0)
		draw_line(c + off + Vector2(4, 0), c + off + Vector2(12, 0), k, 2.0)
		draw_line(c + off + Vector2(0, -12), c + off + Vector2(0, -4), k, 2.0)
		draw_line(c + off + Vector2(0, 4), c + off + Vector2(0, 12), k, 2.0)
	draw_circle(c, 1.5, col)
