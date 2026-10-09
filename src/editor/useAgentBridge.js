import { useEffect, useState } from 'react';
import { validateProject } from '../project.js';
import { registerWebMCP } from '../webmcp.js';

export function useAgentBridge({ loaded, projectRef, change, save, setError, setTime, setPlaying, setExportOpen, jobRef, proposeAlternatives }) {
  const [agentState, setAgentState] = useState('Checking');
  const [audit, setAudit] = useState([]);

  useEffect(() => {
    if (!loaded) return;
    const registration = registerWebMCP({ get: () => projectRef.current, set: next => { const project = validateProject(next); return change(project); }, save, proposeAlternatives,
      seek: time => { setPlaying(false); setTime(time); }, audit: name => setAudit(items => [{ name, time: new Date().toLocaleTimeString() }, ...items].slice(0, 8)), requestExport: () => { setPlaying(false); setExportOpen(true); }, exportStatus: () => jobRef.current || { state: 'idle' } });
    setAgentState(registration.supported ? 'Connecting' : 'Unavailable');
    registration.ready.then(() => { if (registration.supported) setAgentState('Connected'); }).catch(error => { setAgentState('Registration failed'); setError(error.message); });
    return () => registration.dispose();
  }, [loaded, change, save, projectRef, setError, setExportOpen, jobRef, proposeAlternatives]);

  return { agentState, audit };
}
