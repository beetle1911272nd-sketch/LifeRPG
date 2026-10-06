class_name EquipmentData
extends RefCounted
## Equipment shared with the LIFE RPG web app.

const ITEMS := {
	"wood_sword": {"slot": "weapon", "name": "木の剣", "atk": 4},
	"bronze_dagger": {"slot": "weapon", "name": "青銅の短剣", "atk": 7},
	"stone_axe": {"slot": "weapon", "name": "石斧", "atk": 6},
	"iron_sword": {"slot": "weapon", "name": "鉄の剣", "atk": 10},
	"silver_rapier": {"slot": "weapon", "name": "銀のレイピア", "atk": 13},
	"war_hammer": {"slot": "weapon", "name": "戦鎚", "atk": 15},
	"twin_blades": {"slot": "weapon", "name": "双刃剣", "atk": 12},
	"mythril_blade": {"slot": "weapon", "name": "ミスリルブレード", "atk": 18},
	"dragonfang_blade": {"slot": "weapon", "name": "竜牙の剣", "atk": 24},
	"starlight_glaive": {"slot": "weapon", "name": "星光の大薙刀", "atk": 22},
	"voidedge_blade": {"slot": "weapon", "name": "虚空刃", "atk": 16},
	"leather_armor": {"slot": "armor", "name": "レザーアーマー", "def": 4},
	"studded_leather": {"slot": "armor", "name": "スタッズレザー", "def": 7, "max_hp": 8},
	"cloth_robe": {"slot": "armor", "name": "布のローブ", "def": 5, "max_hp": 5},
	"chain_mail": {"slot": "armor", "name": "チェインメイル", "def": 10, "max_hp": 15},
	"scale_armor": {"slot": "armor", "name": "スケイルアーマー", "def": 13, "max_hp": 22},
	"knight_plate": {"slot": "armor", "name": "騎士のプレート", "def": 14, "max_hp": 18},
	"runed_hauberk": {"slot": "armor", "name": "紋章の鎖帷子", "def": 12},
	"aegis_plate": {"slot": "armor", "name": "イージスプレート", "def": 18, "max_hp": 30},
	"titan_bulwark": {"slot": "armor", "name": "タイタンバルワーク", "def": 24, "max_hp": 45},
	"celestial_mantle": {"slot": "armor", "name": "天空の外套", "def": 20, "max_hp": 40},
	"nightveil_armor": {"slot": "armor", "name": "夜帷の鎧", "def": 16, "max_hp": 26},
	"lucky_charm": {"slot": "accessory", "name": "幸運のお守り", "max_hp": 20},
	"swift_band": {"slot": "accessory", "name": "俊足のバンド", "atk": 3, "def": 3},
	"iron_bangle": {"slot": "accessory", "name": "鉄の腕輪", "def": 5},
	"sages_ring": {"slot": "accessory", "name": "賢者の指輪"},
	"warriors_belt": {"slot": "accessory", "name": "闘士のベルト", "atk": 8, "def": 4},
	"guardian_brooch": {"slot": "accessory", "name": "守護のブローチ", "def": 8, "max_hp": 12},
	"hunters_earring": {"slot": "accessory", "name": "狩人のイヤリング", "atk": 9},
	"dragon_amulet": {"slot": "accessory", "name": "竜のアミュレット", "atk": 6, "def": 6},
	"phoenix_feather": {"slot": "accessory", "name": "不死鳥の羽", "max_hp": 50},
	"worldtree_seed": {"slot": "accessory", "name": "世界樹の種", "max_hp": 35, "atk": 5, "def": 5},
	"amethyst_signet": {"slot": "accessory", "name": "紫水晶の印章", "atk": 5},
}


static func item(item_id: String) -> Dictionary:
	return ITEMS.get(item_id, {})


static func display_name(item_id: String) -> String:
	return String(ITEMS.get(item_id, {}).get("name", item_id))
