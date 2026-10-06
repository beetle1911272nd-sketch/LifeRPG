class_name LevelSystem
extends RefCounted
## 必要EXPの計算だけを担当します。成長カーブを変えたいときはここだけ直せばOK。
## Level1→100 / Level2→150 / Level3→225 / Level4→337 ...

const BASE_EXP := 100.0
const GROWTH := 1.5


static func required_exp(level: int) -> int:
	return int(BASE_EXP * pow(GROWTH, level - 1))
