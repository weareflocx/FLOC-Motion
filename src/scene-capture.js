// Native DOM sources and the existing SVG effect graph feed the shared scene.
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

function drawMedia(context, node, style, width, height, matrix, sx, sy, source = node) {
  const sourceWidth = source.videoWidth || source.naturalWidth || source.width, sourceHeight = source.videoHeight || source.naturalHeight || source.height;
  if (!sourceWidth || !sourceHeight || source.tagName === 'IMG' && !source.complete || source.tagName === 'VIDEO' && source.readyState < 2) return;
  const fit = source === node ? style.objectFit : 'fill';
  let w = width, h = height;
  if (fit === 'contain' || fit === 'cover' || fit === 'none' || fit === 'scale-down') {
    let scale = fit === 'cover' ? Math.max(width / sourceWidth, height / sourceHeight) : Math.min(width / sourceWidth, height / sourceHeight);
    if (fit === 'none') scale = 1;
    if (fit === 'scale-down') scale = Math.min(1, scale);
    w = sourceWidth * scale; h = sourceHeight * scale;
  }
  const position = style.objectPosition.split(/\s+/);
  let x = length(position[0], width - w), y = length(position[1] ?? position[0], height - h);
  let left = 0, top = 0, right = width, bottom = height;
  if (matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1) {
    // Blink paints replaced elements into device-pixel-snapped rectangles.
    // Keep that paint rectangle distinct from the fractional CSS filter box.
    left = Math.round(matrix.e * sx) / sx - matrix.e;
    top = Math.round(matrix.f * sy) / sy - matrix.f;
    right = Math.round((matrix.e + width) * sx) / sx - matrix.e;
    bottom = Math.round((matrix.f + height) * sy) / sy - matrix.f;
    const imageRight = Math.round((matrix.e + x + w) * sx) / sx - matrix.e;
    const imageBottom = Math.round((matrix.f + y + h) * sy) / sy - matrix.f;
    x = Math.round((matrix.e + x) * sx) / sx - matrix.e;
    y = Math.round((matrix.f + y) * sy) / sy - matrix.f;
    w = imageRight - x; h = imageBottom - y;
  }
  context.save(); context.beginPath(); context.rect(left, top, right - left, bottom - top); context.clip();
  if (w > 0 && h > 0) context.drawImage(source, x, y, w, h);
  context.restore();
}


