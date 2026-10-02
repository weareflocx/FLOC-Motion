import React from 'react';
import { DownloadSimple, Robot, UploadSimple, Warning, X } from '@phosphor-icons/react';
import { BRAND } from '../../brand.js';
import { IconButton } from '../controls.jsx';

export function Header({ status, agentState, loaded, onOpenAgent, onImport, onDownload, onExport, onOpenTemplates }) {
  return <header className="topbar"><a href="/" className="brand" aria-label="FLOC Motion home"><img src={BRAND.assets.wordmarkWhite} width="91.23" height="20" alt="FLOC"/><em>MOTION</em></a><div className="header-actions"><span className="save-state"><span className={status === 'Saved locally' ? 'status-dot saved' : 'status-dot'}/>{status}</span><button className="subtle-button" disabled={!loaded} onClick={onOpenTemplates}>Saved templates</button><button className="subtle-button agent-button" onClick={onOpenAgent}><Robot size={17}/>Agent tools<span className={`small-dot ${agentState === 'Connected' ? 'active' : ''}`}/></button><IconButton label="Import project" onClick={onImport}><UploadSimple size={18}/></IconButton><IconButton label="Download project JSON" onClick={onDownload}><DownloadSimple size={18}/></IconButton><button className="export-button" onClick={onExport} disabled={!loaded}><DownloadSimple size={17}/>Export video</button></div></header>;
}

export function ErrorBanner({ error, status, onReload, onDismiss }) {
  if (!error) return null;
  return <div className="error-banner" role="alert"><Warning size={16}/>{error}{status === 'Save conflict' && <button type="button" className="text-button" onClick={onReload}>Reload latest project</button>}<IconButton label="Dismiss error" onClick={onDismiss}><X/></IconButton></div>;
}
