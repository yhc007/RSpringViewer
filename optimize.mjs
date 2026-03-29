import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { draco, dedup, quantize, weld, simplify } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const input = 'models/RSpring.glb';
const output = 'models/RSpring_opt.glb';

async function optimize() {
  console.log('GLB 최적화 시작...');
  console.log('입력:', input);

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  console.log('GLB 읽기...');
  const doc = await io.read(input);

  const root = doc.getRoot();
  const meshCount = root.listMeshes().length;
  const nodeCount = root.listNodes().length;
  console.log(`메시: ${meshCount}, 노드: ${nodeCount}`);

  // 1. 중복 제거
  console.log('1/4 중복 제거...');
  await doc.transform(dedup());

  // 2. 근접 정점 병합
  console.log('2/4 정점 병합 (weld)...');
  await doc.transform(weld({ tolerance: 0.001 }));

  // 3. 양자화 (좌표 정밀도 감소)
  console.log('3/4 양자화...');
  await doc.transform(quantize());

  // 4. Draco 압축
  console.log('4/4 Draco 압축...');
  await doc.transform(draco());

  console.log('저장 중...');
  await io.write(output, doc);

  const fs = await import('fs');
  const stat = fs.statSync(output);
  console.log(`최적화 완료: ${output} (${(stat.size/1024/1024).toFixed(1)}MB)`);
}

optimize().catch(e => { console.error(e); process.exit(1); });
