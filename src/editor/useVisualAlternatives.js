import { useCallback, useRef, useState } from 'react';
import { createStyleAlternatives } from '../visual-alternatives.js';

export function useVisualAlternatives({ projectRef, change, setPlaying, blocked = false }) {
  const [proposal, setProposal] = useState(null);
  const pending = useRef(null);
  const blockedRef = useRef(blocked); blockedRef.current = blocked;
  const close = useCallback(() => { pending.current = null; setProposal(null); }, []);
  const propose = useCallback(next => {
    if (blockedRef.current) throw new Error('Finish the current edit or close the other dialog before comparing alternatives.');
    if (pending.current) throw new Error('Close the current comparison before presenting another set of alternatives.');
    if (next.base !== projectRef.current) throw new Error('The composition changed. Request alternatives again.');
    setPlaying(false);
    pending.current = next;
    setProposal(next);
  }, [projectRef, setPlaying]);
  const explore = useCallback(() => propose(createStyleAlternatives(projectRef.current)), [projectRef, propose]);
  const apply = useCallback(index => {
    const current = pending.current;
    if (blockedRef.current) throw new Error('Finish the current edit before applying an alternative.');
    if (!current || current.base !== projectRef.current) throw new Error('The composition changed. Request alternatives again.');
    if (!Number.isInteger(index) || !current.alternatives[index]) throw new Error('Choose an alternative.');
    const result = change(current.alternatives[index].project);
    if (!result) throw new Error('The alternative could not be applied.');
    setPlaying(false);
    close();
    return result;
  }, [projectRef, change, setPlaying, close]);
  return { proposal, propose, explore, apply, close };
}
