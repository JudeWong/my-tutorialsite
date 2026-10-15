"""Blender Text Editor repair/export: only the current temple scene, no rebuild."""
import bpy
import json
from pathlib import Path

ROOT=Path(r'C:\Users\Acer\Documents\ChatGPT\TutorialSite')
OUT=ROOT/'.temp/research/temple-arena'
scene=bpy.context.scene
assert scene.name.startswith('Golden Temple Arena'), 'Select the Golden Temple Arena scene first.'
objects=[obj for obj in scene.objects if obj.type=='MESH' and obj.name.startswith('Temple_')]
assert len(objects)>=12, 'Expected authored temple geometry in the current scene.'
for obj in bpy.context.view_layer.objects:
    obj.select_set(False)
for obj in objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
bpy.ops.export_scene.gltf(
    filepath=str(ROOT/'assets/models/apocalypse/temple-arena.glb'),
    export_format='GLB',use_selection=True,use_active_scene=True,
    export_animations=False,export_yup=True,export_apply=True,
    export_normals=True,export_texcoords=True,export_tangents=False,
    export_image_format='AUTO',export_materials='EXPORT',
    export_vertex_color='MATERIAL',export_all_vertex_colors=False)
for obj in objects:
    obj.select_set(False)
bpy.context.view_layer.objects.active=None
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'temple-arena.blend'),check_existing=False)
report=OUT/'build-result.json'
if report.exists():
    data=json.loads(report.read_text(encoding='utf8'))
    data['glbBytes']=(ROOT/'assets/models/apocalypse/temple-arena.glb').stat().st_size
    data['exportedSceneOnly']=True
    report.write_text(json.dumps(data,indent=2),encoding='utf8')
print('TEMPLE_ACTIVE_SCENE_ONLY_EXPORTED')
