class_name StatusPanel
extends Control
## ESCキーで開くメニュー(ステータス表示 + 再開 / セーブ / タイトルへ)。

signal resume_requested
signal title_requested

const ROWS := [
	["LEVEL", "level"], ["EXP", "exp"],
	["HP", "hp"], ["ATK", "atk"],
	["DEF", "def"], ["STR", "str"],
	["INT", "int"], ["AGI", "agi"],
	["VIT", "vit"], ["DEX", "dex"],
	["CHA", "cha"], ["", ""],
]

const EQUIPMENT_SLOTS := [
	{"id": "weapon", "label": "武器"},
	{"id": "armor", "label": "防具"},
	{"id": "accessory", "label": "アクセサリー"},
]

var _values: Dictionary = {}
var _equipment_selectors: Dictionary = {}
var _name_label: Label
var _message: Label
var _settings_box: PanelContainer


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	visible = false

	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.6)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(dim)

	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", UiStyle.panel_box())
	UiStyle.place(panel, 0.5, 0.5)
	add_child(panel)
	var vb := VBoxContainer.new()
	vb.custom_minimum_size = Vector2(520, 0)
	vb.add_theme_constant_override("separation", 10)
	panel.add_child(vb)

	vb.add_child(UiStyle.label("STATUS", 34, UiStyle.GOLD))
	_name_label = UiStyle.label("", 24)
	vb.add_child(_name_label)
	vb.add_child(HSeparator.new())

	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 24)
	grid.add_theme_constant_override("v_separation", 6)
	vb.add_child(grid)
	for row in ROWS:
		grid.add_child(UiStyle.label(row[0], 20, UiStyle.GOLD))
		var value := UiStyle.label("", 20)
		grid.add_child(value)
		if row[1] != "":
			_values[row[1]] = value

	vb.add_child(UiStyle.label("EQUIPMENT", 20, UiStyle.GOLD))
	for slot in EQUIPMENT_SLOTS:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 16)
		row.add_child(UiStyle.label(slot.label, 16, UiStyle.GRAY))
		var selector := OptionButton.new()
		selector.custom_minimum_size = Vector2(300, 40)
		selector.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		selector.item_selected.connect(_on_equipment_selected.bind(slot.id))
		row.add_child(selector)
		vb.add_child(row)
		_equipment_selectors[slot.id] = selector

	vb.add_child(HSeparator.new())
	_message = UiStyle.label("", 16, Color(0.6, 1.0, 0.7), true)
	vb.add_child(_message)
	vb.add_child(UiStyle.button("SYNC NOW", _on_sync_pressed))
	vb.add_child(UiStyle.button("RESUME", func() -> void: resume_requested.emit()))
	vb.add_child(UiStyle.button("SETTINGS", _toggle_settings))
	vb.add_child(UiStyle.button("SAVE", _on_save_pressed))
	vb.add_child(UiStyle.button("BACK TO TITLE", func() -> void: title_requested.emit()))
	GameSync.sync_finished.connect(_on_sync_finished)

	_settings_box = PanelContainer.new()
	_settings_box.add_theme_stylebox_override("panel", UiStyle.panel_box(Color(0.04, 0.05, 0.12, 0.98), UiStyle.GOLD))
	UiStyle.place(_settings_box, 0.5, 0.5)
	_settings_box.visible = false
	add_child(_settings_box)
	var sb := VBoxContainer.new()
	sb.custom_minimum_size = Vector2(420, 0)
	sb.add_theme_constant_override("separation", 12)
	_settings_box.add_child(sb)
	sb.add_child(UiStyle.label("操作設定", 28, UiStyle.GOLD))
	GameSettings.build_controls(sb)
	sb.add_child(UiStyle.button("CLOSE", _toggle_settings, Vector2(200, 44), 20))


func _toggle_settings() -> void:
	_settings_box.visible = not _settings_box.visible


func open() -> void:
	_settings_box.visible = false
	_message.text = ""
	refresh()
	visible = true


func refresh() -> void:
	var s := GameManager.stats
	_name_label.text = GameManager.player_name
	_values["level"].text = str(s.level)
	_values["exp"].text = "%d / %d" % [s.current_exp, s.exp_to_next()]
	_values["hp"].text = "%d / %d" % [s.hp, GameManager.effective_max_hp()]
	_values["atk"].text = str(s.atk + GameManager.equipment_bonus("atk"))
	_values["def"].text = str(s.defense + GameManager.equipment_bonus("def"))
	_values["str"].text = str(s.strength)
	_values["int"].text = str(s.intelligence)
	_values["agi"].text = str(s.agility)
	_values["vit"].text = str(s.vitality)
	_values["dex"].text = str(s.dexterity)
	_values["cha"].text = str(s.charisma)
	_refresh_equipment_selectors()


func _refresh_equipment_selectors() -> void:
	for slot in EQUIPMENT_SLOTS:
		var slot_id: String = slot.id
		var selector: OptionButton = _equipment_selectors[slot_id]
		selector.clear()
		selector.add_item("未装備")
		selector.set_item_metadata(0, "")
		var selected_index := 0
		for item_id in GameManager.owned_equipment:
			var item := EquipmentData.item(item_id)
			if item.get("slot") != slot_id:
				continue
			selector.add_item(EquipmentData.display_name(item_id))
			var index := selector.item_count - 1
			selector.set_item_metadata(index, item_id)
			if GameManager.equipment.get(slot_id) == item_id:
				selected_index = index
		var current_value: Variant = GameManager.equipment.get(slot_id)
		var current_id := "" if current_value == null else String(current_value)
		if not current_id.is_empty() and selected_index == 0:
			selector.add_item(EquipmentData.display_name(current_id))
			selected_index = selector.item_count - 1
			selector.set_item_metadata(selected_index, current_id)
		selector.select(selected_index)


func _on_equipment_selected(index: int, slot_id: String) -> void:
	var selector: OptionButton = _equipment_selectors[slot_id]
	var item_id := String(selector.get_item_metadata(index))
	if not item_id.is_empty():
		var item := EquipmentData.item(item_id)
		if item.is_empty() or item.get("slot") != slot_id or not GameManager.owned_equipment.has(item_id):
			return
	GameManager.equipment[slot_id] = item_id if not item_id.is_empty() else null
	GameManager.equipment_dirty = true
	GameManager.clamp_player_hp_to_equipment()
	GameManager.save_game()
	refresh()


func _on_sync_pressed() -> void:
	_message.text = "同期中…"
	_message.text = await GameSync.synchronize()
	refresh()


func _on_sync_finished(_success: bool, message: String) -> void:
	_message.text = message
	refresh()


func _on_save_pressed() -> void:
	_message.text = "セーブしました" if GameManager.save_game() else "セーブに失敗しました"
