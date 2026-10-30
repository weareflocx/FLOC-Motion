// KIFS crystal folding, spectral samples and facet lines adapted from Sabo Sugi:
// https://codepen.io/sabosugi/pen/rajpbOE (Quantum Cube).
// The mesh supplies silhouette/depth. Interior sampling uses a bounded local
// volume and authored depth, not exact ray/mesh exits through arbitrary cavities.
export const QUANTUM_PARS = `
uniform mat4 modelSurfaceWorldToLocal;
varying vec3 modelSurfacePosition;
uniform float modelQuantumTime;
uniform float modelQuantumMorphSpeed;
uniform float modelQuantumScale;
uniform float modelQuantumDepth;
uniform float modelQuantumIntensity;
uniform float modelQuantumRim;
uniform vec3 modelQuantumColor1;
uniform vec3 modelQuantumColor2;
uniform vec3 modelQuantumColor3;
mat2 modelQuantumRotate(float angle) {
  float s = sin(angle), c = cos(angle);
  return mat2(c, -s, s, c);
}
vec3 modelQuantumCrystal(vec3 p, bool top, float lineWidth) {
  vec3 q = p * 0.1;
  q.xz *= modelQuantumRotate(modelQuantumTime * 0.08);
  q.yz *= modelQuantumRotate(modelQuantumTime * 0.05);
  float weight = 0.3;
  vec3 color = vec3(0.0);
  float morphTime = modelQuantumTime * modelQuantumMorphSpeed;
  for (int i = 0; i < 8; i++) {
    float layer = float(i);
    vec3 offset = vec3(0.14, 0.22, 0.14) + sin(morphTime * 0.4 + layer * 1.5) * 0.003;
    q = abs(q) - offset;
    if (q.x < q.y) q.xy = q.yx;
    if (q.x < q.z) q.xz = q.zx;
    if (q.y < q.z) q.yz = q.zy;
    q.xy *= modelQuantumRotate(0.785 + layer * 0.02 + sin(morphTime * 0.3 + layer) * 0.015);
    q.xz *= modelQuantumRotate(0.35 + cos(morphTime * 0.25 - layer) * 0.015);
    q = q * vec3(1.85, 1.85, 1.65) - vec3(0.02, 0.08, 0.04);
    weight *= modelQuantumScale;
    float edge = 1.0 - smoothstep(0.0, 0.12, abs(max(q.x, max(q.y, q.z))) - 0.01);
    vec3 tint = i % 3 == 0 ? modelQuantumColor1 : i % 3 == 1 ? modelQuantumColor2 : modelQuantumColor3;
    float highlight = smoothstep(0.8, 1.0, sin(q.y * -6.5));
    tint += vec3(4.6, 0.95, 0.9) * highlight * 8.3;
    color += tint * edge / weight;
  }
  float slice = (top ? p.x : p.y) * 65.9;
  float lines = mix(1.75, 0.1, smoothstep(0.60 - lineWidth, 0.60 + lineWidth + 1e-5, fract(slice)));
  return (color * 79.1 + vec3(0.0, 0.5, 1.0) * exp(-length(p) * 20.1) * 0.25) * lines;
}
`;
export const QUANTUM_GLASS = `
  float modelQuantumNdv = saturate(dot(geometryNormal, geometryViewDir));
  vec3 modelQuantumInside = refract(-geometryViewDir, geometryNormal, 1.0 / modelGlassIOR);
  if (dot(modelQuantumInside, modelQuantumInside) < 1e-6) modelQuantumInside = -geometryViewDir;
  vec3 modelQuantumWorldRay = transformDirectionByInverseViewMatrix(modelQuantumInside, viewMatrix);
  vec3 modelQuantumRay = normalize((modelSurfaceWorldToLocal * vec4(modelQuantumWorldRay, 0.0)).xyz);
  vec3 modelQuantumLocalNormal = abs(normalize(cross(dFdx(modelSurfacePosition), dFdy(modelSurfacePosition))));
  bool modelQuantumTop = modelQuantumLocalNormal.y > modelQuantumLocalNormal.x && modelQuantumLocalNormal.y > modelQuantumLocalNormal.z;
  float modelQuantumSlice = (modelQuantumTop ? modelSurfacePosition.x : modelSurfacePosition.y) * 0.4 * 65.9;
  float modelQuantumLineWidth = min(0.19, fwidth(modelQuantumSlice));
  vec3 modelQuantumVolume = vec3(0.0);
  if (modelQuantumDepth > 0.0 && modelQuantumIntensity > 0.0) {
    float modelQuantumStep = 2.0 * modelQuantumDepth / 23.0;
    float modelQuantumSpread = modelGlassDispersion * 0.1;
    for (int j = 0; j < 23; j++) {
      vec3 localPoint = modelSurfacePosition + modelQuantumRay * ((float(j) + 0.5) * modelQuantumStep);
      if (max(abs(localPoint.x), max(abs(localPoint.y), abs(localPoint.z))) > 1.01) break;
      vec3 p = localPoint * 0.4;
      vec3 sampleColor;
      if (modelQuantumSpread > 0.0) {
        vec3 spread = vec3(modelQuantumSpread, 0.0, 0.0);
        sampleColor = vec3(
          modelQuantumCrystal(p + spread, modelQuantumTop, modelQuantumLineWidth).r,
          modelQuantumCrystal(p, modelQuantumTop, modelQuantumLineWidth).g,
          modelQuantumCrystal(p - spread, modelQuantumTop, modelQuantumLineWidth).b);
      } else sampleColor = modelQuantumCrystal(p, modelQuantumTop, modelQuantumLineWidth);
      modelQuantumVolume += sampleColor * 0.0452;
    }
  }
  float modelQuantumFresnel = pow(1.0 - modelQuantumNdv, 4.0);
  vec3 modelQuantumColor = modelQuantumVolume * modelQuantumIntensity * diffuseColor.rgb;
  modelQuantumColor = mix(modelQuantumColor, vec3(0.2, 0.65, 1.0), modelQuantumFresnel * 0.45);
  modelQuantumColor += totalSpecular + vec3(0.0, 1.75, 1.0) * modelQuantumFresnel * modelQuantumRim;
  gl_FragColor = vec4(modelQuantumColor, 1.0);
`;
