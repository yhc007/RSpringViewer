#!/usr/bin/env python3.11
"""USD -> GLB converter with equipment group hierarchy preserved in mesh names.
Mesh names are formatted as: {equipment_group}::{mesh_name}
so the frontend can group meshes by equipment.
"""
import sys, struct, json, math
from pxr import Usd, UsdGeom, Gf, UsdShade
import numpy as np

INPUT = sys.argv[1] if len(sys.argv) > 1 else 'models/RSpring.usd'
OUTPUT = sys.argv[2] if len(sys.argv) > 2 else 'models/RSpring.glb'

def find_equipment_group(prim, assembly_path):
    """Find the top-level equipment group for a mesh prim."""
    path = str(prim.GetPath())
    # Remove the assembly prefix to get relative path
    rel = path.replace(str(assembly_path) + '/', '')
    # The first component is the equipment group
    parts = rel.split('/')
    if len(parts) >= 1:
        return parts[0]
    return 'ungrouped'

def collect_meshes(stage):
    meshes = []
    # Find the assembly root
    assembly_path = None
    for prim in stage.Traverse():
        name = prim.GetPath().name
        if 'ASSEMBLY' in name or 'assembly' in name:
            assembly_path = prim.GetPath()
            break
    if not assembly_path:
        # fallback: use first Xform child of /World
        root = stage.GetPrimAtPath('/World')
        if root:
            for child in root.GetChildren():
                assembly_path = child.GetPath()
                break
    print(f'  Assembly root: {assembly_path}')

    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        mesh = UsdGeom.Mesh(prim)
        pts = mesh.GetPointsAttr().Get()
        fvi = mesh.GetFaceVertexIndicesAttr().Get()
        fvc = mesh.GetFaceVertexCountsAttr().Get()
        if not pts or not fvi or not fvc:
            continue
        # world transform
        xf = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        # triangulate
        tris = []
        idx = 0
        for count in fvc:
            if count == 3:
                tris.append((fvi[idx], fvi[idx+1], fvi[idx+2]))
            elif count == 4:
                tris.append((fvi[idx], fvi[idx+1], fvi[idx+2]))
                tris.append((fvi[idx], fvi[idx+2], fvi[idx+3]))
            else:
                for j in range(1, count - 1):
                    tris.append((fvi[idx], fvi[idx+j], fvi[idx+j+1]))
            idx += count
        if not tris:
            continue
        # transform points
        verts = np.array([[p[0], p[1], p[2]] for p in pts], dtype=np.float32)
        m = np.array([[xf[i][j] for j in range(4)] for i in range(4)], dtype=np.float64)
        ones = np.ones((len(verts), 1), dtype=np.float64)
        v4 = np.hstack([verts.astype(np.float64), ones])
        transformed = (v4 @ m)[:, :3].astype(np.float32)
        indices = np.array(tris, dtype=np.uint32).flatten()
        # get color from material
        color = [0.7, 0.7, 0.8, 1.0]
        mat_binding = UsdShade.MaterialBindingAPI(prim)
        mat_path = mat_binding.ComputeBoundMaterial()
        if mat_path and mat_path[0]:
            shader = UsdShade.Material(mat_path[0]).ComputeSurfaceSource()[0]
            if shader:
                dc = shader.GetInput('diffuseColor')
                if dc and dc.Get():
                    c = dc.Get()
                    color = [c[0], c[1], c[2], 1.0]
        # Equipment group name::mesh name
        eq_group = find_equipment_group(prim, assembly_path) if assembly_path else 'ungrouped'
        mesh_name = f'{eq_group}::{prim.GetName()}'
        meshes.append({
            'name': mesh_name,
            'equipment_group': eq_group,
            'vertices': transformed,
            'indices': indices,
            'color': color,
        })
    return meshes

def compute_normals(verts, indices):
    normals = np.zeros_like(verts)
    tri_idx = indices.reshape(-1, 3)
    v0 = verts[tri_idx[:, 0]]
    v1 = verts[tri_idx[:, 1]]
    v2 = verts[tri_idx[:, 2]]
    face_normals = np.cross(v1 - v0, v2 - v0)
    norms = np.linalg.norm(face_normals, axis=1, keepdims=True)
    norms[norms == 0] = 1
    face_normals /= norms
    for i in range(3):
        np.add.at(normals, tri_idx[:, i], face_normals)
    norms = np.linalg.norm(normals, axis=1, keepdims=True)
    norms[norms == 0] = 1
    normals /= norms
    return normals.astype(np.float32)

def pad4(n):
    return (4 - (n % 4)) % 4

