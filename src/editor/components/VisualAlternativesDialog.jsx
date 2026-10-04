import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Pause, Play, X } from '@phosphor-icons/react';
import { FORMAT_LABELS } from '../../project.js';
import { visualAlternativePreview } from '../../visual-alternatives.js';
import { IconButton, Modal } from '../controls.jsx';
import { Stage } from '../Stage.jsx';
import { usePlayback } from '../usePlayback.js';
import './visual-alternatives.css';

const noop = () => {};

export function VisualAlternativesDialog({ proposal, onClose, onApply, stale = false }) {
  const title = useId();
  const pending = useRef(false);
  const [selected, setSelected] = useState(0);
  const [original, setOriginal] = useState(false);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const alternatives = proposal.alternatives.slice(0, 3);
  const chosen = alternatives[selected];
  const activeProject = useMemo(() => visualAlternativePreview(original ? proposal.base : chosen.project), [original, proposal.base, chosen.project]);
  const projectRef = useRef(activeProject);
  projectRef.current = activeProject;
  const { time, playing, setTime, setPlaying } = usePlayback({ projectRef, duration: activeProject.duration });

  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, [setPlaying]);

  const stageReady = useCallback(value => setReady(value), []);
  const stageError = useCallback(failure => { setReady(false); setError(failure); }, []);

  function choose(index) {
    if (pending.current) return;
    setSelected(index);
    setOriginal(false);
    setReady(false);
    setError('');
  }

  function showOriginal() {
    if (pending.current || original) return;
    setOriginal(true);
    setReady(false);
    setError('');
  }

  function close() {
    if (!pending.current) onClose();
  }

  async function apply(event) {
    event.preventDefault();
    if (pending.current || original || stale || !ready || error) return;
    pending.current = true;
    setSubmitting(true);
    setPlaying(false);
    setError('');
    try {
      if (!await onApply(selected)) throw new Error('Unable to apply visual alternative.');
      onClose();
    } catch (failure) {
      setError(typeof failure?.message === 'string' ? failure.message : 'Unable to apply visual alternative.');
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  const blocked = original || stale || !ready || submitting || Boolean(error);
  return <Modal labelledBy={title} onClose={close}><form className="visual-alternatives-window" onSubmit={apply}>
    <header className="visual-alternatives-header">
      <h2 id={title}>Visual alternatives</h2>
      <IconButton label="Close visual alternatives" disabled={submitting} onClick={close}><X size={20}/></IconButton>
    </header>
    <div className="visual-alternatives-body">
      <section className="visual-alternatives-preview" aria-label={`${original ? 'Original' : chosen.name} preview`}>
        <div className="visual-alternatives-preview-heading"><span>{original ? 'Original' : chosen.name}</span><span>{FORMAT_LABELS[activeProject.format]}</span></div>
        <div className="visual-alternatives-stage" inert><Stage project={activeProject} time={time} playing={playing} onReady={stageReady} onError={stageError} onPreview={noop} onSelect={noop} onPatch={noop}/></div>
        <div className="visual-alternatives-transport">
          <IconButton label={playing ? 'Pause preview' : 'Play preview'} disabled={!ready || Boolean(error)} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={18} weight="fill"/> : <Play size={18} weight="fill"/>}</IconButton>
          <input type="range" aria-label="Preview playhead" min={0} max={Math.max(0, activeProject.duration - 0.001)} step={0.01} value={Math.min(time, activeProject.duration)} onChange={event => { setPlaying(false); setTime(Number(event.target.value)); }}/>
          <output>{time.toFixed(2)}s</output>
        </div>
      </section>
      <aside className="visual-alternatives-options">
        <button type="button" className={`visual-alternative-original${original ? ' selected' : ''}`} aria-pressed={original} disabled={submitting} onClick={showOriginal}>Original</button>
        <fieldset disabled={submitting}>
          <legend>Direction</legend>
          {alternatives.map((alternative, index) => <label className={`visual-alternative-option${!original && selected === index ? ' selected' : ''}`} key={alternative.name}>
            <input type="radio" name={`${title}-direction`} value={index} checked={!original && selected === index} onChange={() => choose(index)}/>
            <strong>{alternative.name}</strong>
          </label>)}
        </fieldset>
      </aside>
    </div>
    <footer className="visual-alternatives-footer">
      <div className="visual-alternatives-feedback">{stale && <p role="alert">The composition changed. Generate new alternatives.</p>}{!stale && error && <p role="alert">{error}</p>}</div>
      <button type="button" className="subtle-button" disabled={submitting} onClick={close}>Cancel</button>
      <button type="submit" className="export-button" disabled={blocked}>{submitting ? 'Applying…' : `Apply ${chosen.name}`}</button>
    </footer>
  </form></Modal>;
}
