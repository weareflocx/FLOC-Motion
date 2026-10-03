import * as THREE from 'three';
window.THREE = THREE;
import { createScene } from './scene.js';
import { FORMATS } from './project.js';
let scene;
let requestedTime = 0;
window.addEventListener('hf-seek', event => {
  requestedTime = event.detail.time;
  const time = requestedTime;
  const ready = scene ? scene.seek(time) : window.__flocReady?.then(() => scene.seek(time));
  if (ready) event.detail.waitUntil?.(ready);
});
const root = document.querySelector('[data-composition-id]');
const project = JSON.parse(root.dataset.flocProject);
const cardFrames = JSON.parse(document.getElementById('floc-card-frames')?.textContent || '{}');
window.__flocReady = createScene(root, project, { renderMode: true, cardFrames }).then(value => {
  scene = value;
  const [width, height] = FORMATS[project.format];
  const scale = Number(root.dataset.renderScale) || 1;
  scene.setResolution(width * scale, height * scale);
  return scene.seek(requestedTime);
});
