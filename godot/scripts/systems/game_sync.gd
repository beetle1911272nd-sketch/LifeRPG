extends Node
## Secure device pairing and progression-only sync with the LIFE RPG web app.

signal sync_finished(success: bool, message: String)

const CONFIG_PATH := "user://abore_sync.cfg"
const MAX_LEVEL := 10000

var _config: Dictionary = {}
var _busy := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	var config := ConfigFile.new()
	if config.load(CONFIG_PATH) == OK:
		_config = {
			"url": String(config.get_value("sync", "url", "")),
			"publishable_key": String(config.get_value("sync", "publishable_key", "")),
			"device_token": String(config.get_value("sync", "device_token", "")),
		}


func is_linked() -> bool:
	return not String(_config.get("device_token", "")).is_empty()


func pair_from_bundle(bundle_text: String) -> String:
	if _busy:
		return "同期処理中です。"
	if is_linked():
		return "すでに連携済みです。別アカウントに接続する場合は先にUNLINK DEVICEを実行してください。"
	var parsed: Variant = JSON.parse_string(bundle_text)
	if not parsed is Dictionary:
		return "ペアリングJSONを読み取れません。"
	var bundle: Dictionary = parsed
	var url := String(bundle.get("url", "")).trim_suffix("/")
	var key := String(bundle.get("publishableKey", ""))
	var code := String(bundle.get("code", "")).to_lower()
	var regex := RegEx.new()
	regex.compile("^[0-9a-f]{16}$")
	var key_regex := RegEx.new()
	key_regex.compile("^[A-Za-z0-9._-]{20,512}$")
	if bundle.get("version") != 1 or not url.begins_with("https://") or url.length() > 256 \
			or url.contains("\n") or url.contains("\r") or key_regex.search(key) == null \
			or regex.search(code) == null:
		return "ペアリングJSONの形式が正しくありません。Web版で新しいコードを発行してください。"

	if SaveSystem.has_save():
		GameManager.continue_game()
	_busy = true
	var response := await _post_rpc(url, key, "claim_open_world_pairing", {"p_code": code})
	if not response.ok:
		_busy = false
		var error_text := String(response.get("error", ""))
		var message := "ペアリングに失敗しました。"
		if error_text.contains("invalid or expired"):
			message = "コードが無効か期限切れです。Web版で新しいコードを発行してください。"
		sync_finished.emit(false, message)
		return message

	var token := String(response.data)
	var token_regex := RegEx.new()
	token_regex.compile("^[0-9a-f]{64}$")
	if token_regex.search(token) == null:
		_busy = false
		return "デバイス認証を完了できませんでした。"
	_config = {"url": url, "publishable_key": key, "device_token": token}
	var save_error := _save_config()
	if save_error != OK:
		await _post_rpc(url, key, "revoke_open_world_device", {"p_device_token": token})
		_config.clear()
		_busy = false
		return "同期設定を保存できませんでした。"
	_busy = false
	return await synchronize()


func synchronize() -> String:
	if _busy:
		return "同期処理中です。"
	if not is_linked():
		return "先にWeb版プロフィールからGodotをペアリングしてください。"
	_busy = true

	var local_level := GameManager.stats.level
	var local_exp := GameManager.stats.current_exp
	var local_owned := GameManager.owned_equipment.duplicate()
	var local_equipment := GameManager.equipment.duplicate(true)
	var equipment_changed := GameManager.equipment_dirty
	var local_progress := _normalize_shared_progress(local_level, local_exp)
	var response := await _post_rpc(
		String(_config.url),
		String(_config.publishable_key),
		"load_open_world_progress",
		{"p_device_token": String(_config.device_token)}
	)
	if not response.ok:
		_busy = false
		var load_error := String(response.get("error", ""))
		var message := "クラウドの進行状況を読み込めませんでした。"
		if load_error.contains("invalid sync device"):
			_clear_config()
			message = "このデバイスの連携が無効になりました。Web版から再度ペアリングしてください。"
		sync_finished.emit(false, message)
		return message

	var remote: Variant = response.data
	if remote is Dictionary:
		_apply_shared_progress(remote)
		var update_equipment := equipment_changed
		if equipment_changed:
			GameManager.equipment = local_equipment
			GameManager.owned_equipment.clear()
			for item_id in local_owned:
				if not GameManager.owned_equipment.has(item_id):
					GameManager.owned_equipment.append(String(item_id))
			GameManager.equipment_dirty = true
			GameManager.clamp_player_hp_to_equipment()
		var local_is_ahead := _is_progress_ahead(local_progress.x, local_progress.y, GameManager.stats.level, GameManager.stats.current_exp)
		if local_is_ahead:
			GameManager.stats.level = local_progress.x
			GameManager.stats.current_exp = local_progress.y
			GameManager.stats.shared_progression = true
			if not equipment_changed:
				for item_id in local_owned:
					if not GameManager.owned_equipment.has(item_id):
						GameManager.owned_equipment.append(String(item_id))
				for slot in ["weapon", "armor", "accessory"]:
					if GameManager.equipment.get(slot) == null and local_equipment.get(slot) != null:
						GameManager.equipment[slot] = local_equipment[slot]
						update_equipment = true
		if local_is_ahead or equipment_changed:
			var save_response := await _save_progress(
				local_progress.x if local_is_ahead else GameManager.stats.level,
				local_progress.y if local_is_ahead else GameManager.stats.current_exp,
				GameManager.owned_equipment,
				GameManager.equipment,
				update_equipment
			)
			if not save_response.ok:
				_busy = false
				var save_message := "ローカルの進行状況をクラウドに保存できませんでした。"
				sync_finished.emit(false, save_message)
				return save_message
			GameManager.equipment_dirty = false
	else:
		GameManager.stats.shared_progression = true
		GameManager.stats.level = local_progress.x
		GameManager.stats.current_exp = local_progress.y
		var initial_save := await _save_progress(
			GameManager.stats.level,
			GameManager.stats.current_exp,
			GameManager.owned_equipment,
			GameManager.equipment,
			true
		)
		if not initial_save.ok:
			_busy = false
			var initial_message := "Godotの進行状況をクラウドに保存できませんでした。"
			sync_finished.emit(false, initial_message)
			return initial_message
		GameManager.equipment_dirty = false

	GameManager.save_local_game()
	_busy = false
	var success_message := "LEVEL・EXP・装備を同期しました。"
	sync_finished.emit(true, success_message)
	return success_message