def build_glb(meshes):
    buf_chunks = []
    accessors = []
    buffer_views = []
    gltf_meshes = []
    nodes = []
    materials = []
    byte_off = 0

    def push(arr):
        nonlocal byte_off
        data = arr.tobytes()
        p = pad4(len(data))
        buf_chunks.append(data)
        if p: buf_chunks.append(b'\x00' * p)
        off = byte_off
        byte_off += len(data) + p
        return off, len(data)

    total_tri = 0
    for i, m in enumerate(meshes):
        verts = m['vertices']
        indices = m['indices']
        normals = compute_normals(verts, indices)
        total_tri += len(indices) // 3
        bv_base = len(buffer_views)
        ac_base = len(accessors)
        # indices
        io, il = push(indices)
        buffer_views.append({'buffer':0,'byteOffset':io,'byteLength':il,'target':34963})
        accessors.append({'bufferView':bv_base,'componentType':5125,'count':len(indices),'type':'SCALAR'})
        # positions
        mn = verts.min(axis=0).tolist()
        mx = verts.max(axis=0).tolist()
        po, pl = push(verts)
        buffer_views.append({'buffer':0,'byteOffset':po,'byteLength':pl,'byteStride':12,'target':34962})
        accessors.append({'bufferView':bv_base+1,'componentType':5126,'count':len(verts),'type':'VEC3','min':mn,'max':mx})
        # normals
        no, nl = push(normals)
        buffer_views.append({'buffer':0,'byteOffset':no,'byteLength':nl,'byteStride':12,'target':34962})
        accessors.append({'bufferView':bv_base+2,'componentType':5126,'count':len(normals),'type':'VEC3'})

        attrs = {'POSITION': ac_base+1, 'NORMAL': ac_base+2}
        materials.append({
            'name': f'mat_{i}',
            'pbrMetallicRoughness': {
                'baseColorFactor': m['color'],
                'metallicFactor': 0.3,
                'roughnessFactor': 0.6
            }
        })
        gltf_meshes.append({
            'name': m['name'],  # equipment_group::mesh_name
            'primitives': [{'attributes': attrs, 'indices': ac_base, 'material': i}]
        })
        nodes.append({'mesh': i, 'name': m['name']})

    print(f'  총 삼각형: {total_tri:,}')

    # Equipment group 통계
    groups = {}
    for m in meshes:
        g = m['equipment_group']
        groups[g] = groups.get(g, 0) + 1
    print(f'  장비 그룹: {len(groups)}개')
    for g, c in sorted(groups.items(), key=lambda x: -x[1])[:15]:
        print(f'    {g}: {c} meshes')

    gltf = {
        'asset': {'version': '2.0', 'generator': 'RSpring USD2GLB v2'},
        'scene': 0,
        'scenes': [{'nodes': list(range(len(nodes)))}],
        'nodes': nodes, 'meshes': gltf_meshes,
        'materials': materials, 'accessors': accessors,
        'bufferViews': buffer_views,
        'buffers': [{'byteLength': byte_off}]
    }
    json_data = json.dumps(gltf).encode('utf-8')
    json_pad = pad4(len(json_data))
    bin_data = b''.join(buf_chunks)
    bin_pad = pad4(len(bin_data))
    total = 12 + 8 + len(json_data) + json_pad + 8 + len(bin_data) + bin_pad
    out = bytearray(total)
    struct.pack_into('<III', out, 0, 0x46546C67, 2, total)
    struct.pack_into('<II', out, 12, len(json_data)+json_pad, 0x4E4F534A)
    out[20:20+len(json_data)] = json_data
    for i in range(json_pad): out[20+len(json_data)+i] = 0x20
    bo = 20 + len(json_data) + json_pad
    struct.pack_into('<II', out, bo, len(bin_data)+bin_pad, 0x004E4942)
    out[bo+8:bo+8+len(bin_data)] = bin_data
    return bytes(out)

def main():
    print(f'USD 파일: {INPUT}')
    stage = Usd.Stage.Open(INPUT)
    if not stage:
        print('USD 스테이지 열기 실패'); sys.exit(1)
    print('메시 수집 중...')
    meshes = collect_meshes(stage)
    print(f'  메시: {len(meshes)}개')
    if not meshes:
        print('메시를 찾을 수 없습니다'); sys.exit(1)
    print('GLB 빌드 중...')
    glb = build_glb(meshes)
    with open(OUTPUT, 'wb') as f:
        f.write(glb)
    print(f'저장 완료: {OUTPUT} ({len(glb)/1024/1024:.1f}MB)')

if __name__ == '__main__':
    main()
