import React, { useEffect, useState } from 'react';
import { request } from '../request.js';

export function RendererConnection({ busy, onChange }) {
  const [status, setStatus] = useState(null);
  const [pairing, setPairing] = useState(null);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  useEffect(() => {
    let disposed = false, timer;
    async function poll() {
      try {
        const next = await request('/api/renderers/status');
        if (disposed) return;
        setStatus(next); onChange(next); setError('');
        if (next.paired && !next.connecting) setPairing(null);
      } catch (cause) { if (!disposed) { setError(cause.message); onChange(null); } }
      if (!disposed) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [onChange]);
  async function connect() {
    setConnecting(true); setError('');
    try {
      const next = await request('/api/renderers/pair', { method: 'POST' });
      setPairing(next);
      const waiting = { ...status, connecting: true };
      setStatus(waiting); onChange(waiting);
    } catch (cause) { setError(cause.message); }
    finally { setConnecting(false); }
  }
  const ready = status?.paired && status.online && status.compatible && !status.connecting;
  return <div className="renderer-connection">
    <div className="renderer-status" role="status"><span className={`status-dot ${ready ? 'saved' : ''}`}/><span>{!status ? 'Checking renderer…' : ready ? `${status.name} · Ready` : status.paired && !status.compatible ? 'Update your renderer' : status.paired ? 'Your renderer is offline' : status.required ? 'Connect this computer to export' : 'Rendering on this computer'}</span></div>
    <div className="renderer-actions"><a href="/renderer/FLOC-Motion-Renderer.zip" download>Download renderer</a><button type="button" onClick={connect} disabled={busy || connecting}>{status?.paired ? 'Reconnect' : 'Connect this computer'}</button></div>
    {pairing && <div className="renderer-pairing"><p>Open the installer and enter this code:</p><strong className="renderer-code">{pairing.code}</strong><p className="helper">Valid for 10 minutes · Windows or Mac</p></div>}
    {error && <p role="alert" className="helper">{error}</p>}
  </div>;
}
