class_name ShopPanel
extends Control
## Gold-based merchant UI; all transactions go through InventorySystem.

const STOCK := [
	{"id": "small_potion", "title": "小さなポーション", "description": "HPを100回復します", "price": 30},
	{"id": "large_potion", "title": "大きなポーション", "description": "HPを300回復します", "price": 75},
]
const SLIME_CORE_SELL_PRICE := 18

signal close_requested

var _gold_label: Label
var _feedback: Label
var _sell_button: Button
var _buy_buttons: Dictionary = {}
var _count_labels: Dictionary = {}


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false

	var dim := ColorRect.new()
	dim.color = Color(0.015, 0.02, 0.07, 0.72)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(dim)

	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", UiStyle.panel_box(Color(0.035, 0.045, 0.11, 0.97), UiStyle.GOLD_DIM))
	UiStyle.place(panel, 0.5, 0.5)
	add_child(panel)

	var content := VBoxContainer.new()
	content.custom_minimum_size = Vector2(520, 0)
	content.add_theme_constant_override("separation", 9)
	panel.add_child(content)

	var heading := HBoxContainer.new()
	heading.add_child(UiStyle.label("旅人の露店", 30, UiStyle.GOLD))
	var heading_spacer := Control.new()
	heading_spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	heading.add_child(heading_spacer)
	var close := UiStyle.button("×", func() -> void: close_requested.emit(), Vector2(48, 42), 23)
	close.size_flags_horizontal = Control.SIZE_SHRINK_END
	heading.add_child(close)
	content.add_child(heading)
	_gold_label = UiStyle.label("", 18, UiStyle.GOLD)
	content.add_child(_gold_label)
	content.add_child(HSeparator.new())

	for stock_item in STOCK:
		var item_id := String(stock_item["id"])
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 14)
		var details := VBoxContainer.new()
		details.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		details.add_child(UiStyle.label(String(stock_item["title"]), 21, UiStyle.WHITE))
		details.add_child(UiStyle.label(String(stock_item["description"]), 15, UiStyle.GRAY))
		var count_label := UiStyle.label("所持 0", 14, UiStyle.GRAY)
		details.add_child(count_label)
		row.add_child(details)
		var purchase := UiStyle.button("購入  %d G" % int(stock_item["price"]), _buy.bind(item_id, int(stock_item["price"])), Vector2(145, 48), 17)
		row.add_child(purchase)
		content.add_child(row)
		_buy_buttons[item_id] = purchase
		_count_labels[item_id] = count_label

	content.add_child(HSeparator.new())
	_sell_button = UiStyle.button("スライムコアを売る   +%d G" % SLIME_CORE_SELL_PRICE, _sell_core, Vector2(340, 46), 17)
	content.add_child(_sell_button)
	_feedback = UiStyle.label("", 16, Color(0.67, 1.0, 0.78), true)
	content.add_child(_feedback)
	content.add_child(UiStyle.label("[E / ESC] 閉じる", 14, UiStyle.GRAY, true))


func open() -> void:
	_feedback.text = ""
	refresh()
	visible = true


func refresh() -> void:
	var inventory := GameManager.inventory
	_gold_label.text = "所持金  %d G" % inventory.gold
	for stock_item in STOCK:
		var item_id := String(stock_item["id"])
		var button := _buy_buttons[item_id] as Button
		button.disabled = inventory.gold < int(stock_item["price"])
		var count_label := _count_labels[item_id] as Label
		count_label.text = "所持 %d" % inventory.count(item_id)
	_sell_button.disabled = inventory.count("slime_core") == 0


func _buy(item_id: String, price: int) -> void:
	if not GameManager.inventory.try_purchase(item_id, price):
		_feedback.text = "ゴールドが足りません"
		_feedback.add_theme_color_override("font_color", Color(1.0, 0.55, 0.52))
		refresh()
		return
	_feedback.text = "%sを購入しました" % ItemData.display_name(item_id)
	_feedback.add_theme_color_override("font_color", Color(0.67, 1.0, 0.78))
	if not GameManager.save_game():
		_feedback.text += " (セーブに失敗しました)"
	refresh()


func _sell_core() -> void:
	if not GameManager.inventory.try_sell("slime_core", SLIME_CORE_SELL_PRICE):
		_feedback.text = "売却できるSlime Coreがありません"
		refresh()
		return
	_feedback.text = "Slime Coreを売却しました"
	if not GameManager.save_game():
		_feedback.text += " (セーブに失敗しました)"
	refresh()
