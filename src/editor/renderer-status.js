// One reading of /api/renderers/status for the connection panel and the Render button,
// matching what the server accepts: an updating renderer queues exports until it is current.
export function rendererView(status) {
  if (!status) return { text: 'Checking renderer…', ready: false, canRender: false, showUpdate: false, updating: false };
  const live = Boolean(status.paired && status.online && !status.connecting);
  const outdated = Boolean(status.paired && !status.compatible);
  const failed = live && status.updater && status.engine?.state === 'failed';
  const updating = live && status.updater && !failed && (status.engine?.state === 'updating' || outdated || Boolean(status.updateRequested));
  const ready = live && !outdated;
  const text = failed ? `Needs attention: ${status.engine.message || 'The engine update failed.'}`
    : updating ? 'Updating engine…'
      : ready ? `${status.name} · Ready`
        : live && outdated ? 'Install the latest renderer once'
          : status.paired ? 'Your renderer is offline'
            : status.required ? 'Connect this computer to export' : 'Rendering on this computer';
  const canRender = !status.connecting && (!(status.required || status.paired) || ready || (live && status.updater && !failed));
  return { text, ready: ready && !updating && !failed, canRender, showUpdate: live && Boolean(status.updater), updating };
}
