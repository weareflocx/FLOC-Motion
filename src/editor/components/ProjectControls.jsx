import React from 'react';
import { FORMAT_LABELS, PROJECT_LIMITS } from '../../project.js';
import { DEFAULT_LAYOUT } from '../../layout.js';
import { Field, NumberField, Section } from '../controls.jsx';
import { FormatVersionsControls } from './FormatVersionsControls.jsx';
import { LayoutControls } from './LayoutControls.jsx';

// With nothing selected, the inspector edits the composition itself: output format,
// duration, frame rate, safe margins and guides.
export function ProjectControls({ project, onChangeProject, onChangeDuration, onChangeFps }) {
  const layout = project.layout ?? DEFAULT_LAYOUT;
  return <>
    <div className="section-heading"><h2>Composition</h2></div>
    <p className="helper">{project.layers.length ? 'Select a layer on the canvas or in Layers to edit it.' : 'Add a layer to start composing.'}</p>
    <Section title="Canvas" defaultOpen detail={`${FORMAT_LABELS[project.format]} · ${project.duration} s · ${project.fps} fps`}>
      <FormatVersionsControls project={project} onChangeProject={onChangeProject}/>
      <NumberField scale={1000} suffix="ms" label="Duration" value={project.duration} min={PROJECT_LIMITS.minDuration} max={PROJECT_LIMITS.maxDuration} onChange={onChangeDuration}/>
      <Field label="Frame rate"><select aria-label="Frame rate" value={project.fps} onChange={event => onChangeFps(Number(event.target.value))}><option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></select></Field>
    </Section>
    <LayoutControls project={project} detail={[layout.enabled && `Margins ${layout.marginX} / ${layout.marginY}%`, layout.guides && 'Guides'].filter(Boolean).join(' · ') || 'Off'} onChange={onChangeProject}/>
  </>;
}
