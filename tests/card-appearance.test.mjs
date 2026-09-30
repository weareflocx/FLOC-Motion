import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject, patchLayer } from '../src/project.js';
import { createTools } from '../src/webmcp.js';
import { CATALOG, readCatalogSetting } from '../src/catalog.js';

test('legacy appearance migrates to rectangular, double-sided cards without mutating input', () => {
  const p=demoProject();
  for(const field of ['cornerRadius','cardShape','frontface','backface'])delete p.layers[1][field];
  const card=validateProject(p).layers[1];
  assert.equal(card.cornerRadius,0);assert.equal(card.cardShape,'rounded');
  assert.equal(card.frontface,'show');assert.equal(card.backface,'show');
  assert.equal(p.layers[1].cornerRadius,undefined);
});
test('appearance accepts independent faces and rejects malformed values', () => {
  const p=demoProject();
  for(const frontface of ['show','hide'])for(const backface of ['show','hide']) {
    const next=patchLayer(p,'carousel',{cornerRadius:100,cardShape:'squircle',frontface,backface});
    assert.equal(next.layers[1].frontface,frontface);assert.equal(next.layers[1].backface,backface);
    assert.deepEqual(next.images,p.images);
  }
  for(const patch of [{cornerRadius:-1},{cornerRadius:101},{cornerRadius:NaN},{cornerRadius:'10'},{cardShape:'eval'},{frontface:false},{backface:'none'}])assert.throws(()=>patchLayer(p,'carousel',patch));
});
test('catalog appearance uses observed values within canonical bounds', () => {
  let squircle=0, rounded=0;
  for(const preset of CATALOG){
    const {carouselPatch,raw}=preset;
    const corner=readCatalogSetting(raw,'composition.Cards.Corner',0);
    if(typeof corner==='number')assert.equal(carouselPatch.cornerRadius,Math.max(0,Math.min(100,corner)));
    const next=patchLayer(demoProject(),'carousel',carouselPatch);
    if(next.layers[1].cardShape==='squircle')squircle++;else rounded++;
  }
  assert(squircle>0 && rounded>0);
});
test('agents use the same appearance validation and cannot save invalid face values', async () => {
  let p=demoProject(),saves=0;
  const tool=createTools({get:()=>p,set:next=>p=next,save:async()=>saves++,audit:()=>{}}).find(t=>t.name==='floc_set_carousel');
  assert.deepEqual(tool.inputSchema.properties.cardShape.enum,['rounded','squircle']);
  await tool.execute({template:'sphere',cornerRadius:35,cardShape:'squircle',backface:'hide'});
  assert.equal(p.layers[1].cornerRadius,35);assert.equal(p.layers[1].backface,'hide');
  await assert.rejects(()=>tool.execute({template:'sphere',backface:'invalid'}));
  assert.equal(saves,1);
});
