class_name UiManager
extends CanvasLayer
## ゲーム中のUI全体の管理役。HUD / レベルアップ演出 / インベントリ / ステータス画面を持ちます。
## メニューを開いている間はゲームを一時停止(pause)し、マウスカーソルを表示します。

var hud: Hud
var levelup: LevelUpOverlay
var inventory_panel: InventoryPanel
var status_panel: StatusPanel
var shop_panel: ShopPanel


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS  # 一時停止中もUIは動かす
	layer = 10

	hud = Hud.new()
	add_child(hud)
	levelup = LevelUpOverlay.new()
	add_child(levelup)
	inventory_panel = InventoryPanel.new()
	add_child(inventory_panel)
	status_panel = StatusPanel.new()
	add_child(status_panel)
	shop_panel = ShopPanel.new()
	add_child(shop_panel)

	status_panel.resume_requested.connect(close_menus)
	status_panel.title_requested.connect(GameManager.leave_to_title)
	shop_panel.close_requested.connect(close_menus)
	GameManager.stats.leveled_up.connect(_on_leveled_up)
	GameManager.item_picked.connect(hud.show_pickup)


func setup(player: PlayerController) -> void:
	hud.player = player


func _on_leveled_up(old_level: int, new_level: int) -> void:
	levelup.show_level_up(old_level, new_level)
	GameManager.save_game()


func _input(event: InputEvent) -> void:
	if event.is_action_pressed("menu"):
		if inventory_panel.visible or status_panel.visible or shop_panel.visible:
			close_menus()
		else:
			status_panel.open()
			_pause()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("inventory"):
		if inventory_panel.visible or shop_panel.visible:
			close_menus()
		elif not status_panel.visible:
			inventory_panel.open()
			_pause()
		get_viewport().set_input_as_handled()


func open_shop() -> void:
	if shop_panel.visible or inventory_panel.visible or status_panel.visible:
		return
	shop_panel.open()
	_pause()


func _pause() -> void:
	get_tree().paused = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func close_menus() -> void:
	inventory_panel.visible = false
	status_panel.visible = false
	shop_panel.visible = false
	get_tree().paused = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
