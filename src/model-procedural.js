// UV-free coordinates shared by procedural mesh materials. Capture after skinning,
// morphs and displacement; include batching/instancing just like project_vertex.
export const PROCEDURAL_VERTEX_PARS = `
uniform mat4 modelSurfaceWorldToLocal;
varying vec3 modelSurfacePosition;
`;
export const PROCEDURAL_VERTEX = `
vec4 modelSurfacePoint = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  modelSurfacePoint = batchingMatrix * modelSurfacePoint;
#endif
#ifdef USE_INSTANCING
  modelSurfacePoint = instanceMatrix * modelSurfacePoint;
#endif
modelSurfacePosition = (modelSurfaceWorldToLocal * modelMatrix * modelSurfacePoint).xyz;
#include <project_vertex>
`;
