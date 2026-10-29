class_name UiStyle
extends RefCounted
## UIの見た目(色・枠・ボタン)をまとめた場所。ここを変えると全画面の雰囲気が変わります。

const GOLD := Color(0.93, 0.8, 0.45)
const GOLD_DIM := Color(0.6, 0.5, 0.28)
const NAVY := Color(0.05, 0.07, 0.15, 0.86)
const WHITE := Color(0.97, 0.96, 0.9)
const GRAY := Color(0.7, 0.7, 0.8)


static func panel_box(bg: Color = NAVY, border: Color = GOLD_DIM) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(8)
	sb.set_content_margin_all(14)
	return sb


static func label(text: String, size: int = 18, color: Color = WHITE, center: bool = false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	l.add_theme_constant_override("outline_size", 4)
	if center:
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return l


static func bar(fill: Color, width: float = 280.0, height: float = 16.0) -> ProgressBar:
	var b := ProgressBar.new()
	b.show_percentage = false
	b.custom_minimum_size = Vector2(width, height)
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0, 0, 0, 0.6)
	bg.set_corner_radius_all(4)
	var fg := StyleBoxFlat.new()
	fg.bg_color = fill
	fg.set_corner_radius_all(4)
	b.add_theme_stylebox_override("background", bg)
	b.add_theme_stylebox_override("fill", fg)
	return b


static func button(text: String, callback: Callable, min_size: Vector2 = Vector2(300, 52), font_size: int = 24) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = min_size
	b.focus_mode = Control.FOCUS_NONE
	b.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	b.add_theme_font_size_override("font_size", font_size)
	b.add_theme_color_override("font_color", WHITE)
	b.add_theme_color_override("font_hover_color", GOLD)
	b.add_theme_stylebox_override("normal", panel_box(Color(0.08, 0.1, 0.22, 0.88), GOLD_DIM))
	b.add_theme_stylebox_override("hover", panel_box(Color(0.2, 0.18, 0.32, 0.95), GOLD))
	b.add_theme_stylebox_override("pressed", panel_box(Color(0.32, 0.26, 0.12, 0.95), GOLD))
	b.pressed.connect(callback)
	return b


## 画面の好きな位置(h,v = 0 / 0.5 / 1)にコントロールを置く。余白は margin。
static func place(c: Control, h: float, v: float, margin_x: float = 0.0, margin_y: float = 0.0) -> void:
	c.anchor_left = h
	c.anchor_right = h
	c.anchor_top = v
	c.anchor_bottom = v
	var sx := 1.0 if h < 0.25 else (-1.0 if h > 0.75 else 0.0)
	var sy := 1.0 if v < 0.25 else (-1.0 if v > 0.75 else 0.0)
	c.offset_left = margin_x * sx
	c.offset_right = margin_x * sx
	c.offset_top = margin_y * sy
	c.offset_bottom = margin_y * sy
	if h < 0.25:
		c.grow_horizontal = Control.GROW_DIRECTION_END
	elif h > 0.75:
		c.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	else:
		c.grow_horizontal = Control.GROW_DIRECTION_BOTH
	if v < 0.25:
		c.grow_vertical = Control.GROW_DIRECTION_END
	elif v > 0.75:
		c.grow_vertical = Control.GROW_DIRECTION_BEGIN
	else:
		c.grow_vertical = Control.GROW_DIRECTION_BOTH


## 狭い画面(スマホ)でもパネルが画面外にはみ出さないよう、中身をスクロール可能にして画面内に収める。
static func make_scrollable(panel: Container, vb: Control, width: float) -> void:
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panel.add_child(scroll)
	scroll.add_child(vb)
	vb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var fit := func() -> void:
		if not panel.is_inside_tree():
			return
		var vp := panel.get_viewport_rect().size
		vb.custom_minimum_size.x = minf(width, vp.x - 72.0)
		scroll.custom_minimum_size = Vector2(
			vb.custom_minimum_size.x + 8.0,
			minf(vb.get_combined_minimum_size().y + 4.0, vp.y - 40.0))
	panel.visibility_changed.connect(func() -> void:
		if panel.visible:
			fit.call())
	panel.resized.connect(fit)
	panel.get_window().size_changed.connect(fit)
