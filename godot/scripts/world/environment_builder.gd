class_name EnvironmentBuilder
extends RefCounted
## 空・太陽・環境光・霧・雲を作ります(昼間の幻想的な雰囲気)。
## 色を変えたいときは、ここの Color(...) をいじると雰囲気が変わります。


static func build(parent: Node3D) -> void:
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.075, 0.105, 0.22)
	sky_mat.sky_horizon_color = Color(0.62, 0.39, 0.43)
	sky_mat.sky_curve = 0.32
	sky_mat.ground_horizon_color = Color(0.3, 0.3, 0.39)
	sky_mat.ground_bottom_color = Color(0.075, 0.09, 0.15)
	sky_mat.sun_angle_max = 16.0
	sky_mat.sun_curve = 0.12

	var sky := Sky.new()
	sky.sky_material = sky_mat

	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.78
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.ssao_enabled = false
	env.ssao_radius = 1.6
	env.ssao_intensity = 1.1
	env.ssao_power = 1.25
	env.glow_enabled = false
	env.glow_intensity = 0.18
	env.glow_bloom = 0.025
	env.fog_enabled = true
	env.fog_light_color = Color(0.42, 0.4, 0.54)
	env.fog_density = 0.00072
	env.fog_sky_affect = 0.22
	env.fog_aerial_perspective = 0.38
	env.adjustment_enabled = true
	env.adjustment_saturation = 0.94
	env.adjustment_contrast = 1.07
	env.adjustment_brightness = 0.98

	var world_env := WorldEnvironment.new()
	world_env.name = "WorldEnvironment"
	world_env.environment = env
	parent.add_child(world_env)

	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.rotation_degrees = Vector3(-38.0, -32.0, 0.0)
	sun.light_color = Color(1.0, 0.81, 0.72)
	sun.light_energy = 0.94
	sun.light_angular_distance = 0.35
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 120.0
	sun.shadow_bias = 0.035
	parent.add_child(sun)


static func build_clouds(parent: Node3D) -> Node3D:
	var root := Node3D.new()
	root.name = "Clouds"
	parent.add_child(root)

	var cloud_materials: Array[StandardMaterial3D] = [
		MeshUtil.material(Color(0.74, 0.75, 0.83), 1.0),
		MeshUtil.material(Color(0.82, 0.76, 0.79), 1.0),
		MeshUtil.material(Color(0.64, 0.68, 0.79), 1.0),
	]

	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for i in 18:
		var cloud := Node3D.new()
		cloud.position = Vector3(rng.randf_range(-420, 420), rng.randf_range(78, 138), rng.randf_range(-440, 220))
		cloud.rotation.y = rng.randf_range(-0.35, 0.35)
		var lobe_count := rng.randi_range(4, 7)
		for j in lobe_count:
			var sphere := SphereMesh.new()
			sphere.radius = 1.0
			sphere.height = 2.0
			sphere.radial_segments = 14
			sphere.rings = 7
			var mi := MeshUtil.instance(sphere, cloud_materials[(i + j) % cloud_materials.size()])
			var s := rng.randf_range(9.0, 18.0)
			mi.scale = Vector3(s * rng.randf_range(1.25, 1.8), s * rng.randf_range(0.32, 0.48), s * rng.randf_range(0.75, 1.15))
			mi.position = Vector3(
				(float(j) - float(lobe_count - 1) * 0.5) * rng.randf_range(13.0, 19.0),
				rng.randf_range(-2.0, 2.0),
				rng.randf_range(-7.0, 7.0)
			)
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			cloud.add_child(mi)
		root.add_child(cloud)
	return root
