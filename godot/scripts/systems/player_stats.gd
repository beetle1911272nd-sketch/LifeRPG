class_name PlayerStats
extends RefCounted
## プレイヤーのステータス管理(独立システム)。
## 将来、Web版ABORE LIFE RPGと同期するときは to_dict() / from_dict() をつなぐだけでOK。

signal changed
signal leveled_up(old_level: int, new_level: int)
signal died

var level: int = 1
var current_exp: int = 0
var shared_progression: bool = false
var max_hp: int = 300
var hp: int = 300
var atk: int = 85
var defense: int = 61
var strength: int = 42
var intelligence: int = 57
var agility: int = 64
var vitality: int = 38
var dexterity: int = 53
var charisma: int = 50


func exp_to_next() -> int:
	if shared_progression:
		return 200 + (level - 1) * 40
	return LevelSystem.required_exp(level)


func add_exp(amount: int) -> void:
	current_exp += amount
	while current_exp >= exp_to_next():
		current_exp -= exp_to_next()
		var old_level := level
		level += 1
		_apply_level_up()
		leveled_up.emit(old_level, level)
	changed.emit()


func take_damage(amount: int) -> void:
	if hp <= 0:
		return
	hp = maxi(0, hp - amount)
	changed.emit()
	if hp == 0:
		died.emit()


func heal(amount: int) -> void:
	hp = mini(max_hp, hp + amount)
	changed.emit()


func revive() -> void:
	hp = max_hp
	changed.emit()


func _apply_level_up() -> void:
	max_hp += 30
	hp = max_hp
	atk += 5
	defense += 4
	strength += 2
	intelligence += 2
	agility += 2
	vitality += 2
	dexterity += 2
	charisma += 1


func to_dict() -> Dictionary:
	return {
		"level": level,
		"exp": current_exp,
		"shared_progression": shared_progression,
		"hp": hp,
		"max_hp": max_hp,
		"atk": atk,
		"def": defense,
		"str": strength,
		"int": intelligence,
		"agi": agility,
		"vit": vitality,
		"dex": dexterity,
		"cha": charisma,
	}


func from_dict(d: Dictionary) -> void:
	level = maxi(1, int(d.get("level", level)))
	current_exp = maxi(0, int(d.get("exp", current_exp)))
	shared_progression = bool(d.get("shared_progression", false))
	max_hp = maxi(1, int(d.get("max_hp", max_hp)))
	hp = clampi(int(d.get("hp", max_hp)), 1, max_hp)
	atk = int(d.get("atk", atk))
	defense = int(d.get("def", defense))
	strength = int(d.get("str", strength))
	intelligence = int(d.get("int", intelligence))
	agility = int(d.get("agi", agility))
	vitality = int(d.get("vit", vitality))
	dexterity = int(d.get("dex", dexterity))
	charisma = int(d.get("cha", charisma))
	changed.emit()
