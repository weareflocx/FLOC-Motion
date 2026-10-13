import { carouselImages } from './project.js';
import { EFFECT_FIELDS, animatedFields } from './choreography.js';

// Fields that create DOM nodes, decoders, card meshes or models. Every other
// field is applied to the live scene; changing these rebuilds it.
const STRUCTURAL = {
  background: ['mode', 'src'],
  logo: ['src'],
  media: ['src'],
  model: ['src'],
  music: ['src'],
  carousel: ['template', 'cardCount'],
  effect: ['effectScope']
};
const sources = (project, layer) => JSON.stringify(carouselImages(project, layer).map(image => image.src));
// Animated effect amounts change how effect textures are prepared.
const animatedEffects = layer => animatedFields(layer).filter(field => Object.hasOwn(EFFECT_FIELDS, field)).join();

// Returns null when `next` needs a new scene, otherwise what the in-place
// update must refresh besides layer values.
export function sceneUpdatePlan(previous, next) {
  if (previous.format !== next.format || previous.layers.length !== next.layers.length) return null;
  let effects = false;
  for (const [index, layer] of next.layers.entries()) {
    const before = previous.layers[index];
    if (before.id !== layer.id || before.type !== layer.type) return null;
    if ((STRUCTURAL[layer.type] ?? []).some(key => before[key] !== layer[key])) return null;
    if (layer.type === 'carousel' && sources(previous, before) !== sources(next, layer)) return null;
    if (JSON.stringify(before.effects ?? []) !== JSON.stringify(layer.effects ?? []) || animatedEffects(before) !== animatedEffects(layer)) effects = true;
  }
  return { effects };
}
