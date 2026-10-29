extends Control
## タイトル画面。START GAME / SETTINGS / QUIT。
## セーブデータがあるときは START GAME で続きから始まり、NEW GAME も選べます。

var _settings_panel: PanelContainer
var _pairing_input: TextEdit
var _sync_message: Label


func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	get_tree().paused = false
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_build_background()
	_build_menu()
	_build_settings()
	GameSync.sync_finished.connect(_on_sync_finished)


func _build_background() -> void:
	var grad := Gradient.new()
	grad.colors = PackedColorArray([Color(0.03, 0.04, 0.12), Color(0.14, 0.1, 0.3), Color(0.58, 0.4, 0.3)])
	grad.offsets = PackedFloat32Array([0.0, 0.65, 1.0])
	var tex := GradientTexture2D.new()
	tex.gradient = grad
	tex.fill_from = Vector2(0, 0)
	tex.fill_to = Vector2(0, 1)
	tex.width = 8
	tex.height = 256
	var rect := TextureRect.new()
	rect.texture = tex
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	rect.stretch_mode = TextureRect.STRETCH_SCALE
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(rect)

	# 下から舞い上がる光の粒
	var motes := CPUParticles2D.new()
	motes.position = Vector2(640, 740)
	motes.amount = 40
	motes.lifetime = 14.0
	motes.preprocess = 10.0
	motes.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	motes.emission_rect_extents = Vector2(700, 20)
	motes.direction = Vector2(0, -1)
	motes.spread = 15.0
	motes.gravity = Vector2.ZERO
	motes.initial_velocity_min = 20.0
	motes.initial_velocity_max = 50.0
	motes.scale_amount_min = 2.0
	motes.scale_amount_max = 5.0
	motes.color = Color(1.0, 0.9, 0.55, 0.7)
	add_child(motes)


func _build_menu() -> void:
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 14)
	UiStyle.place(vb, 0.5, 0.5)
	add_child(vb)

	vb.add_child(UiStyle.label("ABORE LIFE RPG", 88, UiStyle.GOLD, true))
	vb.add_child(UiStyle.label("— 現実の人生を、RPGにする —", 24, UiStyle.WHITE, true))
	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(0, 30)
	vb.add_child(spacer)

	vb.add_child(UiStyle.button("START GAME", func() -> void: GameManager.start_game(true)))
	if SaveSystem.has_save():
		vb.add_child(UiStyle.button("NEW GAME(はじめから)", func() -> void: GameManager.start_game(false)))
	vb.add_child(UiStyle.button("SETTINGS", _open_settings))
	vb.add_child(UiStyle.button("QUIT", func() -> void: get_tree().quit()))

	var version := UiStyle.label("Prototype v0.1", 14, UiStyle.GRAY)
	UiStyle.place(version, 1.0, 1.0, 16, 12)
	add_child(version)


func _build_settings() -> void:
	_settings_panel = PanelContainer.new()
	_settings_panel.add_theme_stylebox_override("panel", UiStyle.panel_box(Color(0.04, 0.05, 0.12, 0.96), UiStyle.GOLD))
	UiStyle.place(_settings_panel, 0.5, 0.5)
	_settings_panel.visible = false
	add_child(_settings_panel)

	var vb := VBoxContainer.new()
	vb.custom_minimum_size = Vector2(420, 0)
	vb.add_theme_constant_override("separation", 14)
	_settings_panel.add_child(vb)
	vb.add_child(UiStyle.label("SETTINGS", 32, UiStyle.GOLD))
	vb.add_child(UiStyle.label("LIFE RPGと同期", 20, UiStyle.GOLD))
	vb.add_child(UiStyle.label("Web版プロフィールで発行したペアリングJSONを貼り付けます。", 14, UiStyle.GRAY))
	_pairing_input = TextEdit.new()
	_pairing_input.custom_minimum_size = Vector2(420, 82)
	_pairing_input.placeholder_text = "ペアリングJSON"
	_pairing_input.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	vb.add_child(_pairing_input)
	_sync_message = UiStyle.label("未連携です。", 14, UiStyle.GRAY, true)
	vb.add_child(_sync_message)
	vb.add_child(UiStyle.button("PAIR WITH LIFE RPG", _on_pair_pressed, Vector2(420, 44), 18))
	vb.add_child(UiStyle.button("SYNC NOW", _on_sync_pressed, Vector2(420, 44), 18))
	vb.add_child(UiStyle.button("UNLINK DEVICE", _on_unlink_pressed, Vector2(420, 44), 18))

	var fullscreen := CheckButton.new()
	fullscreen.text = "フルスクリーン"
	fullscreen.focus_mode = Control.FOCUS_NONE
	fullscreen.button_pressed = DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN
	fullscreen.toggled.connect(_on_fullscreen_toggled)
	vb.add_child(fullscreen)

	GameSettings.build_controls(vb)

	vb.add_child(UiStyle.label("音量", 18))
	var volume := HSlider.new()
	volume.min_value = 0.0
	volume.max_value = 1.0
	volume.step = 0.05
	volume.value = db_to_linear(AudioServer.get_bus_volume_db(0))
	volume.focus_mode = Control.FOCUS_NONE
	volume.value_changed.connect(_on_volume_changed)
	vb.add_child(volume)

	vb.add_child(UiStyle.button("CLOSE", _close_settings, Vector2(200, 44), 20))


func _open_settings() -> void:
	_settings_panel.visible = true


func _close_settings() -> void:
	_settings_panel.visible = false


func _on_pair_pressed() -> void:
	_sync_message.text = "ペアリング中…"
	_sync_message.text = await GameSync.pair_from_bundle(_pairing_input.text)


func _on_sync_pressed() -> void:
	_sync_message.text = "同期中…"
	# タイトル画面ではセーブデータがまだ読み込まれておらず、GameManager.stats が
	# 初期値(LEVEL1/EXP0)のままになっている。読み込まずに同期すると、実際のプレイ
	# 進行状況の代わりに初期値をクラウドと比較・保存してしまうため、先に読み込む。
	if not GameManager.is_in_game and SaveSystem.has_save():
		GameManager.continue_game()
	_sync_message.text = await GameSync.synchronize()


func _on_unlink_pressed() -> void:
	_sync_message.text = "連携解除中…"
	_sync_message.text = await GameSync.unlink_device()


func _on_sync_finished(success: bool, message: String) -> void:
	if is_instance_valid(_sync_message):
		_sync_message.text = message


func _on_fullscreen_toggled(on: bool) -> void:
	if on:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	else:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)


func _on_volume_changed(v: float) -> void:
	AudioServer.set_bus_volume_db(0, linear_to_db(maxf(v, 0.0001)))
