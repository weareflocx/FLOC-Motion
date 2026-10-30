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
