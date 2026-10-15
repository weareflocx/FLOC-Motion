import { FORMATS } from './project.js';

let nextCompositor = 0;
const NS = 'http://www.w3.org/2000/svg';
const number = (value, fallback = 0) => Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback;
const tokens = filter => filter.match(/url\([^)]*\)|[a-z-]+\([^)]*\)/gi) ?? [];
const filterId = token => token.startsWith('url(') ? token.match(/#([^)'"\s]+)/)?.[1] : null;
const length = (value, extent) => value?.endsWith('%') ? number(value) * extent / 100 : number(value);
const union = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) });
function transformedBounds(bounds, matrix) {
  const points = [[bounds.x, bounds.y], [bounds.right, bounds.y], [bounds.x, bounds.bottom], [bounds.right, bounds.bottom]].map(([x, y]) => matrix.transformPoint({ x, y }));
  return { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), right: Math.max(...points.map(p => p.x)), bottom: Math.max(...points.map(p => p.y)) };
}
function filterRegion(filter, width, height) {
  const object = filter.getAttribute('filterUnits') !== 'userSpaceOnUse';
  const value = (name, fallback, extent) => {
    const source = filter.getAttribute(name) ?? fallback;
    return source.endsWith('%') ? length(source, extent) : number(source) * (object ? extent : 1);
  };
  const x = value('x', '-10%', width), y = value('y', '-10%', height);
  return { x, y, right: x + value('width', '120%', width), bottom: y + value('height', '120%', height) };
}

// Canvas filters use device pixels, regardless of the current transform. Their
// implicit SourceGraphic bounding box is also the entire backing canvas, not the
// element's CSS box. Adapt the existing, already-decoded effect graphs rather
// than implementing a second catalog with subtly different alpha semantics.
function createFilterCapture(root, id) {
  const document = root.ownerDocument;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;pointer-events:none';
  const defs = document.createElementNS(NS, 'defs'); svg.append(defs); root.append(svg);
  const captures = new Map();
  let nextCapture = 0;
  const sourceFor = token => {
    const sourceId = filterId(token);
    return sourceId ? document.getElementById(sourceId) : null;
  };
  function capture(token, box, sx, sy, originX, originY) {
    const source = sourceFor(token);
    if (!source) return token.replace(/blur\(([-+.\d]+)px\)/g, (_, radius) => `blur(${number(radius) * Math.max(sx, sy)}px)`);
    // SVG primitive raster origins snap to pixels. A fractional canvas origin
    // otherwise expands one-pixel tile windows and changes their sampling grid.
    originX = Math.round(originX * sx) / sx;
    originY = Math.round(originY * sy) / sy;
    let entry = captures.get(source);
    if (!entry) {
      const clone = source.cloneNode(true), observer = new MutationObserver(() => { entry.dirty = true; });
      entry = { clone, observer, dirty: true, key: '' };
      clone.id = `floc-capture-${id}-${nextCapture++}`;
      defs.append(clone); captures.set(source, entry);
      observer.observe(source, { attributes: true, childList: true, subtree: true });
    }
    if (entry.observer.takeRecords().length) entry.dirty = true;
    const key = `${box.width}:${box.height}:${sx}:${sy}:${originX}:${originY}`;
    if (entry.dirty || entry.key !== key) {
      const region = filterRegion(source, box.width, box.height);
      const object = source.getAttribute('primitiveUnits') === 'objectBoundingBox';
      const coordinates = new Set(['x', 'y', 'width', 'height', 'dx', 'dy', 'stdDeviation', 'radius', 'scale', 'kernelUnitLength']);
      const rootValues = {
        filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
        x: (region.x - originX) * sx, y: (region.y - originY) * sy,
        width: (region.right - region.x) * sx, height: (region.bottom - region.y) * sy,
      };
      function sync(sourceNode, cloneNode, isRoot = false) {
        const attributes = new Map([...sourceNode.attributes].map(attribute => [attribute.name, attribute.value]));
        if (isRoot) {
          attributes.set('id', entry.clone.id);
          for (const [name, value] of Object.entries(rootValues)) attributes.set(name, String(value));
        } else for (const [name, value] of attributes) {
          if (!coordinates.has(name)) continue;
          const transformed = value.trim().split(/[\s,]+/).map((part, index) => {
            const vertical = ['y', 'height', 'dy'].includes(name) || ['stdDeviation', 'radius', 'kernelUnitLength'].includes(name) && index === 1;
            const extent = vertical ? box.height : box.width, scale = vertical ? sy : sx;
            let numeric = part.endsWith('%') ? length(part, extent) : number(part) * (object ? extent : 1);
            if (name === 'x') numeric -= originX;
            if (name === 'y') numeric -= originY;
            return numeric * scale;
          });
          attributes.set(name, transformed.join(' '));
        }
        for (const attribute of [...cloneNode.attributes]) if (!attributes.has(attribute.name)) cloneNode.removeAttribute(attribute.name);
        for (const [name, value] of attributes) if (cloneNode.getAttribute(name) !== value) cloneNode.setAttribute(name, value);
        const children = [...sourceNode.children];
        if (children.length !== cloneNode.children.length || children.some((child, index) => child.tagName !== cloneNode.children[index].tagName)) {
          cloneNode.replaceChildren(...children.map(child => child.cloneNode(true)));
        }
        children.forEach((child, index) => sync(child, cloneNode.children[index]));
      }
      // Keep decoded feImage nodes and immutable primitives alive across seeks.
      // Only genuinely changed attributes/graph branches invalidate the filter.
      sync(source, entry.clone, true);
      entry.key = key; entry.dirty = false;
    }
    return `url(#${entry.clone.id})`;
  }
  return {
    sourceFor,
    filter(value, box, sx, sy, x, y) { return tokens(value).map(token => capture(token, box, sx, sy, x, y)).join(' ') || 'none'; },
    prune() {
      for (const [source, entry] of captures) if (!root.contains(source)) {
        entry.observer.disconnect(); entry.clone.remove(); captures.delete(source);
      }
    },
    dispose() { captures.forEach(entry => entry.observer.disconnect()); captures.clear(); svg.remove(); },
  };
}

