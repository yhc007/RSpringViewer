import occtimportjs from 'occt-import-js';
import fs from 'fs';

const inputFile = process.argv[2] || 'models/_0_recoil spring Layout BACK LINE.stp';
const outputFile = process.argv[3] || 'models/recoil_spring.glb';

async function convert() {
  console.log('OpenCASCADE WASM 초기화...');
  const occt = await occtimportjs();

  console.log(`STEP 파일 읽기: ${inputFile}`);
  const buf = fs.readFileSync(inputFile);
  console.log(`파일 크기: ${(buf.length/1024/1024).toFixed(1)}MB`);

  console.log('STEP 파싱 중... (1~2분 소요)');
  const result = occt.ReadStepFile(new Uint8Array(buf), null);
  console.log(`메시 수: ${result.meshes.length}`);

  // glTF 빌더
  const bufferChunks = [];
  const accessors = [];
  const bufferViews = [];
  const gltfMeshes = [];
  const nodes = [];
  const materials = [];
  let byteOff = 0;

  function pad4(n) { return (4 - (n % 4)) % 4; }
  function pushBuf(arr) {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const p = pad4(bytes.length);
    bufferChunks.push(bytes);
    if (p > 0) bufferChunks.push(new Uint8Array(p));
    const off = byteOff;
    byteOff += bytes.length + p;
    return { off, len: bytes.length };
  }

  let totalTri = 0;
  for (let i = 0; i < result.meshes.length; i++) {
    const m = result.meshes[i];
    const pos = new Float32Array(m.attributes.position.array);
    const norm = m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null;
    const idx = new Uint32Array(m.index.array);
    totalTri += idx.length / 3;

    // bounding box
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let j = 0; j < pos.length; j += 3) {
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[j+k]); mx[k] = Math.max(mx[k], pos[j+k]); }
    }

    const bvBase = bufferViews.length;
    const acBase = accessors.length;

    // indices
    const ib = pushBuf(idx);
    bufferViews.push({ buffer: 0, byteOffset: ib.off, byteLength: ib.len, target: 34963 });
    accessors.push({ bufferView: bvBase, componentType: 5125, count: idx.length, type: "SCALAR" });

    // positions
    const pb = pushBuf(pos);
    bufferViews.push({ buffer: 0, byteOffset: pb.off, byteLength: pb.len, byteStride: 12, target: 34962 });
    accessors.push({ bufferView: bvBase+1, componentType: 5126, count: pos.length/3, type: "VEC3", min: mn, max: mx });

    const attrs = { POSITION: acBase+1 };
    let nextBV = bvBase + 2, nextAC = acBase + 2;

    if (norm) {
      const nb = pushBuf(norm);
      bufferViews.push({ buffer: 0, byteOffset: nb.off, byteLength: nb.len, byteStride: 12, target: 34962 });
      accessors.push({ bufferView: nextBV, componentType: 5126, count: norm.length/3, type: "VEC3" });
      attrs.NORMAL = nextAC;
    }

    const col = m.color ? [m.color[0]/255, m.color[1]/255, m.color[2]/255, 1] : [0.7, 0.7, 0.8, 1];
    materials.push({ name: `mat_${i}`, pbrMetallicRoughness: { baseColorFactor: col, metallicFactor: 0.3, roughnessFactor: 0.6 } });
    gltfMeshes.push({ name: m.name || `part_${i}`, primitives: [{ attributes: attrs, indices: acBase, material: i }] });
    nodes.push({ mesh: i, name: m.name || `part_${i}` });
  }

  console.log(`총 삼각형: ${totalTri.toLocaleString()}`);

  // GLB 생성
  const gltf = {
    asset: { version: "2.0", generator: "RSpring Converter" },
    scene: 0,
    scenes: [{ nodes: nodes.map((_,i) => i) }],
    nodes, meshes: gltfMeshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: byteOff }]
  };

  const jsonBuf = Buffer.from(JSON.stringify(gltf));
  const jsonPad = pad4(jsonBuf.length);
  const binTotal = bufferChunks.reduce((s, c) => s + c.length, 0);
  const binPad = pad4(binTotal);
  const glbLen = 12 + 8 + jsonBuf.length + jsonPad + 8 + binTotal + binPad;

  const glb = Buffer.alloc(glbLen);
  glb.writeUInt32LE(0x46546C67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glbLen, 8);
  glb.writeUInt32LE(jsonBuf.length + jsonPad, 12);
  glb.writeUInt32LE(0x4E4F534A, 16);
  jsonBuf.copy(glb, 20);
  for (let i = 0; i < jsonPad; i++) glb[20 + jsonBuf.length + i] = 0x20;

  const binOff = 20 + jsonBuf.length + jsonPad;
  glb.writeUInt32LE(binTotal + binPad, binOff);
  glb.writeUInt32LE(0x004E4942, binOff + 4);
  let pos = binOff + 8;
  for (const chunk of bufferChunks) { Buffer.from(chunk).copy(glb, pos); pos += chunk.length; }

  fs.writeFileSync(outputFile, glb);
  console.log(`GLB 저장 완료: ${outputFile} (${(glb.length/1024/1024).toFixed(1)}MB)`);
}

convert().catch(e => { console.error(e); process.exit(1); });
