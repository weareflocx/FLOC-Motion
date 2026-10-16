import React, { useEffect, useRef, useState } from 'react';
import { DotsNine, Circle, Images, CaretDown, CaretUp, ImageSquare, MusicNotes, Sparkle, TextT } from '@phosphor-icons/react';
import { TimelineTracks } from '../../timeline.jsx';
import { evaluateChoreography } from '../../choreography.js';
import { ChoreographyControls, supportsChoreography } from './ChoreographyControls.jsx';
import { TimelineControlsPopover } from './TimelineControlsPopover.jsx';
import { usePlaybackTime } from '../usePlayback.js';
import { ASSET_DRAG_TYPE, assetKind } from '../media-library.js';
import { timeAtPointer } from '../../editor-controls.js';
import '../timeline-controls.css';

const layerIcons = { background: ImageSquare, carousel: Images, text: TextT, logo: Sparkle, music: MusicNotes, media: ImageSquare, model: Circle, effect: DotsNine };
// An open choreography popover follows every frame so Save state captures the pose on screen.
function PlayheadChoreographyControls({ clock, layer, ...props }) {
  const time = usePlaybackTime(clock);
  return <ChoreographyControls {...props} layer={evaluateChoreography(layer, time)} time={time}/>;
}
export function TimelinePanel({ project, selected, clock, time, timelineOpen, onTimeChange, onSetPlaying, onSetTimelineOpen, onSelect, onSeek, onPatch, onEditLayer = onPatch, onAddAudio, onDropAudio, onDropAudioFiles, audioDisabled = false }) {
  const transport = useRef(null);
  const panel = useRef(null);
  const [audioDrop, setAudioDrop] = useState(null);
  const [audioError, setAudioError] = useState('');
  // Playback moves the collapsed playhead directly; `time` only changes on pause and seek.
  useEffect(() => clock.subscribe(() => { if (transport.current) transport.current.value = clock.get().time; }), [clock]);
  const [context, setContext] = useState({ layerId: selected, mode: 'timing', anchor: null });
  useEffect(() => { setContext(current => current.layerId === selected ? current : { layerId: selected, mode: 'timing', anchor: null }); }, [selected]);
  const layer = project.layers.find(item => item.id === selected);
  const mode = context.layerId === layer?.id && supportsChoreography(layer) ? context.mode : 'timing';
  const editTiming = (id, fields) => { onSetPlaying(false); onPatch(id, fields); };
  const editState = (id, fields) => { onSetPlaying(false); onEditLayer(id, fields); };
  const seekState = value => { onSeek(value); onSetPlaying(false); };
  const selectLayer = id => { setContext({ layerId: id, mode: 'timing', anchor: null }); onSelect(id); onSetPlaying(false); };
  const selectState = id => { setContext(current => ({ layerId: id, mode: 'choreography', anchor: current.layerId === id ? current.anchor : null })); onSelect(id); onSetPlaying(false); };
  const openControls = (id, anchor) => {
    setContext(current => ({ layerId: id, mode: 'choreography', anchor: current.layerId === id && current.anchor ? null : anchor }));
    onSelect(id); onSetPlaying(false);
  };
  const closeControls = () => setContext(current => ({ ...current, anchor: null }));
  const toggle = <button type="button" className="timeline-toggle" aria-expanded={timelineOpen} aria-controls="timeline-tracks" onClick={() => { closeControls(); onSetTimelineOpen(value => !value); }}>
    {timelineOpen ? <CaretDown size={14}/> : <CaretUp size={14}/>}Timeline
  </button>;
  const addAudio = onAddAudio && <button type="button" className="timeline-toggle timeline-add-audio" aria-label="Add audio" title="Add audio at playhead" disabled={audioDisabled} onClick={() => { onSetPlaying(false); onSetTimelineOpen(true); onAddAudio(); }}><MusicNotes size={14}/><span>Add audio</span></button>;
  const acceptsAudioDrop = event => !audioDisabled && ((onDropAudio && event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) || (onDropAudioFiles && event.dataTransfer.types.includes('Files')));
  const dropTime = event => {
    const rect = panel.current.querySelector('.timeline-ruler')?.getBoundingClientRect();
    return rect?.width ? timeAtPointer(event.clientX, rect, project.duration, project.fps) : clock.get().time;
  };
  async function dropAudio(event) {
    if (!acceptsAudioDrop(event)) return;
    event.preventDefault();
    const at = dropTime(event);
    setAudioDrop(null); setAudioError('');
    try {
      if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
        const asset = JSON.parse(event.dataTransfer.getData(ASSET_DRAG_TYPE));
        if (assetKind(asset?.src) !== 'audio') throw new Error('Drop an MP3, WAV, M4A or OGG audio file on the timeline.');
        onSetPlaying(false); onSetTimelineOpen(true);
        await onDropAudio(asset, at);
      } else {
        const files = [...event.dataTransfer.files];
        if (!files.length || files.some(file => !/\.(mp3|wav|m4a|ogg)$/i.test(file.name))) throw new Error('Drop only MP3, WAV, M4A or OGG audio files on the timeline.');
        onSetPlaying(false); onSetTimelineOpen(true);
        await onDropAudioFiles(files, at);
      }
    } catch (error) { setAudioError(error.message); }
  }

  return <section ref={panel} className={`timeline-panel${audioDrop !== null ? ' is-audio-drop' : ''}`} aria-label="Timeline"
    onDragOver={event => { if (!acceptsAudioDrop(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setAudioDrop(dropTime(event)); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setAudioDrop(null); }}
    onDrop={dropAudio}>
    {audioDrop !== null && <p className="timeline-audio-feedback" role="status">Drop audio at {audioDrop.toFixed(2)}s</p>}
    {audioError && <p className="timeline-audio-feedback" role="alert">{audioError}</p>}
    {!timelineOpen && <div className="transport">
      <input ref={transport} type="range" aria-label="Timeline playhead" min={0} max={project.duration - 0.001} step={0.01} value={time} onChange={event => { onSetPlaying(false); onTimeChange(Number(event.target.value)); }}/>
      <span className="timeline-label">{project.fps} FPS</span>{addAudio}{toggle}
    </div>}
    <div id="timeline-tracks" hidden={!timelineOpen}>
      <TimelineTracks project={project} selected={selected} clock={clock} time={time} icons={layerIcons} mode={mode}
        controlsLayerId={timelineOpen && context.anchor ? context.layerId : null}
        rulerControls={<><span className="timeline-label">{project.fps} FPS</span>{addAudio}{toggle}</>}
        onOpenControls={openControls} onSelect={selectLayer} onSelectState={selectState} onSeek={seekState} onCommit={editTiming}/>
    </div>
    {timelineOpen && layer && supportsChoreography(layer) && context.layerId === layer.id && context.anchor && <TimelineControlsPopover key={layer.id} anchor={context.anchor} layer={layer} onClose={closeControls}>
      <PlayheadChoreographyControls clock={clock} project={project} layer={layer} onPatch={editState} onSeek={seekState}/>
    </TimelineControlsPopover>}
  </section>;
}
