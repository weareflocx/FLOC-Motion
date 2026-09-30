import { useCallback, useRef, useState } from 'react';
import { validateProject } from '../project.js';
import { request } from './request.js';

export function useProjectFiles({ projectRef, change, patch, setError }) {
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef();
  const fileTarget = useRef('images');
  const importInput = useRef();

  const upload = useCallback(async (files, target) => {
    setUploading(true);
    setError('');
    try {
      const values = [];
      for (const file of files) values.push(await request(`/api/assets?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }));
      if (target === 'images') change({ ...projectRef.current, images: [...projectRef.current.images, ...values.map(({ id, src, name }) => ({ id, src, name }))] });
      else { const item = values[0]; const layer = projectRef.current.layers.find(layerItem => layerItem.id === target); patch(target, { src: item.src, ...(layer.type === 'background' ? { mode: item.type.startsWith('video') ? 'video' : 'image' } : {}) }); }
    } catch (error) { setError(error.message); }
    finally { setUploading(false); }
  }, [change, patch, projectRef, setError]);

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
