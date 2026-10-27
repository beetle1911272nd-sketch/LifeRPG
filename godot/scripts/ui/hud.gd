class_name Hud
extends Control
## 常に表示される画面表示(HP/EXP・現在地・操作ガイド・ターゲット情報・通知)。

var player: PlayerController

var _name_label: Label
var _level_label: Label
var _hp_label: Label
var _hp_bar: ProgressBar
var _exp_label: Label
var _exp_bar: ProgressBar
var _target_panel: PanelContainer
var _target_name: Label
var _target_level: Label
var _target_bar: ProgressBar
var _toasts: VBoxContainer
var _shop_prompt: Label
var _guide: PanelContainer
var shop_nearby := false
var _touch := false


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_player_panel()
	_build_map_panel()
	_build_target_panel()
	_build_guide()
	_build_toasts()


func _build_player_panel() -> void:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", UiStyle.panel_box())
	UiStyle.place(panel, 0.0, 0.0, 20, 20)
	add_child(panel)
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 4)
	panel.add_child(vb)
	_name_label = UiStyle.label(GameManager.player_name, 22, UiStyle.GOLD)
	_level_label = UiStyle.label("LEVEL 1", 20)
	_hp_label = UiStyle.label("HP", 16)
	_hp_bar = UiStyle.bar(Color(0.85, 0.2, 0.25))
	_exp_label = UiStyle.label("EXP", 16)
	_exp_bar = UiStyle.bar(Color(0.3, 0.65, 1.0), 280.0, 10.0)
	for n in [_name_label, _level_label, _hp_label, _hp_bar, _exp_label, _exp_bar]:
		vb.add_child(n)


func _build_map_panel() -> void:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", UiStyle.panel_box())
	UiStyle.place(panel, 1.0, 0.0, 20, 20)
	add_child(panel)
	var vb := VBoxContainer.new()
	panel.add_child(vb)
	vb.add_child(UiStyle.label("現在地", 14, UiStyle.GRAY))
	vb.add_child(UiStyle.label(GameManager.MAP_NAME, 24, UiStyle.GOLD))


func _build_target_panel() -> void:
	_target_panel = PanelContainer.new()
	_target_panel.add_theme_stylebox_override("panel", UiStyle.panel_box())
	UiStyle.place(_target_panel, 0.5, 0.0, 0, 20)
	_target_panel.visible = false
	add_child(_target_panel)
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 4)
	_target_panel.add_child(vb)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	vb.add_child(row)
	_target_name = UiStyle.label("SLIME", 20, UiStyle.GOLD)
	_target_level = UiStyle.label("LV 1", 18)
	row.add_child(_target_name)
	row.add_child(_target_level)
	_target_bar = UiStyle.bar(Color(0.9, 0.3, 0.3), 260.0, 12.0)
	vb.add_child(_target_bar)


func _build_guide() -> void:
	var panel := PanelContainer.new()
	_guide = panel
	var sb := UiStyle.panel_box(Color(0.03, 0.04, 0.1, 0.6), Color(0, 0, 0, 0))
	sb.set_content_margin_all(8)
	panel.add_theme_stylebox_override("panel", sb)
	UiStyle.place(panel, 0.5, 1.0, 0, 14)
	add_child(panel)
	panel.add_child(UiStyle.label(
		"WASD 移動   SHIFT ダッシュ   SPACE ジャンプ   左クリック 攻撃   右クリック 回避   Q ポーション   TAB アイテム   E 商人   ESC メニュー",
		15, UiStyle.WHITE, true))
	_shop_prompt = UiStyle.label("[E] 旅人の露店", 20, UiStyle.GOLD, true)
	_shop_prompt.visible = false
	UiStyle.place(_shop_prompt, 0.5, 1.0, 0.0, 62.0)
	add_child(_shop_prompt)


func _build_toasts() -> void:
	_toasts = VBoxContainer.new()
	_toasts.alignment = BoxContainer.ALIGNMENT_END
	UiStyle.place(_toasts, 0.5, 1.0, 0, 80)
	add_child(_toasts)


func _process(_delta: float) -> void:
	var s := GameManager.stats
	_level_label.text = "LEVEL %d" % s.level
	var max_hp := GameManager.effective_max_hp()
	_hp_label.text = "HP  %d / %d" % [s.hp, max_hp]
	_hp_bar.max_value = max_hp
	_hp_bar.value = s.hp
	_exp_label.text = "EXP  %d / %d" % [s.current_exp, s.exp_to_next()]
	_exp_bar.max_value = s.exp_to_next()
	_exp_bar.value = s.current_exp

	var target: EnemyBase = null
	if player != null and is_instance_valid(player):
		target = player.find_nearest_enemy(14.0)
	_target_panel.visible = target != null
	if target != null:
		_target_name.text = target.enemy_name
		_target_level.text = "LV %d" % target.level
		_target_bar.max_value = target.max_hp
		_target_bar.value = target.hp


func show_pickup(item_id: String, amount: int) -> void:
	show_message("+ %s × %d" % [ItemData.display_name(item_id), amount], ItemData.color_of(item_id).lerp(Color.WHITE, 0.4))


func show_shop_prompt(is_near: bool) -> void:
	shop_nearby = is_near
	_shop_prompt.visible = is_near


func set_touch_mode(active: bool) -> void:
	_touch = active
	_guide.visible = not active
	_shop_prompt.text = "「話す」で 旅人の露店" if active else "[E] 旅人の露店"


func show_message(text: String, color: Color = UiStyle.WHITE) -> void:
	var l := UiStyle.label(text, 22, color, true)
	_toasts.add_child(l)
	var tw := l.create_tween()
	tw.tween_interval(1.8)
	tw.tween_property(l, "modulate:a", 0.0, 0.6)
	tw.tween_callback(l.queue_free)
