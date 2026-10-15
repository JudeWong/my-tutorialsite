"""Prepare Irondust's CC0 soldiers for the browser arena using Blender 4.2.

Source: https://opengameart.org/content/sci-fi-soldier
Download/extract Sci-fi Soldiers.zip under .temp/research/scifi-soldiers first.
Run: blender --background --factory-startup --python scripts/prepare-arena-characters.py
The original source has a humanoid rig but no animation clips. The six skeletal
clips below are authored placeholders, not motion-captured/source animations.
"""
import bpy
import bmesh
import json
import math
import struct
import sys
import numpy as np
import zlib
from pathlib import Path
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.temp/research/scifi-soldiers/Sci-fi Soldiers 2'
OUTPUT = ROOT / 'assets/models/apocalypse'
TEMP = ROOT / '.temp/research/character-export'
OUTPUT.mkdir(parents=True, exist_ok=True)
TEMP.mkdir(parents=True, exist_ok=True)


def save_data_png(image):
    """Encode 8-bit RGB data with lossless adaptive filters, omitting opaque alpha.

    Blender's default image.save compression is intentionally fast and writes
    an unnecessary alpha channel for the source normals. These are linear data,
    not a palette/quantized color image; every stored channel remains 8-bit.
    """
    width, height = image.size
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    rows = np.rint(np.clip(pixels.reshape(height, width, 4)[::-1, :, :3], 0, 1) * 255).astype(np.uint8).reshape(height, width * 3)
    prior = np.zeros(width * 3, dtype=np.int16)
    filtered = bytearray()
    for row in rows:
        current = row.astype(np.int16)
        left = np.concatenate((np.zeros(3, dtype=np.int16), current[:-3]))
        upper_left = np.concatenate((np.zeros(3, dtype=np.int16), prior[:-3]))
        p = left + prior - upper_left
        pa, pb, pc = abs(p - left), abs(p - prior), abs(p - upper_left)
        paeth = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, prior, upper_left))
        choices = [current, current - left, current - prior, current - ((left + prior) // 2), current - paeth]
        choices = [choice.astype(np.uint8) for choice in choices]
        index = min(range(5), key=lambda i: np.abs(choices[i].view(np.int8).astype(np.int16)).sum())
        filtered.append(index)
        filtered.extend(choices[index].tobytes())
        prior = current
    def chunk(kind, value):
        return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value))
    encoded = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    encoded += chunk(b'IDAT', zlib.compress(bytes(filtered), 9)) + chunk(b'IEND', b'')
    Path(image.filepath_raw).write_bytes(encoded)
    image.reload()


def image_map(skin, suffix, linear=False):
    extension = 'tga' if suffix == 'Albedo' else 'png'
    image = bpy.data.images.load(str(SOURCE / f'{skin}_{suffix}.{extension}'), check_existing=False)
    image.colorspace_settings.name = 'Non-Color' if linear else 'sRGB'
    image.scale(1024, 1024)
    # JPEG corrupts tangent-space normals along armor seams. Keep every data map
    # lossless; only the converted base color is stored as a JPEG below.
    image.file_format = 'PNG'
    image.filepath_raw = str(TEMP / f'{skin}_{suffix}.{image.file_format.lower()}')
    image.save()
    if linear:
        save_data_png(image)
    return image


def source_pixels(skin, suffix):
    extension = 'tga' if suffix in {'Albedo', 'Specular'} else 'png'
    image = bpy.data.images.load(str(SOURCE / f'{skin}_{suffix}.{extension}'), check_existing=False)
    image.colorspace_settings.name = 'Non-Color'
    image.scale(1024, 1024)
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(-1, 4)


