import { demoProject, fileLayer, validateProject } from '../../src/project.js';
import { dataFlowLayer } from '../../src/data-flow-style.js';
import { normalizeElementMotion } from '../../src/element-motion.js';

export function elementMotionFixture(type, space, { format = 'square', animated = false, glass = false } = {}) {
  const base = validateProject(demoProject());
  let layer;
  if (type === 'text') layer = { ...base.layers.find(layer => layer.type === 'text'), text: 'MOTION\nBLOCK', width: 32, size: 52, color: '#ffffff' };
  else if (type === 'logo') layer = { ...base.layers.find(layer => layer.type === 'logo') };
  else if (type === 'media') layer = fileLayer({ src: '/demo/poster-1.svg', name: 'Poster' }, 4, 'subject');
  else if (type === 'model') {
    layer = fileLayer({ src: '/shapes/torus-knot.glb', name: 'Sculpture' }, 4, 'subject');
    layer.modelStyle = { ...layer.modelStyle, motion: animated ? 'spin' : 'none', animationClip: -1, ...(glass && { base: 'custom', glass: 'refractive', look: 'physical', color: '#ffffff' }) };
  } else if (type === 'dataflow') {
    layer = dataFlowLayer(4, 'subject');
    layer.flowStyle = { ...layer.flowStyle, speed: animated ? 1 : 0, fiberCount: 8, samples: 64, particleCount: 30, lineWidth: 3, particleSize: 5, lineColor: '#ffffff', particleColor: '#ffffff' };
  } else layer = { ...base.layers.find(layer => layer.type === 'carousel'), template: 'horizontal', cardCount: animated ? 4 : 1, speed: animated ? 18 : 0, size: .6, cardAspect: 1.4, tilt: 0, yaw: 0, roll: 0 };
  layer = { ...layer, id: 'subject', name: `${type} movement`, space, start: 0, end: 4, x: type === 'carousel' ? 50 : 35, y: type === 'carousel' ? 50 : 35, ...(type !== 'text' && type !== 'carousel' && { size: type === 'media' ? 20 : 28 }), fadeIn: 0, fadeOut: 0, elementMotion: normalizeElementMotion() };
  const background = { ...base.layers[0], start: 0, end: 4, color: '#101820' };
  if (glass) Object.assign(background, { mode: 'image', src: '/demo/poster-3.svg' });
  return validateProject({ ...base, name: `${space} ${type} movement`, format, duration: 4, layout: { ...base.layout, enabled: false }, layers: [background, layer] });
}
