import * as THREE from 'three';

// Imported textures/geometry remain cache-owned. Only these per-instance materials
// and the generated toon ramp belong to this controller.
const surfaceKeys = ['color', 'map', 'alphaMap', 'emissive', 'emissiveIntensity', 'emissiveMap', 'normalMap', 'normalMapType', 'normalScale', 'bumpMap', 'bumpScale', 'displacementMap', 'displacementScale', 'displacementBias', 'aoMap', 'aoMapIntensity', 'lightMap', 'lightMapIntensity', 'vertexColors', 'flatShading', 'wireframe'];
function adapt(source, material, preserveMaps) {
  if (preserveMaps) THREE.Material.prototype.copy.call(material, source);
  else material.side = source.side;
  for (const key of surfaceKeys) {
    if (!preserveMaps && key !== 'flatShading') continue;
    if (!(key in material) || source[key] === undefined || (!preserveMaps && key.endsWith('Map')) || (!preserveMaps && key === 'map')) continue;
    if (material[key]?.isColor || material[key]?.isVector2) material[key].copy(source[key]);
    else material[key] = source[key];
  }
  return material;
}
function fresnel(material) {
  const uniforms = { modelRimColor: { value: new THREE.Color() }, modelRimIntensity: { value: 0 }, modelRimPower: { value: 3 } };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 modelRimColor;\nuniform float modelRimIntensity;\nuniform float modelRimPower;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float modelRim = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), modelRimPower);
      outgoingLight += modelRimColor * modelRimIntensity * modelRim;
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'floc-model-fresnel-v1';
  return uniforms;
}
// A smooth, tiling film-thickness field (green channel) so iridescent hues flow over
// the surface instead of showing a single thickness. Deterministic: no random seed.
export function filmThicknessMap(size = 128) {
  const data = new Uint8Array(size * size * 4), turn = Math.PI * 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const value = .5 + .25 * Math.sin(turn * (2 * u + .5 * Math.sin(turn * 3 * v))) + .25 * Math.sin(turn * (3 * v + .5 * Math.sin(turn * 2 * u)));
    const i = (y * size + x) * 4;
    data[i + 1] = Math.round(value * 255); data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
export function createModelMaterials(model) {
  const bindings = [], variants = new Map(), owned = new Set(), tint = new THREE.Color();
  // Brushing and a varying film need a UV frame; materials on meshes without UVs skip them.
  const withoutUv = new Set();
  let gradient, gradientSteps, film;
  model.traverse(node => {
    if (!node.material) return;
    bindings.push({ node, source: node.material });
    if (node.isMesh && !node.geometry.attributes.uv) for (const source of [node.material].flat()) withoutUv.add(source);
  });
  function ramp(steps) {
    if (!gradient) {
      gradient = new THREE.DataTexture(new Uint8Array(256), 256, 1, THREE.RedFormat);
      gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
      gradient.generateMipmaps = false;
    }
    if (gradientSteps !== steps) {
      const data = gradient.image.data;
      for (let i = 0; i < data.length; i++) data[i] = Math.round((.15 + .85 * Math.min(steps - 1, Math.floor(i * steps / 256)) / (steps - 1)) * 255);
      gradient.needsUpdate = true;
      gradientSteps = steps;
    }
    return gradient;
  }
  function filmThickness() {
    if (!film) film = filmThicknessMap();
    return film;
  }
  function variant(source, style, mesh) {
    const key = `${style.mode}/${mesh ? style.shader : 'standard'}`;
    let table = variants.get(key);
    if (!table) { table = new Map(); variants.set(key, table); }
    let value = table.get(source);
    if (value) return value;
    const shader = mesh ? style.shader : 'standard', preserve = style.mode !== 'replace';
    let material;
    if (!mesh) {
      material = source.clone();
      if (!preserve) {
        if ('map' in material) material.map = null;
        if ('alphaMap' in material) material.alphaMap = null;
        material.vertexColors = false; material.opacity = 1; material.transparent = false; material.alphaTest = 0; material.depthWrite = true;
      }
    } else if (shader === 'wireframe') material = adapt(source, new THREE.MeshBasicMaterial(), preserve);
    else if (shader === 'toon') material = adapt(source, new THREE.MeshToonMaterial(), preserve);
    else if (!preserve) material = adapt(source, new THREE.MeshPhysicalMaterial(), false);
    else if (shader === 'fresnel' && !source.isMeshStandardMaterial) material = adapt(source, new THREE.MeshPhysicalMaterial(), true);
    else material = source.clone();
    if (shader === 'wireframe') material.wireframe = true;
    value = { source, material, rim: shader === 'fresnel' ? fresnel(material) : null };
    table.set(source, value); owned.add(material);
    return value;
  }
  function updateMaterial(value, style) {
    const { source, material, rim } = value;
    if (material.color) {
      if (style.mode === 'replace') material.color.set(style.color);
      else { material.color.copy(source.color ?? tint.set('#ffffff')); if (style.mode === 'tint') material.color.multiply(tint.set(style.color)); }
    }
    if (style.mode === 'replace') {
      if (material.isMeshStandardMaterial) {
        material.roughness = style.roughness; material.metalness = style.metalness;
        material.clearcoat = style.clearcoat; material.iridescence = style.iridescence;
      }
      if (material.isMeshPhysicalMaterial) {
        material.clearcoatRoughness = style.clearcoatRoughness;
        material.sheen = style.sheen; material.sheenColor.set(style.sheenColor); material.sheenRoughness = style.sheenRoughness;
        material.anisotropy = withoutUv.has(source) ? 0 : style.anisotropy;
        material.anisotropyRotation = THREE.MathUtils.degToRad(style.anisotropyRotation);
        material.iridescenceIOR = style.iridescenceIOR;
        material.iridescenceThicknessRange[0] = style.iridescenceThicknessMin; material.iridescenceThicknessRange[1] = style.iridescenceThicknessMax;
        // Without a thickness map three.js uses only the thickest film; a range varies it across the surface.
        const thicknessMap = style.iridescence > 0 && style.iridescenceThicknessMin < style.iridescenceThicknessMax && !withoutUv.has(source) ? filmThickness() : null;
        if (material.iridescenceThicknessMap !== thicknessMap) { material.iridescenceThicknessMap = thicknessMap; material.needsUpdate = true; }
      }
      if (material.emissive) { material.emissive.set(style.emissive); material.emissiveIntensity = style.emissiveIntensity; }
    }
    if (material.isMeshToonMaterial) material.gradientMap = ramp(style.toonSteps);
    if (rim) {
      rim.modelRimColor.value.set(style.fresnelColor);
      rim.modelRimIntensity.value = style.fresnelIntensity;
      rim.modelRimPower.value = style.fresnelPower;
    }
  }
  return {
    update(style) {
      const updated = new Set();
      for (const { node, source } of bindings) {
        const assign = source => {
          const value = variant(source, style, node.isMesh);
          if (!updated.has(value)) { updateMaterial(value, style); updated.add(value); }
          return value.material;
        };
        node.material = Array.isArray(source) ? source.map(assign) : assign(source);
      }
    },
    dispose() { for (const material of owned) material.dispose(); owned.clear(); variants.clear(); gradient?.dispose(); film?.dispose(); }
  };
}