def srgb_to_linear(value):
    return np.where(value <= 0.04045, value / 12.92, ((value + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(value):
    return np.where(value <= 0.0031308, 12.92 * value, 1.055 * np.maximum(value, 0) ** (1 / 2.4) - 0.055)


def save_pixels(name, pixels, color=False):
    image = bpy.data.images.new(name, width=1024, height=1024, alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(np.clip(pixels, 0, 1).ravel())
    image.file_format = 'JPEG' if color else 'PNG'
    image.filepath_raw = str(TEMP / f'{name}.{image.file_format.lower()}')
    image.save()
    if not color:
        save_data_png(image)
    image.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    return image


def converted_pbr(skin):
    """Convert the source Unity Standard Specular texture set into glTF PBR.

    RGB in Specular is sRGB reflectance; its alpha is smoothness. Solve the
    dielectric/metal mixture per pixel instead of making cloth and paint metal.
    The small roughness lift is an intentional worn/dusty finish for this arena.
    """
    albedo = source_pixels(skin, 'Albedo')
    spec_gloss = source_pixels(skin, 'Specular')
    ao = source_pixels(skin, 'Occlusion')[:, 0]
    diffuse = srgb_to_linear(albedo[:, :3])
    specular = srgb_to_linear(spec_gloss[:, :3])
    brightness = lambda color: np.sqrt(np.sum(color * color * np.array([0.299, 0.587, 0.114]), axis=1))
    diffuse_brightness = brightness(diffuse)
    specular_brightness = brightness(specular)
    dielectric = 0.04
    one_minus_specular = 1 - np.max(specular, axis=1)
    b = diffuse_brightness * one_minus_specular / (1 - dielectric) + specular_brightness - 2 * dielectric
    c = dielectric - specular_brightness
    metallic = np.where(specular_brightness < dielectric, 0,
                        np.clip((-b + np.sqrt(np.maximum(b * b - 4 * dielectric * c, 0))) / (2 * dielectric), 0, 1))
    diffuse_base = diffuse * (one_minus_specular / (1 - dielectric) / np.maximum(1 - metallic, 1e-6))[:, None]
    specular_base = (specular - dielectric * (1 - metallic)[:, None]) / np.maximum(metallic[:, None], 1e-6)
    base = diffuse_base * (1 - metallic[:, None] ** 2) + specular_base * metallic[:, None] ** 2
    # Original Unity material values: Federal 0.85, Military 1.0. These are
    # read from the serialized source rather than treating alpha as roughness.
    source_material = (SOURCE / f'{skin}.mat').read_bytes()
    offset = source_material.rfind(b'_GlossMapScale') + len(b'_GlossMapScale')
    offset = (offset + 3) & ~3
    gloss_scale = struct.unpack_from('<f', source_material, offset)[0]
    assert 0 < gloss_scale <= 1, f'Unexpected source gloss scale: {gloss_scale}'
    roughness = np.clip(1 - spec_gloss[:, 3] * gloss_scale + 0.18 + (1 - metallic) * 0.09 + (1 - ao) * 0.12, 0.28, 0.92)
    base_pixels = np.ones_like(albedo)
    base_pixels[:, :3] = linear_to_srgb(np.clip(base, 0, 1))
    orm_pixels = np.ones_like(albedo)
    orm_pixels[:, 0], orm_pixels[:, 1], orm_pixels[:, 2] = ao, roughness, metallic
    print('PBR', skin, 'sourceGloss', gloss_scale,
          'metallic/roughness p5/50/95', np.percentile(orm_pixels[:, 1:3], [5, 50, 95], axis=0).tolist())
    return save_pixels(skin + '_BaseColor', base_pixels, color=True), save_pixels(skin + '_OcclusionRoughnessMetallic', orm_pixels)


def material_for(skin):
    material = bpy.data.materials.new(skin + '_PBR')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Emission Strength'].default_value = 0.7
    base, orm = converted_pbr(skin)
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = base
    links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    packed = nodes.new('ShaderNodeTexImage')
    packed.image = orm
    separate = nodes.new('ShaderNodeSeparateColor')
    links.new(packed.outputs['Color'], separate.inputs['Color'])
    links.new(separate.outputs['Green'], shader.inputs['Roughness'])
    links.new(separate.outputs['Blue'], shader.inputs['Metallic'])
    # Blender's glTF exporter recognizes this socket and embeds the source AO
    # in occlusionTexture, sharing the same lossless packed ORM image.
    settings = bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    if not settings.interface.items_tree:
        settings.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        settings.interface.new_socket(name='Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    settings.nodes.clear()
    settings.nodes.new('NodeGroupInput')
    settings.nodes.new('NodeGroupOutput')
    settings_node = nodes.new('ShaderNodeGroup')
    settings_node.node_tree = settings
    links.new(separate.outputs['Red'], settings_node.inputs['Occlusion'])
    emission = nodes.new('ShaderNodeTexImage')
    emission.image = image_map(skin, 'Emission')
    links.new(emission.outputs['Color'], shader.inputs['Emission Color'])
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image_map(skin, 'NormalMap', True)
    normal = nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = 1.0
    links.new(texture.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    return material


def point_bone(rig, name, direction):
    """Aim the authored bone in armature space, preserving its original roll."""
    bone = rig.pose.bones[name]
    rest = bone.bone.matrix_local
    initial = (bone.bone.tail_local - bone.bone.head_local).normalized()
    desired = initial.rotation_difference(Vector(direction).normalized()) @ rest.to_quaternion()
    base = (bone.parent.matrix @ bone.parent.bone.matrix_local.inverted() @ rest) if bone.parent else rest
    bone.rotation_quaternion = base.to_quaternion().inverted() @ desired
    bpy.context.view_layer.update()


def rotate_local(rig, name, axis, degrees):
    rig.pose.bones[name].rotation_quaternion = Quaternion(Vector(axis), math.radians(degrees))
    bpy.context.view_layer.update()


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = Quaternion()
        bone.location = (0, 0, 0)
        bone.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def combat_pose(rig, breath=0, aim=0):
    reset_pose(rig)
    # Armature uses Blender Z-up, front -Y. A balanced stance, right cannon ready.
    rotate_local(rig, 'chest', (1, 0, 0), -2 + breath)
    point_bone(rig, 'upper_arm.R', (-0.14, -0.36 - aim * 0.55, -0.85 + aim * 0.7))
    point_bone(rig, 'forearm.R', (0.08, -1, -0.10 + aim * 0.10))
    point_bone(rig, 'upper_arm.L', (0.14, -0.18, -0.94))
    point_bone(rig, 'forearm.L', (-0.26, -0.70, -0.66))
    # Fingers remain on their original articulated rig, with a relaxed fist.
    for bone in rig.pose.bones:
        if bone.name.startswith(('f_index.', 'f_middle.', 'f_ring.', 'f_pinky.')):
            bone.rotation_quaternion = Quaternion((1, 0, 0), math.radians(28))
    bpy.context.view_layer.update()


def pose_for(rig, name, t):
    wave = math.sin(t * math.tau)
    combat_pose(rig, wave * 0.7)
    if name == 'Attack':
        # Lift the cannon, brace shoulders, recoil, then return to guard.
        aim = min(1, t / 0.20) * min(1, (1 - t) / 0.24)
        recoil = max(0, 1 - abs(t - 0.45) / 0.10)
        combat_pose(rig, 0, aim)
        rotate_local(rig, 'chest', (1, 0, 0), 4 * recoil - 2 * aim)
        point_bone(rig, 'forearm.R', (0, -1, recoil * 0.16))
        point_bone(rig, 'upper_arm.L', (0.22, -0.38 * aim, -0.90))
        point_bone(rig, 'forearm.L', (-0.35, -0.70, 0.12 * aim - 0.5))
    elif name == 'Hit':
        impact = max(0, math.sin(math.pi * min(1, t / 0.75)))
        rotate_local(rig, 'spine', (1, 0, 0), 17 * impact)
        rotate_local(rig, 'chest', (0, 0, 1), 9 * impact)
        rotate_local(rig, 'head', (1, 0, 0), 8 * impact)
        point_bone(rig, 'upper_arm.L', (0.25 + 0.3 * impact, 0.05, -0.92))
        point_bone(rig, 'forearm.L', (-0.1, -0.3, -0.92))
    elif name == 'Victory':
        lift = min(1, t / 0.3)
        point_bone(rig, 'upper_arm.L', (0.4, -0.05, -0.9 + 1.8 * lift))
        point_bone(rig, 'forearm.L', (-0.18, -0.20, -0.7 + 1.7 * lift))
        rotate_local(rig, 'chest', (0, 0, 1), -4 * lift + wave * 2)
        rotate_local(rig, 'head', (1, 0, 0), -8 * lift)
    elif name in ['Walk', 'Run']:
        amplitude = 0.65 if name == 'Run' else 0.36
        point_bone(rig, 'thigh.L', (0.04, wave * amplitude, -1))
        point_bone(rig, 'thigh.R', (-0.04, -wave * amplitude, -1))
        point_bone(rig, 'shin.L', (0, 0.10 + max(0, -wave) * amplitude, -1))
        point_bone(rig, 'shin.R', (0, 0.10 + max(0, wave) * amplitude, -1))
        point_bone(rig, 'foot.L', (0, -1, -0.4))
        point_bone(rig, 'foot.R', (0, -1, -0.4))
        point_bone(rig, 'upper_arm.L', (0.15, -wave * amplitude * 0.55, -0.95))
        rotate_local(rig, 'chest', (1, 0, 0), -7 if name == 'Run' else -2)


def make_animations(rig):
    rig.animation_data_create()
    for name, duration in [('Idle', 2.8), ('Attack', 1.35), ('Hit', 1.0), ('Victory', 2.4), ('Walk', 1.2), ('Run', 0.75)]:
        action = bpy.data.actions.new(name)
        rig.animation_data.action = action
        end = round(duration * 30)
        for frame in sorted(set([0, end] + list(range(0, end, 3)))):
            pose_for(rig, name, frame / end)
            for bone in rig.pose.bones:
                bone.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=bone.name)
                if bone.name == 'hips':
                    bone.keyframe_insert(data_path='location', frame=frame, group=bone.name)
        for curve in action.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = 'BEZIER'
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, action)
        track.mute = True
    rig.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(0)


def render_preview(rig, name, output_name, frame=0):
    scene = bpy.context.scene
    rig.animation_data.action = bpy.data.actions[name]
    scene.frame_set(frame)
    camera_data = bpy.data.cameras.new('PreviewCamera')
    camera = bpy.data.objects.new('PreviewCamera', camera_data)
    scene.collection.objects.link(camera)
    camera.location = (3.2, -6.0, 2.7)
    camera.rotation_euler = (Vector((0, 0, 1.25)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 2.5
    scene.camera = camera
    for loc, energy, color in [((2, -4, 5), 300, (0.92, 0.95, 1.0)), ((-3, -1, 3), 180, (1.0, 0.88, 0.76)), ((1, 3, 4), 400, (0.75, 0.86, 1.0))]:
        data = bpy.data.lights.new('PreviewLight', 'AREA')
        data.energy, data.color, data.size = energy, color, 5
        obj = bpy.data.objects.new('PreviewLight', data)
        scene.collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (Vector((0, 0, 1.1)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    if not scene.world:
        scene.world = bpy.data.worlds.new('PreviewWorld')
    scene.world.use_nodes = True
    wn, wl = scene.world.node_tree.nodes, scene.world.node_tree.links
    wn.clear()
    environment = wn.new('ShaderNodeTexEnvironment')
    environment.image = bpy.data.images.load(str(OUTPUT / 'burnt-warehouse.hdr'), check_existing=True)
    background = wn.new('ShaderNodeBackground')
    background.inputs['Strength'].default_value = 0.45
    wl.new(environment.outputs['Color'], background.inputs['Color'])
    world_output = wn.new('ShaderNodeOutputWorld')
    wl.new(background.outputs['Background'], world_output.inputs['Surface'])
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.render.film_transparent = True
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 800
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(TEMP / output_name)
    bpy.ops.render.render(write_still=True)
    for obj in list(scene.objects):
        if obj.type in {'CAMERA', 'LIGHT'}:
            bpy.data.objects.remove(obj, do_unlink=True)


def export_variant(filename, head_name, skin):
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE / 'Mesh.blend'))
    for obj in list(bpy.data.objects):
        if obj.name not in {'metarig', 'Body', 'Cannon', head_name}:
            bpy.data.objects.remove(obj, do_unlink=True)
        else:
            obj.hide_set(False)
            obj.hide_viewport = obj.hide_render = False
    bpy.context.view_layer.update()
    rig = bpy.data.objects['metarig']
    rig.name = 'ArmoredFighter'
    rig['source'] = 'Irondust / OpenGameArt / CC0 1.0'
    rig['frontAxis'] = '+Z in glTF, -Y in Blender'
    material = material_for(skin)
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            # Repair legacy Blender 2.7 mesh topology before the 4.2 exporter.
            obj.data.validate(verbose=False)
            mesh_edit = bmesh.new()
            mesh_edit.from_mesh(obj.data)
            # The source cannon has n-gons: triangulate them before tangents so
            # all three meshes carry a stable normal-map basis on mobile GPUs.
            bmesh.ops.triangulate(mesh_edit, faces=[face for face in mesh_edit.faces if len(face.verts) > 4])
            mesh_edit.to_mesh(obj.data)
            mesh_edit.free()
            obj.data.update()
            obj.data.materials.clear()
            obj.data.materials.append(material)
            for polygon in obj.data.polygons:
                polygon.use_smooth = True
    # The source cannon replaces the right hand and follows forearm.R.
    # Parent a named marker to the barrel tip so Three.js effects use the rig.
    muzzle = bpy.data.objects.new('Muzzle', None)
    bpy.context.collection.objects.link(muzzle)
    muzzle.parent = rig
    muzzle.parent_type = 'BONE'
    muzzle.parent_bone = 'forearm.R'
    muzzle.location = (0, 0.17, 0)
    make_animations(rig)
    bpy.context.scene.render.fps = 30
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = 84
    bpy.ops.object.select_all(action='SELECT')
    target = OUTPUT / f'{filename}.glb'
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_nla_strips=True,
        export_force_sampling=True, export_frame_range=False, export_anim_single_armature=True,
        export_image_format='AUTO', export_jpeg_quality=88, export_yup=True,
        export_tangents=True,
        export_copyright='Irondust (Sci-fi soldier), CC0 1.0; adapted for Personal AI Learning Arena',
        export_extras=True, export_cameras=False, export_lights=False)
    print('EXPORTED', filename, target.stat().st_size)
    bpy.ops.wm.save_as_mainfile(filepath=str(TEMP / f'{filename}-materials.blend'))
    if '--no-preview' not in sys.argv:
        render_preview(rig, 'Idle', filename + '-idle.png')
        render_preview(rig, 'Attack', filename + '-attack.png', 16)


if __name__ == '__main__':
    if '--baseline' in sys.argv:
        for variant in ['vanguard', 'sentinel']:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            bpy.ops.import_scene.gltf(filepath=str(OUTPUT / f'{variant}.glb'))
            rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
            for track in rig.animation_data.nla_tracks:
                track.mute = True
            action = next(action for action in bpy.data.actions if 'Idle' in action.name)
            action.name = 'Idle'
            render_preview(rig, 'Idle', variant + '-before.png')
    else:
        export_variant('vanguard', 'Head1', 'FederalSoldierSkin')
        export_variant('sentinel', 'Head3', 'MilitarySkin')
