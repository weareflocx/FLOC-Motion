// Thin-film palette and moving sweep adapted from Sabo Sugi's Iridescence Morph Cube:
// https://codepen.io/editor/sabosugi/pen/01a11bb7-b78e-704f-9622-e14dfc85a704
// Mesh shading only: the source's SDF geometry and interior ray march are not used.
export const HOLOGRAPHIC_PARS = `
varying vec3 modelSurfacePosition;
uniform float modelHoloPhase;
uniform float modelHoloSweepY;
uniform float modelHoloIntensity;
uniform float modelHoloScale;
uniform float modelHoloSweep;
vec3 modelHoloFilm(float ndv) {
  float cosT = sqrt(max(1.0 - (1.0 - ndv * ndv) / (1.4 * 1.4), 0.0));
  float thickness = 1.0 + 0.4 * sin(dot(modelSurfacePosition, vec3(2.1, 1.7, 2.6)));
  float phase = (thickness * modelHoloScale + modelHoloPhase) * cosT;
  vec3 film = 0.5 + 0.5 * cos(6.28318530718 * (phase + vec3(0.0, 0.33, 0.67)));
  film *= mix(vec3(1.0), vec3(0.8, 0.95, 1.2), 0.4);
  return 2.0 * film * film + 0.15;
}
vec3 modelHoloExit(vec3 inside, vec3 exitNormal, float ior, float roughness) {
  vec3 outside = refract(inside, -exitNormal, ior);
  if (dot(outside, outside) < 1e-6) outside = reflect(inside, -exitNormal);
  return modelGlassEnvironment(normalize(outside), roughness);
}
`;
// Reuses the environment glass's sphere-exit approximation, not a claim of exact
// interior tracing on arbitrary meshes. Output remains opaque inside the mesh.
export const HOLOGRAPHIC_GLASS = `
  float modelHoloNdv = saturate(dot(geometryNormal, geometryViewDir));
  float modelGlassF0 = pow((modelGlassIOR - 1.0) / (modelGlassIOR + 1.0), 2.0);
  float modelGlassFresnel = modelGlassF0 + (1.0 - modelGlassF0) * pow(1.0 - modelHoloNdv, 5.0);
  // One entry ray, then spectral separation at the exit, as in the reference.
  // A tangent unit sphere supplies the exit normal and chord length on meshes.
  vec3 modelHoloInside = refract(-geometryViewDir, geometryNormal, 1.0 / modelGlassIOR);
  vec3 modelHoloExitNormal = reflect(geometryNormal, modelHoloInside);
  float modelHoloThickness = max(0.0, -2.0 * dot(geometryNormal, modelHoloInside));
  float modelGlassSpread = .1 * modelGlassDispersion;
  vec3 modelGlassThrough = vec3(
    modelHoloExit(modelHoloInside, modelHoloExitNormal, max(1.0, modelGlassIOR - modelGlassSpread), material.roughness).r,
    modelHoloExit(modelHoloInside, modelHoloExitNormal, modelGlassIOR, material.roughness).g,
    modelHoloExit(modelHoloInside, modelHoloExitNormal, modelGlassIOR + modelGlassSpread, material.roughness).b);
  vec3 modelHoloFilmColor = modelHoloFilm(modelHoloNdv);
  vec3 modelHoloTint = mix(vec3(1.0), modelHoloFilmColor, modelHoloIntensity);
  vec3 modelHoloReflection = modelGlassEnvironment(reflect(-geometryViewDir, geometryNormal), material.roughness) * modelHoloTint;
  modelGlassThrough *= exp(-vec3(0.9, 0.35, 0.22) * modelHoloThickness) * diffuseColor.rgb;
  vec3 modelHoloColor = mix(modelGlassThrough, modelHoloReflection, modelGlassFresnel);
  // Environment reflection is already above. totalSpecular would add it twice.
  modelHoloColor += reflectedLight.directSpecular * modelHoloTint;
  float modelHoloLight = saturate(max(reflectedLight.directDiffuse.r, max(reflectedLight.directDiffuse.g, reflectedLight.directDiffuse.b)) * PI);
  modelHoloColor += modelHoloFilmColor * modelHoloIntensity * 0.08 * (0.3 + modelHoloLight);
  float modelHoloBand = modelSurfacePosition.y - modelHoloSweepY;
  modelHoloColor += modelHoloFilmColor * exp(-modelHoloBand * modelHoloBand * 60.0) * modelHoloSweep;
  gl_FragColor = vec4(modelHoloColor, 1.0);
`;
