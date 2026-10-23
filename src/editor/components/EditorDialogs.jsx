import React from 'react';
import { AddLayerDialog } from './AddLayerDialog.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { NewCompositionDialog } from './NewCompositionDialog.jsx';
import { SaveCompositionDialog } from './SaveCompositionDialog.jsx';
import { SavedTemplates } from './SavedTemplates.jsx';
import { VersionHistoryDialog } from './VersionHistoryDialog.jsx';
import { TemplateContentDialog } from './TemplateContentDialog.jsx';
import { BatchVariantsDialog } from './BatchVariantsDialog.jsx';
import { VisualAlternativesDialog } from './VisualAlternativesDialog.jsx';
import { Dialogs } from './Dialogs.jsx';
import { NudgeDialog } from './NudgeDialog.jsx';
import { AccountDialog } from './AccountDialog.jsx';
import { restoreCompositionVersion } from '../version-history.js';
import { useCompositionContent } from '../useCompositionContent.js';

// Every editor dialog, rendered from `useEditorDialogs` state. `commands` builds the palette entries on demand.
export function EditorDialogs({ user, onSignOut, session, playback, setSelected, view, dialogs, files, actions, exportJob, agent, alternatives, commands }) {
  const { project, composition, canvasEditing, save, saveCopy, change, updateCompositionMetadata, detachComposition } = session;
  const { nudge, setNudge, setLeftTab } = view;
  const content = useCompositionContent({ session, setTime: playback.setTime, setPlaying: playback.setPlaying, setSelected, view, dialogs });
  const {
    nudgeOpen, setNudgeOpen, newOpen, setNewOpen, saveOpen, setSaveOpen, templatesOpen, setTemplatesOpen, versionsOpen, setVersionsOpen, accountOpen, setAccountOpen,
    addTarget, setAddTarget, contentTarget, setContentTarget, batchTemplate, setBatchTemplate, exportOpen, setExportOpen, agentOpen, setAgentOpen, paletteOpen, setPaletteOpen
  } = dialogs;
  return <>
    {nudgeOpen && <NudgeDialog value={nudge} onChange={setNudge} onClose={() => setNudgeOpen(false)}/>}
    {newOpen && <NewCompositionDialog project={project} initialTab={newOpen === 'compositions' ? 'compositions' : 'aspect'} onClose={() => setNewOpen(false)} onCreate={content.createComposition} onOpen={content.openComposition}/>}
    {saveOpen && <SaveCompositionDialog name={project.name} onClose={() => setSaveOpen(false)} onSave={saveCopy}/>}
    {templatesOpen && <SavedTemplates project={project} onMetadata={updateCompositionMetadata} onRemove={detachComposition} onUseTemplate={content.startFromTemplate} onSaveCurrent={() => { setTemplatesOpen(false); setSaveOpen(true); }} onClose={() => setTemplatesOpen(false)} onApply={content.applyTemplate}/>}
    {versionsOpen && composition && <VersionHistoryDialog compositionId={composition.id} onClose={() => setVersionsOpen(false)} onRestore={version => restoreCompositionVersion(version, { save, change, updateCompositionMetadata })}/>}
    {accountOpen && <AccountDialog user={user} onClose={() => setAccountOpen(false)} onSignOut={async () => { await save(); await onSignOut(); }}/>}
    {addTarget !== null && <AddLayerDialog project={project} initialTarget={addTarget} uploading={files.uploading} onClose={() => setAddTarget(null)} onPick={files.pick} onAddText={actions.addText} onAddLayer={actions.addLayer} onOpenMedia={() => setLeftTab('media')} onPlaceAsset={asset => files.placeAssets([asset], addTarget)}/>}
    {contentTarget && <TemplateContentDialog project={contentTarget.project} copy={contentTarget.copy} name={contentTarget.name} onClose={() => setContentTarget(null)} onSubmit={content.applyContent} onBatch={() => { setBatchTemplate(contentTarget.project); setContentTarget(null); }}/>}
    {batchTemplate && <BatchVariantsDialog project={batchTemplate} exportSettings={exportJob.settings} onClose={() => setBatchTemplate(null)}/>}
    {alternatives.proposal && <VisualAlternativesDialog proposal={alternatives.proposal} stale={project !== alternatives.proposal.base || canvasEditing} onClose={alternatives.close} onApply={alternatives.apply}/>}
    <Dialogs project={project} exportOpen={exportOpen} agentOpen={agentOpen} job={exportJob.job} busy={exportJob.busy} recent={exportJob.recent} settings={exportJob.settings} onSettingsChange={exportJob.setSettings} agentState={agent.agentState} audit={agent.audit} onCloseExport={() => setExportOpen(false)} onCloseAgent={() => setAgentOpen(false)} onRender={exportJob.render} onCancelExport={exportJob.cancel}/>
    {paletteOpen && <CommandPalette commands={commands()} onClose={() => setPaletteOpen(false)}/>}
  </>;
}
