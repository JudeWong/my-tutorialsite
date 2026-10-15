"""Original weathered temple arena, built from the Blender Text Editor.

This creates a separate scene; it never deletes the user's existing scene.
Run in Blender 5.2 using Text Editor > Open > Run Script.  No background Blender
process or remote asset loader is needed.  Texture provenance is recorded in
assets/models/apocalypse/TEMPLE.md.  The Sketchfab work is a visual reference,
not a downloaded or redistributed model.
"""
import bpy
import json
import math
import random
import traceback
from pathlib import Path
from mathutils import Vector, Quaternion


ROOT = Path(r'C:\Users\Acer\Documents\ChatGPT\TutorialSite')
script_path = Path(globals().get('__file__', '')).resolve()
if len(script_path.parents) > 1 and (script_path.parents[1] / 'arena-scene.js').exists():
    ROOT = script_path.parents[1]
elif getattr(bpy.context.space_data, 'text', None):
    text_path = Path(bpy.context.space_data.text.filepath).resolve()
    if len(text_path.parents) > 1 and (text_path.parents[1] / 'arena-scene.js').exists():
        ROOT = text_path.parents[1]
OUT = ROOT / '.temp/research/temple-arena'
TEX = OUT / 'textures'
ASSETS = ROOT / 'assets/models/apocalypse'
OUT.mkdir(parents=True, exist_ok=True)
RNG = random.Random(6612026)
TAU = math.pi * 2
BUFFERS = {}
MATERIALS = {}
SCENE = None
ENV = None


def material(name, color, rough=.85, metallic=0, texture=None):
    mat = bpy.data.materials.new('Temple ' + name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, 1)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = rough
    shader.inputs['Metallic'].default_value = metallic
    vc = nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    if texture:
        uv = nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'SurfaceUV'
        for suffix, socket in [('diffuse', 'Base Color'), ('roughness', 'Roughness'), ('normal', 'Normal')]:
            optimized = TEX / 'web' / f'temple-{texture}-{suffix}.jpg'
            path = optimized if optimized.exists() else TEX / f'temple-{texture}-{suffix}.jpg'
            if not path.exists():
                raise FileNotFoundError('Required Poly Haven texture missing: ' + str(path))
            node = nodes.new('ShaderNodeTexImage')
            node.image = bpy.data.images.load(str(path), check_existing=True)
            node.image.colorspace_settings.name = 'sRGB' if suffix == 'diffuse' else 'Non-Color'
            links.new(uv.outputs['UV'], node.inputs['Vector'])
            if suffix == 'normal':
                normal = nodes.new('ShaderNodeNormalMap')
                normal.uv_map = 'SurfaceUV'
                normal.inputs['Strength'].default_value = .62 if texture == 'stone' else .48
                links.new(node.outputs['Color'], normal.inputs['Color'])
                links.new(normal.outputs['Normal'], shader.inputs['Normal'])
            elif suffix == 'diffuse':
                mix = nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                mix.blend_type = 'MULTIPLY'
                mix.inputs[0].default_value = 1
                links.new(node.outputs['Color'], mix.inputs[6])
                links.new(vc.outputs['Color'], mix.inputs[7])
                links.new(mix.outputs[2], shader.inputs['Base Color'])
            else:
                links.new(node.outputs['Color'], shader.inputs[socket])
    else:
        # Colors live on vertices: glTF can reproduce these without baking.
        links.new(vc.outputs['Color'], shader.inputs['Base Color'])
    MATERIALS[name] = mat
    return mat


