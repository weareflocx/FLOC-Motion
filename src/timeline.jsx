import React, { useRef, useState } from 'react';
import { editClip, editFade, timeAtPointer } from './editor-controls.js';
import { fitFades } from './project.js';

const isFade = kind => kind === 'fadeIn' || kind === 'fadeOut';

export function TimelineTracks({ project, selected, time, icons, onSelect, onSeek, onCommit }) {
  const gesture = useRef(null); const scrub = useRef(false);
  const [draft, setDraft] = useState(null);
  const timing = l => ({ start: l.start, end: l.end, fadeIn: l.fadeIn, fadeOut: l.fadeOut });
  const edit = (l, kind, delta) => ({ ...timing(l), ...(isFade(kind) ? editFade(l, kind, delta, project.fps) : editClip(l, kind, delta, project.duration, project.fps)) });
  const changes = (l, kind, next) => isFade(kind) ? next[kind] !== l[kind] && { [kind]: next[kind] } : (next.start !== l.start || next.end !== l.end) && { start: next.start, end: next.end };
  function begin(e, layer, kind) {
    if (layer.locked || e.button !== 0 || gesture.current) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.focus({ preventScroll: true }); onSelect(layer.id);
    const lane = e.currentTarget.closest('.track-lane').getBoundingClientRect();
    gesture.current = { pointerId: e.pointerId, x: e.clientX, layer, kind, width: lane.width, latest: timing(layer) };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft({ id: layer.id, kind, ...timing(layer) });
  }
  function move(e) {
    const g = gesture.current; if (!g || e.pointerId !== g.pointerId) return;
    g.latest = edit(g.layer, g.kind, (e.clientX - g.x) / g.width * project.duration);
    setDraft({ id: g.layer.id, kind: g.kind, ...g.latest });
  }
  function finish(e, cancel = false) {
    const g = gesture.current; if (!g || e.pointerId !== g.pointerId) return;
    gesture.current = null; setDraft(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const patch = !cancel && changes(g.layer, g.kind, g.latest);
    if (patch) onCommit(g.layer.id, patch);
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
    const patch = changes(layer, kind, edit(layer, kind, delta));
    if (patch) onCommit(layer.id, patch);
  }
  const pointerProps = (l, kind) => ({ disabled: l.locked, onPointerDown: e => begin(e, l, kind), onPointerMove: move, onPointerUp: e => finish(e), onPointerCancel: e => finish(e, true), onLostPointerCapture: e => finish(e, true), onKeyDown: e => keys(e, l, kind) });
  const seek = e => onSeek(timeAtPointer(e.clientX, e.currentTarget.getBoundingClientRect(), project.duration, project.fps));
  const status = d => `${project.layers.find(l => l.id === d.id)?.name}: ${isFade(d.kind) ? `fade ${d.kind === 'fadeIn' ? 'in' : 'out'} ${d[d.kind].toFixed(2)}s` : `${d.start.toFixed(2)}s — ${d.end.toFixed(2)}s`}`;
  return <>
    <div className="timeline-instructions" role="status">{draft ? status(draft) : ''}</div>
    <div className="timeline-ruler-row"><span>SECONDS</span><div className="timeline-ruler" role="slider" tabIndex={0} aria-label="Timeline ruler" aria-valuemin={0} aria-valuemax={project.duration} aria-valuenow={Number(time.toFixed(2))} onPointerDown={e => { if (e.button !== 0) return; scrub.current = true; e.currentTarget.setPointerCapture(e.pointerId); seek(e); }} onPointerMove={e => { if (scrub.current) seek(e); }} onPointerUp={e => { scrub.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { scrub.current = false; }} onLostPointerCapture={() => { scrub.current = false; }} onKeyDown={e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); onSeek(Math.max(0, Math.min(project.duration - 1 / project.fps, e.key === 'Home' ? 0 : e.key === 'End' ? project.duration - 1 / project.fps : time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) / project.fps))); } }}>
      {Array.from({ length: 7 }, (_, i) => <span key={i} style={{ left: `${i / 6 * 100}%` }}>{Number((i / 6 * project.duration).toFixed(1))}s</span>)}<i className="ruler-playhead" style={{ left: `${time / project.duration * 100}%` }}/>
    </div></div>
    <div className="track-list">{project.layers.map(l => {
      const Icon = icons[l.type]; const range = draft?.id === l.id ? draft : l; const span = range.end - range.start;
      // Trimming previews the fitted fades that validation will store.
      const fades = l.fadeIn !== undefined && fitFades(range.fadeIn, range.fadeOut, span);
      const share = value => `${value / span * 100}%`;
      return <div className={`track-row ${selected === l.id ? 'selected' : ''}`} key={l.id}>
        <button className="track-name" onClick={() => onSelect(l.id)} aria-label={`Select ${l.name} track`} aria-pressed={selected === l.id}><Icon size={13}/>{l.name}</button>
        <div className="track-lane" onPointerDown={e => { if (e.target === e.currentTarget && e.button === 0) onSeek(timeAtPointer(e.clientX, e.currentTarget.getBoundingClientRect(), project.duration, project.fps)); }}>
          <div className={`track-clip ${l.type} ${l.type === 'music' && !l.src ? 'empty' : ''} ${!l.visible ? 'muted' : ''} ${draft?.id === l.id ? 'dragging' : ''}`} style={{ left: `${range.start / project.duration * 100}%`, width: `${(range.end - range.start) / project.duration * 100}%` }} role="group" aria-label={`${l.name} timing`} title={`${range.start.toFixed(2)}s — ${range.end.toFixed(2)}s`}>
            <button className="clip-handle start" aria-label={`Trim start of ${l.name}`} {...pointerProps(l, 'start')}/>
            {fades && <><svg className="clip-fade in" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: share(fades.fadeIn) }}><path className="fade-shade" d="M0 0H100L0 100Z"/><path className="fade-line" d="M0 100L100 0"/></svg><button className="fade-handle in" style={{ '--fade-at': share(fades.fadeIn) }} aria-label={`Fade in of ${l.name}: ${fades.fadeIn.toFixed(2)}s`} title={`Fade in ${fades.fadeIn.toFixed(2)}s`} {...pointerProps(l, 'fadeIn')}/></>}
            <button className="clip-body" aria-label={`Move ${l.name} clip`} {...pointerProps(l, 'move')}>{l.type === 'music' && !l.src ? 'No audio' : l.name}</button>
            {fades && <><svg className="clip-fade out" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: share(fades.fadeOut) }}><path className="fade-shade" d="M0 0H100V100Z"/><path className="fade-line" d="M0 0L100 100"/></svg><button className="fade-handle out" style={{ '--fade-at': share(fades.fadeOut) }} aria-label={`Fade out of ${l.name}: ${fades.fadeOut.toFixed(2)}s`} title={`Fade out ${fades.fadeOut.toFixed(2)}s`} {...pointerProps(l, 'fadeOut')}/></>}
            <button className="clip-handle end" aria-label={`Trim end of ${l.name}`} {...pointerProps(l, 'end')}/>
          </div><i className="playhead" style={{ left: `${time / project.duration * 100}%` }}/>
        </div>
      </div>;
    })}</div>
  </>;
}
