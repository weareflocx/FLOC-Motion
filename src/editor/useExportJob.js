import { useEffect, useRef, useState } from 'react';
import { request } from './request.js';

export function useExportJob({ projectRef, setError, setPlaying }) {
  const [job, setJob] = useState(null);
  const jobRef = useRef(null);

  useEffect(() => {
    jobRef.current = job;
    if (!job || ['done', 'failed'].includes(job.state)) return;
    const timer = setTimeout(() => request(`/api/exports/${job.id}`).then(setJob).catch(error => setError(error.message)), 1200);
    return () => clearTimeout(timer);
  }, [job, setError]);

  async function render(settings) {
    setPlaying(false);
    setError('');
    try {
      const result = await request('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: projectRef.current, settings }) });
      setJob(result);
    } catch (error) { setError(error.message); }
  }

  return { job, jobRef, busy: job && !['done', 'failed'].includes(job.state), render };
}