def add_mesh(group, mat, vertices, faces, colors=None, smooth=False, uvscale=2.2):
    """Accumulate geometry into semantic material batches, not thousands of draws."""
    key = (group, mat)
    buffer = BUFFERS.setdefault(key, {'v': [], 'f': [], 'c': [], 'smooth': [], 'uv': []})
    start = len(buffer['v'])
    buffer['v'].extend(tuple(v) for v in vertices)
    if colors is None:
        colors = [(1, 1, 1, 1)] * len(vertices)
    if len(colors) == 4 and isinstance(colors[0], (float, int)):
        colors = [colors] * len(vertices)
    buffer['c'].extend(colors)
    for face in faces:
        buffer['f'].append(tuple(i + start for i in face))
        buffer['smooth'].append(smooth)
        a, b, c = (Vector(vertices[i]) for i in face[:3])
        norm = (b-a).cross(c-a)
        axis = max(range(3), key=lambda i: abs(norm[i]))
        axes = (1, 2) if axis == 0 else (0, 2) if axis == 1 else (0, 1)
        buffer['uv'].append([(vertices[i][axes[0]] / uvscale, vertices[i][axes[1]] / uvscale) for i in face])


def stone_color(tint=(1, .96, .86), dark=.75, variation=.18):
    shade = dark + RNG.random() * variation
    return (*[min(1, c*shade) for c in tint], 1)


def chipped_block(group, loc, size, mat='Stone', color=None, bevel=.06, angle=0, damage=.12):
    """Three uneven octagonal rings produce real chipped, beveled masonry."""
    x, y, z = loc
    w, d, h = size
    bevel = min(bevel, h*.22, w*.18, d*.18)
    cut = min(w, d) * (.1 + damage*.28)
    outline = [(-w/2+cut,-d/2),(w/2-cut,-d/2),(w/2,-d/2+cut),
               (w/2,d/2-cut),(w/2-cut,d/2),(-w/2+cut,d/2),
               (-w/2,d/2-cut),(-w/2,-d/2+cut)]
    verts = []
    base = color or stone_color()
    colors = []
    for level, (height, inset) in enumerate([(0, bevel), (bevel, 0), (h-bevel, 0), (h, bevel)]):
        for px, py in outline:
            scale_x = 1-2*inset/w
            scale_y = 1-2*inset/d
            px *= scale_x
            py *= scale_y
            if damage and level in (1, 2):
                px += RNG.uniform(-1,1)*bevel*damage
                py += RNG.uniform(-1,1)*bevel*damage
            verts.append((x+px*math.cos(angle)-py*math.sin(angle),
                          y+px*math.sin(angle)+py*math.cos(angle), z+height))
            shade = .89 if level == 0 else .97 if level == 1 else 1.0
            colors.append((base[0]*shade, base[1]*shade, base[2]*shade, 1))
    faces = [tuple(reversed(range(8))), tuple(range(24,32))]
    for layer in range(3):
        for i in range(8):
            j = (i+1)%8
            faces.append((layer*8+i, layer*8+j, (layer+1)*8+j, (layer+1)*8+i))
    add_mesh(group, mat, verts, faces, colors)


