import React, { useRef, useState } from 'react';
import { EyeSlash, LockSimple } from '@phosphor-icons/react';
import { editClip, editFade, timeAtPointer } from './editor-controls.js';
import { fitFades } from './project.js';
import { moveState } from './choreography.js';
import './timeline-choreography.css';

const isFade = kind => kind === 'fadeIn' || kind === 'fadeOut';
const layerTypes = { background: 'Background', carousel: 'Carousel', text: 'Text', logo: 'Logo', music: 'Audio', media: 'Media', model: '3D model' };

export function TimelineTracks({ project, selected, time, icons, onSelect, onSeek, onCommit }) {
  const gesture = useRef(null); const scrub = useRef(false);
  const stateClick = useRef(null);
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
  function beginState(e, layer, state) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.focus({ preventScroll: true }); onSelect(layer.id);
    if (layer.locked || gesture.current) return;
    stateClick.current = null;
    const lane = e.currentTarget.closest('.track-lane').getBoundingClientRect();
    gesture.current = { pointerId: e.pointerId, x: e.clientX, layer, kind: 'state', state, width: lane.width, latest: layer.choreography };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft({ id: layer.id, kind: 'state', stateId: state.id, ...timing(layer), choreography: layer.choreography });
  }
  function move(e) {
    const g = gesture.current; if (!g || e.pointerId !== g.pointerId) return;
    if (g.kind === 'state') {
      e.stopPropagation();
      g.latest = moveState(g.layer, g.state.id, g.state.time + (e.clientX - g.x) / g.width * project.duration, project.fps);
      setDraft({ id: g.layer.id, kind: 'state', stateId: g.state.id, ...timing(g.layer), choreography: g.latest });
      return;
    }
    g.latest = edit(g.layer, g.kind, (e.clientX - g.x) / g.width * project.duration);
    setDraft({ id: g.layer.id, kind: g.kind, ...g.latest });
  }
  function finish(e, cancel = false) {
    const g = gesture.current; if (!g || e.pointerId !== g.pointerId) return;
    if (g.kind === 'state') e.stopPropagation();
    gesture.current = null; setDraft(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (g.kind === 'state') {
      if (!cancel) {
        const next = g.latest.find(state => state.id === g.state.id);
        stateClick.current = { layerId: g.layer.id, stateId: g.state.id };
        if (next.time !== g.state.time) onCommit(g.layer.id, { choreography: g.latest });
        onSeek(g.layer.start + next.time);
      }
      return;
    }
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
  function stateKeys(e, layer, state) {
    if (e.key === 'Escape') { e.stopPropagation(); keys(e, layer, 'state'); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete', 'Backspace'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (layer.locked || gesture.current) return;
    onSelect(layer.id);
    if (e.key === 'Delete' || e.key === 'Backspace') {
      onCommit(layer.id, { choreography: layer.choreography.filter(item => item.id !== state.id) });
      return;
    }
    const localTime = e.key === 'Home' ? 0 : e.key === 'End' ? layer.end - layer.start : state.time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) / project.fps;
    const next = moveState(layer, state.id, localTime, project.fps);
    const moved = next.find(item => item.id === state.id);
    if (moved.time !== state.time) onCommit(layer.id, { choreography: next });
    onSeek(layer.start + moved.time);
  }
  const pointerProps = (l, kind) => ({ disabled: l.locked, onPointerDown: e => begin(e, l, kind), onPointerMove: move, onPointerUp: e => finish(e), onPointerCancel: e => finish(e, true), onLostPointerCapture: e => finish(e, true), onKeyDown: e => keys(e, l, kind) });
  const seek = e => onSeek(timeAtPointer(e.clientX, e.currentTarget.getBoundingClientRect(), project.duration, project.fps));
  const status = d => `${project.layers.find(l => l.id === d.id)?.name}: ${d.kind === 'state' ? `state at ${(d.start + d.choreography.find(state => state.id === d.stateId).time).toFixed(2)}s` : isFade(d.kind) ? `fade ${d.kind === 'fadeIn' ? 'in' : 'out'} ${d[d.kind].toFixed(2)}s` : `${d.start.toFixed(2)}s — ${d.end.toFixed(2)}s`}`;
  const rulerStep = project.duration <= 3 ? 0.5 : project.duration <= 6 ? 1 : project.duration <= 15 ? 2 : 5;
  const ticks = Array.from({ length: Math.ceil(project.duration / rulerStep * 5) }, (_, i) => i * rulerStep / 5);
  return <>
    <div className="timeline-feedback" role="status">{draft ? status(draft) : ''}</div>
    <div className="timeline-track-scroll" style={{ '--timeline-grid': `${rulerStep / project.duration * 100}%` }}>
    <div className="timeline-ruler-row"><span className="ruler-track-heading">Layers <small>{project.layers.length}</small></span><div className="timeline-ruler" role="slider" tabIndex={0} aria-label="Timeline ruler" aria-valuemin={0} aria-valuemax={project.duration} aria-valuenow={Number(time.toFixed(2))} onPointerDown={e => { if (e.button !== 0) return; scrub.current = true; e.currentTarget.setPointerCapture(e.pointerId); seek(e); }} onPointerMove={e => { if (scrub.current) seek(e); }} onPointerUp={e => { scrub.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { scrub.current = false; }} onLostPointerCapture={() => { scrub.current = false; }} onKeyDown={e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); onSeek(Math.max(0, Math.min(project.duration - 1 / project.fps, e.key === 'Home' ? 0 : e.key === 'End' ? project.duration - 1 / project.fps : time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) / project.fps))); } }}>
      {ticks.map((tick, i) => <span key={i} className={`timeline-tick ${i % 5 === 0 ? 'major' : ''} ${i % 10 === 5 ? 'secondary' : ''}`} style={{ left: `${tick / project.duration * 100}%` }} aria-hidden="true">{i % 5 === 0 && (tick === 0 || project.duration - tick >= rulerStep * 0.6) && <span className="tick-label">{Number(tick.toFixed(2))}s</span>}</span>)}
      <span className="timeline-tick major endpoint" style={{ left: '100%' }} aria-hidden="true"><span className="tick-label">{project.duration}s</span></span>
      <i className="ruler-playhead" style={{ left: `${time / project.duration * 100}%` }} aria-hidden="true"><span className="playhead-cap"/></i>
    </div></div>
    <div className="track-list">{project.layers.map(l => {
      const Icon = icons[l.type]; const range = draft?.id === l.id ? draft : l; const span = range.end - range.start;
      // Trimming previews the fitted fades that validation will store.
      const fades = l.fadeIn !== undefined && fitFades(range.fadeIn, range.fadeOut, span);
      const share = value => `${value / span * 100}%`;
      const states = (draft?.id === l.id && draft.kind === 'state' ? draft.choreography : l.choreography || []).filter(state => state.time >= 0 && state.time <= span);
      const activeState = states.findLast(state => state.time <= time - range.start) || states[0];
      return <div className={`track-row ${selected === l.id ? 'selected' : ''} ${l.locked ? 'locked' : ''}`} key={l.id}>
        <button className="track-name" onClick={() => onSelect(l.id)} aria-label={`Select ${l.name} track`} aria-pressed={selected === l.id} title={`${l.name} · ${layerTypes[l.type]}${l.locked ? ' · Locked' : ''}${!l.visible ? ' · Hidden' : ''}`}>
          <span className="track-icon"><Icon size={16}/></span>
          <span className="track-label"><span>{l.name}</span></span>
          {(l.locked || !l.visible) && <span className="track-state">{l.locked && <LockSimple size={12} aria-hidden="true"/>}{!l.visible && <EyeSlash size={12} aria-hidden="true"/>}</span>}
        </button>
        <div className={`track-lane ${l.choreography?.length ? 'has-choreography' : ''}`} onPointerDown={e => { if (e.target === e.currentTarget && e.button === 0) onSeek(timeAtPointer(e.clientX, e.currentTarget.getBoundingClientRect(), project.duration, project.fps)); }}>
          <div className={`track-clip ${l.type} ${l.type === 'music' && !l.src ? 'empty' : ''} ${!l.visible ? 'muted' : ''} ${draft?.id === l.id && draft.kind !== 'state' ? 'dragging' : ''}`} style={{ left: `${range.start / project.duration * 100}%`, width: `${(range.end - range.start) / project.duration * 100}%` }} role="group" aria-label={`${l.name} timing`} title={`${range.start.toFixed(2)}s — ${range.end.toFixed(2)}s`}>
            <button className="clip-handle start" aria-label={`Trim start of ${l.name}`} {...pointerProps(l, 'start')}/>
            {fades && <><svg className="clip-fade in" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: share(fades.fadeIn) }}><path className="fade-shade" d="M0 0H100L0 100Z"/><path className="fade-line" d="M0 100L100 0"/></svg><button className="fade-handle in" style={{ '--fade-at': share(fades.fadeIn) }} aria-label={`Fade in of ${l.name}: ${fades.fadeIn.toFixed(2)}s`} title={`Fade in ${fades.fadeIn.toFixed(2)}s`} {...pointerProps(l, 'fadeIn')}/></>}
            <button className="clip-body" aria-label={`Move ${l.name} clip`} {...pointerProps(l, 'move')}>
              <span className="clip-label">{l.type === 'music' && !l.src ? 'No audio added' : l.type === 'text' ? l.text : ''}</span>
              <span className="clip-duration" aria-hidden="true">{span.toFixed(2)}s</span>
            </button>
            {fades && <><svg className="clip-fade out" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: share(fades.fadeOut) }}><path className="fade-shade" d="M0 0H100V100Z"/><path className="fade-line" d="M0 0L100 100"/></svg><button className="fade-handle out" style={{ '--fade-at': share(fades.fadeOut) }} aria-label={`Fade out of ${l.name}: ${fades.fadeOut.toFixed(2)}s`} title={`Fade out ${fades.fadeOut.toFixed(2)}s`} {...pointerProps(l, 'fadeOut')}/></>}
            <button className="clip-handle end" aria-label={`Trim end of ${l.name}`} {...pointerProps(l, 'end')}/>
          </div>
          {states.map(state => {
            const at = range.start + state.time;
            const current = time >= range.start && time < range.end && activeState?.id === state.id;
            return <button key={state.id} className={`choreography-mark ${current ? 'current' : ''} ${draft?.stateId === state.id && draft?.id === l.id ? 'dragging' : ''}`} style={{ left: `${at / project.duration * 100}%` }} aria-label={`${l.name} state at ${at.toFixed(2)} seconds${l.locked ? ', locked' : ''}`} aria-current={current ? 'step' : undefined} title={`${l.name} · ${at.toFixed(2)}s${l.locked ? ' · Locked' : ''}`}
              onClick={e => { e.stopPropagation(); const skip = e.detail !== 0 && stateClick.current?.layerId === l.id && stateClick.current?.stateId === state.id; stateClick.current = null; if (skip) return; onSelect(l.id); onSeek(at); }}
              onPointerDown={e => beginState(e, l, state)} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => finish(e, true)} onKeyDown={e => stateKeys(e, l, state)}><span aria-hidden="true"/></button>;
          })}
          <i className="playhead" style={{ left: `${time / project.duration * 100}%` }}/>
        </div>
      </div>;
    })}</div></div>
  </>;
}
