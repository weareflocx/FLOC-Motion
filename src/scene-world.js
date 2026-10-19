import * as THREE from 'three';
import { FORMATS, layerAlpha } from './project.js';
import { evaluateChoreography } from './choreography.js';
import { SCENE_VIEW_HEIGHT, sceneDimensions } from './scene-camera.js';
import { SCENE_PASS } from './scene-pass.js';
import { createSceneSurface } from './scene-surfaces.js';
import { modelCanvasGeometry } from './model-canvas.js';
import { SPATIAL_LAYER_TYPES } from './scene-settings.js';

const GRAPHIC_TYPES = ['text', 'logo', 'media'];
const ORDER_DEPTH_PERCENT = .002;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function canvas() { return document.createElement('canvas'); }
function resize(value, width, height) {
  if (value.width !== width) value.width = width;
  if (value.height !== height) value.height = height;
  return value.getContext('2d');
}

export function createSceneWorld(root, sourceRoot, project, { rendering, capture, cameras, engines, renderMode = false }) {
  const [nativeWidth, nativeHeight] = FORMATS[project.format];
  const models = new Map(engines.flatMap(engine => engine.scene.models).map(model => [model.id, model]));
  const carousels = new Map(engines.map(engine => engine.scene.carousel).filter(Boolean).map(carousel => [carousel.id, carousel]));
  const leaves = new Map(), groups = new Map();
  const output = canvas(); output.dataset.flocSceneOutput = ''; output.setAttribute('aria-hidden', 'true');
  output.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${project.layers.length}`;
  root.append(output);
  const point = new THREE.Vector3(), direction = new THREE.Vector3(), boxPoint = new THREE.Vector3();
  const planeMatrix = new THREE.Matrix4(), planeMapping = new THREE.Matrix4(), viewProjection = new THREE.Matrix4();
  const pickPixel = new Uint8Array(4);
  let current = project, width = nativeWidth, height = nativeHeight, time = 0, placement = null, graph = [], frame = 0, pickDirty = true, pickTarget, disposed = false;
  function draft(id) { return placement?.id === id ? placement : placement?.layers?.[id] ?? null; }
  function element(id) { return [...sourceRoot.querySelectorAll('[data-floc-layer]')].find(node => node.dataset.flocLayer === id && !node.hasAttribute('data-floc-background-content')); }
  function fullBounds() { return { x: 0, y: 0, width: nativeWidth, height: nativeHeight }; }
  function sourceSurface(value) { return { canvas: value, ...fullBounds() }; }
  function makeLeaf(layer, index) {
    const node = { id: layer.id, index, layer, value: layer, alpha: 0, element: element(layer.id), model: models.get(layer.id), carousel: carousels.get(layer.id), surface: createSceneSurface(rendering),
      colorCanvas: canvas(), maskCanvas: canvas(), cropCanvas: canvas(), maskCropCanvas: canvas(), sortPoint: new THREE.Vector3(), projected: false, refFrame: 0, fxBounds: null, raster: false };
    leaves.set(layer.id, node); return node;
  }
  function build() {
    let result = [];
    current.layers.forEach((layer, index) => {
      if (layer.type === 'music') return;
      let node = leaves.get(layer.id);
      if (!node) node = makeLeaf(layer, index);
      node.layer = layer; node.index = index;
      if (layer.type === 'effect') {
        let group = groups.get(layer.id);
        if (!group) { group = { id: `effect:${layer.id}`, effect: layer, index, surface: createSceneSurface(rendering), colorCanvas: canvas(), children: [] }; groups.set(layer.id, group); }
        group.effect = layer; group.index = index; group.children = result; group.overlay = layer.effectScope === 'overlay' ? node : null;
        result = [group];
      } else result.push(node);
    });
    graph = result;
  }
  build();
  function projectedSphere(model) {
    const center = model.spatialRoot.position, radius = model.spatialRadius;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (let i = 0; i < 8; i++) {
      boxPoint.set(center.x + (i & 1 ? radius : -radius), center.y + (i & 2 ? radius : -radius), center.z + (i & 4 ? radius : -radius)).project(cameras.output);
      if (boxPoint.z < -1 || boxPoint.z > 1) return fullBounds();
      left = Math.min(left, (boxPoint.x + 1) * .5 * width); right = Math.max(right, (boxPoint.x + 1) * .5 * width);
      top = Math.min(top, (1 - boxPoint.y) * .5 * height); bottom = Math.max(bottom, (1 - boxPoint.y) * .5 * height);
    }
    left = clamp(Math.floor(left), 0, width); right = clamp(Math.ceil(right), 0, width);
    top = clamp(Math.floor(top), 0, height); bottom = clamp(Math.ceil(bottom), 0, height);
    return { x: left / width * nativeWidth, y: top / height * nativeHeight, width: Math.max(1, right - left) / width * nativeWidth, height: Math.max(1, bottom - top) / height * nativeHeight };
  }
  function crop(source, target, bounds) {
    const x = Math.round(bounds.x / nativeWidth * width), y = Math.round(bounds.y / nativeHeight * height);
    const w = Math.max(1, Math.round(bounds.width / nativeWidth * width)), h = Math.max(1, Math.round(bounds.height / nativeHeight * height));
    const context = resize(target, w, h); context.resetTransform(); context.clearRect(0, 0, w, h);
    context.drawImage(source, x, y, w, h, 0, 0, w, h); return target;
  }
  function captureScale(node) {
    const w = node.element?.offsetWidth || nativeWidth, h = node.element?.offsetHeight || nativeHeight;
    let paddingX = 1, paddingY = 1;
    for (const effect of node.layer.effects ?? []) if (effect.enabled && effect.type === 'optical-warp') {
      if (effect.axis === 'horizontal') paddingY = 3;
      else paddingX = 3;
    }
    let magnification = Math.max(1, cameras.output.zoom);
    if (cameras.output.isPerspectiveCamera && node.value.z > 0) magnification *= 8 / Math.max(1, 8 - node.value.z / 100 * SCENE_VIEW_HEIGHT);
    // Optical Warp expands only the axis perpendicular to its lens. Using
    // three diagonals here needlessly downsampled ordinary 1080p Flat sources.
    const wLimit = w * paddingX, hLimit = h * paddingY;
    const extent = node.value.roll ? Math.hypot(wLimit, hLimit) : Math.max(wLimit, hLimit);
    return Math.min(width / nativeWidth * Math.min(8, magnification), rendering.maxSide / extent);
  }
  function uploadLeaf(node, value, options = {}) {
    node.surface.set(value, { format: current.format, layer: node.value, index: node.index, ...options });
    node.raster = true;
  }
  function renderLeaf(node, pass, options = {}) {
    if (node.alpha <= 0) return;
    const id = node.index + 1, camera = cameras.output;
    if (node.raster) node.surface.render(camera, pass, node.rasterOpacity ?? 1, id, { background: node.background, ...options });
    else if (node.model) node.model.renderSpatial(camera, pass, node.alpha, id, options);
    else if (node.carousel) node.carousel.render(camera, pass, node.alpha, id, options);
  }
  function renderData(nodes, pass) {
    for (const node of nodes) {
      if (node.children) node.surface.render(cameras.output, pass, 1, 0);
      else renderLeaf(node, pass, { coverage: node.refractive, background: node.background && pass === SCENE_PASS.pick });
    }
  }
  function depthPrepass(nodes, processed = []) {
    for (const node of nodes) {
      if (node.children) node.surface.render(cameras.output, SCENE_PASS.opaqueDepth, 1, 0);
      else if (!node.background && !node.refractive) renderLeaf(node, SCENE_PASS.opaqueDepth);
    }
    for (const node of processed) if (node.refractive) renderLeaf(node, SCENE_PASS.depth, { coverage: true });
  }
  function nodeAlpha(node) { return node.children ? 1 : node.alpha; }
  function nodeDepth(node) {
    if (node.children) point.set(0, 0, node.index * ORDER_DEPTH_PERCENT / 100 * SCENE_VIEW_HEIGHT);
    else point.copy(node.sortPoint);
    return point.sub(cameras.output.position).dot(direction);
  }
  function existingGlass(node) {
    if (node.model && !node.raster) node.model.setRefractionMask(false);
    renderLeaf(node, SCENE_PASS.depth, { coverage: true });
    if (node.model && !node.raster) node.model.setRefractionMask(true);
    renderLeaf(node, SCENE_PASS.all, { coverage: true, erase: true });
    if (node.model && !node.raster) node.model.setRefractionMask(false);
    renderLeaf(node, SCENE_PASS.all, { replacement: true });
  }
  function restore(texture, nodes, processed) {
    rendering.frame(width, height); rendering.drawCopy(texture); depthPrepass(nodes, processed);
  }
  function packet(node, refraction = false) {
    const bounds = node.fxBounds ?? fullBounds();
    const depth = rendering.dataTarget(`depth:${node.id}`, width, height, () => renderLeaf(node, SCENE_PASS.packedDepth));
    rendering.frame(width, height);
    if (refraction) {
      renderLeaf(node, SCENE_PASS.depth);
      node.model.setRefractionMask(false); renderLeaf(node, SCENE_PASS.all);
    } else { renderLeaf(node, SCENE_PASS.opaque); renderLeaf(node, SCENE_PASS.transparent); }
    rendering.copyTo(node.colorCanvas);
    capture.setResolution(width, height);
    const color = capture.captureLayer(node.id, { source: crop(node.colorCanvas, node.cropCanvas, bounds), bounds, opacity: false });
    const center = node.model ? node.model.spatialRoot.position : node.carousel.root.position;
    const fallbackDepth = point.copy(center).project(cameras.output).z * .5 + .5;
    uploadLeaf(node, color, { projected: true, depth: depth.texture, fallbackDepth });
    node.projected = true; node.rasterOpacity = 1;
    if (refraction) {
      // Render the same geometry coverage, not the transmitted image's alpha.
      node.raster = false; rendering.frame(width, height); node.model.setRefractionMask(true);
      renderLeaf(node, SCENE_PASS.all); node.model.setRefractionMask(false); rendering.copyTo(node.maskCanvas);
      const mask = capture.captureLayer(node.id, { source: crop(node.maskCanvas, node.maskCropCanvas, bounds), bounds, opacity: false });
      node.surface.setCoverage(mask); node.raster = true;
    }
  }
  function flatRefraction(node, backdrop) {
    const style = getComputedStyle(node.element), x = parseFloat(style.left) || 0, y = parseFloat(style.top) || 0;
    const w = parseFloat(style.width), h = parseFloat(style.height);
    const frameSize = sceneDimensions(current.format), z = ((node.value.z ?? 0) + node.index * ORDER_DEPTH_PERCENT) / 100 * SCENE_VIEW_HEIGHT;
    planeMapping.makeScale(frameSize.width, frameSize.height, 1); planeMapping.setPosition(-frameSize.width / 2, -frameSize.height / 2, z);
    viewProjection.multiplyMatrices(cameras.output.projectionMatrix, cameras.output.matrixWorldInverse);
    planeMatrix.multiplyMatrices(viewProjection, planeMapping);
    const result = node.model.drawRefraction(backdrop, { x: x / nativeWidth, y: y / nativeHeight, width: w / nativeWidth, height: h / nativeHeight }, time, draft(node.id), planeMatrix);
    const density = captureScale(node); capture.setResolution(nativeWidth * density, nativeHeight * density);
    const beauty = capture.captureLayer(node.id);
    uploadLeaf(node, beauty); node.rasterOpacity = 1;
    const mask = capture.captureLayer(node.id, { source: result.mask, bounds: { x, y, width: w, height: h }, opacity: true });
    node.surface.setCoverage(mask);
  }
  function renderNodes(nodes) {
    rendering.frame(width, height); depthPrepass(nodes);
    for (const node of nodes) if (!node.children && node.background) renderLeaf(node, SCENE_PASS.all, { background: true });
    for (const node of nodes) {
      if (node.children) node.surface.render(cameras.output, SCENE_PASS.opaque, 1, 0);
      else if (!node.background && !node.refractive) renderLeaf(node, SCENE_PASS.opaque);
    }
    const queue = nodes.filter(node => nodeAlpha(node) > 0 && !node.background).sort((a, b) => nodeDepth(b) - nodeDepth(a) || a.index - b.index);
    const processed = [];
    for (const node of queue) {
      if (!node.refractive) {
        if (node.children) node.surface.render(cameras.output, SCENE_PASS.transparent, 1, 0);
        else renderLeaf(node, SCENE_PASS.transparent);
      } else if (node.refFrame === frame) existingGlass(node);
      else {
        const saved = rendering.framebuffer('restore');
        const behind = nodes.filter(other => other !== node && !(node.layer.space === 'flat' && (other.children || other.layer.space === 'flat') && other.index >= node.index));
        // A Flat lens retains layer-stack semantics. A Spatial lens includes
        // all opaque geometry in its common-camera background.
        rendering.frame(width, height); depthPrepass(behind);
        for (const other of behind) {
          if (other.children) other.surface.render(cameras.output, SCENE_PASS.opaque, 1, 0);
          else if (other.background) renderLeaf(other, SCENE_PASS.all, { background: true });
          else if (!other.refractive) renderLeaf(other, SCENE_PASS.opaque);
        }
        for (const other of processed) if (behind.includes(other)) {
          if (other.refractive) existingGlass(other);
          else if (other.children) other.surface.render(cameras.output, SCENE_PASS.transparent, 1, 0);
          else renderLeaf(other, SCENE_PASS.transparent);
        }
        const backdrop = rendering.capture(node.model.currentStyle.refractionResolution, `glass:${node.id}`);
        if (node.layer.space === 'flat') flatRefraction(node, backdrop);
        else {
          node.model.setBackdrop(backdrop);
          if (node.hasEffects) packet(node, true);
        }
        node.refFrame = frame; restore(saved, nodes, processed); existingGlass(node);
      }
      processed.push(node);
    }
  }
  function prepareGroups(nodes) {
    for (const group of nodes.filter(node => node.children)) {
      prepareGroups(group.children); renderNodes(group.children);
      if (group.overlay?.alpha > 0) renderLeaf(group.overlay, SCENE_PASS.all, { background: true });
      rendering.copyTo(group.colorCanvas);
      const depth = rendering.dataTarget(`group-depth:${group.id}`, width, height, () => renderData(group.children, SCENE_PASS.packedDepth));
      const picking = rendering.dataTarget(`group-pick:${group.id}`, width, height, () => renderData(group.children, SCENE_PASS.pick));
      capture.setResolution(width, height);
      const color = group.overlay ? group.colorCanvas : capture.captureAdjustment(group.effect.id, group.colorCanvas);
      group.surface.set(sourceSurface(color), { format: current.format, layer: group.effect, index: group.index, projected: true, depth: depth.texture, picking: picking.texture, fallbackDepth: 1 });
    }
  }
  return {
    output,
    update(value) { current = value; build(); pickDirty = true; },
    setResolution(w, h) { width = w; height = h; pickDirty = true; },
    setPlacement(value) { placement = value; pickDirty = true; },
    pose(at) {
      time = at; pickDirty = true;
      for (const node of leaves.values()) {
        node.value = { ...evaluateChoreography(node.layer, at), ...draft(node.id) };
        node.alpha = layerAlpha(node.layer, at); node.background = node.layer.type === 'background' && node.index === 0;
        node.refractive = node.layer.type === 'model' && node.layer.modelStyle?.shader === 'refractive';
        node.hasEffects = node.layer.effects?.some(effect => effect.enabled) ?? false;
        node.projected = false; node.raster = !(node.layer.space === 'spatial' && (node.model || node.carousel));
        if (node.model && node.layer.space === 'spatial') {
          node.model.prepareSpatial(current.format, cameras.output);
          node.fxBounds = projectedSphere(node.model);
          if (node.element) {
            node.element.dataset.flocFilterWidth = String(node.fxBounds.width); node.element.dataset.flocFilterHeight = String(node.fxBounds.height);
            node.element.dataset.flocFilterFullFrame = String(node.fxBounds.width === nativeWidth && node.fxBounds.height === nativeHeight);
          }
        }
        if (node.model && node.layer.space === 'spatial') node.sortPoint.copy(node.model.spatialRoot.position);
        else if (node.carousel && node.layer.space === 'spatial') node.sortPoint.copy(node.carousel.root.position);
        else if (node.element) {
          // Deferred lenses have no uploaded quad on their first frame. Sort
          // from the authored plane, never from a previous frame's surface.
          const style = getComputedStyle(node.element), size = sceneDimensions(current.format);
          const x = (parseFloat(style.left) || 0) + (parseFloat(style.width) || 0) / 2;
          const y = (parseFloat(style.top) || 0) + (parseFloat(style.height) || 0) / 2;
          node.sortPoint.set((x / nativeWidth - .5) * size.width, (.5 - y / nativeHeight) * size.height,
            ((node.value.z ?? 0) + node.index * ORDER_DEPTH_PERCENT) / 100 * SCENE_VIEW_HEIGHT);
        }
      }
    },
    draw() {
      if (disposed || rendering.lost) { if (renderMode) throw new Error('The shared scene lost its graphics context during export.'); return; }
      frame++; pickDirty = true;
      cameras.output.getWorldDirection(direction);
      for (const node of leaves.values()) {
        if (node.alpha <= 0 || node.layer.type === 'music' || node.layer.type === 'effect' && node.layer.effectScope === 'below') continue;
        if (!node.raster) { if (node.hasEffects && !node.refractive) packet(node); continue; }
        if (node.refractive) continue;
        const density = captureScale(node); capture.setResolution(nativeWidth * density, nativeHeight * density);
        const bakedOpacity = node.layer.space !== 'spatial' || node.background || node.layer.type === 'effect';
        const value = capture.captureLayer(node.id, { opacity: bakedOpacity });
        uploadLeaf(node, value, { projected: node.background || node.layer.type === 'effect' });
        node.rasterOpacity = bakedOpacity ? 1 : node.alpha;
      }
      prepareGroups(graph); renderNodes(graph); rendering.copyTo(output);
    },
    pick(u, v) {
      if (disposed || rendering.lost || !Number.isFinite(u) || !Number.isFinite(v) || u < 0 || v < 0 || u > 1 || v > 1) return null;
      if (pickDirty) { pickTarget = rendering.picking(width, height, () => renderData(graph, SCENE_PASS.pick)); pickDirty = false; }
      rendering.renderer.readRenderTargetPixels(pickTarget, Math.min(width - 1, Math.floor(u * width)), Math.min(height - 1, Math.floor((1 - v) * height)), 1, 1, pickPixel);
      const id = pickPixel[0] + (pickPixel[1] << 8) + (pickPixel[2] << 16);
      return id ? current.layers[id - 1]?.id ?? null : null;
    },
    projectedBounds(id) {
      const node = leaves.get(id); if (!node || node.alpha <= 0 || node.layer.type === 'effect') return null;
      if (node.background) return { x: 0, y: 0, width: 100, height: 100 };
      if (node.model && node.layer.space === 'spatial') return node.model.projectedBounds(cameras.output);
      if (node.model) return node.surface.elementBounds(cameras.output, node.element, modelCanvasGeometry(node.element)?.bounds());
      if (node.carousel && node.layer.space === 'spatial') return node.carousel.bounds(cameras.output);
      return node.surface.bounds(cameras.output);
    },
    projectPointer(u, v, id) {
      const node = id ? leaves.get(id) : null, depth = node?.value.z ?? 0;
      const orderedDepth = depth + (node && !(node.layer.space === 'spatial' && (node.model || node.carousel)) ? node.index * ORDER_DEPTH_PERCENT : 0);
      const result = cameras.pointerOnPlane(u, v, orderedDepth);
      return result ? { ...result, z: depth } : null;
    },
    // Depth (percent of the common view height, positive toward the default front camera)
    // of each visible depth-capable layer in the posed frame: one piece per Spatial card or
    // model, one plane for every Flat presentation and graphic.
    depthInfo() {
      const layers = [], toDepth = value => value / SCENE_VIEW_HEIGHT * 100;
      for (const node of leaves.values()) {
        if (node.alpha <= 0 || !SPATIAL_LAYER_TYPES.includes(node.layer.type)) continue;
        const pieces = [], spatial = node.layer.space === 'spatial';
        if (spatial && node.carousel) node.carousel.depthPieces(pieces);
        else if (spatial && node.model) {
          const z = toDepth(node.model.spatialRoot.position.z), radius = toDepth(node.model.spatialRadius);
          pieces.push({ min: z - radius, max: z + radius });
        } else pieces.push({ min: node.value.z ?? 0, max: node.value.z ?? 0 });
        if (!pieces.length) continue;
        let min = Infinity, max = -Infinity;
        for (const piece of pieces) { min = Math.min(min, piece.min); max = Math.max(max, piece.max); }
        layers.push({ id: node.id, min, max, pieces });
      }
      return layers;
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const node of leaves.values()) node.surface.dispose();
      for (const group of groups.values()) group.surface.dispose();
      leaves.clear(); groups.clear(); output.remove(); output.width = output.height = 1;
    }
  };
}
