class_name TouchControls
extends Control
## スマホ/タブレット用のタッチ操作。左側で仮想ジョイスティック、右側に行動ボタン、
## 何もない場所のドラッグでカメラ回転。キーボード/マウスは常に併用できます。
## ゲーム中はタッチ→マウスのエミュレートを止めている(GameManager.set_gameplay_input)ため、
## 攻撃などが二重に発火したりカメラに漏れたりしません。

signal touch_mode_changed(active: bool)

const STICK_RADIUS := 64.0       # 物理px基準
const STICK_ZONE_X := 0.45       # 画面左側のこの割合がジョイスティック領域
const SPRINT_THRESHOLD := 0.92
const LOOK_SENS := 0.0040
const MAX_LOOK_STEP := 60.0     # 1イベントの最大移動量(物理px)。急なジャンプを防ぐ
const PORTRAIT_SCALE := 2.0

var camera_rig: CameraRig
var hud: Hud
var touch_active: bool = false

var _buttons: Array[Dictionary] = []  # {action, label, center, radius, hold, visible}
var _stick_id := -1
var _stick_origin := Vector2.ZERO
var _stick_vec := Vector2.ZERO
var _sprinting := false
var _look_id := -1
var _look_accum := Vector2.ZERO       # 次のフレームで適用する視点移動量
var _button_touches: Dictionary = {}  # touch index -> button dict
var _insets := Vector4.ZERO           # left, top, right, bottom (viewport units)
var _px := 1.0                        # 1 viewport unit = _px physical pixels
var _font: Font


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_font = get_theme_default_font()
	_buttons = [
		{"action": &"attack", "label": "攻撃", "phys": 58.0},
		{"action": &"dodge", "label": "回避", "phys": 40.0},
		{"action": &"jump", "label": "跳", "phys": 40.0},
		{"action": &"use_potion", "label": "薬", "phys": 34.0},
		{"action": &"interact", "label": "話す", "phys": 40.0, "needs_interact": true},
		{"action": &"inventory", "label": "道具", "phys": 28.0, "toggle": true},
		{"action": &"menu", "label": "☰", "phys": 28.0, "toggle": true},
	]
	get_window().size_changed.connect(_relayout)
	if _detect_touch_device():
		_set_touch_active(true)
	_relayout()


func _detect_touch_device() -> bool:
	if DisplayServer.is_touchscreen_available():
		return true
	if OS.has_feature("web"):
		var res: Variant = JavaScriptBridge.eval(
			"(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints || 0) > 0")
		return res == true
	return false


func _set_touch_active(value: bool) -> void:
	if touch_active == value:
		return
	touch_active = value
	if not value:
		_release_all()
	touch_mode_changed.emit(value)
	_relayout()
	queue_redraw()


func _relayout() -> void:
	var win := get_window()
	var win_size := Vector2(win.size)
	var portrait := win_size.x < win_size.y
	win.content_scale_factor = PORTRAIT_SCALE if (touch_active and portrait) else 1.0
	var vp := get_viewport_rect().size
	_px = win_size.x / maxf(vp.x, 1.0)
	_insets = _safe_insets(win_size, vp)

	var m := 22.0 / _px * 1.0 + 8.0
	var left := _insets.x + m
	var right := vp.x - _insets.z - m
	var bottom := vp.y - _insets.w - m
	var top := _insets.y + m
	var r_attack := _v("attack")["phys"] as float / _px
	var r_small := 40.0 / _px

	var by_action := {}
	for b in _buttons:
		by_action[b["action"]] = b
		b["radius"] = (b["phys"] as float) / _px
	var attack: Dictionary = by_action[&"attack"]
	attack["center"] = Vector2(right - r_attack, bottom - r_attack)
	var ac: Vector2 = attack["center"]
	var ring := r_attack + r_small * 0.55 + 10.0 / _px
	by_action[&"dodge"]["center"] = ac + Vector2(-ring * 1.0, 0.0) + Vector2(-8.0, 0.0) / _px
	by_action[&"jump"]["center"] = ac + Vector2(0.0, -ring) + Vector2(0.0, -8.0) / _px
	by_action[&"use_potion"]["center"] = ac + Vector2(-ring * 0.78, -ring * 0.78) + Vector2(-6.0, -6.0) / _px
	by_action[&"interact"]["center"] = ac + Vector2(-ring * 1.9, -ring * 0.35)
	var small_r := (by_action[&"menu"]["radius"] as float)
	var map_clear := top + 96.0
	by_action[&"menu"]["center"] = Vector2(right - small_r, map_clear + small_r)
	by_action[&"inventory"]["center"] = Vector2(right - small_r, map_clear + small_r * 3.0 + 8.0 / _px)
	_stick_origin_default = Vector2(left + STICK_RADIUS / _px * 1.4, bottom - STICK_RADIUS / _px * 1.4)
	queue_redraw()


