import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// PMREM is renderer/context-local: never share GPU targets through the source cache.
export function createModelEnvironment(renderer, scene) {
  let target;
  function clear() { scene.environment = null; target?.dispose(); target = undefined; }
  return {
    update(style) {
      const active = style.environment === 'studio' && style.shader !== 'toon' && style.shader !== 'wireframe';
      if (active && !target) {
        const room = new RoomEnvironment();
        let generator;
        const previousTarget = renderer.getRenderTarget();
        try {
          generator = new THREE.PMREMGenerator(renderer);
          target = generator.fromScene(room, .04);
        } catch (error) {
          // fromScene may fail while its output target is still bound.
          const failedTarget = renderer.getRenderTarget();
          if (failedTarget && failedTarget !== previousTarget) failedTarget.dispose();
          throw error;
        } finally { renderer.setRenderTarget(previousTarget); room.dispose(); generator?.dispose(); }
      }
      scene.environment = active ? target.texture : null;
      scene.environmentIntensity = style.environmentIntensity;
      scene.environmentRotation.set(0, THREE.MathUtils.degToRad(style.environmentRotation), 0);
    },
    invalidate: clear,
    dispose: clear
  };
}