def poly_extrude(group, points, depth, mat, color):
    # points: 2D x/z facade contour; extruded along y.
    front, back = depth
    n = len(points)
    verts = [(x, front, z) for x,z in points] + [(x, back, z) for x,z in points]
    faces = [tuple(reversed(range(n))), tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    add_mesh(group, mat, verts, faces, color)


def beam(group, start, end, r0, r1, mat='Wood', color=(.12,.075,.034,1), sides=7):
    a, b = Vector(start), Vector(end)
    axis = b-a
    if axis.length < 1e-6:
        return
    rotation = Vector((0,0,1)).rotation_difference(axis.normalized())
    verts = []
    for t, r in [(0,r0),(1,r1)]:
        for i in range(sides):
            angle = TAU*i/sides
            verts.append(tuple(a + axis*t + rotation @ Vector((math.cos(angle)*r,math.sin(angle)*r,0))))
    faces = [tuple(reversed(range(sides))),tuple(range(sides,2*sides))]
    faces += [(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)]
    add_mesh(group, mat, verts, faces, color, smooth=True)


def boulder(group, loc, size, mat='Stone', tint=(.62,.61,.53), segments=9, rings=5):
    x,y,z = loc
    sx,sy,sz = size
    verts = [(x,y,z-sz*.15)]
    colors = [(*[c*.7 for c in tint],1)]
    for j in range(1,rings):
        theta=math.pi*j/rings
        for i in range(segments):
            phi=TAU*i/segments
            noise=RNG.uniform(.83,1.13)
            verts.append((x+sx*math.sin(theta)*math.cos(phi)*noise,
                          y+sy*math.sin(theta)*math.sin(phi)*noise,
                          z+sz*(math.cos(theta)+.5)*noise))
            light=RNG.uniform(.78,1.02)
            colors.append((*[min(1,c*light) for c in tint],1))
    verts.append((x+.1*sx,y,z+sz*1.5))
    colors.append((*tint,1))
    # Ring one is the top; cap order follows outward normals.
    top=len(verts)-1
    faces=[(top,1+i,1+(i+1)%segments) for i in range(segments)]
    for j in range(rings-2):
        a=1+j*segments; b=a+segments
        for i in range(segments):
            ni=(i+1)%segments
            faces.append((a+i,b+i,b+ni,a+ni))
    last=1+(rings-2)*segments
    faces.extend((0,last+(i+1)%segments,last+i) for i in range(segments))
    add_mesh(group,mat,verts,faces,colors)


def platform():
    # Foundation is visible between individual steps/slabs, not a paper plane.
    chipped_block('Temple_Limestone_Frame',(0,0,-.85),(10.7,8.7,.45),'Stone',stone_color(dark=.58),.10)
    chipped_block('Temple_Limestone_Frame',(0,0,-.42),(10.35,8.35,.27),'Stone',stone_color(dark=.83),.08)
    chipped_block('Temple_Limestone_Frame',(0,0,-.17),(9.85,7.85,.12),'DarkStone',(.40,.46,.45,1),.025)
    # 70 separate bevel/chipped slabs, well below the fighters' collision plane.
    for row in range(7):
        for col in range(10):
            x=-4.45+col*.99
            y=-3+row
            chipped_block('Temple_Central_Floor',(x,y,-.115),(.966,.973,.108),'Floor',
                          stone_color((.96,.96,.92),.83,.15),.017,damage=.35)
    # Pale raised border, segmented stone rather than a single giant cuboid.
    for y in (-4.01,4.01):
        for i in range(11):
            chipped_block('Temple_Limestone_Frame',(-4.6+i*.92,y,-.04),(.90,.38,.20),
                          'Stone',stone_color((1,.98,.89),.84,.12),.035)
    for x in (-5.0,5.0):
        for i in range(8):
            chipped_block('Temple_Limestone_Frame',(x,-3.5+i,-.04),(.38,.98,.20),
                          'Stone',stone_color((1,.98,.89),.84,.12),.035)
    # Recessed geometric ring in the floor is flush, subtle and non-emissive.
    for i in range(64):
        a,b=TAU*i/64,TAU*(i+1)/64
        r0,r1=2.48,2.51
        v=[(math.cos(a)*r0,math.sin(a)*r0,-.003),
           (math.cos(a)*r1,math.sin(a)*r1,-.003),
           (math.cos(b)*r1,math.sin(b)*r1,-.003),
           (math.cos(b)*r0,math.sin(b)*r0,-.003)]
        add_mesh('Temple_Bronze_Inlays','Bronze',v,[(0,1,2,3)],(.25,.16,.055,1))
    for side in (-1,1):
        for step in range(5):
            depth=.46
            z=-.75+step*.15
            y=side*(6.0-step*.43)
            for i in range(5):
                chipped_block('Temple_Stone_Stairs',(-1.84+i*.92,y,z),(.90,depth,.15),
                              'Stone',stone_color(),.035)
            x=side*(7.0-step*.43)
            for i in range(4):
                chipped_block('Temple_Stone_Stairs',(x,-1.38+i*.92,z),(depth,.90,.15),
                              'Stone',stone_color(),.035)
    # Worn rubble outside the clear combat lane.
    for i in range(45):
        x=RNG.choice([-1,1])*RNG.uniform(3.65,4.66)
        y=RNG.uniform(-3.35,3.35)
        chipped_block('Temple_Scattered_Rubble',(x,y,.005),
                      (RNG.uniform(.13,.43),RNG.uniform(.09,.30),RNG.uniform(.025,.10)),
                      'Stone',stone_color(dark=.74),.02,angle=RNG.uniform(-2,2),damage=.8)


def carved_column(x,y,height=4.2,broken=False):
    group='Temple_Carved_Pillars'
    for width,z,h in [(1.52,-.72,.25),(1.32,-.47,.20),(1.16,-.27,.18),(1.02,-.09,.16)]:
        chipped_block(group,(x,y,z),(width,width,h),'Stone',stone_color(dark=.86),.05)
    h=height-.55
    # Dark tapering shaft is built from alternating staggered masonry courses.
    count=max(2,int(h/.58))
    for j in range(count):
        z=.07+j*h/count
        width=1.02-j/count*.14
        color=stone_color((.54,.64,.65),.69,.14)
        chipped_block(group,(x,y,z),(width,width,h/count-.014),'DarkStone',color,.035,damage=.22)
        if j%2==0:
            chipped_block(group,(x,y,z+.025),(width+.05,width+.05,.055),'Stone',
                          stone_color((.9,.91,.83),.75,.12),.013)
    if not broken:
        for width,z,hh in [(1.08,h+.05,.12),(1.28,h+.17,.17),(1.44,h+.34,.18)]:
            chipped_block(group,(x,y,z),(width,width,hh),'Stone',stone_color(dark=.85),.045)
        # Tapered pyramid cap / obelisk silhouette, with an uneven chipped apex.
        verts=[(x-.58,y-.58,h+.52),(x+.58,y-.58,h+.52),(x+.58,y+.58,h+.52),
               (x-.58,y+.58,h+.52),(x+.025,y-.02,h+1.0)]
        add_mesh(group,'Stone',verts,[(0,3,2,1),(0,1,4),(1,2,4),(2,3,4),(3,0,4)],stone_color(dark=.9))
    else:
        boulder('Temple_Scattered_Rubble',(x+.14,y,h+.02),(.47,.45,.22),tint=(.65,.72,.67))
    # Recessed dark vertical panels plus pale edge rails and relief diamonds.
    for side in (-1,1):
        front=y+side*.511
        for dx in (-.32,.32):
            chipped_block(group,(x+dx,front,.39),(.055,.05,max(.5,h-.55)),
                          'Stone',stone_color(dark=.85),.009)
        for j in range(max(1,int(h/.70))):
            z=.63+j*.69
            points=[(x-.16,z),(x,z+.23),(x+.16,z),(x,z-.23)]
            poly_extrude(group,points,(front-.025,front+.025),'Stone',stone_color((.97,.94,.80),.84,.10))


def gateway():
    # Layered ruin portal; rectangular stepped silhouette, not a Roman colosseum.
    for step in range(5):
        for i in range(8):
            chipped_block('Temple_Stone_Stairs',(-3.22+i*.92,7.2+step*.44,-.74+step*.15),
                          (.90,.46,.16),'Stone',stone_color(dark=.79),.035)
    for side in (-1,1):
        x=side*2.55
        carved_column(x,9.2,5.0)
        # Pilaster walls beside portal, each course with a distinct silhouette.
        for row in range(8):
            length=2.4+RNG.uniform(-.35,.30)
            chipped_block('Temple_Ruined_Gateway',(side*(3.65+length/2),9.35,row*.48-.69),
                          (length,1.1,.46),'DarkStone',stone_color((.65,.71,.68),.72,.13),.06)
        for i in range(5):
            chipped_block('Temple_Ruined_Gateway',(side*(3.7+i*.53),9.35,3.17),
                          (.52,1.35,.22),'Stone',stone_color(dark=.84),.055)
    # Massive lintel and staggered cornices; entrance remains entirely open.
    for i in range(7):
        chipped_block('Temple_Ruined_Gateway',(-2.4+i*.8,9.2,4.25),(.785,1.16,.65),
                      'DarkStone',stone_color((.61,.70,.70),.73,.12),.045)
    for width,z,height in [(6.05,4.87,.20),(5.7,5.07,.28),(5.22,5.35,.20),(4.45,5.55,.28)]:
        chipped_block('Temple_Ruined_Gateway',(0,9.2,z),(width,1.40,height),
                      'Stone',stone_color(dark=.83),.055)
    # Crown and inset sun relief carved into the front facade.
    poly_extrude('Temple_Ruined_Gateway',[(-1.8,5.78),(-1.45,6.0),(-.65,6.0),(-.4,6.33),
                 (.48,6.30),(.7,5.98),(1.51,5.98),(1.79,5.78)],(8.57,9.75),
                 'Stone',stone_color(dark=.85))
    for i in range(12):
        angle=TAU*i/12
        r=.34
        x,z=math.cos(angle)*r,4.59+math.sin(angle)*r
        beam('Temple_Bronze_Inlays',(x*.86,8.59,4.59+(z-4.59)*.86),
             (x*1.17,8.59,4.59+(z-4.59)*1.17),.025,.018,'Bronze',(.30,.20,.077,1),5)
    for i in range(11):
        if abs(i-5)<2:
            continue
        x=-2.25+i*.45
        poly_extrude('Temple_Ruined_Gateway',[(x-.13,4.6),(x,4.78),(x+.13,4.6),(x,4.42)],
                     (8.58,8.61),'Stone',stone_color(dark=.9))
    # Side retaining walls and a few broken detached courses.
    for side in (-1,1):
        for j in range(4):
            y=1.7+j*1.55
            height=[1.15,1.7,1.4,1.85][j]
            for row in range(int(height/.38)):
                chipped_block('Temple_Ruin_Walls',(side*6.3,y,-.7+row*.38),
                              (.72,1.5,.36),'DarkStone',stone_color((.67,.72,.65),.71,.14),.04)
        for y,h in [(-2.8,3.0),(2.8,3.85),(6.3,4.7)]:
            carved_column(side*5.7,y,h,broken=(side==1 and y==2.8))


def terrain():
    # Broad low, irregular terrain mesh below all steps.
    size,n=36,24
    verts=[]
    for j in range(n+1):
        for i in range(n+1):
            x=(i/n-.5)*size
            y=(j/n-.5)*size+4
            z=-.86+math.sin(x*.5)*math.cos(y*.4)*.09
            verts.append((x,y,z))
    faces=[(j*(n+1)+i,j*(n+1)+i+1,(j+1)*(n+1)+i+1,(j+1)*(n+1)+i)
           for j in range(n) for i in range(n)]
    colors=[stone_color((.58,.58,.44),.75,.15) for _ in verts]
    add_mesh('Temple_Earth','Stone',verts,faces,colors,uvscale=3.7)
    # Geological outcrops use many coarse strata with irregular silhouette.
    for i in range(18):
        x=-15+i*1.8
        y=14.7+RNG.uniform(-.7,1.5)
        h=RNG.uniform(3.4,5.4)+(1 if abs(x)>10 else 0)
        for level in range(3):
            boulder('Temple_Cliff',(x+RNG.uniform(-.5,.5),y+level*.26,-.7+level*h*.48),
                    (RNG.uniform(1.6,2.4),RNG.uniform(1.8,2.9),h*.45),
                    tint=(.53+level*.035,.56+level*.025,.48+level*.02),segments=9,rings=5)
    for side in (-1,1):
        for i in range(12):
            y=-2+i*1.1
            x=side*(8.5+RNG.uniform(-.8,1.7))
            boulder('Temple_Cliff',(x,y,-.7),
                    (RNG.uniform(.65,1.65),RNG.uniform(.6,1.5),RNG.uniform(.6,1.6)),
                    tint=(.62,.65,.53))
    for i in range(65):
        x=RNG.choice([-1,1])*RNG.uniform(5.9,8.4)
        y=RNG.uniform(-5,11)
        boulder('Temple_Scattered_Rubble',(x,y,-.72),
                (RNG.uniform(.15,.46),RNG.uniform(.15,.43),RNG.uniform(.08,.28)),
                tint=(.73,.73,.62),segments=7,rings=3)


def leaf(loc, length, direction, color, width=.43):
    rotation=Vector((0,0,1)).rotation_difference(Vector(direction).normalized())
    center=Vector(loc)
    # Five-sided folded leaf, opaque real geometry: no alpha-card halos.
    local=[(0,0,0),(-length*width,0,length*.43),(0,-length*.10,length*.53),
           (length*width,0,length*.43),(0,0,length)]
    verts=[tuple(center+rotation@Vector(v)) for v in local]
    add_mesh('Temple_Golden_Foliage','Leaves',verts,[(0,1,2),(1,4,2),(4,3,2),(3,0,2)],color,smooth=True)


def leaf_cluster(center, radius, count):
    for i in range(count):
        direction=Vector((RNG.uniform(-1,1),RNG.uniform(-1,1),RNG.uniform(-.3,1)))
        if direction.length<.01:
            direction.z=1
        direction.normalize()
        p=Vector(center)+direction*(radius*RNG.random()**.45)
        shade=RNG.uniform(.75,1.3)
        palette=RNG.choice([(.44,.26,.045),(.56,.35,.065),(.30,.32,.075),(.58,.43,.13)])
        color=(*[min(.85,c*shade) for c in palette],1)
        leaf(p,RNG.uniform(.12,.27),direction,color)


def tree(x,y,height,side=1):
    trunk=[Vector((x,y,-.72)),Vector((x+.12*side,y,height*.32)),
           Vector((x-.10*side,y+.14,height*.63)),Vector((x+.24*side,y,height*.91))]
    for i in range(3):
        beam('Temple_Branches',trunk[i],trunk[i+1],.20-i*.044,.15-i*.05)
    for i in range(9):
        a=TAU*i/9+.3
        start=trunk[1].lerp(trunk[3],i/12+.1)
        reach=RNG.uniform(.9,1.7)
        end=start+Vector((math.cos(a)*reach,math.sin(a)*reach,RNG.uniform(.3,.9)))
        bend=start.lerp(end,.6)+Vector((0,0,.16))
        beam('Temple_Branches',start,bend,.075,.043)
        beam('Temple_Branches',bend,end,.043,.014)
        leaf_cluster(end,reach*.65,65)
        for j in range(2):
            twig=end+Vector((RNG.uniform(-.4,.4),RNG.uniform(-.4,.4),RNG.uniform(-.1,.5)))
            beam('Temple_Branches',end,twig,.018,.006)
            leaf_cluster(twig,.38,16)


def foliage():
    for side in (-1,1):
        for y,h in [(-.6,4.1),(5.1,5.8),(10.1,6.4)]:
            tree(side*(8.5+RNG.uniform(-.3,.5)),y,h,side)
    # Ivy climbs architectural edges; leaf clusters cast their own shadows.
    for side in (-1,1):
        for y in (2.8,6.3,9.2):
            x=side*(5.7 if y!=9.2 else 2.55)
            last=(x-.45,y-.55,3.6)
            for j in range(14):
                end=(x-.45+math.sin(j*.55)*.14,y-.56,3.6-j*.25)
                beam('Temple_Branches',last,end,.014,.012,'Wood',(.115,.11,.04,1),5)
                for k in range(3):
                    leaf((end[0]+RNG.uniform(-.14,.14),end[1]-.025,end[2]),
                         RNG.uniform(.12,.20),(RNG.uniform(-1,1),-.5,RNG.uniform(-.6,.8)),
                         (.35+RNG.random()*.16,.28+RNG.random()*.12,.065,1))
                last=end
    # Low overgrowth stays outside the center lane and behind foreground stairs.
    for i in range(115):
        side=RNG.choice([-1,1])
        x=side*RNG.uniform(5.35,8.7)
        y=RNG.uniform(-4.6,12)
        leaf_cluster((x,y,-.57),RNG.uniform(.22,.50),RNG.randint(12,22))
    # Curved blades, each two tapering triangles; varied hue avoids flat blobs.
    for i in range(230):
        side=RNG.choice([-1,1])
        x=side*RNG.uniform(5.2,9.2)
        y=RNG.uniform(-5.4,12.5)
        for j in range(4):
            a=RNG.random()*TAU
            h=RNG.uniform(.13,.44)
            w=RNG.uniform(.018,.035)
            dx,dy=math.cos(a),math.sin(a)
            base=(x,y,-.75)
            v=[(x-dy*w,y+dx*w,base[2]),(x+dy*w,y-dx*w,base[2]),
               (x+dx*h*.28+dy*w*.45,y+dy*h*.28-dx*w*.45,base[2]+h*.6),
               (x+dx*h*.28-dy*w*.45,y+dy*h*.28+dx*w*.45,base[2]+h*.6),
               (x+dx*h*.55,y+dy*h*.55,base[2]+h)]
            add_mesh('Temple_Grass','Leaves',v,[(0,1,2,3),(3,2,4)],
                     (.23+RNG.random()*.15,.22+RNG.random()*.15,.045,1),smooth=True)


def finalize_geometry():
    objects=[]
    for (group,mat),buf in BUFFERS.items():
        name=group+'_'+mat
        data=bpy.data.meshes.new(name)
        data.from_pydata(buf['v'],[],buf['f'])
        data.update()
        uv=data.uv_layers.new(name='SurfaceUV')
        for poly,coords,smooth in zip(data.polygons,buf['uv'],buf['smooth']):
            poly.use_smooth=smooth
            for loop,co in zip(poly.loop_indices,coords):
                uv.data[loop].uv=co
        color=data.color_attributes.new(name='Color',type='BYTE_COLOR',domain='POINT')
        color.data.foreach_set('color',[channel for rgba in buf['c'] for channel in rgba])
        data.color_attributes.active_color=color
        data.materials.append(MATERIALS[mat])
        obj=bpy.data.objects.new(name,data)
        ENV.objects.link(obj)
        objects.append(obj)
    return objects


def lighting():
    scene=SCENE
    world=bpy.data.worlds.new('Temple warm afternoon sky')
    world.use_nodes=True
    scene.world=world
    nodes,links=world.node_tree.nodes,world.node_tree.links
    bg=nodes.get('Background')
    hdr=ASSETS/'temple-golden-hour.hdr'
    if hdr.exists():
        texture=nodes.new('ShaderNodeTexEnvironment')
        texture.image=bpy.data.images.load(str(hdr),check_existing=True)
        links.new(texture.outputs['Color'],bg.inputs['Color'])
        bg.inputs['Strength'].default_value=.32
    else:
        bg.inputs['Color'].default_value=(.39,.46,.49,1)
        bg.inputs['Strength'].default_value=.45
    def area(name,loc,target,energy,color,size):
        data=bpy.data.lights.new(name,'AREA')
        data.energy=energy; data.color=color; data.shape='DISK'; data.size=size
        obj=bpy.data.objects.new(name,data); scene.collection.objects.link(obj)
        obj.location=loc; obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    area('Warm sunset key',(-7,-5,12),(0,3,0),2100,(1,.78,.49),7)
    area('Open sky fill',(7,-2,9),(0,3,1),1250,(.64,.77,1),9)
    area('Golden temple rim',(0,10,10),(0,2,1),1600,(1,.65,.31),6)
    sun=bpy.data.lights.new('Low afternoon sun','SUN')
    sun.energy=2.1; sun.angle=.09; sun.color=(1,.82,.61)
    obj=bpy.data.objects.new('Low afternoon sun',sun); scene.collection.objects.link(obj)
    obj.rotation_euler=(math.radians(30),math.radians(-25),math.radians(-24))
    def camera(name,loc,target,lens):
        data=bpy.data.cameras.new(name); data.lens=lens
        obj=bpy.data.objects.new(name,data); scene.collection.objects.link(obj)
        obj.location=loc; obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
        data.clip_end=100
        return obj
    scene.camera=camera('Temple showcase camera',(12,-18,12),(0,3,1.15),38)
    camera('Website gameplay framing',(0,-8,3.25),(0,.35,1.25),43.2)
    scene.render.engine='CYCLES'
    scene.cycles.samples=32
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1440; scene.render.resolution_y=1000
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.render.filepath=str(OUT/'temple-arena-preview.png')
    scene.view_settings.view_transform='AgX'
    scene.view_settings.exposure=0
    try:
        scene.view_settings.look='AgX - Medium High Contrast'
    except TypeError:
        pass
    scene.render.film_transparent=False


def main():
    global SCENE,ENV
    SCENE=bpy.data.scenes.new('Golden Temple Arena - original study')
    bpy.context.window.scene=SCENE
    ENV=bpy.data.collections.new('Temple arena export geometry')
    SCENE.collection.children.link(ENV)
    material('Stone',(.68,.65,.51),texture='stone')
    material('DarkStone',(.36,.43,.42),texture='stone')
    material('Floor',(.49,.49,.42),texture='floor')
    material('Bronze',(.28,.18,.055),rough=.64,metallic=.58)
    material('Wood',(.13,.08,.036),rough=.96)
    material('Leaves',(.43,.31,.07),rough=.88)
    platform(); gateway(); terrain(); foliage()
    objects=finalize_geometry()
    lighting()
    bpy.context.view_layer.update()
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    export_args=dict(filepath=str(ASSETS/'temple-arena.glb'),export_format='GLB',use_selection=True,use_active_scene=True,
                     export_animations=False,export_yup=True,export_apply=True,export_normals=True,
                     export_texcoords=True,export_tangents=False,export_image_format='AUTO',
                     export_materials='EXPORT')
    # Version-safe: some Blender releases renamed the vertex-color export flag.
    properties=bpy.ops.export_scene.gltf.get_rna_type().properties
    if 'export_vertex_color' in properties:
        export_args['export_vertex_color']='MATERIAL'
    if 'export_all_vertex_colors' in properties:
        export_args['export_all_vertex_colors']=False
    bpy.ops.export_scene.gltf(**export_args)
    for obj in objects:
        obj.select_set(False)
    bpy.context.view_layer.objects.active=None
    # Keep the GUI ready for inspection/rendering, never silently render or quit.
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_perspective='CAMERA'
                area.spaces.active.shading.type='MATERIAL'
                area.spaces.active.shading.use_scene_world=True
                area.spaces.active.shading.use_scene_lights=True
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'temple-arena.blend'),check_existing=False)
    report={'status':'built','scene':SCENE.name,'objects':len(objects),
            'vertices':sum(len(o.data.vertices) for o in objects),
            'polygons':sum(len(o.data.polygons) for o in objects),
            'glbBytes':(ASSETS/'temple-arena.glb').stat().st_size,
            'glb':str(ASSETS/'temple-arena.glb'),'blend':str(OUT/'temple-arena.blend'),
            'preview':str(OUT/'temple-arena-preview.png'),'rendered':False}
    (OUT/'build-result.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print('TEMPLE_ARENA_READY '+json.dumps(report))


if __name__=='__main__':
    try:
        main()
    except Exception:
        (OUT/'build-error.txt').write_text(traceback.format_exc(),encoding='utf8')
        raise
