import { useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { isTerminalJobState } from '../export-jobs.js';

export function useExportJob({ projectRef, setError, setPlaying, open }) {
  const [job, setJob] = useState(null);
  const [recent, setRecent] = useState([]);
  const jobRef = useRef(null);
  const busy = Boolean(job) && !isTerminalJobState(job.state);

  useEffect(() => {
    jobRef.current = job;
    if (!job || isTerminalJobState(job.state)) return;
    const timer = setTimeout(() => request(`/api/exports/${job.id}`).then(setJob).catch(error => setError(error.message)), 1200);
    return () => clearTimeout(timer);
  }, [job, setError]);

  // History refreshes when Export opens and whenever an export starts or ends.
  useEffect(() => {
    if (!open) return;
    let current = true;
    request('/api/exports').then(result => { if (current) setRecent(result.jobs); }).catch(error => setError(error.message));
    return () => { current = false; };
  }, [open, job?.id, busy, setError]);

  async function render(settings) {
    setPlaying(false);
    setError('');
    try {
      const result = await request('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectRef.current, settings }) });
      setJob(result);
    } catch (error) { setError(error.message); }
  }

  async function cancel() {
    const current = jobRef.current;
    if (!current || isTerminalJobState(current.state)) return;
    try { setJob(await request(`/api/exports/${current.id}/cancel`, { method: 'POST' })); }
    catch (error) { setError(error.message); }
  }

  return { job, jobRef, busy, recent, render, cancel };
}
