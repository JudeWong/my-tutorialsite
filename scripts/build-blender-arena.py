"""Blender-authored arena, Cycles ground AO bake and rendered QA scene.

Run Blender 4.2 --background --factory-startup --python scripts/build-blender-arena.py
Optional environment variables: ARENA_SKIP_BAKE=1, ARENA_SKIP_RENDER=1.
The GLB is real, textured 3D geometry, not a camera-facing render backdrop.
Scanned prop / concrete / HDR provenance: assets/models/apocalypse/ENVIRONMENT.md.
"""
import math
import json
import os
import struct
import random
from pathlib import Path
import bpy
from mathutils import Vector, Matrix, Euler

ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / 'assets/models/apocalypse'
OUT = ROOT / '.temp/research/blender-arena'
OUT.mkdir(parents=True, exist_ok=True)
BASIS = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
PROTOTYPES = {}


def xyz(v):
    return BASIS @ Vector(v)


def pbr(name, color, metal=0, rough=.8):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Roughness'].default_value = rough
    return mat


def concrete(name):
    mat = pbr(name, (.45, .45, .45), .015, .95)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get('Principled BSDF')
    uv = nodes.new('ShaderNodeUVMap'); uv.uv_map = 'SurfaceUV'
    for file, socket in [('ground-diffuse.jpg', 'Base Color'), ('ground-roughness.jpg', 'Roughness'), ('ground-normal.jpg', 'Normal')]:
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(str(ASSET / file), check_existing=True)
        texture.image.colorspace_settings.name = 'sRGB' if socket == 'Base Color' else 'Non-Color'
        links.new(uv.outputs['UV'], texture.inputs['Vector'])
        if socket == 'Normal':
            normal = nodes.new('ShaderNodeNormalMap'); normal.inputs['Strength'].default_value = .55
            links.new(texture.outputs['Color'], normal.inputs['Color'])
            links.new(normal.outputs['Normal'], shader.inputs['Normal'])
        else:
            links.new(texture.outputs['Color'], shader.inputs[socket])
    return mat


def mesh(name, verts, faces, material, bevel=0, uv_scale=3):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces); data.update()
    obj = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(obj)
    data.materials.append(material)
    uv = data.uv_layers.new(name='SurfaceUV')
    for face in data.polygons:
        normal = face.normal
        axes = (0, 1) if abs(normal.z) > .7 else (0, 2) if abs(normal.y) > .7 else (1, 2)
        for loop in face.loop_indices:
            co = data.vertices[data.loops[loop].vertex_index].co
            uv.data[loop].uv = (co[axes[0]] / uv_scale, co[axes[1]] / uv_scale)
    if bevel:
        mod = obj.modifiers.new('Chipped edge highlights', 'BEVEL'); mod.width = bevel; mod.segments = 2
        normals = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL'); normals.keep_sharp = True
    triangulate = obj.modifiers.new('Export-safe tangent topology', 'TRIANGULATE')
    triangulate.min_vertices = 5
    triangulate.keep_custom_normals = True
    return obj


def wall_piece(name, polygon, y, thickness, material):
    # An irregular broken silhouette extruded into a solid, not stacked boxes.
    verts = [(x, y - thickness / 2, z) for x, z in polygon] + [(x, y + thickness / 2, z) for x, z in polygon]
    n = len(polygon)
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    return mesh(name, verts, faces, material, .035)


