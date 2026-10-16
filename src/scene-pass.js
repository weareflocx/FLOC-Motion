import * as THREE from 'three';

export const SCENE_PASS = Object.freeze({ source: 0, opaque: 1, transparent: 2, pick: 3, all: 4, depth: 5, packedDepth: 6, opaqueDepth: 7 });
export const SCENE_PASS_PARS = `
uniform int flocScenePass;
uniform float flocSceneOpacity;
uniform vec3 flocScenePick;
uniform bool flocSceneOpaque;
uniform bool flocSceneLateAlpha;
vec4 flocPackDepth(float value) {
  vec3 encoded = fract(value * vec3(1.0, 255.0, 65025.0));
  encoded -= encoded.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);
  return vec4(encoded, 1.0);
}
void flocApplyScenePass() {
  if (flocScenePass == 0) return;
  float originalAlpha = gl_FragColor.a;
  float alpha = (flocSceneOpaque ? 1.0 : originalAlpha) * flocSceneOpacity;
  if (alpha <= 0.00001) discard;
  if ((flocScenePass == 1 || flocScenePass == 7) && alpha < 0.999) discard;
  if (flocScenePass == 2 && alpha >= 0.999) discard;
  if (flocScenePass == 3) {
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(flocScenePick, 1.0); return;
  }
  if (flocScenePass == 6) { gl_FragColor = flocPackDepth(gl_FragCoord.z); return; }
  #ifdef PREMULTIPLIED_ALPHA
    if (flocSceneOpaque) gl_FragColor.rgb /= max(originalAlpha, 0.00001);
    gl_FragColor.rgb *= flocSceneOpacity;
  #endif
  gl_FragColor.a = alpha;
}
`;
export const SCENE_PASS_FRAGMENT = 'flocApplyScenePass();';

export function createScenePass() {
  const uniforms = {
    flocScenePass: { value: SCENE_PASS.source },
    flocSceneOpacity: { value: 1 },
    flocScenePick: { value: new THREE.Vector3() }
  };
  return {
    uniforms,
    set(pass, opacity = 1, id = 0) {
      uniforms.flocScenePass.value = pass;
      uniforms.flocSceneOpacity.value = opacity;
      uniforms.flocScenePick.value.set((id & 255) / 255, ((id >>> 8) & 255) / 255, ((id >>> 16) & 255) / 255);
    }
  };
}

// Each model keeps its imported/PBR shader and material ownership. The common
// output hook supplies coverage/depth/ID passes without a second geometry model.
export function bindScenePass(material, state, { spatial = false, authoredOpaque = false, lateAlpha = false } = {}) {
  const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
  const opaque = { value: authoredOpaque }, late = { value: lateAlpha };
  material.onBeforeCompile = (program, renderer) => {
    compile.call(material, program, renderer);
    Object.assign(program.uniforms, state.uniforms, { flocSceneOpaque: opaque, flocSceneLateAlpha: late });
    program.fragmentShader = program.fragmentShader
      .replace('void main() {', SCENE_PASS_PARS + '\nvoid main() {')
      .replace('#include <premultiplied_alpha_fragment>', '#include <premultiplied_alpha_fragment>\n' + SCENE_PASS_FRAGMENT)
      .replace('// floc-refraction-mask-return', SCENE_PASS_FRAGMENT);
    // Depth and picking retain alpha maps/tests but skip PBR lighting work.
    program.fragmentShader = program.fragmentShader.replace('#include <alphahash_fragment>', `
      #include <alphahash_fragment>
      float flocEarlyAlpha = (flocSceneOpaque ? 1.0 : diffuseColor.a) * flocSceneOpacity;
      if (!flocSceneLateAlpha) {
        if ((flocScenePass == 1 || flocScenePass == 7) && flocEarlyAlpha < 0.999) discard;
        if (flocScenePass == 2 && flocEarlyAlpha >= 0.999) discard;
      }
      if (flocScenePass == 3 || flocScenePass == 5 || flocScenePass == 6 || flocScenePass == 7 && !flocSceneLateAlpha) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, diffuseColor.a);
        flocApplyScenePass(); return;
      }`);
  };
  material.customProgramCacheKey = () => `${cacheKey.call(material)}|floc-scene-pass-v2-${authoredOpaque ? 1 : 0}`;
  if (spatial) { material.transparent = true; material.forceSinglePass = true; }
  return material;
}

export function setSceneMaterialPass(material, pass, { replacement = false, erase = false, depthOnly = false } = {}) {
  material.depthTest = true;
  material.depthWrite = pass === SCENE_PASS.opaque || pass === SCENE_PASS.opaqueDepth || pass === SCENE_PASS.depth || pass === SCENE_PASS.packedDepth || pass === SCENE_PASS.pick;
  material.colorWrite = pass !== SCENE_PASS.depth && pass !== SCENE_PASS.opaqueDepth && !depthOnly;
  material.blending = material.depthWrite ? THREE.NoBlending : THREE.NormalBlending;
  if (replacement || erase) {
    material.blending = THREE.CustomBlending;
    material.blendEquation = material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrc = material.blendSrcAlpha = erase ? THREE.ZeroFactor : THREE.OneFactor;
    material.blendDst = material.blendDstAlpha = erase ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor;
  }
}
