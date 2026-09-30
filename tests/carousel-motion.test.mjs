import test from 'node:test';
import assert from 'node:assert/strict';
import { carouselCard, MOTION_VARIANTS } from '../src/carousel-motion.js';
import { demoProject, validateProject, patchLayer } from '../src/project.js';
import { CATALOG } from '../src/catalog.js';

const base = () => ({ ...demoProject().layers[1], start: 0, loopDuration: 4, speed: 30, tilt: 0, yaw: 0, roll: 0 });
function close(a, b) {
  for (const key of Object.keys(a)) {
    const aa = Array.isArray(a[key]) ? a[key] : [a[key]], bb = Array.isArray(b[key]) ? b[key] : [b[key]];
    aa.forEach((v, i) => assert(Math.abs(v - bb[i]) < 1e-8, `${key}: ${v} != ${bb[i]}`));
  }
}
test('every family and variant is finite, seek-safe, changes over time and closes a full loop', () => {
  for (const [template, variants] of Object.entries(MOTION_VARIANTS)) for (const [motionVariant] of variants) {
    const l = { ...base(), template, motionVariant };
    let moving = false;
    for (const count of [1, 6, 48]) for (let i = 0; i < count; i++) {
      const initial = carouselCard(l, i, count, 0.137);
      const later = carouselCard(l, i, count, 1.173);
      moving ||= JSON.stringify(initial) !== JSON.stringify(later);
      close(initial, carouselCard(l, i, count, 4.137));
      close(initial, carouselCard(l, i, count, 0.137)); // independent of a preceding seek
      for (const t of [0, 0.001, 1.7, 3.999, 4, 1000]) {
        const card = carouselCard(l, i, count, t);
        assert(Object.values(card).flat().every(Number.isFinite), `${template}/${motionVariant}`);
        assert(card.opacity >= 0 && card.opacity <= 1);
        assert(card.scale > 0);
      }
    }
    assert(moving, `${template}/${motionVariant} is static`);
  }
});
test('reverse, pause, nonzero layer start and legacy positions retain their semantics', () => {
  const l = { ...base(), template: 'sphere' };
  close(carouselCard({ ...l, speed: -30 }, 1, 6, 1), carouselCard(l, 1, 6, 3));
  close(carouselCard({ ...l, speed: 0 }, 1, 6, 2), carouselCard(l, 1, 6, 0));
  close(carouselCard({ ...l, start: 2 }, 1, 6, 3), carouselCard(l, 1, 6, 1));
  const horizontal = carouselCard({ ...base(), template: 'horizontal', loopDuration: 0, speed: 35 }, 1, 6, 1);
  assert.deepEqual(horizontal.position, [0, 0, -0]);
});
test('108 recipes use nine real families and 24 variants with observed composition settings', () => {
  assert.equal(new Set(CATALOG.map(p => p.carouselPatch.template)).size, 9);
  assert.equal(new Set(CATALOG.map(p => `${p.carouselPatch.template}/${p.carouselPatch.motionVariant}`)).size, 24);
  for (const p of CATALOG) {
    const next = patchLayer(demoProject(), 'carousel', p.carouselPatch);
    assert(next.layers[1].loopDuration > 0);
    assert(p.description.length > 0);
  }
  const first = CATALOG[0];
  assert.equal(first.carouselPatch.cardCount, 18);
  assert.equal(first.carouselPatch.cardAspect, 1);
  assert.equal(first.carouselPatch.yaw, -10);
  assert.equal(first.carouselPatch.gap, 0.35);
});
test('new settings migrate without mutating old projects and reject malformed or excessive input', () => {
  const p = demoProject();
  for (const field of ['cardCount', 'cardAspect', 'radius', 'loopDuration', 'motionVariant', 'fade']) delete p.layers[1][field];
  assert.equal(validateProject(p).layers[1].cardCount, 0);
  assert.equal(p.layers[1].cardCount, undefined);
  for (const patch of [{cardCount:49}, {cardCount:1.5}, {cardAspect:0}, {loopDuration:Infinity}, {radius:7}, {fade:-1}, {motionVariant:'eval'}]) assert.throws(() => patchLayer(demoProject(), 'carousel', patch));
  const next = patchLayer(patchLayer(demoProject(), 'carousel', {template:'sphere', motionVariant:'tangent'}), 'carousel', {template:'wheel'});
  assert.equal(next.layers[1].motionVariant, 'default');
});
test('recycling cards is invisible at loop boundaries and native families differ', () => {
  const fingerprints = new Set();
  for (const template of ['circular','horizontal','showcase','sphere','spinner','stack','stickers','twist','wheel']) {
    const l = { ...base(), template };
    fingerprints.add(JSON.stringify(carouselCard(l, 1, 12, 0.7)));
    for (let i=0;i<12;i++) {
      const a=carouselCard(l,i,12,4-1e-7), b=carouselCard(l,i,12,1e-7);
      if(a.opacity<1e-4 && b.opacity<1e-4) continue;
      a.position.forEach((v,j)=>assert(Math.abs(v-b.position[j])<1e-4, `${template} visible teleport`));
      assert(Math.abs(a.opacity-b.opacity)<1e-4,`${template} opacity seam`);
      a.rotation.forEach((v,j)=>assert(Math.abs(Math.sin(v)-Math.sin(b.rotation[j]))<1e-4,`${template} rotation seam`));
    }
  }
  assert.equal(fingerprints.size,9);
});
test('agents apply real family controls through the same validated project model', async () => {
  const {createTools}=await import('../src/webmcp.js');
  let p=demoProject(), saved=0;
  const tools=createTools({get:()=>p,set:next=>p=next,save:async()=>saved++,audit:()=>{}});
  const tool=tools.find(t=>t.name==='floc_set_carousel');
  assert(tool.inputSchema.properties.template.enum.includes('sphere'));
  await tool.execute({template:'sphere',motionVariant:'cloud',cardCount:24,cardAspect:1,loopDuration:8,radius:2,yaw:30});
  assert.equal(p.layers[1].motionVariant,'cloud');assert.equal(p.layers[1].cardCount,24);assert.equal(saved,1);
  await assert.rejects(()=>tool.execute({template:'sphere',motionVariant:'rotor'}));
  assert.equal(saved,1);assert.equal(p.layers[1].motionVariant,'cloud');
});
