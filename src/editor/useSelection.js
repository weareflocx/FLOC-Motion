import { useCallback, useEffect, useRef, useState } from 'react';
import { pruneSelection, rangeSelection, singleSelection, toggleSelection } from './selection.js';

// Ordered multi-selection; `selected` is the primary (last clicked) layer that
// single-layer panels follow. Shift ranges extend from the last plain or toggle click.
export function useSelection({ layers, initial = null }) {
  const [selection, setSelectionState] = useState(() => singleSelection(initial));
  const anchor = useRef(initial);
  const selected = selection.at(-1) ?? null;
  const setSelection = useCallback(ids => { anchor.current = ids.at(-1) ?? null; setSelectionState(ids); }, []);
  const setSelected = useCallback(id => setSelection(singleSelection(id)), [setSelection]);
  // `mode`: undefined replaces, 'toggle' adds/removes, 'range' spans `order` (ids as listed) from the anchor.
  const selectLayer = useCallback((id, mode, order) => {
    if (mode === 'range' && order) setSelectionState(ids => rangeSelection(order, anchor.current ?? ids.at(-1), id));
    else if (mode === 'toggle') { anchor.current = id; setSelectionState(ids => toggleSelection(ids, id)); }
    else setSelected(id);
  }, [setSelected]);
  useEffect(() => {
    const kept = pruneSelection(selection, layers);
    if (kept !== selection) setSelection(kept.length ? kept : singleSelection(layers[0]?.id));
  }, [layers, selection, setSelection]);
  return { selection, selected, setSelection, setSelected, selectLayer };
}
