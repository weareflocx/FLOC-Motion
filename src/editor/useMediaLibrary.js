import { useCallback, useEffect, useState } from 'react';
import { request } from './request.js';
import { onAssetsUploaded } from './upload-assets.js';

// The workspace's uploads, refreshed whenever any editor flow uploads more.
export function useMediaLibrary() {
  const [state, setState] = useState({ assets: [], loading: true, error: '' });
  const refresh = useCallback(async () => {
    try { const { assets } = await request('/api/assets'); setState({ assets, loading: false, error: '' }); }
    catch (error) { setState(current => ({ ...current, loading: false, error: error.message })); }
  }, []);
  useEffect(() => { refresh(); return onAssetsUploaded(refresh); }, [refresh]);
  return state;
}
