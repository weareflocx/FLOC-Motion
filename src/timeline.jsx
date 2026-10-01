import React, { useRef, useState } from 'react';
import { editClip, timeAtPointer } from './editor-controls.js';

export function TimelineTracks({ project, selected, time, icons, onSelect, onSeek, onCommit }) {
  const gesture = useRef(null); const scrub = useRef(false);
  const [draft, setDraft] = useState(null);
  function begin(e, layer, kind) {
    if (layer.locked || e.button !== 0 || gesture.current) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.focus({ preventScroll: true }); onSelect(layer.id);
    const lane = e.currentTarget.closest('.track-lane').getBoundingClientRect();
    gesture.current = { pointerId: e.pointerId, x: e.clientX, layer, kind, width: lane.width, latest: { start: layer.start, end: layer.end } };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft({ id: layer.id, start: layer.start, end: layer.end });
  }
  function move(e) {
    const g = gesture.current; if (!g || e.pointerId !== g.pointerId) return;
    g.latest = editClip(g.layer, g.kind, (e.clientX - g.x) / g.width * project.duration, project.duration, project.fps);
    setDraft({ id: g.layer.id, ...g.latest });
  }
  function finish(e, cancel = false) {
    const g = gesture.current; if (!g || e.pointerId !== g.pointerId) return;
    gesture.current = null; setDraft(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!cancel && (g.latest.start !== g.layer.start || g.latest.end !== g.layer.end)) onCommit(g.layer.id, g.latest);
  }
  function keys(e, layer, kind) {
    if (e.key === 'Escape' && gesture.current) {
      const id = gesture.current.pointerId; gesture.current = null; setDraft(null);
      if (e.currentTarget.hasPointerCapture(id)) e.currentTarget.releasePointerCapture(id);
      e.preventDefault(); return;
    }
    if (layer.locked) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || gesture.current) return;
    e.preventDefault(); onSelect(layer.id);
    const delta = e.key === 'Home' ? -project.duration : e.key === 'End' ? project.duration : (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) / project.fps;
    const next = editClip(layer, kind, delta, project.duration, project.fps);
    if (next.start !== layer.start || next.end !== layer.end) onCommit(layer.id, next);
  }
  const pointerProps = (l, kind) => ({ disabled: l.locked, onPointerDown: e => begin(e, l, kind), onPointerMove: move, onPointerUp: e => finish(e), onPointerCancel: e => finish(e, true), onLostPointerCapture: e => finish(e, true), onKeyDown: e => keys(e, l, kind) });
  const seek = e => onSeek(timeAtPointer(e.clientX, e.currentTarget.getBoundingClientRect(), project.duration, project.fps));
  return <>
    <div className="timeline-instructions" role="status">{draft ? `${project.layers.find(l => l.id === draft.id)?.name}: ${draft.start.toFixed(2)}s — ${draft.end.toFixed(2)}s` : 'Drag a block to move it. Drag its edges to trim. ← / →: 1 frame · Shift: 10 frames · Esc: cancel.'}</div>
    <div className="timeline-ruler-row"><span>SECONDS</span><div className="timeline-ruler" role="slider" tabIndex={0} aria-label="Timeline ruler" aria-valuemin={0} aria-valuemax={project.duration} aria-valuenow={Number(time.toFixed(2))} onPointerDown={e => { if (e.button !== 0) return; scrub.current = true; e.currentTarget.setPointerCapture(e.pointerId); seek(e); }} onPointerMove={e => { if (scrub.current) seek(e); }} onPointerUp={e => { scrub.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { scrub.current = false; }} onLostPointerCapture={() => { scrub.current = false; }} onKeyDown={e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); onSeek(Math.max(0, Math.min(project.duration - 1 / project.fps, e.key === 'Home' ? 0 : e.key === 'End' ? project.duration - 1 / project.fps : time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) / project.fps))); } }}>
      {Array.from({ length: 7 }, (_, i) => <span key={i} style={{ left: `${i / 6 * 100}%` }}>{Number((i / 6 * project.duration).toFixed(1))}s</span>)}<i className="ruler-playhead" style={{ left: `${time / project.duration * 100}%` }}/>
    </div></div>
    <div className="track-list">{project.layers.map(l => {
      const Icon = icons[l.type]; const range = draft?.id === l.id ? draft : l;
      return <div className={`track-row ${selected === l.id ? 'selected' : ''}`} key={l.id}>
        <button className="track-name" onClick={() => onSelect(l.id)} aria-label={`Select ${l.name} track`} aria-pressed={selected === l.id}><Icon size={13}/>{l.name}</button>
        <div className="track-lane" onPointerDown={e => { if (e.target === e.currentTarget && e.button === 0) onSeek(timeAtPointer(e.clientX, e.currentTarget.getBoundingClientRect(), project.duration, project.fps)); }}>
          <div className={`track-clip ${l.type} ${l.type === 'music' && !l.src ? 'empty' : ''} ${!l.visible ? 'muted' : ''} ${draft?.id === l.id ? 'dragging' : ''}`} style={{ left: `${range.start / project.duration * 100}%`, width: `${(range.end - range.start) / project.duration * 100}%` }} role="group" aria-label={`${l.name} timing`} title={`${range.start.toFixed(2)}s — ${range.end.toFixed(2)}s`}>
            <button className="clip-handle start" aria-label={`Trim start of ${l.name}`} {...pointerProps(l, 'start')}/>
            <button className="clip-body" aria-label={`Move ${l.name} clip`} {...pointerProps(l, 'move')}>{l.type === 'music' && !l.src ? 'No audio' : l.name}</button>
            <button className="clip-handle end" aria-label={`Trim end of ${l.name}`} {...pointerProps(l, 'end')}/>
          </div><i className="playhead" style={{ left: `${time / project.duration * 100}%` }}/>
        </div>
      </div>;
    })}</div>
  </>;
}
