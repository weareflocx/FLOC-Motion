import React from 'react';
import { Circle, Images, CaretDown, CaretUp, ImageSquare, MusicNotes, Play, Pause, SkipBack, Sparkle, TextT } from '@phosphor-icons/react';
import { IconButton } from '../controls.jsx';
import { TimelineTracks } from '../../timeline.jsx';

const layerIcons = { background: ImageSquare, carousel: Images, text: TextT, logo: Sparkle, music: MusicNotes, media: ImageSquare, model: Circle };
const timeLabel = (seconds, fps) => {
  const totalFrames = Math.floor(seconds * fps + 0.00001);
  const minutes = Math.floor(totalFrames / (fps * 60));
  const wholeSeconds = Math.floor(totalFrames / fps) % 60;
  const frames = totalFrames % fps;
  return [minutes, wholeSeconds, frames].map(value => value.toString().padStart(2, '0')).join(':');
};

export function TimelinePanel({ project, selected, time, playing, ready, timelineOpen, onTimeChange, onSetPlaying, onSetTimelineOpen, onSelect, onSeek, onPatch }) {
  const currentTime = timeLabel(time, project.fps);
  const totalTime = timeLabel(project.duration, project.fps);

  return (
    <section className="timeline-panel" aria-label="Timeline">
      <div className="transport">
        <div className="transport-controls">
          <IconButton label="Back to start" onClick={() => { onTimeChange(0); onSetPlaying(false); }}>
            <SkipBack size={18}/>
          </IconButton>
          <IconButton
            className="icon-button timeline-play"
            label={playing ? 'Pause preview' : 'Play preview'}
            onClick={() => onSetPlaying(value => !value)}
            disabled={!ready}
          >
            {playing ? <Pause size={20} weight="fill"/> : <Play size={20} weight="fill"/>}
          </IconButton>
          <span className="timecode" title="Minutes:seconds:frames" aria-label={`Current time ${currentTime} of ${totalTime}, minutes:seconds:frames`}>
            <span className="timecode-current">{currentTime}</span>
            <span className="timecode-total">/ {totalTime}</span>
          </span>
        </div>
        <input
          type="range"
          aria-label="Timeline playhead"
          min={0}
          max={project.duration - 0.001}
          step={0.01}
          value={time}
          onChange={event => { onSetPlaying(false); onTimeChange(Number(event.target.value)); }}
        />
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
          onSelect={id => { onSelect(id); onSetPlaying(false); }}
          onSeek={value => { onSeek(value); onSetPlaying(false); }}
          onCommit={onPatch}
        />
      </div>
    </section>
  );
}