var _stick_origin_default := Vector2.ZERO


func _v(action: StringName) -> Dictionary:
	for b in _buttons:
		if b["action"] == action:
			return b
	return {}


func _safe_insets(win_size: Vector2, vp: Vector2) -> Vector4:
	var out := Vector4.ZERO
	if OS.has_feature("web") or not touch_active:
		return out
	var safe := DisplayServer.get_display_safe_area()
	var screen := Vector2(DisplayServer.screen_get_size(DisplayServer.window_get_current_screen()))
	if safe.size.x <= 0 or screen.x <= 0:
		return out
	var k := vp.x / maxf(screen.x, 1.0)
	out.x = clampf(float(safe.position.x) * k, 0.0, vp.x * 0.15)
	out.y = clampf(float(safe.position.y) * k, 0.0, vp.y * 0.15)
	out.z = clampf((screen.x - float(safe.end.x)) * k, 0.0, vp.x * 0.15)
	out.w = clampf((screen.y - float(safe.end.y)) * k, 0.0, vp.y * 0.15)
	return out


func _shown(b: Dictionary) -> bool:
	if not touch_active or get_tree().paused:
		return false
	if b.get("needs_interact", false) and (hud == null or not hud.shop_nearby):
		return false
	return true


func _process(_delta: float) -> void:
	if _look_accum != Vector2.ZERO:
		if camera_rig != null and not get_tree().paused:
			camera_rig.yaw -= _look_accum.x * LOOK_SENS
			camera_rig.pitch = clampf(camera_rig.pitch - _look_accum.y * LOOK_SENS, CameraRig.PITCH_MIN, CameraRig.PITCH_MAX)
		_look_accum = Vector2.ZERO
	var should_show := touch_active and not get_tree().paused
	if get_tree().paused and (_stick_id != -1 or _look_id != -1 or not _button_touches.is_empty()):
		_release_all()
	if visible != touch_active:
		visible = touch_active
	if should_show or _stick_id != -1:
		queue_redraw()


func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if touch_active:
			_set_touch_active(false)
		return
	if event is InputEventMouseButton and event.pressed and event.device != InputEvent.DEVICE_ID_EMULATION:
		if touch_active and not OS.has_feature("web"):
			_set_touch_active(false)
		return
	if event is InputEventScreenTouch:
		if not touch_active:
			_set_touch_active(true)
		if get_tree().paused or not GameManager.is_in_game:
			return
		if event.pressed:
			_on_touch_down(event.index, event.position)
		else:
			_on_touch_up(event.index)
		get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag and touch_active and not get_tree().paused:
		_on_touch_drag(event.index, event.position, event.relative)
		get_viewport().set_input_as_handled()


func _on_touch_down(index: int, pos: Vector2) -> void:
	for b in _buttons:
		if _shown(b) and pos.distance_to(b["center"]) <= (b["radius"] as float) * 1.2:
			_button_touches[index] = b
			_send(b["action"], true)
			queue_redraw()
			return
	var vp := get_viewport_rect().size
	if _stick_id == -1 and pos.x < vp.x * STICK_ZONE_X and pos.y > vp.y * 0.2:
		_stick_id = index
		_stick_origin = pos
		_stick_vec = Vector2.ZERO
	elif _look_id == -1:
		_look_id = index
	queue_redraw()


