// Evaluate the underlying procedural surface normal per fragment. The refined
// mesh still supplies silhouette, intersections, depth and selection geometry.
const VARYINGS = 'varying vec3 flocLocalPosition;\nvarying mat3 flocNormalFrame;\n';
export function bindSurfaceNormals(material, surface) {
  if (!surface || (!material.isMeshStandardMaterial && !material.isMeshToonMaterial)) return;
  const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = (program, renderer) => {
    compile.call(material, program, renderer);
    Object.assign(program.uniforms, surface.uniforms);
    program.vertexShader = program.vertexShader
      .replace('#include <common>', '#include <common>\n' + VARYINGS)
      .replace('#include <project_vertex>', 'flocLocalPosition = transformed;\nflocNormalFrame = normalMatrix;\n#include <project_vertex>');
    program.fragmentShader = program.fragmentShader
      .replace('#include <common>', '#include <common>\n' + VARYINGS + surface.pars)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        normal = normalize(flocNormalFrame * flocSurfaceNormal(flocLocalPosition));
        #ifdef FLIP_SIDED
          normal = -normal;
        #endif
        #ifdef DOUBLE_SIDED
          normal *= faceDirection;
        #endif
      `);
  };
  material.customProgramCacheKey = () => `${cacheKey.call(material)}/surface-${surface.key}`;
}

// Procedural sculptures may also place their vertices on the GPU. `displacement`
// supplies `pars` defining `vec3 flocDisplace(vec3 position, inout vec3 normal,
// inout vec3 color)`, its `uniforms` and a cache `key`. Every pass of the material
// (beauty, depth, pick, refraction mask) then shares one displaced surface; the
// CPU geometry is the undisplaced input and must carry conservative bounds.
// three r186 declares `vColor` as vec4 whenever any vertex color source is active.
const VERTEX_COLOR = 'defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )';
const DISPLACE_COLOR = `#if ${VERTEX_COLOR}\n  flocDisplacedColor = vColor.rgb;\n#endif`;
const STORE_COLOR = `#if ${VERTEX_COLOR}\n  vColor.rgb = flocDisplacedColor;\n#endif`;
export function bindSurfaceDisplacement(material, displacement) {
  if (!displacement || material.isShaderMaterial) return;
  const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = (program, renderer) => {
    compile.call(material, program, renderer);
    Object.assign(program.uniforms, displacement.uniforms);
    program.vertexShader = program.vertexShader
      .replace('#include <common>', '#include <common>\n' + displacement.pars)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vec3 flocDisplacedNormal = normal;
        vec3 flocDisplacedColor = vec3(1.0);
        ${DISPLACE_COLOR}
        vec3 flocDisplacedPosition = flocDisplace(position, flocDisplacedNormal, flocDisplacedColor);
        ${STORE_COLOR}`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = flocDisplacedNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = flocDisplacedPosition;');
  };
  material.customProgramCacheKey = () => `${cacheKey.call(material)}/displace-${displacement.key}`;
}
