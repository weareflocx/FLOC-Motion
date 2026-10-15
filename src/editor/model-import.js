import { MeshPhysicalMaterial, MeshBasicMaterial, Texture, Source, SRGBColorSpace, RepeatWrapping } from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export const MODEL_IMPORT_ACCEPT = '.glb,.obj,.mtl,.png,.jpg,.jpeg,.webp,.avif';
const textureExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif']);
const textureProperties = new Set(['map_kd', 'map_ks', 'map_ke', 'norm', 'map_bump', 'bump', 'map_d']);
const extension = name => name.split('.').pop().toLowerCase();
const selectedPath = file => file.webkitRelativePath || file.name;
const basename = path => path.replaceAll('\\', '/').split('/').pop();
const sizeError = maxBytes => `Model files, their local bundle and converted GLB must each be at most ${maxBytes / 1e6} MB.`;

function localPath(value) {
  const path = value.trim().replace(/^(["'])(.*)\1$/, '$2').replaceAll('\\', '/');
  if (!path || (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:\//i.test(path)) || path.startsWith('//') || /[\0\r\n]/.test(path)) {
    throw new Error(`Only selected local resources are allowed: "${value}".`);
  }
  return path;
}

function normalizedPath(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function resolveCompanion(files, reference, owner, extensions) {
  const path = localPath(reference);
  if (!extensions.has(extension(path))) throw new Error(`Unsupported local resource "${reference}" in ${owner.name}.`);
  const folder = selectedPath(owner).replaceAll('\\', '/').split('/').slice(0, -1).join('/');
  const exact = files.filter(file => extensions.has(extension(file.name)) && normalizedPath(selectedPath(file).replaceAll('\\', '/')) === normalizedPath(`${folder}/${path}`));
  const matches = exact.length ? exact : files.filter(file => extensions.has(extension(file.name)) && basename(file.name) === basename(path));
  if (matches.length !== 1) throw new Error(`${matches.length ? 'Ambiguous' : 'Missing'} local resource "${reference}" for ${owner.name}. Select its MTL and texture files together with the OBJ.`);
  return matches[0];
}

function cleanText(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\\\n/g, '').split('\n').map(line => line.replace(/\s*#.*$/, '').trim()).filter(Boolean);
}

function inspectObject(lines, maxBytes) {
  const counts = { v: 0, vt: 0, vn: 0 };
  const libraries = [], materials = new Set();
  let expandedVertices = 0;
  for (const line of lines) {
    const [key, ...values] = line.split(/\s+/);
    if (key in counts) {
      const required = key === 'vt' ? 2 : 3;
      if (values.length < required || values.some(value => !Number.isFinite(Number(value)))) throw new Error('OBJ contains invalid or non-finite vertex attributes.');
      counts[key]++;
    } else if (key === 'f' || key === 'l' || key === 'p') {
      if (values.length < (key === 'f' ? 3 : key === 'l' ? 2 : 1)) throw new Error('OBJ contains an incomplete face, line or point.');
      for (const value of values) {
        const indices = value.split('/');
        if (indices.length > 3) throw new Error('OBJ contains invalid vertex indices.');
        for (let i = 0; i < indices.length; i++) {
          if (!indices[i] && i > 0) continue;
          const index = Number(indices[i]), available = counts[['v', 'vt', 'vn'][i]];
          if (!Number.isInteger(index) || index === 0 || Math.abs(index) > available) throw new Error('OBJ references a missing vertex, UV or normal.');
        }
      }
      expandedVertices += key === 'f' ? (values.length - 2) * 3 : key === 'l' ? (values.length - 1) * 2 : values.length;
      if (expandedVertices * 44 > maxBytes) throw new Error(sizeError(maxBytes));
    } else if (key === 'mtllib') {
      libraries.push(line.slice(key.length).trim());
    } else if (key === 'usemtl') {
      const name = line.slice(key.length).trim();
      if (!name) throw new Error('OBJ declares an empty material name.');
      materials.add(name);
    } else if (key === 'usemap' || ['curv', 'curv2', 'surf', 'cstype'].includes(key)) {
      throw new Error(`OBJ ${key} declarations are not supported. Use polygon faces and MTL textures.`);
    }
  }
  if (!expandedVertices) throw new Error('OBJ has no faces, lines or points to import.');
  return { libraries, materials };
}

function materialLibraries(files, references, owner) {
  const result = new Set();
  for (const reference of references) {
    // An existing whole filename wins over whitespace-separated mtllib entries.
    const local = localPath(reference);
    const whole = files.some(file => extension(file.name) === 'mtl' && basename(file.name) === basename(local));
    const names = whole ? [reference] : reference.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    for (const name of names) result.add(resolveCompanion(files, name, owner, new Set(['mtl'])));
  }
  return [...result];
}

function validateMaterialInfo(info) {
  for (const [property, value] of Object.entries(info)) {
    if (['ka', 'kd', 'ks', 'ke'].includes(property) && (value.length !== 3 || value.some(number => !Number.isFinite(number) || number < 0 || number > 1))) throw new Error(`Material "${info.name}" has invalid ${property} colors.`);
    if (['ns', 'd', 'tr', 'ni'].includes(property) && (!Number.isFinite(Number(value)) || Number(value) < 0 || (['d', 'tr'].includes(property) && Number(value) > 1))) throw new Error(`Material "${info.name}" has invalid ${property}.`);
    if ((property.startsWith('map_') || ['bump', 'norm', 'disp', 'refl'].includes(property)) && !textureProperties.has(property)) throw new Error(`Material "${info.name}" uses unsupported ${property}. It cannot be preserved in GLB.`);
  }
}

async function readMaterials(files, libraries, usedMaterials) {
  const definitions = Object.create(null), textures = new Map();
  const resources = new Set(libraries);
  for (const library of libraries) {
    const lines = cleanText(await library.text()).map(line => line.replace(/^(\S+)(?:\s+|$)/, (_, key) => `${key.toLowerCase()} `).trim());
    const names = new Set();
    for (const line of lines) {
      if (!/^newmtl(?: |$)/.test(line)) continue;
      const name = line.slice(7).trim();
      if (!name || Object.hasOwn(Object.prototype, name) || name === 'prototype' || names.has(name) || Object.hasOwn(definitions, name)) throw new Error(`Ambiguous or invalid material "${name}" in ${library.name}.`);
      names.add(name);
    }
    const creator = new MTLLoader().parse(lines.join('\n'), '');
    for (const [name, info] of Object.entries(creator.materialsInfo)) {
      if (!usedMaterials.has(name)) continue;
      validateMaterialInfo(info);
      for (const property of Object.keys(info)) {
        if (!textureProperties.has(property)) continue;
        const params = {};
        const texture = creator.getTextureParams(info[property], params);
        if ([...texture.scale.toArray(), ...texture.offset.toArray(), ...Object.values(params)].some(number => !Number.isFinite(number))) throw new Error(`Material "${name}" has invalid texture options.`);
        // Only options understood by the installed MTLLoader are accepted.
        if (/(?:^|\s)-[a-z]/i.test(texture.url)) throw new Error(`Material "${name}" uses unsupported texture options.`);
        const file = resolveCompanion(files, texture.url, library, textureExtensions);
        resources.add(file);
        const token = `texture-${textures.size}`;
        textures.set(token, file);
        info[property] = info[property].replace(texture.url, token);
      }
      definitions[name] = info;
    }
  }
  for (const name of usedMaterials) if (!Object.hasOwn(definitions, name)) throw new Error(`Missing declared material "${name}". Select the referenced MTL file.`);
  return { definitions, textures, resources };
}

function canvasPixels(image, width = image.width, height = image.height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('A browser canvas is required to convert OBJ textures.');
  context.drawImage(image, 0, 0, width, height);
  return { canvas, context, pixels: context.getImageData(0, 0, width, height) };
}

function derivedTexture(original, canvas, scope) {
  const texture = original.clone();
  texture.source = new Source(canvas);
  texture.needsUpdate = true;
  scope.textures.add(texture);
  scope.canvases.add(canvas);
  return texture;
}

function combineAlpha(material, scope) {
  if (!material.alphaMap) return material.map;
  const base = material.map, alpha = material.alphaMap;
  const width = Math.max(base?.image.width || 1, alpha.image.width), height = Math.max(base?.image.height || 1, alpha.image.height);
  const output = canvasPixels(base?.image || alpha.image, width, height);
  scope.canvases.add(output.canvas);
  const mask = canvasPixels(alpha.image, width, height);
  scope.canvases.add(mask.canvas);
  if (base && (!base.repeat.equals(alpha.repeat) || !base.offset.equals(alpha.offset))) {
    const opacity = mask.pixels.data[1];
    for (let i = 5; i < mask.pixels.data.length; i += 4) {
      if (mask.pixels.data[i] !== opacity) throw new Error('Diffuse and nonuniform opacity textures must use matching UV scale and offset to preserve their appearance in GLB.');
    }
  }
  for (let i = 0; i < output.pixels.data.length; i += 4) {
    if (!base) output.pixels.data.fill(255, i, i + 3);
    output.pixels.data[i + 3] = (base ? output.pixels.data[i + 3] : 255) * mask.pixels.data[i + 1] / 255;
  }
  output.context.putImageData(output.pixels, 0, 0);
  const texture = derivedTexture(base || alpha, output.canvas, scope);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function adaptMaterial(original, object, scope) {
  scope.materials.add(original);
  const common = { name: original.name, color: original.color, opacity: original.opacity, transparent: original.transparent, side: original.side, vertexColors: !!object.geometry.getAttribute('color') };
  let material;
  if (object.isMesh) {
    material = new MeshPhysicalMaterial({ ...common, metalness: 0, roughness: Math.min(1, Math.max(.04, Math.sqrt(2 / ((original.shininess ?? 30) + 2)))), flatShading: original.flatShading, emissive: original.emissive, emissiveMap: original.emissiveMap, normalMap: original.normalMap, normalScale: original.normalScale, bumpMap: original.bumpMap, bumpScale: original.bumpScale, specularColor: original.specular });
    if (original.specularMap) {
      const output = canvasPixels(original.specularMap.image);
      scope.canvases.add(output.canvas);
      for (let i = 0; i < output.pixels.data.length; i += 4) output.pixels.data[i + 3] = output.pixels.data[i];
      output.context.putImageData(output.pixels, 0, 0);
      material.specularIntensityMap = derivedTexture(original.specularMap, output.canvas, scope);
    }
  } else {
    if (original.emissiveMap || original.normalMap || original.bumpMap || original.specularMap) throw new Error('Lit MTL texture channels require OBJ polygon faces, not lines or points.');
    material = new MeshBasicMaterial(common);
  }
  scope.materials.add(material);
  material.map = combineAlpha(original, scope);
  return material;
}

function trackObject(object, scope) {
  object.traverse(child => {
    if (child.geometry) scope.geometries.add(child.geometry);
    for (const material of [child.material].flat().filter(Boolean)) {
      scope.materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) scope.textures.add(value);
    }
  });
}

function validateGeometry(object) {
  let primitives = 0;
  object.traverse(child => {
    if (!child.geometry) return;
    const position = child.geometry.getAttribute('position');
    if (!position?.count) throw new Error('OBJ contains empty geometry.');
    for (const attribute of Object.values(child.geometry.attributes)) {
      if (attribute.count !== position.count || attribute.array.some(value => !Number.isFinite(value))) throw new Error('OBJ contains invalid or non-finite geometry attributes.');
    }
    if (child.isMesh) {
      if (position.count % 3) throw new Error('OBJ contains incomplete triangle geometry.');
      let hasArea = false;
      for (let i = 0; i < position.count; i += 3) {
        const ax = position.getX(i + 1) - position.getX(i), ay = position.getY(i + 1) - position.getY(i), az = position.getZ(i + 1) - position.getZ(i);
        const bx = position.getX(i + 2) - position.getX(i), by = position.getY(i + 2) - position.getY(i), bz = position.getZ(i + 2) - position.getZ(i);
        if (ax * by !== ay * bx || ay * bz !== az * by || az * bx !== ax * bz) hasArea = true;
      }
      if (!hasArea) throw new Error('OBJ contains only degenerate triangles.');
      const normal = child.geometry.getAttribute('normal');
      if (normal) for (let i = 0; i < normal.count; i++) {
        if (normal.getX(i) === 0 && normal.getY(i) === 0 && normal.getZ(i) === 0) throw new Error('OBJ contains zero-length normals or degenerate triangles.');
      }
    }
    primitives++;
  });
  if (!primitives) throw new Error('OBJ has no geometry to import.');
}

async function convertObject(file, files, maxBytes) {
  const scope = { textures: new Set(), materials: new Set(), geometries: new Set(), images: new Set(), urls: new Set(), canvases: new Set() };
  try {
    const lines = cleanText(await file.text());
    const inspected = inspectObject(lines, maxBytes);
    const libraries = materialLibraries(files, inspected.libraries, file);
    const { definitions, textures, resources } = await readMaterials(files, libraries, inspected.materials);
    if ([file, ...resources].reduce((sum, resource) => sum + resource.size, 0) > maxBytes) throw new Error(sizeError(maxBytes));
    const decoded = new Map();
    for (const resource of new Set(textures.values())) {
      const url = URL.createObjectURL(resource);
      scope.urls.add(url);
      const image = new Image();
      scope.images.add(image);
      image.src = url;
      try { await image.decode(); } catch { throw new Error(`Cannot decode local texture "${resource.name}".`); }
      if (!image.width || !image.height || image.width > 4096 || image.height > 4096 || image.width * image.height > 20e6) throw new Error(`Texture "${resource.name}" must be at most 4096 px per edge and 20 megapixels.`);
      decoded.set(resource, image);
    }
    const creator = new MTLLoader().parse('', '');
    creator.setMaterials(definitions);
    creator.loadTexture = token => {
      const resource = textures.get(token);
      if (!resource || !decoded.has(resource)) throw new Error('An OBJ texture was not resolved from the selected local files.');
      const texture = new Texture(decoded.get(resource));
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.needsUpdate = true;
      scope.textures.add(texture);
      return texture;
    };
    const loader = new OBJLoader();
    // Tracking creation also covers a parse failure before OBJLoader returns its group.
    const create = creator.create.bind(creator);
    creator.create = name => {
      if (!name) return undefined;
      const material = create(name);
      scope.materials.add(material);
      return material;
    };
    if (libraries.length) loader.setMaterials(creator);
    const object = loader.parse(lines.join('\n'));
    trackObject(object, scope);
    validateGeometry(object);
    object.traverse(child => {
      if (!child.material) return;
      const adapt = material => {
        if (!child.isMesh && Object.keys(definitions[material.name] || {}).some(property => textureProperties.has(property))) throw new Error('Textured OBJ materials require polygon faces, not lines or points.');
        return adaptMaterial(material, child, scope);
      };
      child.material = Array.isArray(child.material) ? child.material.map(adapt) : adapt(child.material);
    });
    const exporter = new GLTFExporter();
    exporter.register(writer => {
      const processTexture = writer.processTextureAsync.bind(writer);
      writer.processTextureAsync = texture => {
        scope.textures.add(texture);
        if (texture.image?.tagName === 'CANVAS') scope.canvases.add(texture.image);
        return processTexture(texture);
      };
      return {};
    });
    const binary = await exporter.parseAsync(object, { binary: true, maxTextureSize: 4096, onlyVisible: true });
    if (!(binary instanceof ArrayBuffer) || binary.byteLength > maxBytes) throw new Error(sizeError(maxBytes));
    return { descriptor: { file: new File([binary], file.name.replace(/\.obj$/i, '.glb'), { type: 'model/gltf-binary' }), name: file.name }, resources };
  } finally {
    for (const texture of scope.textures) texture.dispose();
    for (const material of scope.materials) material.dispose();
    for (const geometry of scope.geometries) geometry.dispose();
    for (const image of scope.images) image.removeAttribute('src');
    for (const url of scope.urls) URL.revokeObjectURL(url);
    for (const canvas of scope.canvases) { canvas.width = 0; canvas.height = 0; }
  }
}

export async function prepareModelImports(files, { maxBytes = 75e6 } = {}) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('The model import size limit must be positive.');
  const selected = Array.from(files), converted = new Map(), companions = new Set();
  for (const file of selected) if (file.size > maxBytes) throw new Error(sizeError(maxBytes));
  for (const file of selected) {
    if (extension(file.name) !== 'obj') continue;
    const { descriptor, resources } = await convertObject(file, selected, maxBytes);
    converted.set(file, descriptor);
    for (const resource of resources) companions.add(resource);
  }
  for (const file of selected) if (extension(file.name) === 'mtl' && !companions.has(file)) throw new Error(`MTL file "${file.name}" is not referenced by a selected OBJ. Select its OBJ too.`);
  return selected.filter(file => !companions.has(file)).map(file => converted.get(file) || { file, name: file.name });
}