def steel_beam(name, start, end, width, mat):
    # I-section steel with separate flange/web and bevel highlights.
    a, b = Vector(start), Vector(end)
    length = (b-a).length; w = width / 2; t = width * .13
    profile = [(-w,-w),(w,-w),(w,-w+t),(t/2,-w+t),(t/2,w-t),(w,w-t),(w,w),(-w,w),(-w,w-t),(-t/2,w-t),(-t/2,-w+t),(-w,-w+t)]
    n = len(profile)
    verts = [(x, y, z) for z in (0, length) for x,y in profile]
    faces = [tuple(reversed(range(n))), tuple(range(n,n*2))] + [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    obj = mesh(name, verts, faces, mat, .012)
    obj.location = a; obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = Vector((0,0,1)).rotation_difference(b-a)
    return obj


def clone_tree(obj):
    copy = obj.copy(); bpy.context.collection.objects.link(copy)
    for child in obj.children:
        cloned = clone_tree(child); cloned.parent = copy
    return copy


def prop(file, position, rotation=(0,0,0), width=None, height=None):
    if file not in PROTOTYPES:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(ASSET / file))
        objects = [o for o in bpy.data.objects if o not in before]
        bpy.context.view_layer.update()
        points = [o.matrix_world @ Vector(c) for o in objects if o.type == 'MESH' for c in o.bound_box]
        low = Vector([min(p[a] for p in points) for a in range(3)])
        high = Vector([max(p[a] for p in points) for a in range(3)])
        size = high-low; center = (high+low)*.5
        root = bpy.data.objects.new(file.replace('.glb','') + '_placement', None); bpy.context.collection.objects.link(root)
        offset = bpy.data.objects.new('GroundedSource', None); bpy.context.collection.objects.link(offset); offset.parent = root
        for obj in objects:
            if obj.parent is None: obj.parent = offset
        offset.location = (-center.x,-center.y,-low.z)
        PROTOTYPES[file] = (root, size)
    else:
        template, size = PROTOTYPES[file]
        root = clone_tree(template)
    size = PROTOTYPES[file][1]
    scale = height / size.z if height else width / max(size.x,size.y)
    root.scale = (scale,)*3; root.location = xyz(position)
    root.rotation_euler = (BASIS @ Euler(rotation, 'XYZ').to_matrix() @ BASIS.inverted()).to_euler()
    return root


def make_ground(material):
    rng = random.Random(47); n = 48; size = 28
    verts = []
    for y in range(n+1):
        for x in range(n+1):
            px,py = (x/n-.5)*size, (y/n-.5)*size+3
            z = -.025 if abs(px)<3.6 and abs(py)<1.8 else -.045+rng.random()*.025
            verts.append((px,py,z))
    faces = [(y*(n+1)+x,y*(n+1)+x+1,(y+1)*(n+1)+x+1,(y+1)*(n+1)+x) for y in range(n) for x in range(n)]
    obj = mesh('Baked_Concrete_Ground', verts, faces, material, uv_scale=4.5)
    ao = obj.data.uv_layers.new(name='AO_UV')
    for loop in obj.data.loops:
        p = obj.data.vertices[loop.vertex_index].co
        ao.data[loop.index].uv = (p.x/size+.5,(p.y-3)/size+.5)
    return obj


def build_scene():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    concrete_mat = concrete('Scanned damaged concrete')
    floor_mat = concrete('Ground with Blender baked contact occlusion')
    steel = pbr('Oxidised structural steel',(.19,.095,.045),.6,.64)
    ground = make_ground(floor_mat)
    wall_piece('Broken west warehouse', [(-10,0),(-3.8,0),(-3.8,2.1),(-4.15,2.5),(-3.9,2.75),(-4.5,3.15),(-4.2,3.7),(-4.8,4.15),(-4.5,5.3),(-5.5,5.65),(-5.9,5.25),(-6.3,6.1),(-10,6.1)],8.5,.48,concrete_mat)
    wall_piece('Broken east warehouse', [(4.2,0),(10,0),(10,5.8),(7.7,5.7),(7.5,4.8),(6.2,5.0),(5.7,4.35),(5.25,4.65),(5.1,3.4),(4.6,3.15),(4.8,2.8),(4.2,2.3)],8.2,.48,concrete_mat)
    steel_beam('Bent overhead girder',(-7,8.05,5.7),(4.0,8.05,5.15),.28,steel)
    steel_beam('Broken hanging girder',(3.95,8.05,5.15),(5.65,7.4,2.1),.2,steel)
    steel_beam('West support',(-6.8,7.85,0),(-6.5,7.85,5.8),.22,steel)
    for i in range(8):
        x=-4.65-i*.3
        steel_beam('Exposed rebar', (x,8.25,4.6),(x+.14,8.1,5.5+i*.07),.035,steel)
    rng = random.Random(118)
    for i in range(32):
        x = rng.choice([-1,1])*rng.uniform(3.7,8.3); y = rng.uniform(3.7,8.4)
        w,h,d = rng.uniform(.18,.7),rng.uniform(.08,.28),rng.uniform(.18,.55)
        verts = [(x-w,y-d,0),(x+w,y-d*.8,0),(x+w*.8,y+d,0),(x-w*.7,y+d*.9,0),
                 (x-w*.6,y-d*.7,h),(x+w*.85,y-d*.3,h*.85),(x+w*.5,y+d*.7,h*.55),(x-w*.7,y+d*.6,h*.8)]
        mesh('Fractured rubble %02d'%i,verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],concrete_mat,.018)
    prop('covered-car.glb',[-5.6,0,-4.0],[0,.48,0],width=4.4)
    for pos,rot in [([-3.5,0,-3.7],[0,-.12,0]),([3.7,0,-4.2],[0,.22,0]),([5.8,0,-.7],[0,1.35,0])]:
        prop('barrier.glb',pos,rot,width=2.15)
    for x in [-5,-2.5,0,2.5,5]: prop('fence.glb',[x,0,-6.5],[0,0,0],width=2.5)
    prop('barrel.glb',[-4.4,.38,-1.9],[0,.35,math.pi/2],height=1.15)
    prop('barrel.glb',[4.5,0,-2.7],[0,1.6,0],height=1.15)
    prop('barrel.glb',[5.3,0,-3.6],[0,.8,0],height=1.05)
    prop('tyre.glb',[-3.8,.15,.6],[math.pi/2,0,-.7],width=.86)
    prop('tyre.glb',[4.6,0,.3],[0,.35,0],width=.84)
    prop('tyre.glb',[-5,.15,-.6],[math.pi/2,0,1.8],width=.9)
    return ground


