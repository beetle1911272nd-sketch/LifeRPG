extends Node
## 操作設定(視点感度 / 一人称 / ボタンサイズ)。user://abore_settings.cfg に保存します。

signal changed

const PATH := "user://abore_settings.cfg"

var look_sens: float = 1.0      # 視点感度の倍率
var first_person: bool = false
var button_scale: float = 1.0   # タッチボタンの倍率


func _ready() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(PATH) == OK:
		look_sens = clampf(float(cfg.get_value("controls", "look_sens", 1.0)), 0.3, 3.0)
		first_person = bool(cfg.get_value("controls", "first_person", false))
		button_scale = clampf(float(cfg.get_value("controls", "button_scale", 1.0)), 0.6, 1.8)


func set_look_sens(v: float) -> void:
	look_sens = clampf(v, 0.3, 3.0)
	_commit()


func set_first_person(v: bool) -> void:
	first_person = v
	_commit()


func set_button_scale(v: float) -> void:
	button_scale = clampf(v, 0.6, 1.8)
	_commit()


func _commit() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("controls", "look_sens", look_sens)
	cfg.set_value("controls", "first_person", first_person)
	cfg.set_value("controls", "button_scale", button_scale)
	cfg.save(PATH)
	changed.emit()


## 設定項目をまとめて container に追加する(タイトル画面/ポーズメニュー共通)。
func build_controls(container: Container) -> void:
	var fp := CheckButton.new()
	fp.text = "一人称視点"
	fp.focus_mode = Control.FOCUS_NONE
	fp.button_pressed = first_person
	fp.toggled.connect(set_first_person)
	changed.connect(func() -> void:
		if fp.button_pressed != first_person:
			fp.set_pressed_no_signal(first_person))
	container.add_child(fp)
	_add_slider(container, "視点感度", look_sens, 0.3, 3.0, set_look_sens)
	_add_slider(container, "ボタンサイズ", button_scale, 0.6, 1.8, set_button_scale)


func _add_slider(container: Container, title: String, value: float, lo: float, hi: float, setter: Callable) -> void:
	var lab := Label.new()
	lab.text = "%s  x%.2f" % [title, value]
	lab.add_theme_font_size_override("font_size", 18)
	container.add_child(lab)
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = 0.05
	s.value = value
	s.focus_mode = Control.FOCUS_NONE
	s.custom_minimum_size = Vector2(0, 28)
	s.value_changed.connect(func(v: float) -> void:
		lab.text = "%s  x%.2f" % [title, v]
		setter.call(v))
	container.add_child(s)
