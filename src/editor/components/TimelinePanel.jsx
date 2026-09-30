import React from 'react';
import { Circle, CaretDown, CaretUp, ImageSquare, MusicNotes, Play, Pause, SkipBack, Sparkle, TextT } from '@phosphor-icons/react';
import { IconButton } from '../controls.jsx';
import { TimelineTracks } from '../../timeline.jsx';

const layerIcons = { background: ImageSquare, carousel: Circle, text: TextT, logo: Sparkle, music: MusicNotes };
const timeLabel = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}.${Math.floor(seconds * 10 + 0.00001) % 10}`;

export function TimelinePanel({ project, selected, time, playing, ready, timelineOpen, onTimeChange, onSetPlaying, onSetTimelineOpen, onSelect, onSeek, onPatch }) {
  return <section className="timeline-panel" aria-label="Timeline"><div className="transport"><div className="transport-controls"><IconButton label="Back to start" onClick={() => { onTimeChange(0); onSetPlaying(false); }}><SkipBack size={18}/></IconButton><IconButton label={playing ? 'Pause preview' : 'Play preview'} onClick={() => onSetPlaying(value => !value)} disabled={!ready}>{playing ? <Pause size={20} weight="fill"/> : <Play size={20} weight="fill"/>}</IconButton><span className="timecode">{timeLabel(time)}<span>/ {timeLabel(project.duration)}</span></span></div><input type="range" aria-label="Timeline playhead" min={0} max={project.duration - 0.001} step={0.01} value={time} onChange={event => { onSetPlaying(false); onTimeChange(Number(event.target.value)); }}/><span className="timeline-label">{project.fps} FPS</span><button className="timeline-toggle" aria-expanded={timelineOpen} aria-controls="timeline-tracks" onClick={() => onSetTimelineOpen(value => !value)}>{timelineOpen ? <CaretDown size={14}/> : <CaretUp size={14}/>}Timeline</button></div><div id="timeline-tracks" hidden={!timelineOpen}><TimelineTracks project={project} selected={selected} time={time} icons={layerIcons} onSelect={id => { onSelect(id); onSetPlaying(false); }} onSeek={value => { onSeek(value); onSetPlaying(false); }} onCommit={onPatch}/></div></section>;
}
