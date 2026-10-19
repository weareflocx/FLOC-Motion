import { useCallback, useEffect, useState } from 'react';
import { loadNudge, saveNudge } from './nudge.js';

// Editor UI state that never changes the composition: panel tabs, canvas view, scene readiness and placement preview.
export function useEditorView({ setPlaying }) {
  const [leftTab, setLeftTab] = useState('layers');
  const [rightTab, setRightTab] = useState('composition');
  const [nudge, setNudge] = useState(loadNudge);
  useEffect(() => saveNudge(nudge), [nudge]);
  const [ready, setReady] = useState(false);
  const [positionPreview, setPositionPreview] = useState(null);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [zoom, setZoom] = useState('fit');
  const sceneReady = useCallback(value => setReady(value), []);
  const previewPosition = useCallback(value => { setPositionPreview(value); if (value) setPlaying(false); }, [setPlaying]);
  return { leftTab, setLeftTab, rightTab, setRightTab, nudge, setNudge, ready, sceneReady, positionPreview, setPositionPreview, previewPosition, timelineOpen, setTimelineOpen, zoom, setZoom };
}
