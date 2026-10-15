"""Prepare Irondust's CC0 soldiers for the browser arena using Blender 4.2.

Source: https://opengameart.org/content/sci-fi-soldier
Download/extract Sci-fi Soldiers.zip under .temp/research/scifi-soldiers first.
Run: blender --background --factory-startup --python scripts/prepare-arena-characters.py
The original source has a humanoid rig but no animation clips. The six skeletal
clips below are authored placeholders, not motion-captured/source animations.
"""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.temp/research/scifi-soldiers/Sci-fi Soldiers 2'
OUTPUT = ROOT / 'assets/models/apocalypse'
TEMP = ROOT / '.temp/research/character-export'
OUTPUT.mkdir(parents=True, exist_ok=True)
TEMP.mkdir(parents=True, exist_ok=True)


def image_map(skin, suffix, linear=False):
    extension = 'tga' if suffix == 'Albedo' else 'png'
    image = bpy.data.images.load(str(SOURCE / f'{skin}_{suffix}.{extension}'), check_existing=False)
    image.colorspace_settings.name = 'Non-Color' if linear else 'sRGB'
    image.scale(1024, 1024)
    image.file_format = 'PNG' if suffix == 'Emission' else 'JPEG'
    image.filepath_raw = str(TEMP / f'{skin}_{suffix}.{image.file_format.lower()}')
    image.save()
    return image


def material_for(skin):
    material = bpy.data.materials.new(skin + '_PBR')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Metallic'].default_value = 0.65
    shader.inputs['Roughness'].default_value = 0.48
    shader.inputs['Emission Strength'].default_value = 1.3
    for suffix, socket, linear in [('Albedo', 'Base Color', False), ('Emission', 'Emission Color', False)]:
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = image_map(skin, suffix, linear)
        links.new(texture.outputs['Color'], shader.inputs[socket])
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image_map(skin, 'NormalMap', True)
    normal = nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = 0.8
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
    camera.location = (3.6, -6.0, 3.1)
    camera.rotation_euler = (Vector((0, 0, 1.15)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 3.0
    scene.camera = camera
    for loc, energy, color in [((2, -4, 5), 700, (0.82, 0.9, 1.0)), ((-3, -1, 3), 500, (1.0, 0.78, 0.58)), ((1, 3, 4), 900, (0.6, 0.8, 1.0))]:
        data = bpy.data.lights.new('PreviewLight', 'AREA')
        data.energy, data.color, data.size = energy, color, 5
        obj = bpy.data.objects.new('PreviewLight', data)
        scene.collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (Vector((0, 0, 1.1)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    scene.world.color = (0.08, 0.08, 0.08)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 20
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
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
        export_copyright='Irondust (Sci-fi soldier), CC0 1.0; adapted for Personal AI Learning Arena',
        export_extras=True, export_cameras=False, export_lights=False)
    print('EXPORTED', filename, target.stat().st_size)
    render_preview(rig, 'Idle', filename + '-idle.png')
    render_preview(rig, 'Attack', filename + '-attack.png', 16)


if __name__ == '__main__':
    export_variant('vanguard', 'Head1', 'FederalSoldierSkin')
    export_variant('sentinel', 'Head3', 'MilitarySkin')
