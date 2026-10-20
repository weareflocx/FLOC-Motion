import * as THREE from 'three';
import { createModelRefraction } from './model-refraction.js';
import { bindScenePass, createScenePass, setSceneMaterialPass } from './scene-pass.js';

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
// Glass over layers: the tinted body covers glassOpacity of what lies below, Fresnel makes
// edges more reflective and opaque, and reflections are added on top. The output is
// premultiplied, with alpha raised to cover bright highlights, so the layer's 2D canvas
// composites it over any background in preview and export alike.
const OVERLAY_GLASS = `
  float modelGlassF0 = pow((modelGlassIOR - 1.0) / (modelGlassIOR + 1.0), 2.0);
  float modelGlassFresnel = modelGlassF0 + (1.0 - modelGlassF0) * pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 5.0);
  // Clearcoat has already attenuated the diffuse term, so the remainder never goes negative.
  vec3 modelGlassLight = max(outgoingLight - (1.0 - modelGlassBody) * totalDiffuse, vec3(0.0));
  float modelGlassAlpha = modelGlassBody + (1.0 - modelGlassBody) * modelGlassFresnel;
  modelGlassAlpha = clamp(max(modelGlassAlpha, max(modelGlassLight.r, max(modelGlassLight.g, modelGlassLight.b))), 0.0, 1.0);
  gl_FragColor = vec4(modelGlassLight / max(modelGlassAlpha, 1e-4), modelGlassAlpha * diffuseColor.a);
`;
// Studio glass: view rays refract into the model and out again, then sample the model's
// own reflection environment, one index per color channel for dispersion. The exit is
// solved for a sphere through the entry point, which reads as a thick, image-inverting
// lens on any convex shape. The result is opaque; reflections come from the lit surface.
const STUDIO_GLASS_PARS = `
uniform float modelGlassIOR;
uniform float modelGlassBody;
uniform float modelGlassDispersion;
vec3 modelGlassEnvironment(vec3 viewDirection, float roughness) {
  vec3 direction = transformDirectionByInverseViewMatrix(viewDirection, viewMatrix);
  #if defined(USE_ENVMAP) && defined(ENVMAP_TYPE_CUBE_UV)
    return textureCubeUV(envMap, envMapRotation * direction, roughness).rgb * envMapIntensity;
  #else
    // Without an environment a neutral horizon keeps the glass readable.
    return mix(vec3(.03), vec3(.9), smoothstep(-.35, .85, direction.y));
  #endif
}
vec3 modelGlassRefract(vec3 normal, vec3 viewDir, float eta, float roughness) {
  vec3 inside = refract(-viewDir, normal, 1.0 / eta);
  vec3 exitNormal = reflect(normal, inside);
  vec3 outside = refract(inside, -exitNormal, eta);
  if (dot(outside, outside) < 1e-6) outside = reflect(inside, -exitNormal);
  return modelGlassEnvironment(normalize(outside), roughness);
}
void main() {`;
const STUDIO_GLASS = `
  float modelGlassF0 = pow((modelGlassIOR - 1.0) / (modelGlassIOR + 1.0), 2.0);
  float modelGlassFresnel = modelGlassF0 + (1.0 - modelGlassF0) * pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 5.0);
  float modelGlassSpread = .1 * modelGlassDispersion;
  vec3 modelGlassThrough = vec3(
    modelGlassRefract(geometryNormal, geometryViewDir, modelGlassIOR * (1.0 - modelGlassSpread), material.roughness).r,
    modelGlassRefract(geometryNormal, geometryViewDir, modelGlassIOR, material.roughness).g,
    modelGlassRefract(geometryNormal, geometryViewDir, modelGlassIOR * (1.0 + modelGlassSpread), material.roughness).b);
  gl_FragColor = vec4(modelGlassThrough * diffuseColor.rgb * (1.0 - modelGlassFresnel) + totalSpecular + totalEmissiveRadiance, diffuseColor.a);
  #ifdef OPAQUE
    gl_FragColor.a = 1.0;
  #endif
`;
function glass(material, kind) {
  const uniforms = { modelGlassIOR: { value: 1.5 }, modelGlassBody: { value: .08 }, modelGlassDispersion: { value: 0 } };
  material.onBeforeCompile = program => {
    Object.assign(program.uniforms, uniforms);
    program.fragmentShader = program.fragmentShader
      .replace('void main() {', STUDIO_GLASS_PARS)
      .replace('#include <opaque_fragment>', kind === 'see-through' ? OVERLAY_GLASS : STUDIO_GLASS);
  };
  material.customProgramCacheKey = () => `floc-model-glass-${kind}-v1`;
  if (kind === 'see-through') {
    // Back faces render first, then front faces, so the far wall shows through the near one.
    material.transparent = true; material.depthWrite = false; material.side = THREE.DoubleSide; material.premultipliedAlpha = true;
  } else {
    material.transparent = false; material.depthWrite = true; material.opacity = 1;
  }
  return uniforms;
}
export function createModelMaterials(model, { spatial = false } = {}) {
  const bindings = [], variants = new Map(), owned = new Set(), tint = new THREE.Color();
  // Brushing and a varying film need a UV frame; materials on meshes without UVs skip them.
  const withoutUv = new Set();
  let gradient, gradientSteps, film, refraction;
  const scenePass = createScenePass();
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
  // One variant per lighting look; glass and edge glow are variants of the Physical look.
  const surfaceKind = style => style.look !== 'physical' ? style.look : style.glass !== 'none' ? style.glass : style.fresnelIntensity > 0 ? 'edge-glow' : 'physical';
  function variant(source, style, mesh) {
    const kind = mesh ? surfaceKind(style) : 'physical';
    const key = `${style.base}/${kind}${kind === 'refractive' ? `/${style.refractionSamples}` : ''}`;
    let table = variants.get(key);
    if (!table) { table = new Map(); variants.set(key, table); }
    let value = table.get(source);
    if (value) return value;
    const preserve = style.base !== 'custom', glassy = ['see-through', 'environment', 'refractive'].includes(kind);
    let material;
    if (!mesh) {
      material = source.clone();
      if (!preserve) {
        if ('map' in material) material.map = null;
        if ('alphaMap' in material) material.alphaMap = null;
        material.vertexColors = false; material.opacity = 1; material.transparent = false; material.alphaTest = 0; material.depthWrite = true;
      }
    } else if (kind === 'wireframe') material = adapt(source, new THREE.MeshBasicMaterial(), preserve);
    else if (kind === 'toon') material = adapt(source, new THREE.MeshToonMaterial(), preserve);
    else if (glassy) {
      material = adapt(source, new THREE.MeshPhysicalMaterial(), preserve);
      // Imported and tinted bases keep the imported surface finish, which glass reflects and refracts.
      if (preserve && source.isMeshStandardMaterial) for (const key of ['roughness', 'metalness', 'roughnessMap', 'metalnessMap']) material[key] = source[key];
    }
    else if (!preserve) material = adapt(source, new THREE.MeshPhysicalMaterial(), false);
    else if (kind === 'edge-glow' && !source.isMeshStandardMaterial) material = adapt(source, new THREE.MeshPhysicalMaterial(), true);
    else material = source.clone();
    if (kind === 'wireframe') material.wireframe = true;
    if (kind === 'refractive') {
      refraction ??= createModelRefraction();
      refraction.attach(material, style.refractionSamples);
    }
    value = { source, material, refractive: kind === 'refractive', rim: kind === 'edge-glow' ? fresnel(material) : null, glass: kind === 'see-through' || kind === 'environment' ? glass(material, kind) : null };
    bindScenePass(material, scenePass, { spatial, authoredOpaque: !['see-through', 'refractive'].includes(kind) && !material.transparent, lateAlpha: ['see-through', 'refractive'].includes(kind) || material.transmission > 0 });
    table.set(source, value); owned.add(material);
    return value;
  }
  function updateMaterial(value, style) {
    const { source, material, rim, glass } = value;
    if (material.color) {
      if (style.base === 'custom') material.color.set(style.color);
      else { material.color.copy(source.color ?? tint.set('#ffffff')); if (style.base === 'tinted') material.color.multiply(tint.set(style.color)); }
    }
    if (style.base === 'custom') {
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
    if (glass) {
      glass.modelGlassIOR.value = style.ior;
      glass.modelGlassBody.value = style.glassOpacity;
      glass.modelGlassDispersion.value = style.dispersion;
    }
    if (value.refractive) {
      // This surface is dielectric transmission. Other preset surface details stay inactive.
      material.roughness = style.roughness;
      material.ior = style.ior;
      material.metalness = 0; material.metalnessMap = null;
      material.clearcoat = 0; material.iridescence = 0; material.iridescenceThicknessMap = null;
      material.sheen = 0; material.anisotropy = 0;
      material.emissiveIntensity = 0; material.emissiveMap = null;
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
      refraction?.update(style);
    },
    setRefraction(source, rect, resolution, scale = 1, planeMatrix = null) { refraction?.input(source, rect, resolution, scale, planeMatrix); },
    setRefractionMask(value) { refraction?.mask(value); },
    setScenePass(pass, opacity = 1, id = 0, options = {}) {
      scenePass.set(pass, opacity, id);
      if (spatial) for (const { node } of bindings) for (const material of [node.material].flat()) setSceneMaterialPass(material, pass, options);
    },
    dispose() { for (const material of owned) material.dispose(); owned.clear(); variants.clear(); gradient?.dispose(); film?.dispose(); refraction?.dispose(); }
  };
}