const textProperties = ['font', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant', 'fontKerning', 'fontFeatureSettings', 'fontVariationSettings', 'fontOpticalSizing', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textIndent', 'textTransform', 'whiteSpace', 'overflowWrap', 'wordBreak', 'tabSize', 'direction', 'unicodeBidi'];
function createTextCapture(document) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style';
  document.body.append(host);
  let layouts = new WeakMap();
  let fontVersion = 0;
  const fontsChanged = () => { fontVersion++; };
  document.fonts?.addEventListener('loadingdone', fontsChanged);
  function layout(node, style, width) {
    const key = JSON.stringify([node.textContent, width, fontVersion, ...textProperties.map(property => style[property])]);
    const cached = layouts.get(node);
    if (cached?.key === key) return cached;
    const measure = document.createElement('div');
    measure.style.cssText = 'position:relative;margin:0;padding:0;border:0;transform:none';
    for (const property of textProperties) measure.style[property] = style[property];
    measure.style.width = `${width}px`; measure.textContent = node.textContent;
    host.replaceChildren(measure);
    const text = measure.firstChild, runs = [], range = document.createRange(), base = measure.getBoundingClientRect();
    let offset = 0, run = null;
    for (const character of node.textContent) {
      const end = offset + character.length;
      if (character === '\n' || character === '\r' || character === '\t') { run = null; offset = end; continue; }
      range.setStart(text, offset); range.setEnd(text, end);
      const rect = range.getBoundingClientRect();
      const x = rect.left - base.left, y = rect.top - base.top;
      if (!run || Math.abs(run.y - y) > 0.5) { run = { start: offset, end, x, y, right: x + rect.width, height: rect.height }; runs.push(run); }
      else { run.end = end; run.x = Math.min(run.x, x); run.right = Math.max(run.right, x + rect.width); }
      offset = end;
    }
    const value = { key, runs: runs.map(run => ({ ...run, text: node.textContent.slice(run.start, run.end) })) };
    layouts.set(node, value); return value;
  }
  return {
    draw(context, node, style, width) {
      context.font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      context.fontKerning = style.fontKerning; context.fontStretch = style.fontStretch;
      context.fontVariantCaps = style.fontVariantCaps;
      context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
      context.wordSpacing = style.wordSpacing === 'normal' ? '0px' : style.wordSpacing;
      context.direction = style.direction; context.textAlign = style.direction === 'rtl' ? 'right' : 'left';
      context.textBaseline = 'alphabetic'; context.fillStyle = style.color;
      for (const run of layout(node, style, width).runs) {
        const metrics = context.measureText(run.text);
        const ascent = metrics.fontBoundingBoxAscent, descent = metrics.fontBoundingBoxDescent;
        const baseline = run.y + ascent + (run.height - ascent - descent) / 2;
        context.fillText(run.text, style.direction === 'rtl' ? run.right : run.x, baseline);
      }
    },
    dispose() { document.fonts?.removeEventListener('loadingdone', fontsChanged); layouts = new WeakMap(); host.remove(); },
  };
}

