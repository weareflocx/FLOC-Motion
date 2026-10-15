import { useCallback, useRef, useState } from 'react';
import { PROJECT_LIMITS, carouselImages } from '../project.js';
import { assetLayer, cardFromAsset, sourcePatch } from '../media-library.js';
import { uploadAssets } from './upload-assets.js';
import { parseProjectFile } from './project-import.js';

const cardLayerOf = (project, target) => target.startsWith('cards:') ? project.layers.find(l => l.id === target.slice(6) && l.type === 'carousel') : null;
function checkCards(project, target, count) {
  const layer = cardLayerOf(project, target);
  if (!layer || layer.locked) throw new Error('Select an unlocked carousel layer.');
  if (carouselImages(project, layer).length + count > PROJECT_LIMITS.maxImages) throw new Error(`Use up to ${PROJECT_LIMITS.maxImages} carousel assets.`);
  return layer;
}

export function useProjectFiles({ projectRef, change, importDraft = change, patch, setError, setSelected, setLeftTab }) {
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef();
  const fileTarget = useRef('layers');
  const importInput = useRef();

  // Uploaded or library assets become new layers ('layers', optionally centered on a canvas
  // point), carousel cards ('cards:<layer id>') or a layer's new source (its id).
  const applyAssets = useCallback((assets, target, point) => {
    const current = projectRef.current;
    if (target === 'layers') {
      if (current.layers.length + assets.length > PROJECT_LIMITS.maxLayers) throw new Error(`Use up to ${PROJECT_LIMITS.maxLayers} layers.`);
      const layers = assets.map(asset => assetLayer(asset, current, crypto.randomUUID(), point));
      if (change({ ...current, layers: [...current.layers, ...layers] })) setSelected(layers.at(-1).id);
    } else if (target.startsWith('cards:')) {
      const layer = checkCards(current, target, assets.length);
      patch(layer.id, { images: [...carouselImages(current, layer), ...assets.map(asset => cardFromAsset(asset, crypto.randomUUID()))] });
    } else {
      const layer = current.layers.find(item => item.id === target);
      if (!layer) throw new Error('Layer no longer exists.');
      patch(target, sourcePatch(layer, assets[0]));
    }
  }, [change, patch, projectRef, setSelected]);

  const placeAssets = useCallback((assets, target, point) => {
    setError('');
    try { applyAssets(assets, target, point); } catch (error) { setError(error.message); }
  }, [applyAssets, setError]);

  const upload = useCallback(async (files, target) => {
    setUploading(true);
    setError('');
    try {
      if (target.startsWith('cards:')) checkCards(projectRef.current, target, files.length);
      const replacingModel = projectRef.current.layers.find(layer => layer.id === target)?.type === 'model';
      const values = await uploadAssets(files, target === 'layers'
        ? { maxFiles: PROJECT_LIMITS.maxLayers - projectRef.current.layers.length, limitMessage: `Use up to ${PROJECT_LIMITS.maxLayers} layers.` }
        : replacingModel ? { maxFiles: 1, modelOnly: true } : {});
      applyAssets(values, target);
      if (target === 'layers') setLeftTab('layers');
    } catch (error) { setError(error.message); }
    finally { setUploading(false); }
  }, [applyAssets, projectRef, setError, setLeftTab]);

  const pick = useCallback((target, accept, multiple = false) => {
    fileTarget.current = target;
    fileInput.current.accept = accept;
    fileInput.current.multiple = multiple;
    fileInput.current.click();
  }, []);

  const handleFileChange = useCallback(event => {
    if (event.target.files.length) upload([...event.target.files], fileTarget.current);
    event.target.value = '';
  }, [upload]);

  const handleImportChange = useCallback(async event => {
    const file = event.target.files[0];
    if (file) {
      try { importDraft(await parseProjectFile(file)); }
      catch (error) { setError(error.message); }
    }
    event.target.value = '';
  }, [importDraft, setError]);

  const downloadProject = useCallback(() => {
    const blob = new Blob([JSON.stringify(projectRef.current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'floc-motion-project.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [projectRef]);

  return { uploading, fileInput, importInput, pick, placeAssets, handleFileChange, handleImportChange, downloadProject };
}
