import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {browserCandidates} from '../scripts/renderer-runtime.mjs';
const executablePath=[process.env.HYPERFRAMES_BROWSER_PATH,...browserCandidates()].find(value=>value&&existsSync(value));

test('GPU continuous normals agree with the actual CPU surfaces across signed seeks', {skip:!executablePath&&'Chrome or Edge is required',timeout:120000},async t=>{
 const bundle=await build({stdin:{resolveDir:path.resolve('src'),contents:`
  import * as THREE from 'three';
  import {createMorphingSphere} from './model-morph.js';
  import {createLiquidRibbons} from './model-liquid.js';
  import {normalizeModelStyle} from './model-style.js';
  window.checkNormals=()=>{
   const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(1,1,false);
   const target=new THREE.WebGLRenderTarget(1,1),scene=new THREE.Scene(),camera=new THREE.Camera(),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));scene.add(quad);
   const bytes=new Uint8Array(4),actual=new THREE.Vector3(),expected=new THREE.Vector3(),point=new THREE.Vector3();const report=[];
   function shader(descriptor){return new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:{...descriptor.uniforms,probe:{value:new THREE.Vector3()}},vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:'uniform vec3 probe;out vec4 fragColor;'+descriptor.pars+'void main(){fragColor=vec4(normalize(flocSurfaceNormal(probe))*.5+.5,1.0);}'});}
   function compare(material,probe,normal){material.uniforms.probe.value.copy(probe);quad.material=material;renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,1,1,bytes);actual.set(bytes[0]/255*2-1,bytes[1]/255*2-1,bytes[2]/255*2-1).normalize();return actual.dot(normal);}
   const directions=[],positions=[],epsilon=1e-4;
   for(let i=0;i<12;i++){
    const direction=new THREE.Vector3(Math.sin(i*2.399+.3),Math.cos(i*1.71+.5),Math.sin(i*.83+.7)).normalize();directions.push(direction);
    const tangent=new THREE.Vector3().crossVectors(direction,new THREE.Vector3(0,1,0)).normalize(),bitangent=new THREE.Vector3().crossVectors(direction,tangent).normalize();
    for(const p of [direction,direction.clone().addScaledVector(tangent,epsilon),direction.clone().addScaledVector(tangent,-epsilon),direction.clone().addScaledVector(bitangent,epsilon),direction.clone().addScaledVector(bitangent,-epsilon)])positions.push(p.x,p.y,p.z);
   }
   const source=new THREE.BufferGeometry();source.setAttribute('position',new THREE.BufferAttribute(new Float64Array(positions),3));const sourceMaterial=new THREE.MeshStandardMaterial();const sphere=new THREE.Mesh(source,sourceMaterial),morph=createMorphingSphere(sphere);const morphShader=shader(morph.surfaceNormals);
   try{
    for(const speed of [1,-1]){
     morph.setStyle(normalizeModelStyle({morphSpeed:speed}));morph.update(2.75);let minimum=1;
     for(let i=0;i<directions.length;i++){
      const p=sphere.geometry.attributes.position,k=i*5;const du=new THREE.Vector3().fromBufferAttribute(p,k+1).sub(new THREE.Vector3().fromBufferAttribute(p,k+2));const dv=new THREE.Vector3().fromBufferAttribute(p,k+3).sub(new THREE.Vector3().fromBufferAttribute(p,k+4));expected.crossVectors(du,dv).normalize();minimum=Math.min(minimum,compare(morphShader,directions[i],expected));
     }
     report.push({shape:'morph',speed,minimumDot:minimum});
    }
   }finally{morphShader.dispose();morph.dispose();source.dispose();}
   const base=new THREE.BoxGeometry(),ribbons=new THREE.Mesh(base,sourceMaterial),liquid=createLiquidRibbons(ribbons);liquid.setStyle(normalizeModelStyle({liquidDetail:32}));liquid.update(0);const liquidShader=shader(liquid.surfaceNormals);
   try{
    for(const speed of [1,-1]){
     liquid.setStyle(normalizeModelStyle({liquidDetail:32,liquidSpeed:speed}));liquid.update(1.7);let minimum=1;const geometry=ribbons.geometry;
     for(let i=0;i<20;i++){const corner=Math.floor((i+.37)*geometry.drawRange.count/20),vertex=geometry.index?geometry.index.getX(corner):corner;point.fromBufferAttribute(geometry.attributes.position,vertex);expected.fromBufferAttribute(geometry.attributes.normal,vertex).normalize();minimum=Math.min(minimum,compare(liquidShader,point,expected));}
     report.push({shape:'liquid',speed,minimumDot:minimum});
    }
   }finally{liquidShader.dispose();liquid.dispose();base.dispose();}
   quad.geometry.dispose();sourceMaterial.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();return report;
  };
 `},bundle:true,write:false,format:'iife'});
 const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-compositing']});t.after(()=>browser.close());
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.setContent('<!doctype html><title>Procedural normal regression</title>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const report=await page.evaluate(()=>window.checkNormals());assert.deepEqual(errors,[],'no GLSL compilation or texture errors');
 for(const result of report)assert.ok(result.minimumDot>.995,`${result.shape}, speed ${result.speed}: GPU normal diverged from CPU surface: ${result.minimumDot}`);
});
