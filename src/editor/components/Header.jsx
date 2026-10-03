import React from 'react';
import { Copy, DownloadSimple, FloppyDisk, FolderOpen, Robot, UploadSimple, Warning, X } from '@phosphor-icons/react';
import { BRAND } from '../../brand.js';
import { IconButton } from '../controls.jsx';

export function Header({ status, agentState, loaded, name, composition, onSave, onSaveCopy, onOpenAgent, onImport, onDownload, onExport, onOpenTemplates }) {
  return <header className="topbar"><a href="/" className="brand" aria-label="FLOC Motion home"><img src={BRAND.assets.wordmarkWhite} width="91.23" height="20" alt="FLOC"/><em>MOTION</em></a><div className="header-actions"><span className="save-state"><span className={['All changes saved', 'Draft saved'].includes(status) ? 'status-dot saved' : 'status-dot'}/>{name} · {composition ? status : `Draft · ${status}`}</span><IconButton label={composition ? 'Save changes' : 'Save composition'} disabled={!loaded} onClick={onSave}><FloppyDisk size={18}/></IconButton>{composition && <IconButton label="Save a copy" disabled={!loaded} onClick={onSaveCopy}><Copy size={18}/></IconButton>}<button className="subtle-button" disabled={!loaded} onClick={onOpenTemplates}><FolderOpen size={18}/>Compositions</button><IconButton label={`Agent tools · ${agentState}`} onClick={onOpenAgent}><Robot size={18}/><span className={`small-dot ${agentState === 'Connected' ? 'active' : ''}`}/></IconButton><IconButton label="Import project" onClick={onImport}><UploadSimple size={18}/></IconButton><IconButton label="Download project JSON" onClick={onDownload}><DownloadSimple size={18}/></IconButton><button className="export-button" onClick={onExport} disabled={!loaded}><DownloadSimple size={17}/>Export video</button></div></header>;
}

export function ErrorBanner({ error, status, onReload, onRetry, onDismiss }) {
  if (!error) return null;
  return <div className="error-banner" role="alert"><Warning size={16}/>{error}{status === 'Save conflict' && <button type="button" className="text-button" onClick={onReload}>Reload latest project</button>}{status === 'Save failed' && <button type="button" className="text-button" onClick={onRetry}>Retry save</button>}<IconButton label="Dismiss error" onClick={onDismiss}><X/></IconButton></div>;
}
