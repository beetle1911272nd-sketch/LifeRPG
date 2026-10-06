class_name CombatSystem
extends RefCounted
## ダメージ計算だけを集めた場所。バランス調整はここで。


## プレイヤー → 敵 : max(1, ATK - DEF)
static func calc_damage(attacker_atk: int, target_def: int) -> int:
	return maxi(1, attacker_atk - target_def)


## 敵 → プレイヤー : DEFが高いほど軽減される(0にはならない)
## 例) ATK20 vs DEF61 → 約12ダメージ
static func calc_damage_to_player(enemy_atk: int, player_def: int) -> int:
	return maxi(1, int(round(enemy_atk * 100.0 / (100.0 + player_def))))
