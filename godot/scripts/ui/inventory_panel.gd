class_name InventoryPanel
extends Control
## TABキーで開くインベントリ(簡易)。

var _list: VBoxContainer


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	visible = false

	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.55)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(dim)

	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", UiStyle.panel_box())
	UiStyle.place(panel, 0.5, 0.5)
	add_child(panel)
	var vb := VBoxContainer.new()
	vb.custom_minimum_size = Vector2(380, 0)
	vb.add_theme_constant_override("separation", 10)
	panel.add_child(vb)
	vb.add_child(UiStyle.label("ITEMS", 32, UiStyle.GOLD))
	vb.add_child(HSeparator.new())
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 6)
	vb.add_child(_list)
	vb.add_child(UiStyle.label("[TAB] 閉じる   [Q] ポーションを使う(フィールドで)", 15, UiStyle.GRAY))


func open() -> void:
	refresh()
	visible = true


func refresh() -> void:
	for c in _list.get_children():
		_list.remove_child(c)
		c.queue_free()
	var inv := GameManager.inventory
	for id in inv.items:
		_add_row(ItemData.display_name(String(id)), int(inv.items[id]), ItemData.color_of(String(id)))
	_add_row("Gold", inv.gold, ItemData.color_of("gold"))
	if inv.items.is_empty():
		_list.add_child(UiStyle.label("(アイテムなし)", 16, UiStyle.GRAY))


func _add_row(item_name: String, count: int, color: Color) -> void:
	_list.add_child(UiStyle.label("%s × %d" % [item_name, count], 22, color.lerp(Color.WHITE, 0.5)))
