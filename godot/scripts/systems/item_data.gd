class_name ItemData
extends RefCounted
## アイテム定義。新しいアイテムはここに1行足すだけ。
## 将来はdata/フォルダのJSONやResourceに移せます。

const ITEMS := {
	"small_potion": {"name": "Small Potion", "color": Color(0.95, 0.3, 0.4), "heal": 100},
	"large_potion": {"name": "Large Potion", "color": Color(0.65, 0.48, 0.95), "heal": 300},
	"slime_core": {"name": "Slime Core", "color": Color(0.3, 0.95, 0.75)},
	"gold": {"name": "Gold", "color": Color(1.0, 0.82, 0.25)},
}


static func display_name(id: String) -> String:
	var info: Dictionary = ITEMS.get(id, {})
	return String(info.get("name", id))


static func color_of(id: String) -> Color:
	var info: Dictionary = ITEMS.get(id, {})
	return info.get("color", Color.WHITE)


static func heal_amount(id: String) -> int:
	var info: Dictionary = ITEMS.get(id, {})
	return int(info.get("heal", 0))
