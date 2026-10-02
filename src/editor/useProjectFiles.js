import { useCallback, useRef, useState } from 'react';
import { validateProject, fileLayer, carouselImages } from '../project.js';
import { request } from './request.js';

export function useProjectFiles({ projectRef, change, patch, setError, setSelected, setLeftTab }) {
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef();
  const fileTarget = useRef('layers');
  const importInput = useRef();

  const upload = useCallback(async (files, target) => {
    setUploading(true);
    setError('');
    try {
      if (target === 'layers' && projectRef.current.layers.length + files.length > 20) throw new Error('Use up to 20 layers.');
      const cardLayer = target.startsWith('cards:') ? projectRef.current.layers.find(l => l.id === target.slice(6) && l.type === 'carousel') : null;
      if (target.startsWith('cards:') && (!cardLayer || cardLayer.locked)) throw new Error('Select an unlocked carousel layer.');
      if (cardLayer && carouselImages(projectRef.current, cardLayer).length + files.length > 24) throw new Error('Use up to 24 carousel assets.');
      const values = [];
      for (const file of files) values.push(await request(`/api/assets?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }));
      if (target === 'layers') {
        const current = projectRef.current;
        const layers = values.map(asset => fileLayer(asset, current.duration, crypto.randomUUID()));
        if (current.layers.length + layers.length > 20) throw new Error('Use up to 20 layers.');
        if (change({ ...current, layers: [...current.layers, ...layers] })) { setSelected(layers.at(-1).id); setLeftTab('layers'); }
      } else if (cardLayer) {
        const current = projectRef.current.layers.find(l => l.id === cardLayer.id);
        if (!current) throw new Error('Carousel no longer exists.');
        patch(current.id, { images: [...carouselImages(projectRef.current, current), ...values.map(({ id, src, name }) => ({ id, src, name }))] });
      } else { const item = values[0]; const layer = projectRef.current.layers.find(layerItem => layerItem.id === target); if (!layer) throw new Error('Layer no longer exists.'); patch(target, { src: item.src, ...(layer.type === 'background' ? { mode: /\.(mp4|webm)$/i.test(item.src) ? 'video' : 'image' } : {}) }); }
    } catch (error) { setError(error.message); }
    finally { setUploading(false); }
  }, [change, patch, projectRef, setError, setSelected, setLeftTab]);

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
      try { change(validateProject(JSON.parse(await file.text()))); }
      catch (error) { setError(error.message); }
    }
    event.target.value = '';
  }, [change, setError]);

  const downloadProject = useCallback(() => {
    const blob = new Blob([JSON.stringify(projectRef.current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'floc-motion-project.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [projectRef]);

  return { uploading, fileInput, importInput, pick, handleFileChange, handleImportChange, downloadProject };
}