func _apply_shared_progress(remote: Dictionary) -> void:
	GameManager.stats.level = clampi(int(remote.get("level", 1)), 1, MAX_LEVEL)
	GameManager.stats.current_exp = maxi(0, int(remote.get("exp", 0)))
	GameManager.stats.shared_progression = true
	var equipment: Variant = remote.get("equipment", {})
	if equipment is Dictionary:
		GameManager.equipment = {
			"weapon": equipment.get("weapon"),
			"armor": equipment.get("armor"),
			"accessory": equipment.get("accessory"),
		}
	var owned: Variant = remote.get("owned_equipment", [])
	if owned is Array:
		GameManager.owned_equipment.clear()
		for item_id in owned:
			GameManager.owned_equipment.append(String(item_id))
	GameManager.clamp_player_hp_to_equipment()


func _is_progress_ahead(level_a: int, exp_a: int, level_b: int, exp_b: int) -> bool:
	return level_a > level_b or (level_a == level_b and exp_a > exp_b)


func _normalize_shared_progress(level: int, exp: int) -> Vector2i:
	var normalized_level := clampi(level, 1, MAX_LEVEL)
	var normalized_exp := maxi(0, exp)
	while normalized_level < MAX_LEVEL and normalized_exp >= 200 + (normalized_level - 1) * 40:
		normalized_exp -= 200 + (normalized_level - 1) * 40
		normalized_level += 1
	return Vector2i(normalized_level, normalized_exp)


func _save_progress(level: int, exp: int, owned: Array, equipment: Dictionary, update_equipment: bool) -> Dictionary:
	return await _post_rpc(
		String(_config.url),
		String(_config.publishable_key),
		"save_open_world_device_progress",
		{
			"p_device_token": String(_config.device_token),
			"p_level": clampi(level, 1, MAX_LEVEL),
			"p_exp": clampi(exp, 0, 1000000),
			"p_owned_equipment": owned,
			"p_equipment": equipment,
			"p_update_equipment": update_equipment,
		}
	)


func _post_rpc(base_url: String, publishable_key: String, function_name: String, payload: Dictionary) -> Dictionary:
	var request := HTTPRequest.new()
	add_child(request)
	request.timeout = 15.0
	var headers := PackedStringArray([
		"apikey: %s" % publishable_key,
		"Content-Type: application/json",
	])
	var error := request.request(
		"%s/rest/v1/rpc/%s" % [base_url, function_name],
		headers,
		HTTPClient.METHOD_POST,
		JSON.stringify(payload)
	)
	if error != OK:
		request.queue_free()
		return {"ok": false, "error": error_string(error)}

	var result: Array = await request.request_completed
	request.queue_free()
	var response_code := int(result[1])
	var body := (result[3] as PackedByteArray).get_string_from_utf8()
	var data: Variant = JSON.parse_string(body)
	if int(result[0]) != HTTPRequest.RESULT_SUCCESS or response_code < 200 or response_code >= 300:
		var error_message := body
		if data is Dictionary:
			error_message = String(data.get("message", data.get("error", body)))
		return {"ok": false, "error": error_message}
	return {"ok": true, "data": data}


func _save_config() -> Error:
	var config := ConfigFile.new()
	config.set_value("sync", "url", _config.url)
	config.set_value("sync", "publishable_key", _config.publishable_key)
	config.set_value("sync", "device_token", _config.device_token)
	return config.save(CONFIG_PATH)


func unlink_device() -> String:
	if _busy:
		return "同期処理中です。"
	if not is_linked():
		return "Godotは連携されていません。"
	_busy = true
	var response := await _post_rpc(
		String(_config.url),
		String(_config.publishable_key),
		"revoke_open_world_device",
		{"p_device_token": String(_config.device_token)}
	)
	_busy = false
	if not response.ok:
		var error_message := "連携解除に失敗しました。オンライン状態を確認してください。"
		sync_finished.emit(false, error_message)
		return error_message
	var clear_error := _clear_config()
	if clear_error != OK:
		var clear_message := "連携は解除されましたが、端末の設定ファイルを削除できませんでした。"
		sync_finished.emit(false, clear_message)
		return clear_message
	var success_message := "このGodotデバイスの連携を解除しました。"
	sync_finished.emit(true, success_message)
	return success_message


func _clear_config() -> Error:
	var config_path := ProjectSettings.globalize_path(CONFIG_PATH)
	if FileAccess.file_exists(CONFIG_PATH):
		var error := DirAccess.remove_absolute(config_path)
		if error != OK:
			return error
	_config.clear()
	return OK
