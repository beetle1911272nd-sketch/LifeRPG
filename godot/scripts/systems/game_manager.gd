extends Node
## ゲーム全体の状態(プレイヤーデータ・セーブ・シーン移動)を持つ「オートロード」。
## project.godot の [autoload] に "GameManager" として登録済みなので、
## どのスクリプトからでも GameManager.stats などで呼び出せます。

signal item_picked(item_id: String, amount: int)
signal enemy_defeated(enemy_name: String)

const TITLE_SCENE := "res://scenes/main/title_screen.tscn"
const WORLD_SCENE := "res://scenes/world/game_world.tscn"
const MAP_NAME := "はじまりの草原"
const DEFAULT_PLAYER_NAME := "ABORE"

var player_name: String = DEFAULT_PLAYER_NAME
var stats: PlayerStats = PlayerStats.new()
var inventory: InventorySystem = InventorySystem.new()
var equipment: Dictionary = {"weapon": null, "armor": null, "accessory": null}
var owned_equipment: Array[String] = []
var equipment_dirty: bool = false
var is_in_game: bool = false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_setup_input_map()
	new_game()


# ---------------------------------------------------------------- ゲーム開始/セーブ
func new_game() -> void:
	stats = PlayerStats.new()
	inventory = InventorySystem.new()
	equipment = {"weapon": null, "armor": null, "accessory": null}
	owned_equipment.clear()
	equipment_dirty = false
	inventory.add_item("small_potion", 3)
	inventory.add_item("slime_core", 2)
	inventory.add_item("gold", 100)


func continue_game() -> bool:
	var data := SaveSystem.load_data()
	if data.is_empty():
		return false
	player_name = String(data.get("player_name", DEFAULT_PLAYER_NAME))
	stats = PlayerStats.new()
	stats.from_dict(data.get("stats", {}))
	inventory = InventorySystem.new()
	inventory.from_dict(data.get("inventory", {}))
	equipment = data.get("equipment", {"weapon": null, "armor": null, "accessory": null}).duplicate(true)
	owned_equipment.clear()
	for item_id in data.get("owned_equipment", []):
		owned_equipment.append(String(item_id))
	equipment_dirty = bool(data.get("equipment_dirty", false))
	return true


func start_game(continue_save: bool) -> void:
	if not (continue_save and continue_game()):
		new_game()
	get_tree().change_scene_to_file(WORLD_SCENE)
	if GameSync.is_linked():
		GameSync.call_deferred("synchronize")


func save_game() -> bool:
	var saved := save_local_game()
	if saved and GameSync.is_linked():
		GameSync.call_deferred("synchronize")
	return saved


func save_local_game() -> bool:
	var data := {
		"version": 2,
		"player_name": player_name,
		"stats": stats.to_dict(),
		"inventory": inventory.to_dict(),
		"equipment": equipment,
		"owned_equipment": owned_equipment,
		"equipment_dirty": equipment_dirty,
	}
	return SaveSystem.save(data)


func equipment_bonus(stat: String) -> int:
	var total := 0
	for item_id in equipment.values():
		if item_id == null:
			continue
		var item_data := EquipmentData.item(String(item_id))
		total += int(item_data.get(stat, 0))
	return total


func effective_max_hp() -> int:
	return stats.max_hp + equipment_bonus("max_hp")


func clamp_player_hp_to_equipment() -> void:
	stats.hp = mini(stats.hp, effective_max_hp())
	stats.changed.emit()


func heal_player(amount: int) -> void:
	stats.hp = mini(effective_max_hp(), stats.hp + amount)
	stats.changed.emit()


func begin_play() -> void:
	is_in_game = true
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	set_gameplay_input(true)


## プレイ中はタッチをマウス扱いにしない(攻撃の二重発火・カメラ漏れ防止)。
## メニュー/タイトルではボタン操作のためにエミュレートを戻す。
func set_gameplay_input(playing: bool) -> void:
	Input.emulate_mouse_from_touch = not playing


func leave_to_title() -> void:
	save_game()
	is_in_game = false
	get_tree().paused = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	set_gameplay_input(false)
	get_tree().change_scene_to_file(TITLE_SCENE)


func pick_up(item_id: String, amount: int) -> void:
	inventory.add_item(item_id, amount)
	item_picked.emit(item_id, amount)


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST and is_in_game:
		save_game()


# ---------------------------------------------------------------- 入力設定(コードで登録)
func _setup_input_map() -> void:
	_add_key("move_forward", KEY_W)
	_add_key("move_back", KEY_S)
	_add_key("move_left", KEY_A)
	_add_key("move_right", KEY_D)
	_add_key("sprint", KEY_SHIFT)
	_add_key("jump", KEY_SPACE)
	_add_key("use_potion", KEY_Q)
	_add_key("inventory", KEY_TAB)
	_add_key("menu", KEY_ESCAPE)
	_add_key("interact", KEY_E)
	_add_mouse("attack", MOUSE_BUTTON_LEFT)
	_add_mouse("dodge", MOUSE_BUTTON_RIGHT)


func _add_action(action: StringName) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action)


func _add_key(action: StringName, key: Key) -> void:
	_add_action(action)
	var ev := InputEventKey.new()
	ev.physical_keycode = key
	InputMap.action_add_event(action, ev)


func _add_mouse(action: StringName, button: MouseButton) -> void:
	_add_action(action)
	var ev := InputEventMouseButton.new()
	ev.button_index = button
	InputMap.action_add_event(action, ev)
