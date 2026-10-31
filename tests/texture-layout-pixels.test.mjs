import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { blankProject, patchLayer } from '../src/project.js';
import { TEXTURE_BACKGROUNDS } from '../src/texture-backgrounds.js';
import { executablePath, openGoldenSession, checkFrame } from '../scripts/golden-frames.mjs';

const browserSkip = !executablePath && 'Chrome or Edge is required for texture pixels';

test('adaptive texture counts, fit margins and geometry survive seeks, resizing and extreme grids', { skip: browserSkip, timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { drawProceduralBackground } from './backgrounds.js';
    import { textureLayout } from './texture-layout.js';
    import { TEXTURE_BACKGROUNDS } from './texture-backgrounds.js';
    const canvas = document.createElement('canvas');
    const base = {color:'#000000',patternColor:'#ffffff',patternIntensity:1,patternSpeed:.2,patternSeed:7,
      patternScale:1,patternFocusX:50,patternFocusY:50,textureLayout:'fit',textureDistribution:'manual',textureColumns:5,textureRows:7,textureElementSize:.5,textureMargin:.1,start:0,end:6};
    function render(layer,time,width=360,height=640,aspect=9/16) {
      canvas.width=width;canvas.height=height;
      drawProceduralBackground(canvas,layer,time,24,null,aspect);
      return canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
    }
    function envelope(data,width,height) {
      let minX=width,minY=height,maxX=-1,maxY=-1,area=0;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4]>4){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);area++;}
      return {minX,minY,maxX,maxY,area};
    }
    function components(data,width,height) {
      const visited=new Uint8Array(width*height),queue=new Int32Array(width*height);let count=0;
      for(let i=0;i<visited.length;i++)if(!visited[i]&&data[i*4]>4){
        count++;let begin=0,end=1;queue[0]=i;visited[i]=1;
        while(begin<end){const p=queue[begin++],x=p%width,y=Math.floor(p/width);
          for(const n of [x>0?p-1:-1,x+1<width?p+1:-1,y>0?p-width:-1,y+1<height?p+width:-1])if(n>=0&&!visited[n]&&data[n*4]>4){visited[n]=1;queue[end++]=n;}}
      }return count;
    }
    const hash=data=>{let h=2166136261;for(let i=0;i<data.length;i++)h=Math.imul(h^data[i],16777619);return h>>>0;};
    window.probeLayouts=()=>{
      const rows=[];
      for(const {id} of TEXTURE_BACKGROUNDS){
        const layer={...base,pattern:id},first=hash(render(layer,.5));
        render({...layer,textureColumns:1,textureRows:1,textureElementSize:1.5},1.7);
        render({...layer,textureLayout:'adaptive',textureDensity:2,textureDistribution:'auto'},2,640,360,16/9);
        render({...layer,textureColumns:64,textureRows:64},.5,360,360,1);
        const seek=hash(render(layer,.5));
        const bounds=[];
        for(const counts of [[1,1],[5,7]])for(const focus of [0,100])for(const time of [.1,2.3]){
          const pixels=render({...layer,textureColumns:counts[0],textureRows:counts[1],textureElementSize:1.5,patternFocusX:focus,patternFocusY:100-focus},time);
          bounds.push(envelope(pixels,360,640));
        }
        const auto={...layer,textureLayout:'adaptive',textureDistribution:'auto'};
        rows.push({id,first,seek,bounds,portrait:textureLayout(id,auto,9/16),landscape:textureLayout(id,auto,16/9)});
      }
      const watch={...base,pattern:'watch'};
      const count35=components(render(watch,.5),360,640);
      const count80=components(render({...watch,textureColumns:8,textureRows:10},.5),360,640);
      const small=envelope(render({...watch,textureElementSize:.25},.5),360,640).area;
      const large=envelope(render({...watch,textureElementSize:1},.5),360,640).area;
      return {rows,count35,count80,small,large};
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<body></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => window.probeLayouts());
  assert.deepEqual(errors, []);
  for (const row of result.rows) {
    assert.equal(row.first, row.seek, `${row.id}: switching grid, size and aspect must not retain stale state`);
    assert.ok(row.portrait.rows > row.portrait.columns, `${row.id}: portrait layout must redistribute vertically`);
    assert.ok(row.landscape.columns > row.landscape.rows, `${row.id}: landscape layout must redistribute horizontally`);
    for (const bounds of row.bounds) {
      assert.ok(bounds.area > 0, `${row.id}: fitted field disappeared`);
      assert.ok(bounds.minX >= 35 && bounds.maxX <= 324 && bounds.minY >= 63 && bounds.maxY <= 576,
        `${row.id}: motion escaped the fixed 10% margin: ${JSON.stringify(bounds)}`);
    }
  }
  assert.equal(result.count35, 35, 'manual grid must render all 5 × 7 Watch motifs');
  assert.equal(result.count80, 80, 'increasing rows/columns must fit all 8 × 10 motifs');
  assert.ok(result.large > result.small * 3, 'Element size must resize motifs independently of grid spacing');
});

test('adaptive and fitted textures match real exported frames in portrait and landscape', { skip: browserSkip, timeout: 180000 }, async t => {
  const fixtures = TEXTURE_BACKGROUNDS.flatMap(({ id }, index) => ['adaptive', 'fit'].map((mode, variant) => {
    const project = patchLayer({ ...blankProject(), format: (index + variant) % 2 ? 'portrait' : 'landscape' }, 'background', {
      mode: 'procedural', pattern: id, color: '#101010', patternColor: '#ffffff', textureLayout: mode,
      textureDistribution: mode === 'fit' ? 'manual' : 'auto', textureDensity: .65, textureColumns: 5, textureRows: 7,
      textureElementSize: .7, textureMargin: .1, patternAccent: '#0055ff', patternAccentAmount: .4
    });
    return { id: `texture-layout-${id}-${mode}`, times: [.5], project };
  }));
  const session = await openGoldenSession({ lanes: 2 });
  t.after(() => session.close());
  const captures = await session.captureAll(fixtures);
  for (const fixture of fixtures) for (const frame of captures[fixture.id]) {
    const result = await checkFrame(session, fixture, frame);
    assert.deepEqual(result.failures, [], result.summary);
  }
});