def bake_ground(ground):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 32
    scene.world.light_settings.distance = 3
    path = OUT / 'ground-contact-ao.png'
    if os.environ.get('ARENA_SKIP_BAKE') == '1' and path.exists():
        image = bpy.data.images.load(str(path),check_existing=True)
    else:
        image = bpy.data.images.new('Cycles ground contact occlusion',width=2048,height=2048)
        image.colorspace_settings.name='Non-Color'
        mat = ground.active_material
        target = mat.node_tree.nodes.new('ShaderNodeTexImage'); target.image=image
        mat.node_tree.nodes.active=target
        ground.data.uv_layers.active_index=1
        bpy.ops.object.select_all(action='DESELECT'); ground.select_set(True); bpy.context.view_layer.objects.active=ground
        scene.render.bake.margin=16; scene.render.bake.use_clear=True
        bpy.ops.object.bake(type='AO')
        image.filepath_raw=str(path); image.file_format='PNG'; image.save()
    ground.data.uv_layers.active_index=0; ground.data.uv_layers[0].active_render=True
    nodes,links=ground.active_material.node_tree.nodes,ground.active_material.node_tree.links
    group=bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
    if not group.interface.items_tree: group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
    settings=nodes.new('ShaderNodeGroup'); settings.node_tree=group
    texture=nodes.new('ShaderNodeTexImage'); texture.image=image
    uv=nodes.new('ShaderNodeUVMap'); uv.uv_map='AO_UV'
    links.new(uv.outputs['UV'],texture.inputs['Vector']); links.new(texture.outputs['Color'],settings.inputs['Occlusion'])


