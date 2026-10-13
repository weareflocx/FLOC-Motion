import React from 'react';
import { BRAND } from '../../brand.js';
import '../brand-lockup.css';

// The MOTION mask is split into red, green and blue copies; the login shader
// uses the same offset for its background.
export const BRAND_CHROMATIC_SPLIT = Object.freeze({ x: 3, y: 0.6 });

export function BrandLockup({ className = '' }) {
  return <span className={`brand-lockup ${className}`.trim()} role="img" aria-label="FLOC Motion">
    <img className="brand-lockup-lettering" src={BRAND.assets.loginLettering} alt=""/>
    <img className="brand-lockup-asterisk" src={BRAND.assets.loginAsterisk} alt=""/>
    <span className="brand-lockup-motion" aria-hidden="true" style={{ '--motion-mask': `url("${BRAND.assets.loginMotion}")`, '--split-x': `${BRAND_CHROMATIC_SPLIT.x}px`, '--split-y': `${BRAND_CHROMATIC_SPLIT.y}px` }}><span/></span>
  </span>;
}
