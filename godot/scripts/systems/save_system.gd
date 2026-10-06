class_name SaveSystem
extends RefCounted
## ローカルJSONセーブ。保存先は user://abore_save.json
## (Godotメニューの「プロジェクト > ユーザーデータフォルダを開く」で場所を確認できます)
## 将来Supabase同期を入れるときは、この save()/load_data() と同じ形で
## クラウド版を作って切り替えるだけで済みます。

const SAVE_PATH := "user://abore_save.json"


static func has_save() -> bool:
	return FileAccess.file_exists(SAVE_PATH)


static func save(data: Dictionary) -> bool:
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file == null:
		push_warning("セーブに失敗しました: %s" % error_string(FileAccess.get_open_error()))
		return false
	file.store_string(JSON.stringify(data, "\t"))
	return true


static func load_data() -> Dictionary:
	if not has_save():
		return {}
	var file := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if file == null:
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if parsed is Dictionary:
		return parsed
	return {}