def lighting():
    scene=bpy.context.scene; world=scene.world or bpy.data.worlds.new('Warehouse HDR world'); scene.world=world; world.use_nodes=True
    nodes,links=world.node_tree.nodes,world.node_tree.links
    env=nodes.new('ShaderNodeTexEnvironment'); env.image=bpy.data.images.load(str(ASSET/'burnt-warehouse.hdr'))
    links.new(env.outputs['Color'],nodes['Background'].inputs['Color']); nodes['Background'].inputs['Strength'].default_value=.65
    def area(name,loc,energy,color,size,target=(0,1,1)):
        light=bpy.data.lights.new(name,'AREA'); light.energy=energy; light.color=color; light.shape='DISK'; light.size=size
        obj=bpy.data.objects.new(name,light); scene.collection.objects.link(obj); obj.location=xyz(loc)
        obj.rotation_euler=(xyz(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    area('Soft warm key',[-4,7,5],1100,(1,.81,.63),5.0)
    area('Cool roof fill',[4,5,-4],900,(.58,.75,1),5.0)
    area('Front bounce',[0,3,5],180,(.8,.88,1),4)


def remove_unused_tangents(filepath):
    """Drop undefined UV tangents on untextured steel without changing geometry.

    Blender can emit zero-length tangents for beveled rebar whose material has
    no normal map. Those attributes are unused by rendering, but violate glTF
    validation. Keep all tangents belonging to normal-mapped materials and
    preserve the binary payload byte for byte.
    """
    data = Path(filepath).read_bytes()
    magic, version, total = struct.unpack_from('<4sII', data)
    if magic != b'glTF' or version != 2 or total != len(data):
        raise ValueError('Expected a complete GLB 2.0 export')
    json_length, chunk_type = struct.unpack_from('<II', data, 12)
    if chunk_type != 0x4E4F534A:
        raise ValueError('Expected GLB JSON as the first chunk')
    document = json.loads(data[20:20+json_length])
    removed = 0
    for mesh_data in document.get('meshes', []):
        for primitive in mesh_data.get('primitives', []):
            material_index = primitive.get('material')
            material = document['materials'][material_index] if material_index is not None else {}
            attributes = primitive.get('attributes', {})
            if 'normalTexture' not in material and 'TANGENT' in attributes:
                del attributes['TANGENT']
                removed += 1
    if not removed:
        return
    encoded = json.dumps(document, separators=(',', ':'), ensure_ascii=False).encode('utf8')
    encoded += b' ' * ((-len(encoded)) % 4)
    trailing = data[20+json_length:]
    header = struct.pack('<4sII', b'glTF', 2, 20+len(encoded)+len(trailing))
    Path(filepath).write_bytes(header + struct.pack('<II', len(encoded), chunk_type) + encoded + trailing)
    print('Removed unused tangent attributes:', removed)


def export_environment():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        if obj.type not in {'LIGHT','CAMERA'}: obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(ASSET/'blender-wasteland.glb'),export_format='GLB',use_selection=True,
        export_apply=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=86,export_tangents=True,
        export_extras=True,export_cameras=False,export_lights=False,
        export_copyright='Poly Haven CC0 scans and textures; Blender-authored ruined warehouse, layout and AO bake')
    remove_unused_tangents(ASSET/'blender-wasteland.glb')


def preview():
    scene=bpy.context.scene
    for file,pos,rot in [('vanguard.glb',[-2.05,0,0],[0,.95,0]),('sentinel.glb',[2.05,0,0],[0,-.95,0])]:
        root=prop(file,pos,rot,height=2.65)
        for obj in root.children_recursive:
            if obj.type=='ARMATURE' and obj.animation_data:
                for track in obj.animation_data.nla_tracks: track.mute=True
                action=next((a for a in bpy.data.actions if a.name.lower().startswith('idle') and a.id_root=='OBJECT'),None)
                if action: obj.animation_data.action=action
    scene.frame_set(0)
    data=bpy.data.cameras.new('Arena composition camera'); camera=bpy.data.objects.new('Arena composition camera',data); scene.collection.objects.link(camera)
    camera.location=xyz([0,3.25,8]); camera.rotation_euler=(xyz([0,1.25,-.35])-camera.location).to_track_quat('-Z','Y').to_euler()
    data.sensor_fit='VERTICAL'; data.sensor_height=32; data.lens=32/(2*math.tan(math.radians(20)))
    scene.camera=camera
    scene.render.engine='CYCLES'; scene.cycles.samples=48; scene.cycles.use_denoising=True
    scene.render.resolution_x=1440; scene.render.resolution_y=900; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'; scene.render.filepath=str(OUT/'arena-blender-preview.png')
    scene.view_settings.view_transform='AgX'; scene.view_settings.look='AgX - Medium High Contrast'
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'arena-rendered.blend'))
    if os.environ.get('ARENA_SKIP_RENDER')!='1': bpy.ops.render.render(write_still=True)


if __name__=='__main__':
    ground=build_scene(); lighting(); bake_ground(ground); export_environment(); preview()
    print('BLENDER_ARENA_READY',OUT/'arena-blender-preview.png')
