import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// Browser-only, locally authored self-contained GLB. No downloads or user assets.
// Returns an ArrayBuffer; callers can upload it or create a disposable Blob URL.
export async function createModelRenderingFixture({ unlit = false, vertexColors = false, opacity = 1, cube = false, uv = true } = {}) {
  // A unit cube reaches √3 half-extents along its diagonals: fixed framing crops it.
  // Its Grow clip scales it to 1.8× mid-clip.
  if (cube) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#c8c8c8', roughness: .5 })); box.name = 'Cube';
    if (!uv) box.geometry.deleteAttribute('uv');
    const grow = new THREE.AnimationClip('Grow', 2, [new THREE.VectorKeyframeTrack('Cube.scale', [0, 1, 2], [1, 1, 1, 1.8, 1.8, 1.8, 1, 1, 1])]);
    try { return await new GLTFExporter().parseAsync(box, { binary: true, animations: [grow] }); }
    finally { box.geometry.dispose(); box.material.dispose(); }
  }
  const root = new THREE.Group(); root.name = 'FixtureRoot';
  const image = document.createElement('canvas'); image.width = image.height = 16;
  const context = image.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, 16, 16);
  context.fillStyle = '#101010'; context.fillRect(0, 0, 8, 8); context.fillRect(8, 8, 8, 8);
  const texture = new THREE.CanvasTexture(image); texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.NearestFilter;
  const material = unlit ? new THREE.MeshBasicMaterial({ color: '#d9bc91', map: texture }) : new THREE.MeshStandardMaterial({ color: '#d9bc91', map: texture, roughness: .48 });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(.8, 24, 16), material); sphere.name = 'AnimatedSphere'; root.add(sphere);
  if (vertexColors) {
    const colors = new Float32Array(sphere.geometry.attributes.position.count * 3);
    for (let i = 2; i < colors.length; i += 3) colors[i] = 1;
    sphere.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    material.vertexColors = true;
  }
  material.opacity = opacity; material.transparent = opacity < 1;
  const marker = new THREE.Mesh(new THREE.BoxGeometry(.3, .6, .25), new THREE.MeshStandardMaterial({ color: '#2573b0', roughness: .4 })); marker.position.set(.85, .18, .12); root.add(marker);
  const clips = [
    new THREE.AnimationClip('Turn', 2, [new THREE.QuaternionKeyframeTrack('AnimatedSphere.quaternion', [0, 1, 2], [0, 0, 0, 1, 0, Math.sin(.65), 0, Math.cos(.65), 0, 0, 0, 1])]),
    new THREE.AnimationClip('Stretch', 2, [new THREE.VectorKeyframeTrack('AnimatedSphere.scale', [0, 1, 2], [1, 1, 1, 1, .55, 1, 1, 1, 1])])
  ];
  try { return await new GLTFExporter().parseAsync(root, { binary: true, animations: clips }); }
  finally { texture.dispose(); material.dispose(); sphere.geometry.dispose(); marker.material.dispose(); marker.geometry.dispose(); }
}
