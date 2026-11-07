// Spectral chrome and generated studio from Sabo Sugi's Abstract Chrome Liquid:
// https://codepen.io/editor/sabosugi/pen/01a1777c-c5ba-7db4-978a-e60cd0100f42
// Materials and illumination are independent of the procedural ribbon geometry.
export const LIQUID_STUDIO = `
float liquidPanel(vec3 d, vec3 c, vec3 up, vec2 size, float soft) {
  float z = dot(d, c);
  if (z <= 0.0) return 0.0;
  vec3 right = normalize(cross(c, up));
  vec2 uv = vec2(dot(d, right), dot(d, cross(right, c))) / z;
  vec2 edge = abs(uv) - size;
  return 1.0 - smoothstep(-soft, soft, max(edge.x, edge.y));
}
vec3 liquidStudio(vec3 d) {
  float sky = smoothstep(-0.30, 0.45, d.y);
  vec3 color = mix(vec3(0.004, 0.005, 0.007), vec3(0.17, 0.21, 0.27), sky);
  color *= 0.6 + 0.4 * max(dot(d, normalize(vec3(0.3, 0.4, 0.85))), 0.0);
  float azimuth = atan(d.z, d.x);
  float rings = exp(-abs(d.y - 0.05) * 60.0)
    + 0.7 * exp(-abs(d.y - 0.42 - 0.06 * sin(3.0 * azimuth)) * 50.0)
    + 0.4 * exp(-abs(d.y + 0.28 - 0.04 * sin(2.0 * azimuth + 1.0)) * 50.0);
  color += vec3(0.80, 0.88, 1.0) * 0.45 * rings;
  color += vec3(1.0, 0.96, 0.90) * 5.0 * liquidPanel(d, normalize(vec3(0.55, 0.60, 0.60)), vec3(0, 1, 0), vec2(0.35, 0.22), 0.06);
  color += vec3(0.85, 0.90, 1.0) * 2.6 * liquidPanel(d, normalize(vec3(-0.85, 0.10, 0.45)), vec3(0, 1, 0), vec2(0.07, 0.60), 0.03);
  color += vec3(0.90, 0.92, 0.95) * 2.4 * liquidPanel(d, normalize(vec3(0.95, -0.05, 0.25)), vec3(0, 1, 0), vec2(0.06, 0.50), 0.03);
  color += vec3(0.50, 0.56, 0.64) * 0.5 * liquidPanel(d, normalize(vec3(0.15, -0.75, 0.55)), vec3(0, 0, 1), vec2(0.60, 0.35), 0.25);
  color += vec3(1.0, 0.55, 0.25) * 0.8 * liquidPanel(d, normalize(vec3(-0.55, 0.20, -0.80)), vec3(0, 1, 0), vec2(0.20, 0.30), 0.10);
  return color;
}
`;
export const LIQUID_PARS = `
uniform float modelLiquidReflectance;
uniform float modelLiquidIorSpread;
uniform vec3 modelLiquidTint;
vec3 modelLiquidSpectrum(float x) {
  return 0.1 + clamp(vec3(1.0 - 1.8 * x, 1.0 - 2.5 * abs(x - 0.6), 1.8 * x - 0.8), 0.0, 1.0);
}
`;
export const LIQUID_GLASS = `
  vec3 modelLiquidRay = -geometryViewDir;
  float modelLiquidGrazing = clamp(1.0 + dot(modelLiquidRay, geometryNormal), 0.0, 1.0);
  float modelLiquidFresnel = modelLiquidReflectance + (1.0 - modelLiquidReflectance) * pow(modelLiquidGrazing, 5.0);
  vec3 modelLiquidTangent = modelLiquidRay - geometryNormal * dot(modelLiquidRay, geometryNormal);
  modelLiquidTangent *= length(modelLiquidTangent);
  vec3 modelLiquidReflection = vec3(0.0), modelLiquidTransmission = vec3(0.0), modelLiquidWeights = vec3(0.0);
  #ifndef MODEL_LIQUID_DISPERSED
    vec3 modelLiquidReflected = modelGlassEnvironment(reflect(modelLiquidRay, normalize(geometryNormal)), material.roughness);
  #endif
  #ifndef MODEL_LIQUID_SPREAD
    vec3 modelLiquidRefracted = refract(modelLiquidRay, geometryNormal, 1.0 / modelGlassIOR);
    if (dot(modelLiquidRefracted, modelLiquidRefracted) < 0.5) modelLiquidRefracted = reflect(modelLiquidRay, geometryNormal);
    vec3 modelLiquidTransmitted = modelGlassEnvironment(modelLiquidRefracted, material.roughness);
  #endif
  for (int i = 0; i < 10; i++) {
    float x = (float(i) + 0.5) / 10.0;
    vec3 weight = modelLiquidSpectrum(x);
    #ifdef MODEL_LIQUID_DISPERSED
      vec3 spectralNormal = normalize(geometryNormal + modelLiquidTangent * modelGlassDispersion * (x - 0.5));
      modelLiquidReflection += modelGlassEnvironment(reflect(modelLiquidRay, spectralNormal), material.roughness) * weight;
    #else
      modelLiquidReflection += modelLiquidReflected * weight;
    #endif
    #ifdef MODEL_LIQUID_SPREAD
      vec3 direction = refract(modelLiquidRay, geometryNormal, 1.0 / (modelGlassIOR + modelLiquidIorSpread * (x - 0.5)));
      if (dot(direction, direction) < 0.5) direction = reflect(modelLiquidRay, geometryNormal);
      modelLiquidTransmission += modelGlassEnvironment(direction, material.roughness) * weight;
    #else
      modelLiquidTransmission += modelLiquidTransmitted * weight;
    #endif
    modelLiquidWeights += weight;
  }
  // The reference deliberately allows F0 > 1 as an artistic chrome response.
  vec3 modelLiquidColor = (modelLiquidFresnel * modelLiquidReflection
    + (1.0 - modelLiquidFresnel) * modelLiquidTint * modelLiquidTransmission) / modelLiquidWeights;
  gl_FragColor = vec4(max(modelLiquidColor, vec3(0.0)) * diffuseColor.rgb, 1.0);
`;
