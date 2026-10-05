import React from 'react';
import { alignmentPlacement, DEFAULT_LAYOUT, safeArea, spacingGuides } from '../layout.js';

export function PlacementGuides({ layout = DEFAULT_LAYOUT, rect, targets = [], dimensions, lines, scale = 1, fontSize }) {
  if (!layout?.guides && !lines?.length) return null;
  const area = safeArea(layout);
  const guides = lines ?? (rect ? alignmentPlacement(rect, rect, targets, layout, { x: .001, y: .001 }).guides : []);
  const gaps = rect ? spacingGuides(rect, targets, layout) : [];
  return <div className="placement-guides" style={fontSize ? { fontSize } : undefined} aria-hidden="true">
    {layout.enabled && <div className="safe-area-outline" style={{ left: `${area.x}%`, top: `${area.y}%`, width: `${area.width}%`, height: `${area.height}%` }}/>}
    {guides.map((line, i) => <i key={`line-${i}`} className={`alignment-guide ${line.axis}`} style={{ [line.axis === 'x' ? 'left' : 'top']: `${line.value}%` }}/>) }
    {gaps.map((gap, i) => { const pixels = (gap.end - gap.start) / 100 * dimensions[gap.axis === 'x' ? 0 : 1]; return <span key={`gap-${i}`} className={`spacing-guide ${gap.axis}`} style={gap.axis === 'x' ? { left: `${gap.start}%`, top: `${gap.at}%`, width: `${gap.end - gap.start}%` } : { top: `${gap.start}%`, left: `${gap.at}%`, height: `${gap.end - gap.start}%` }}>{pixels * scale >= 32 && <small>{Math.round(pixels)} px</small>}</span>; })}
  </div>;
}
