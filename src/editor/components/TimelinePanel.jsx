import React, { useEffect, useState } from 'react';
import { Circle, Images, CaretDown, CaretUp, ImageSquare, MusicNotes, Sparkle, TextT, Timer, DiamondsFour } from '@phosphor-icons/react';
import { TimelineTracks } from '../../timeline.jsx';
import { evaluateChoreography } from '../../choreography.js';
import { ChoreographyControls, supportsChoreography } from './ChoreographyControls.jsx';
import { TimelineTimingControls } from './TimelineTimingControls.jsx';
import '../timeline-controls.css';

const layerIcons = { background: ImageSquare, carousel: Images, text: TextT, logo: Sparkle, music: MusicNotes, media: ImageSquare, model: Circle };
export function TimelinePanel({ project, selected, time, timelineOpen, onTimeChange, onSetPlaying, onSetTimelineOpen, onSelect, onSeek, onPatch, onEditLayer = onPatch }) {
  const [context, setContext] = useState({ layerId: selected, mode: 'timing' });
  useEffect(() => { setContext({ layerId: selected, mode: 'timing' }); }, [selected]);
  const layer = project.layers.find(item => item.id === selected) ?? project.layers[0];
  const mode = context.layerId === layer?.id && supportsChoreography(layer) ? context.mode : 'timing';
  const editTiming = (id, fields) => { onSetPlaying(false); onPatch(id, fields); };
  const seekState = value => { onSeek(value); onSetPlaying(false); };
  const selectLayer = id => { setContext({ layerId: id, mode: 'timing' }); onSelect(id); onSetPlaying(false); };
  const selectState = id => { setContext({ layerId: id, mode: 'choreography' }); onSelect(id); onSetPlaying(false); };

  return (
    <section className="timeline-panel" aria-label="Timeline">
      <div className={`transport ${timelineOpen ? 'timeline-expanded' : ''}`}>
        {timelineOpen ? <div className="timeline-context" aria-label="Timeline layer controls">
          {layer ? <>
            <div className="segmented timeline-modes" role="group" aria-label="Timeline editing mode">
              <button type="button" aria-label="Timing" title="Timing: edit when this layer starts, ends and fades" aria-pressed={mode === 'timing'} className={mode === 'timing' ? 'selected' : ''} onClick={() => setContext({ layerId: layer.id, mode: 'timing' })}><Timer size={16} aria-hidden="true"/></button>
              {supportsChoreography(layer) && <button type="button" aria-label="Choreography" title="Choreography: edit motion states and their transitions over time" aria-pressed={mode === 'choreography'} className={mode === 'choreography' ? 'selected' : ''} onClick={() => { setContext({ layerId: layer.id, mode: 'choreography' }); onSetPlaying(false); }}><DiamondsFour size={16} aria-hidden="true"/></button>}
            </div>
            {layer.locked && <span className="timeline-context-hint">Locked</span>}
            {mode === 'timing' ? <TimelineTimingControls project={project} layer={layer} onPatch={editTiming}/> : <ChoreographyControls project={project} layer={evaluateChoreography(layer, time)} time={time} onPatch={onEditLayer} onSeek={seekState}/>}
          </> : <span className="timeline-context-hint">Select a layer to edit timing</span>}
        </div> : <input
          type="range"
          aria-label="Timeline playhead"
          min={0}
          max={project.duration - 0.001}
          step={0.01}
          value={time}
          onChange={event => { onSetPlaying(false); onTimeChange(Number(event.target.value)); }}
        />}
        <span className="timeline-label">{project.fps} FPS</span>
        <button
          className="timeline-toggle"
          aria-expanded={timelineOpen}
          aria-controls="timeline-tracks"
          onClick={() => onSetTimelineOpen(value => !value)}
        >
          {timelineOpen ? <CaretDown size={14}/> : <CaretUp size={14}/>}
          Timeline
        </button>
      </div>
      <div id="timeline-tracks" hidden={!timelineOpen}>
        <TimelineTracks
          project={project}
          selected={selected}
          time={time}
          icons={layerIcons}
          mode={mode}
          onSelect={selectLayer}
          onSelectState={selectState}
          onSeek={value => { onSeek(value); onSetPlaying(false); }}
          onCommit={onPatch}
        />
      </div>
    </section>
  );
}