function clipPath(context, value, width, height) {
  if (!value || value === 'none') return;
  const inset = value.match(/^inset\(([^)]+)\)$/);
  if (inset) {
    const [edges, round] = inset[1].split(/\s+round\s+/), values = edges.trim().split(/\s+/);
    const [top, right = top, bottom = top, left = right] = values;
    const x = length(left, width), y = length(top, height), w = Math.max(0, width - x - length(right, width)), h = Math.max(0, height - y - length(bottom, height));
    context.beginPath();
    if (round) context.roundRect(x, y, w, h, length(round, Math.min(width, height)));
    else context.rect(x, y, w, h);
    context.clip(); return;
  }
  const polygon = value.match(/^polygon\((.+)\)$/);
  if (polygon) {
    context.beginPath(); polygon[1].split(',').forEach((point, index) => {
      const [x, y] = point.trim().split(/\s+/);
      context[index ? 'lineTo' : 'moveTo'](length(x, width), length(y, height));
    }); context.closePath(); context.clip(); return;
  }
  throw new Error(`Unsupported composition clip path: ${value}`);
}

function drawMedia(context, node, style, width, height) {
  const sourceWidth = node.videoWidth || node.naturalWidth || node.width, sourceHeight = node.videoHeight || node.naturalHeight || node.height;
  if (!sourceWidth || !sourceHeight || node.tagName === 'IMG' && !node.complete || node.tagName === 'VIDEO' && node.readyState < 2) return;
  const fit = style.objectFit;
  let w = width, h = height;
  if (fit === 'contain' || fit === 'cover' || fit === 'none' || fit === 'scale-down') {
    let scale = fit === 'cover' ? Math.max(width / sourceWidth, height / sourceHeight) : Math.min(width / sourceWidth, height / sourceHeight);
    if (fit === 'none') scale = 1;
    if (fit === 'scale-down') scale = Math.min(1, scale);
    w = sourceWidth * scale; h = sourceHeight * scale;
  }
  const position = style.objectPosition.split(/\s+/);
  const x = length(position[0], width - w), y = length(position[1] ?? position[0], height - h);
  context.save(); context.beginPath(); context.rect(0, 0, width, height); context.clip();
  context.drawImage(node, x, y, w, h); context.restore();
}