func _on_touch_up(index: int) -> void:
	if _button_touches.has(index):
		var b: Dictionary = _button_touches[index]
		_button_touches.erase(index)
		_send(b["action"], false)
	if index == _stick_id:
		_stick_id = -1
		_apply_stick(Vector2.ZERO)
	if index == _look_id:
		_look_id = -1
	queue_redraw()


func _on_touch_drag(index: int, pos: Vector2, relative: Vector2) -> void:
	if index == _stick_id:
		var radius := STICK_RADIUS / _px * 1.3
		var offset := pos - _stick_origin
		if offset.length() > radius:
			_stick_origin += offset.normalized() * (offset.length() - radius)
			offset = offset.normalized() * radius
		_apply_stick(offset / radius)
	elif _button_touches.has(index):
		return
	else:
		# touch-up を取りこぼして視点用の指が残っても、次のドラッグで復帰できるようにする
		if _look_id == -1 or index == _look_id:
			_look_id = index
			_look_accum += (relative * _px).limit_length(MAX_LOOK_STEP)


func _apply_stick(v: Vector2) -> void:
	_stick_vec = v
	_set_axis(&"move_left", maxf(-v.x, 0.0))
	_set_axis(&"move_right", maxf(v.x, 0.0))
	_set_axis(&"move_forward", maxf(-v.y, 0.0))
	_set_axis(&"move_back", maxf(v.y, 0.0))
	var sprint := v.length() >= SPRINT_THRESHOLD
	if sprint != _sprinting:
		_sprinting = sprint
		_send(&"sprint", sprint)


func _set_axis(action: StringName, strength: float) -> void:
	if strength > 0.12:
		Input.action_press(action, strength)
	else:
		Input.action_release(action)


func _send(action: StringName, pressed: bool) -> void:
	var ev := InputEventAction.new()
	ev.action = action
	ev.pressed = pressed
	ev.strength = 1.0 if pressed else 0.0
	Input.parse_input_event(ev)


func _release_all() -> void:
	for index in _button_touches.keys():
		_send((_button_touches[index] as Dictionary)["action"], false)
	_button_touches.clear()
	_stick_id = -1
	_look_id = -1
	_look_accum = Vector2.ZERO
	_apply_stick(Vector2.ZERO)
	queue_redraw()


func _draw() -> void:
	if not touch_active or get_tree().paused or not GameManager.is_in_game:
		return
	var gold := UiStyle.GOLD
	var base_r := STICK_RADIUS / _px * 1.3
	var origin := _stick_origin if _stick_id != -1 else _stick_origin_default
	var alpha := 0.55 if _stick_id != -1 else 0.28
	draw_circle(origin, base_r, Color(0.03, 0.04, 0.1, 0.35))
	draw_arc(origin, base_r, 0.0, TAU, 48, Color(gold, alpha), 2.0, true)
	draw_circle(origin + _stick_vec * base_r, base_r * 0.42, Color(gold, alpha + 0.15))

	var pressed_buttons := _button_touches.values()
	for b in _buttons:
		if not _shown(b):
			continue
		var down := pressed_buttons.has(b)
		var c: Vector2 = b["center"]
		var r: float = b["radius"]
		draw_circle(c, r, Color(0.32, 0.26, 0.12, 0.8) if down else Color(0.05, 0.07, 0.15, 0.6))
		draw_arc(c, r, 0.0, TAU, 40, Color(gold, 0.9 if down else 0.6), 2.5, true)
		var fs := int(maxf(14.0, r * 0.62))
		var text: String = b["label"]
		var w := _font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		draw_string(_font, c + Vector2(-w * 0.5, fs * 0.36), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, UiStyle.WHITE)
