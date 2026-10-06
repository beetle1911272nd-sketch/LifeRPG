class_name InventorySystem
extends RefCounted
## 所持アイテムとゴールドの管理。

signal changed

var items: Dictionary = {}  # item_id -> 個数
var gold: int = 0


func add_item(id: String, amount: int = 1) -> void:
	if id == "gold":
		gold += amount
	else:
		items[id] = int(items.get(id, 0)) + amount
	changed.emit()


func remove_item(id: String, amount: int = 1) -> bool:
	if amount <= 0:
		return false
	if count(id) < amount:
		return false
	if id == "gold":
		gold -= amount
	else:
		items[id] = int(items[id]) - amount
		if int(items[id]) <= 0:
			items.erase(id)
	changed.emit()
	return true


func try_purchase(id: String, price: int, amount: int = 1) -> bool:
	if id == "gold" or not ItemData.ITEMS.has(id) or price <= 0 or amount <= 0 or gold < price:
		return false
	gold -= price
	items[id] = int(items.get(id, 0)) + amount
	changed.emit()
	return true


func try_sell(id: String, price: int, amount: int = 1) -> bool:
	if id == "gold" or price <= 0 or amount <= 0 or count(id) < amount:
		return false
	items[id] = int(items[id]) - amount
	if int(items[id]) <= 0:
		items.erase(id)
	gold += price * amount
	changed.emit()
	return true


func count(id: String) -> int:
	if id == "gold":
		return gold
	return int(items.get(id, 0))


func to_dict() -> Dictionary:
	return {"items": items.duplicate(), "gold": gold}


func from_dict(d: Dictionary) -> void:
	items.clear()
	var saved: Dictionary = d.get("items", {})
	for key in saved:
		items[String(key)] = int(saved[key])
	gold = int(d.get("gold", 0))
	changed.emit()