let nextCapture = 0;
export function createSceneCapture(root, { width, height }) {
  const document = root.ownerDocument, view = document.defaultView;
  const filters = createFilterCapture(root, `scene-${nextCapture++}`), text = createTextCapture(document);
  let surfaces = new WeakMap(), disposed = false, sx = 1, sy = 1;
  function setResolution(w, h) {
    width = Math.max(1, Math.round(w)); height = Math.max(1, Math.round(h));
  }
  setResolution(width, height);
  function prepare() {
    const style = view.getComputedStyle(root);
    sx = width / Math.max(1, number(style.width, root.clientWidth));
    sy = height / Math.max(1, number(style.height, root.clientHeight));
    filters.prune();
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
  function describe(node, omitTransform = false) {
    if (['SVG', 'STYLE', 'AUDIO'].includes(node.tagName.toUpperCase()) || node.hasAttribute('data-floc-scene-output')) return null;
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const w = number(style.width, node.offsetWidth), h = number(style.height, node.offsetHeight);
    if (!(w > 0 && h > 0)) return null;
    const origin = style.transformOrigin.split(/\s+/);
    const matrix = new view.DOMMatrix(omitTransform || style.transform === 'none' ? undefined : style.transform);
    if (!matrix.is2D) throw new Error('Flat scene capture requires affine 2D source transforms.');
    const ox = length(origin[0], w), oy = length(origin[1], h);
    const transform = omitTransform ? matrix : new view.DOMMatrix().translate(number(style.left, node.offsetLeft), number(style.top, node.offsetTop)).translate(ox, oy).multiply(matrix).translate(-ox, -oy);
    const isText = !node.children.length && [...node.childNodes].some(child => child.nodeType === 3);
    const children = isText ? [] : [...node.children].map(child => describe(child)).filter(Boolean).sort((a, b) => number(a.style.zIndex) - number(b.style.zIndex));
    const filter = node.style.filter || style.filter;
    const desc = { node, style, width: w, height: h, transform, children, isText, filter };
    desc.bounds = boundsFor(desc);
    return desc;
  }
  function boundsFor(desc) {
    let bounds = { x: 0, y: 0, right: desc.width, bottom: desc.height };
    if (desc.style.overflow === 'visible') for (const child of desc.children) bounds = union(bounds, transformedBounds(child.bounds, child.transform));
    for (const token of tokens(desc.filter)) {
      const source = filters.sourceFor(token);
      if (source) bounds = union(bounds, filterRegion(source, desc.width, desc.height));
      else if (token.startsWith('blur(')) {
        const padding = number(token.slice(5)) * 3;
        bounds = { x: bounds.x - padding, y: bounds.y - padding, right: bounds.right + padding, bottom: bounds.bottom + padding };
      }
    }
    return bounds;
  }
  function drawSurface(context, value) { context.drawImage(value.canvas, value.x, value.y, value.width, value.height); }
  function filtered(desc, raw) {
    if (!desc.filter || desc.filter === 'none') return raw;
    const value = surface(desc.node, 'filtered', desc.bounds, desc.phase), context = value.context;
    context.resetTransform();
    context.filter = filters.filter(desc.filter, desc, sx, sy, value.x, value.y);
    context.drawImage(raw.canvas, Math.round((raw.x - value.x) * sx), Math.round((raw.y - value.y) * sy));
    context.filter = 'none';
    return value;
  }
  function paint(desc, destination, global, includeOpacity = true, source = null, omitClip = false) {
    const matrix = global.multiply(desc.transform);
    // Native images/canvases also rasterize on the final output pixel grid.
    // A layer-local bitmap followed by a fractional placement filters it twice.
    if (matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1) desc.phase = { x: matrix.e, y: matrix.f };
    const raw = surface(desc.node, 'raw', desc.bounds, desc.phase), context = raw.context;
    if (source) drawMedia(context, desc.node, desc.style, desc.width, desc.height, matrix, sx, sy, source);
    else if (desc.isText) text.draw(context, desc.node, desc.style, desc.width);
    else {
      if (desc.style.backgroundColor !== 'rgba(0, 0, 0, 0)' && desc.style.backgroundColor !== 'transparent') {
        context.fillStyle = desc.style.backgroundColor; context.fillRect(0, 0, desc.width, desc.height);
      }
      if (['CANVAS', 'IMG', 'VIDEO'].includes(desc.node.tagName)) drawMedia(context, desc.node, desc.style, desc.width, desc.height, matrix, sx, sy);
      context.save();
      if (desc.style.overflow !== 'visible') { context.beginPath(); context.rect(0, 0, desc.width, desc.height); context.clip(); }
      for (const child of desc.children) paint(child, raw, matrix);
      context.restore();
    }
    const beauty = filtered(desc, raw), target = destination.context, m = desc.transform;
    target.save(); target.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    if (!omitClip) clipPath(target, desc.style.clipPath, desc.width, desc.height);
    target.globalAlpha = includeOpacity ? number(desc.style.opacity, 1) : 1;
    drawSurface(target, beauty); target.restore();
  }
  function captureLayer(id, { local = false, source = null, bounds = null, opacity = true } = {}) {
    if (disposed) return null;
    prepare();
    let node = [...root.querySelectorAll('[data-floc-layer]')].find(node => node.dataset.flocLayer === id && !node.hasAttribute('data-floc-background-content'));
    if (!node) return null;
    // Effect groups for multiple source nodes belong to this layer, unlike
    // Below wrappers which are applied explicitly by the scene render graph.
    while (node.parentElement !== root && !node.parentElement?.hasAttribute('data-floc-adjustment') && node.parentElement?.querySelectorAll('[data-floc-layer]').length && [...node.parentElement.querySelectorAll('[data-floc-layer]')].every(child => child.dataset.flocLayer === id)) node = node.parentElement;
    const desc = describe(node, local || Boolean(source && bounds));
    if (!desc) return null;
    if (source && bounds) {
      desc.width = bounds.width; desc.height = bounds.height; desc.children = []; desc.isText = false;
      desc.transform = new view.DOMMatrix().translate(local ? 0 : bounds.x, local ? 0 : bounds.y);
      desc.bounds = boundsFor(desc);
    }
    const placed = transformedBounds(desc.bounds, desc.transform);
    const value = surface(node, 'output', placed);
    paint(desc, value, new view.DOMMatrix(), opacity, source, Boolean(source && bounds));
    return { canvas: value.canvas, x: value.x, y: value.y, width: value.width, height: value.height };
  }
  function captureAdjustment(id, canvas) {
    if (disposed) return canvas;
    prepare();
    const node = [...root.querySelectorAll('[data-floc-adjustment]')].find(node => node.dataset.flocAdjustment === id);
    if (!node) return canvas;
    const style = view.getComputedStyle(node), w = width / sx, h = height / sy;
    const desc = { node, style, width: w, height: h, filter: node.style.filter || style.filter, children: [] };
    desc.bounds = { x: 0, y: 0, right: w, bottom: h };
    const raw = surface(node, 'adjustment-raw', desc.bounds);
    raw.context.drawImage(canvas, 0, 0, w, h);
    const beauty = filtered(desc, raw);
    if (beauty.canvas === raw.canvas) return raw.canvas;
    // Adjustment output is always a full-frame canvas, not padded filter bounds.
    const result = surface(node, 'adjustment-output', desc.bounds);
    drawSurface(result.context, beauty);
    return result.canvas;
  }
  return {
    setResolution, captureLayer, captureAdjustment,
    dispose() {
      if (disposed) return;
      disposed = true; filters.dispose(); text.dispose(); surfaces = new WeakMap();
    },
  };
}
