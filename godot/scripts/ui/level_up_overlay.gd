class_name LevelUpOverlay
extends Control
## レベルアップ演出(画面を少し暗くして「LEVEL UP!」を表示)。

var _title: Label
var _sub: Label
var _tween: Tween


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	visible = false

	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.5)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(dim)

	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 10)
	UiStyle.place(vb, 0.5, 0.5)
	add_child(vb)
	_title = UiStyle.label("LEVEL UP!", 110, UiStyle.GOLD, true)
	_sub = UiStyle.label("", 44, UiStyle.WHITE, true)
	vb.add_child(_title)
	vb.add_child(_sub)


func show_level_up(old_level: int, new_level: int) -> void:
	_sub.text = "LEVEL %d  →  LEVEL %d" % [old_level, new_level]
	visible = true
	modulate.a = 0.0
	if _tween != null and _tween.is_valid():
		_tween.kill()
	_tween = create_tween()
	_tween.tween_property(self, "modulate:a", 1.0, 0.35)
	_tween.tween_interval(1.8)
	_tween.tween_property(self, "modulate:a", 0.0, 0.5)
	_tween.tween_callback(_hide)


func _hide() -> void:
	visible = false
