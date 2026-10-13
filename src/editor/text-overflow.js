import { FORMATS } from '../project.js';
import { stageMarkup } from '../scene.js';
import { fontFamily } from '../fonts.js';
import { evaluateChoreography } from '../choreography.js';
import { rotatedTextBounds, textOverflows } from '../layout.js';
import { contentFields } from '../template-content.js';

// Lays out each visible text content field with the stage markup that preview and export
// share, at its base pose and every choreography state, and reports the ones that do not
// fit the safe area (or the frame, without one). Measured offscreen at the format's size.
export async function textOverflowIssues(project, doc = globalThis.document) {
  const layers = contentFields(project).filter(layer => layer.type === 'text' && layer.visible);
  if (!layers.length) return [];
  const [width, height] = FORMATS[project.format];
  await Promise.all(layers.map(layer => doc.fonts?.load(`${layer.weight} 16px "${fontFamily(layer.font)}"`).catch(() => {})));
  const host = doc.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:${-2 * width}px;top:0;width:${width}px;height:${height}px;visibility:hidden;pointer-events:none;overflow:hidden`;
  doc.body.appendChild(host);
  try {
    const issues = [];
    for (const layer of layers) {
      for (const time of [layer.start, ...(layer.choreography ?? []).map(state => layer.start + state.time)]) {
        const pose = evaluateChoreography(layer, time);
        host.innerHTML = stageMarkup({ ...project, layers: [pose] });
        const node = host.firstElementChild;
        if (!textOverflows(pose, rotatedTextBounds(node.offsetWidth, node.offsetHeight, pose.roll, width, height), project.layout)) continue;
        const { id, label } = layer.contentField;
        issues.push({ kind: 'overflow', fieldId: id, layerId: layer.id, message: project.layout?.enabled ? `${label} does not fit the safe area.` : `${label} runs past the frame.` });
        break;
      }
    }
    return issues;
  } finally { host.remove(); }
}
