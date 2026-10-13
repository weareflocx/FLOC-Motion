import { useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { isTerminalJobState } from '../export-jobs.js';

export const DEFAULT_EXPORT_SETTINGS = Object.freeze({ quality: 'high', resolution: '1080p', format: 'mp4', transparent: false });

export function useExportJob({ projectRef, setError, setPlaying, open }) {
  const [job, setJob] = useState(null);
  const [recent, setRecent] = useState([]);
  // Shared by Export and batch exports so a batch renders with the settings chosen in Export.
  const [settings, setSettings] = useState(DEFAULT_EXPORT_SETTINGS);
  const jobRef = useRef(null);
  const busy = Boolean(job) && !isTerminalJobState(job.state);
  const pending = recent.some(item => !isTerminalJobState(item.state));

  useEffect(() => {
    jobRef.current = job;
    if (!job || isTerminalJobState(job.state)) return;
    const timer = setTimeout(() => request(`/api/exports/${job.id}`).then(setJob).catch(error => setError(error.message)), 1200);
    return () => clearTimeout(timer);
  }, [job, setError]);

  // History refreshes when Export opens, whenever an export starts or ends, and while queued exports remain.
  useEffect(() => {
    if (!open) return;
    let current = true;
    const refresh = () => request('/api/exports').then(result => { if (current) setRecent(result.jobs); }).catch(error => setError(error.message));
    refresh();
    const timer = pending ? setInterval(refresh, 2000) : null;
    return () => { current = false; clearInterval(timer); };
  }, [open, job?.id, busy, pending, setError]);

  async function render(options = settings) {
    setPlaying(false);
    setError('');
    try {
      const result = await request('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectRef.current, settings: options }) });
      setJob(result);
    } catch (error) { setError(error.message); }
  }

  // Cancels the export shown in Export, or any unfinished export by ID (queued ones included).
  async function cancel(id = jobRef.current?.id) {
    const current = id === jobRef.current?.id ? jobRef.current : recent.find(item => item.id === id);
    if (!current || isTerminalJobState(current.state)) return;
    try {
      const result = await request(`/api/exports/${id}/cancel`, { method: 'POST' });
      if (id === jobRef.current?.id) setJob(result);
      setRecent(items => items.map(item => item.id === id ? { ...item, state: result.state, message: result.message } : item));
    } catch (error) { setError(error.message); }
  }

  return { job, jobRef, busy, recent, settings, setSettings, render, cancel };
}