export function createRefractionCompositor(root, { width, height }) {
  const document = root.ownerDocument, view = document.defaultView, id = nextCompositor++;
  const output = document.createElement('canvas');
  output.setAttribute('data-floc-refraction-output', ''); output.setAttribute('aria-hidden', 'true');
  output.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none';
  const hiding = document.createElement('style');
  // Filters suppress paint without removing HTML hit targets, unlike visibility.
  // This never overwrites the source opacity, position or inline effect graph.
  hiding.textContent = `[data-floc-refraction-hidden="${id}"]{filter:opacity(0)!important}`;
  root.append(output, hiding);
  const filters = createFilterCapture(root, id), text = createTextCapture(document);
  const backdrop = document.createElement('canvas'), hidden = new Map();
  let surfaces = new WeakMap();
  let enabled = false, disposed = false, nativeWidth = 1, nativeHeight = 1, sx = 1, sy = 1;
  function setResolution(w, h) {
    width = Math.max(1, Math.round(w)); height = Math.max(1, Math.round(h));
    if (backdrop.width !== width) backdrop.width = width;
    if (backdrop.height !== height) backdrop.height = height;
  }
  setResolution(width, height);
  function restoreSources() {
    for (const [node, previous] of hidden) {
      if (previous === null) node.removeAttribute('data-floc-refraction-hidden');
      else node.setAttribute('data-floc-refraction-hidden', previous);
    }
    hidden.clear();
  }
  function hideSources() {
    const sources = [...root.children].filter(node => node.hasAttribute('data-floc-layer') || node.querySelector('[data-floc-layer]'));
    for (const [node, previous] of hidden) if (!sources.includes(node)) {
      if (previous === null) node.removeAttribute('data-floc-refraction-hidden'); else node.setAttribute('data-floc-refraction-hidden', previous);
      hidden.delete(node);
    }
    for (const node of sources) {
      if (!hidden.has(node)) hidden.set(node, node.getAttribute('data-floc-refraction-hidden'));
      node.setAttribute('data-floc-refraction-hidden', String(id));
    }
  }
  function setEnabled(value) {
    enabled = Boolean(value) && !disposed;
    if (enabled) hideSources(); else restoreSources();
    output.style.display = enabled ? 'block' : 'none';
  }
  function surface(node, kind, bounds, phase) {
    let cache = surfaces.get(node);
    if (!cache) { cache = new Map(); surfaces.set(node, cache); }
    let canvas = cache.get(kind);
    if (!canvas) { canvas = document.createElement('canvas'); cache.set(kind, canvas); }
    const px = phase?.x ?? 0, py = phase?.y ?? 0;
    const left = Math.floor((bounds.x + px) * sx), top = Math.floor((bounds.y + py) * sy);
    const x = left / sx - px, y = top / sy - py;
    const w = Math.max(1, Math.ceil((bounds.right + px) * sx) - left), h = Math.max(1, Math.ceil((bounds.bottom + py) * sy) - top);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const context = canvas.getContext('2d');
    context.resetTransform(); context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; context.filter = 'none'; context.clearRect(0, 0, w, h);
    context.setTransform(sx, 0, 0, sy, -x * sx, -y * sy);
    return { canvas, context, x, y, width: w / sx, height: h / sy };
  }
  function describe(node, layers) {
    if (['SVG', 'STYLE', 'AUDIO'].includes(node.tagName.toUpperCase()) || node === output) return null;
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const w = number(style.width, node.offsetWidth), h = number(style.height, node.offsetHeight);
    if (!(w > 0 && h > 0)) return null;
    const origin = style.transformOrigin.split(/\s+/), matrix = new view.DOMMatrix(style.transform === 'none' ? undefined : style.transform);
    if (!matrix.is2D) throw new Error('Refraction composition requires affine 2D source transforms.');
    const ox = length(origin[0], w), oy = length(origin[1], h);
    const transform = new view.DOMMatrix().translate(number(style.left, node.offsetLeft), number(style.top, node.offsetTop)).translate(ox, oy).multiply(matrix).translate(-ox, -oy);
    const layer = !node.hasAttribute('data-floc-background-content') ? layers.get(node.dataset.flocLayer) : null;
    const children = layer?.type === 'text' ? [] : [...node.children].map(child => describe(child, layers)).filter(Boolean).sort((a, b) => number(a.style.zIndex) - number(b.style.zIndex));
    let bounds = { x: 0, y: 0, right: w, bottom: h };
    if (style.overflow === 'visible') for (const child of children) bounds = union(bounds, transformedBounds(child.bounds, child.transform));
    const filter = node.style.filter || (hidden.has(node) ? 'none' : style.filter);
    for (const token of tokens(filter)) {
      const source = filters.sourceFor(token);
      if (source) bounds = union(bounds, filterRegion(source, w, h));
      else if (token.startsWith('blur(')) {
        const padding = number(token.slice(5)) * 3;
        bounds = { x: bounds.x - padding, y: bounds.y - padding, right: bounds.right + padding, bottom: bounds.bottom + padding };
      }
    }
    return { node, layer, style, width: w, height: h, transform, children, bounds, filter };
  }
  function drawSurface(context, value) { context.drawImage(value.canvas, value.x, value.y, value.width, value.height); }
  function filtered(desc, raw, kind) {
    if (!desc.filter || desc.filter === 'none') return raw;
    const value = surface(desc.node, kind, desc.bounds, desc.phase), context = value.context;
    // Filter coordinates have been adapted to backing-store pixels; keep the
    // draw itself in that same space, with no hidden CTM scaling of blur radii.
    context.resetTransform();
    context.filter = filters.filter(desc.filter, desc, sx, sy, value.x, value.y);
    context.drawImage(raw.canvas, Math.round((raw.x - value.x) * sx), Math.round((raw.y - value.y) * sy));
    context.filter = 'none'; return value;
  }
  function draw(project, time, renderModel) {
    if (disposed || !enabled) return;
    [nativeWidth, nativeHeight] = FORMATS[project.format]; sx = width / nativeWidth; sy = height / nativeHeight;
    // Above source layers, below the editor's guide plane (z-index 100).
    output.style.zIndex = String(project.layers.length);
    hideSources(); filters.prune();
    const layers = new Map(project.layers.map(layer => [layer.id, layer]));
    const descriptions = [...root.children].filter(node => hidden.has(node)).map(node => describe(node, layers)).filter(Boolean).sort((a, b) => number(a.style.zIndex) - number(b.style.zIndex));
    // Keep the previous frame visible between a viewport resize and its seek.
    if (output.width !== width) output.width = width;
    if (output.height !== height) output.height = height;
    const context = output.getContext('2d'); context.resetTransform(); context.clearRect(0, 0, width, height); context.setTransform(sx, 0, 0, sy, 0, 0);
    const rootSurface = { canvas: output, context, x: 0, y: 0, width: nativeWidth, height: nativeHeight };
    const identity = new view.DOMMatrix();
    function paint(desc, destination, global, ancestors) {
      const opacity = number(desc.style.opacity, 1);
      if (opacity <= 0) return;
      const matrix = global.multiply(desc.transform);
      // Rasterize translated text on the final output pixel grid. Otherwise a
      // fractional layer origin resamples an already-antialiased glyph bitmap
      // a second time, unlike native DOM text, softening/moving its edges.
      if (desc.layer?.type === 'text' && matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1) desc.phase = { x: matrix.e, y: matrix.f };
      const raw = surface(desc.node, 'raw', desc.bounds, desc.phase);
      const refractive = desc.layer?.type === 'model' && desc.layer.modelStyle?.shader === 'refractive' && desc.layer.visible && time >= desc.layer.start && time < desc.layer.end;
      let mask = null;
      if (refractive) {
        const background = backdrop.getContext('2d'); background.resetTransform(); background.clearRect(0, 0, width, height);
        for (const entry of ancestors) {
          const m = entry.matrix; background.setTransform(sx * m.a, sy * m.b, sx * m.c, sy * m.d, sx * m.e, sy * m.f); drawSurface(background, entry.surface);
        }
        const position = matrix.transformPoint({ x: 0, y: 0 });
        const rendered = renderModel(desc.layer.id, backdrop, { x: position.x / nativeWidth, y: position.y / nativeHeight, width: desc.width / nativeWidth, height: desc.height / nativeHeight });
        if (!rendered?.canvas || !rendered?.mask) throw new Error(`Refractive model ${desc.layer.id} did not provide beauty and coverage canvases.`);
        raw.context.drawImage(rendered.canvas, 0, 0, desc.width, desc.height);
        mask = surface(desc.node, 'mask', desc.bounds); mask.context.drawImage(rendered.mask, 0, 0, desc.width, desc.height);
      } else if (desc.layer?.type === 'text') text.draw(raw.context, desc.node, desc.style, desc.width);
      else {
        if (desc.style.backgroundColor !== 'rgba(0, 0, 0, 0)' && desc.style.backgroundColor !== 'transparent') {
          raw.context.fillStyle = desc.style.backgroundColor; raw.context.fillRect(0, 0, desc.width, desc.height);
        }
        if (['CANVAS', 'IMG', 'VIDEO'].includes(desc.node.tagName)) drawMedia(raw.context, desc.node, desc.style, desc.width, desc.height);
        raw.context.save();
        if (desc.style.overflow !== 'visible') { raw.context.beginPath(); raw.context.rect(0, 0, desc.width, desc.height); raw.context.clip(); }
        const stack = [...ancestors, { surface: raw, matrix }];
        for (const child of desc.children) paint(child, raw, matrix, stack);
        raw.context.restore();
      }
      const beauty = filtered(desc, raw, 'filtered'), coverage = mask ? filtered(desc, mask, 'filtered-mask') : null;
      const target = destination.context, m = desc.transform;
      target.save(); target.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      clipPath(target, desc.style.clipPath, desc.width, desc.height);
      target.globalAlpha = opacity;
      if (coverage) {
        target.globalCompositeOperation = 'destination-out'; drawSurface(target, coverage);
        target.globalCompositeOperation = 'lighter'; drawSurface(target, beauty);
      } else drawSurface(target, beauty);
      target.restore();
    }
    for (const desc of descriptions) paint(desc, rootSurface, identity, [{ surface: rootSurface, matrix: identity }]);
  }
  return {
    draw, setResolution, setEnabled,
    dispose() {
      if (disposed) return;
      setEnabled(false); disposed = true; filters.dispose(); text.dispose(); output.remove(); hiding.remove();
      surfaces = new WeakMap();
      output.width = output.height = backdrop.width = backdrop.height = 1;
    },
  };
}
