import * as THREE from 'three';
window.THREE = THREE;
import { createScene } from './scene.js';
let scene;
let requestedTime = 0;
window.addEventListener('hf-seek', event => { requestedTime = event.detail.time; scene?.seek(requestedTime); });
const root = document.querySelector('[data-composition-id]');
const project = JSON.parse(root.dataset.flocProject);
window.__flocReady = createScene(root, project, { renderMode: true }).then(value => { scene = value; scene.seek(requestedTime); });
