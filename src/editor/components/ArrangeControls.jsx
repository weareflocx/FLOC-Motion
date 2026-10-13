import React from 'react';
import { AlignBottom, AlignCenterHorizontal, AlignCenterVertical, AlignLeft, AlignRight, AlignTop, ArrowsOutLineHorizontal, ArrowsOutLineVertical } from '@phosphor-icons/react';
import { IconButton } from '../controls.jsx';
import { ALIGN_TITLES } from '../commands.js';

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenterHorizontal, right: AlignRight, top: AlignTop, middle: AlignCenterVertical, bottom: AlignBottom };

export function ArrangeControls({ className, target, canAlign, canDistribute, onArrange, size = 16 }) {
  return <div className={className} role="group" aria-label="Align and distribute">
    {ALIGN_TITLES.map(([mode, title]) => { const Icon = ALIGN_ICONS[mode]; return <IconButton key={mode} label={`${title} to ${target}`} disabled={!canAlign} onClick={() => onArrange(mode)}><Icon size={size}/></IconButton>; })}
    <IconButton label="Distribute horizontally" disabled={!canDistribute} onClick={() => onArrange('horizontal')}><ArrowsOutLineHorizontal size={size}/></IconButton>
    <IconButton label="Distribute vertically" disabled={!canDistribute} onClick={() => onArrange('vertical')}><ArrowsOutLineVertical size={size}/></IconButton>
  </div>;
}
