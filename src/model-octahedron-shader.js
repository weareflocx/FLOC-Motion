// Volumetric field by Sabo Sugi, Magical Octahedron. The field, octahedral
// clipping, optical integration and nonlinear output retain the authored math.
export const OCTAHEDRON_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 octaLocalPosition;
varying vec3 octaViewPosition;
void main() {
  octaLocalPosition = position;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  octaViewPosition = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

export const OCTAHEDRON_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform mat4 uCameraToLocal;
uniform bool uOrthographic;
uniform float uEvolutionTime;
uniform float uColorTime;
uniform float uOctahedronRadius;
uniform float uOctahedronHeight;
uniform float uDomainScale;
uniform float uPathScale;
uniform float uGlowDensity;
uniform float uVolumeOpacity;
uniform float uOrbBoost;
uniform float uEdgeGlow;
uniform float uBackEdgeGlow;
uniform int uVolumeSteps;
uniform vec3 uFractalTint;
uniform vec3 uFrontEdgeColor;
uniform vec3 uBackEdgeColor;
uniform vec3 uBaseTint;
varying vec3 octaLocalPosition;
varying vec3 octaViewPosition;
const int MAX_VOLUME_STEPS = 128;
vec3 getPathPosition(float z) {
    return vec3(
        12.0 * cos(z * vec2(0.1, 0.39)),
        z
    );
}

bool clipPlane(
    vec3 n,
    vec3 ro,
    vec3 rd,
    float radius,
    inout float tMin,
    inout float tMax
) {
    float denom = dot(n, rd);
    float numer = radius - dot(n, ro);

    if (abs(denom) < 1e-5) {
        return numer >= 0.0;
    }

    float t = numer / denom;

    if (denom < 0.0) {
        tMin = max(tMin, t);
    } else {
        tMax = min(tMax, t);
    }

    return tMin <= tMax;
}

vec2 rayOctahedron(vec3 ro, vec3 rd, float radius) {
    vec3 localRo = vec3(
        ro.x,
        ro.y / uOctahedronHeight,
        ro.z
    );

    vec3 localRd = vec3(
        rd.x,
        rd.y / uOctahedronHeight,
        rd.z
    );

    float tMin = -1e9;
    float tMax = 1e9;

    if (!clipPlane(vec3( 1.0,  1.0,  1.0), localRo, localRd, radius, tMin, tMax)) return vec2(-1.0);
    if (!clipPlane(vec3( 1.0,  1.0, -1.0), localRo, localRd, radius, tMin, tMax)) return vec2(-1.0);
    if (!clipPlane(vec3( 1.0, -1.0,  1.0), localRo, localRd, radius, tMin, tMax)) return vec2(-1.0);
    if (!clipPlane(vec3( 1.0, -1.0, -1.0), localRo, localRd, radius, tMin, tMax)) return vec2(-1.0);

    if (!clipPlane(vec3(-1.0,  1.0,  1.0), localRo, localRd, radius, tMin, tMax)) return vec2(-1.0);
    if (!clipPlane(vec3(-1.0,  1.0, -1.0), localRo, localRd, radius, tMin, tMax)) return vec2(-1.0);
    if (!clipPlane(vec3(-1.0, -1.0,  1.0), localRo, localRd, radius, tMin, tMax)) return vec2(-1.0);
    if (!clipPlane(vec3(-1.0, -1.0, -1.0), localRo, localRd, radius, tMin, tMax)) return vec2(-1.0);

    if (tMax < max(tMin, 0.0)) {
        return vec2(-1.0);
    }

    return vec2(tMin, tMax);
}

float octahedronCoord(vec3 p) {
    return
        abs(p.x) +
        abs(p.y) / uOctahedronHeight +
        abs(p.z);
}

vec3 octahedronNormal(vec3 p) {
    vec3 localNormal = vec3(
        p.x < 0.0 ? -1.0 : 1.0,
        p.y < 0.0 ? -1.0 : 1.0,
        p.z < 0.0 ? -1.0 : 1.0
    );

    vec3 worldNormal = vec3(
        localNormal.x,
        localNormal.y / uOctahedronHeight,
        localNormal.z
    );

    return normalize(worldNormal);
}

void sampleLayer(
    vec3 p,
    float animTime,
    float phase,
    out float tunnelGlow,
    out float orbGlow
) {
    vec3 q = p * uDomainScale;

    float domainZ =
        q.z * 0.16 +
        animTime +
        phase;

    vec3 rawPath = getPathPosition(domainZ);

    vec3 pathCenter = vec3(
        uPathScale * rawPath.x,
        uPathScale * rawPath.y,
        p.z + 0.06 * sin(domainZ * 0.07 + phase)
    );

    float baseRadius =
        0.26 +
        0.14 * cos(domainZ * 0.72 + phase);

    float tunnelStructure = min(
        length(
            p.xy -
            pathCenter.xy -
            vec2(0.14, 0.0)
        ),
        length((p - pathCenter).xy)
    );

    float largeScoops =
        abs(
            dot(
                sin(0.8 * q + phase),
                vec3(0.52)
            )
        ) / 0.1;

    float detailTexture =
        abs(
            dot(
                sin(animTime + 16.0 * p + phase),
                vec3(0.53)
            )
        ) / 3.7;

    float tunnelDist =
        baseRadius
        - tunnelStructure
        + 0.016 * largeScoops
        - 0.175 * detailTexture;

    tunnelGlow =
        6.7 /
        (0.085 + abs(tunnelDist));

    float wave = sin(uEvolutionTime * 0.7 + phase);

    vec3 orbCenter = vec3(
        pathCenter.x +
        0.07 * wave,

        pathCenter.y +
        0.11 * sin(
            uEvolutionTime * 0.9 +
            phase * 1.3
        ),

        0.42 * sin(
            animTime * 0.32 +
            1.6 +
            phase
        )
    );

    float orbDist =
        length(p - orbCenter) -
        0.022;

    orbGlow =
        -0.9 /
        (0.43 + max(orbDist, 0.0));
}

void sampleFractal(
    vec3 p,
    float animTime,
    float colorTime,
    float stepIndex,
    out vec3 emission,
    out float density
) {
    float tunnelA;
    float tunnelB;
    float tunnelC;

    float orbA;
    float orbB;
    float orbC;

    sampleLayer(
        p,
        animTime,
        0.0,
        tunnelA,
        orbA
    );

    sampleLayer(
        p.yzx,
        animTime,
        2.1,
        tunnelB,
        orbB
    );

    sampleLayer(
        p.zxy,
        animTime,
        4.2,
        tunnelC,
        orbC
    );

    float tunnelSum =
        0.40 * tunnelA +
        0.33 * tunnelB +
        0.27 * tunnelC;

    float orbSum =
        0.40 * orbA +
        0.34 * orbB +
        0.26 * orbC;

    vec3 q = p * uDomainScale;

    float globalDetail =
        abs(
            dot(
                sin(
                    q * 0.11 +
                    q.yzx * 0.07 +
                    q.zxy * 0.05 +
                    animTime
                ),
                vec3(0.3333)
            )
        ) / 0.3333;

    float colorDetail =
        abs(
            dot(
                sin(
                    q * 0.11 +
                    q.yzx * 0.07 +
                    q.zxy * 0.05 +
                    colorTime
                ),
                vec3(0.3333)
            )
        ) / 0.3333;

    float octCoord = octahedronCoord(p);

    float edgeFill =
        1.0 -
        smoothstep(
            uOctahedronRadius * 0.965,
            uOctahedronRadius,
            octCoord
        );

    float core =
        saturate(
            1.0 -
            octCoord /
            uOctahedronRadius
        );

    float volumeFill =
        0.40 +
        0.60 * pow(
            max(core, 0.0),
            0.45
        );

    float baseFill =
        0.75 +
        0.55 * globalDetail;

    density =
        (
            0.060 * baseFill +
            0.085 * tunnelSum +
            0.100 * orbSum
        ) *
        volumeFill *
        edgeFill;

    density = max(density, 0.0);

    vec3 palette =
        1.0 +
        cos(
            stepIndex * 0.7 +
            colorDetail * 1.4 +
            vec3(6.0, 1.0, 2.0)
        );

    emission =
        palette *
        uFractalTint *
        (
            0.20 * baseFill +
            0.28 * tunnelSum +
            uOrbBoost * 0.085 * orbSum
        ) *
        volumeFill *
        edgeFill;
}

vec3 renderVolume(vec3 ro, vec3 rd, vec2 hit) {
    float animTime =
        uEvolutionTime * 4.0 +
        5.0 +
        5.0 * sin(uEvolutionTime * 0.3);

    float colorTime =
        uColorTime +
        5.0;

    float tNear = max(hit.x, 0.0);
    float tFar = hit.y;

    float rayLength =
        max(
            tFar - tNear,
            0.0001
        );

    float stepSize =
        rayLength /
        float(max(uVolumeSteps, 1));

    float t =
        tNear +
        stepSize * 0.5;

    vec3 color = vec3(0.0);
    float transmittance = 1.0;

    for (int i = 0; i < MAX_VOLUME_STEPS; i++) {
        if (
            i >= uVolumeSteps ||
            t > tFar ||
            transmittance < 0.005
        ) {
            break;
        }

        vec3 p = ro + rd * t;

        vec3 emission;
        float density;

        float stepIndex =
            float(i) +
            43.0;

        sampleFractal(
            p,
            animTime,
            colorTime,
            stepIndex,
            emission,
            density
        );

        float opticalDepth =
            density *
            uGlowDensity *
            uVolumeOpacity *
            stepSize;

        float alpha =
            1.0 -
            exp(
                -max(
                    opticalDepth,
                    0.0
                )
            );

        color +=
            transmittance *
            emission *
            alpha;

        transmittance *=
            1.0 - alpha;

        t += stepSize;
    }

    vec3 frontPos =
        ro +
        rd * tNear;

    vec3 frontNormal =
        octahedronNormal(frontPos);

    float frontFresnel =
        pow(
            1.0 -
            saturate(
                dot(
                    frontNormal,
                    -rd
                )
            ),
            4.0
        );

    color +=
        uEdgeGlow *
        frontFresnel *
        uFrontEdgeColor;

    vec3 backPos =
        ro +
        rd * tFar;

    vec3 backNormal =
        octahedronNormal(backPos);

    float backFresnel =
        pow(
            1.0 -
            saturate(
                dot(
                    backNormal,
                    rd
                )
            ),
            3.0
        );

    color +=
        transmittance *
        uBackEdgeGlow *
        backFresnel *
        uBackEdgeColor;

    return color;
}

void main() {
  // The rasterized eight-face mesh supplies native depth, picking and coverage.
  // Scene-pass early returns happen before any volume ray marching.
  gl_FragDepth = gl_FragCoord.z;
  #include <logdepthbuf_fragment>
  vec4 diffuseColor = vec4(1.0);
  #include <alphahash_fragment>
  vec3 ro;
  vec3 rd;
  if (uOrthographic) {
    ro = (uCameraToLocal * vec4(octaViewPosition.xy, 0.0, 1.0)).xyz;
    rd = normalize(mat3(uCameraToLocal) * vec3(0.0, 0.0, -1.0));
  } else {
    ro = (uCameraToLocal * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    rd = normalize(octaLocalPosition - ro);
  }
  vec2 hit = rayOctahedron(ro, rd, uOctahedronRadius);
  if (hit.y <= 0.0) discard;
  vec3 color = renderVolume(ro, rd, hit);
  color = tanh(color * color * 0.05);
  color = pow(max(color, vec3(0.0)), vec3(0.4545));
  // Output is already display-referred, exactly once, as in the reference.
  gl_FragColor = vec4(color * uBaseTint, 1.0);
  #include <premultiplied_alpha_fragment>
}
`;
