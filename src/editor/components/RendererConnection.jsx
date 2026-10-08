import React, { useEffect, useState } from 'react';
import { request } from '../request.js';

const RENDERER_REQUEST_TIMEOUT_MS = 10000;
const rendererError = cause => cause.code === 'ETIMEDOUT' ? 'The renderer service did not respond. Try again.' : cause.message;

export function RendererConnection({ busy, onChange }) {
  const [status, setStatus] = useState(null);
  const [pairing, setPairing] = useState(null);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  useEffect(() => {
    let disposed = false, timer;
    async function poll() {
      try {
        const next = await request('/api/renderers/status', { timeoutMs: RENDERER_REQUEST_TIMEOUT_MS });
        if (disposed) return;
        setStatus(next); onChange(next); setError('');
        if (next.paired && !next.connecting) setPairing(null);
      } catch (cause) { if (!disposed) { setError(rendererError(cause)); onChange(null); } }
      if (!disposed) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [onChange]);
  async function connect() {
    setConnecting(true); setError('');
    try {
      const next = await request('/api/renderers/pair', { method: 'POST', timeoutMs: RENDERER_REQUEST_TIMEOUT_MS });
      setPairing(next);
      const waiting = { ...status, connecting: true };
      setStatus(waiting); onChange(waiting);
    } catch (cause) { setError(rendererError(cause)); }
    finally { setConnecting(false); }
  }
  const ready = status?.paired && status.online && status.compatible && !status.connecting;
  return <div className="renderer-connection">
    <div className="renderer-status" role="status" aria-busy={connecting || !status}><span className={`status-dot ${ready ? 'saved' : ''}`}/><span>{connecting ? 'Generating connection code…' : !status ? 'Checking renderer…' : ready ? `${status.name} · Ready` : status.paired && !status.compatible ? 'Update your renderer' : status.paired ? 'Your renderer is offline' : status.required ? 'Connect this computer to export' : 'Rendering on this computer'}</span></div>
    <div className="renderer-actions"><a href="/renderer/FLOC-Motion-Renderer.zip" download>Download renderer</a><button type="button" onClick={connect} disabled={busy || connecting}>{status?.paired ? 'Reconnect' : 'Connect this computer'}</button></div>
    {pairing && <div className="renderer-pairing"><p>Open the installer and enter this code:</p><strong className="renderer-code">{pairing.code}</strong><p className="helper">Valid for 10 minutes · Windows or Mac</p></div>}
    {error && <p role="alert" className="helper">{error}</p>}
  </div>;
}
