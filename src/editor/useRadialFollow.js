import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

const EDGE = 8;
const DWELL = 150;
const STILL = 4;

// The ring opens fixed where it was summoned, so the pointer can go straight to an icon. Leaving
// the ring glues it to the pointer, centered and without lag; pausing for DWELL ms (moves under
// STILL px count as a pause, for trackpad jitter) fixes it again. A press or a key fixes it at
// once. `area` bounds the ring's box.
export function useRadialFollow(menu, origin, area) {
  const areaRef = useRef(area);
  areaRef.current = area;
  useEffect(() => {
    const node = menu.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let size, release, target, pointer, glued = false, still = null, timer = null;
    // While glued the ring sits exactly on the pointer plus `gap`; `gap` only eases the jump
    // from where the ring was to the pointer when it re-attaches, then stays at zero.
    const gap = { x: 0, y: 0 };
    const context = gsap.context(() => {}, node);
    const fit = (value, low, high) => low > high ? (low + high) / 2 : Math.max(low, Math.min(high, value));
    function clamp(point) {
      const box = areaRef.current?.() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight), half = size / 2 + EDGE;
      return { x: fit(point.x, box.left + half, box.right - half), y: fit(point.y, box.top + half, box.bottom - half) };
    }
    function place(point) {
      target = clamp(point);
      gsap.set(node, { x: target.x - size / 2, y: target.y - size / 2 });
    }
    const follow = () => place({ x: pointer.x + gap.x, y: pointer.y + gap.y });
    function fix() { clearTimeout(timer); timer = null; glued = false; gsap.killTweensOf(gap); }
    function freeze() { if (glued) fix(); }
    function measure() {
      size = node.offsetWidth;
      release = size * .36 + 36;
      place(target ?? origin);
    }
    function move(event) {
      if (reducedMotion.matches || event.pointerType === 'touch' || event.buttons) return;
      pointer = { x: event.clientX, y: event.clientY };
      const point = pointer;
      if (!glued) {
        if (Math.hypot(point.x - target.x, point.y - target.y) <= release) return;
        glued = true;
        gap.x = target.x - point.x; gap.y = target.y - point.y;
        context.add(() => gsap.to(gap, { x: 0, y: 0, duration: .12, ease: 'power2.out', overwrite: true, onUpdate: follow }));
      }
      follow();
      if (!timer || Math.hypot(point.x - still.x, point.y - still.y) > STILL) {
        still = point;
        clearTimeout(timer);
        timer = setTimeout(fix, DWELL);
      }
    }
    measure();
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerdown', freeze, true);
    document.addEventListener('keydown', freeze, true);
    window.addEventListener('blur', freeze);
    window.addEventListener('resize', measure);
    reducedMotion.addEventListener('change', freeze);
    return () => {
      clearTimeout(timer);
      context.revert();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', freeze, true);
      document.removeEventListener('keydown', freeze, true);
      window.removeEventListener('blur', freeze);
      window.removeEventListener('resize', measure);
      reducedMotion.removeEventListener('change', freeze);
    };
  }, [menu, origin.x, origin.y]);
}
