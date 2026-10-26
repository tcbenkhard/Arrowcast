import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';

/** Owns fullscreen entry, focus restoration, and automatic standings scrolling. */
export function useFullscreenStandings(competitionId: string) {
  const panel = useRef<HTMLElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  useEffect(() => {
    function onFullscreenChange() {
      const active = document.fullscreenElement === panel.current;
      setFullscreen(active);
      if (!active) fullscreenButton.current?.focus();
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);
  useEffect(() => {
    const element = panel.current;
    if (!fullscreen || !element) return;

    const pixelsPerSecond = 28;
    const pauseMilliseconds = 3000;
    let position = 0;
    let direction = 1;
    let previousTime = performance.now();
    let pauseUntil = previousTime + pauseMilliseconds;
    let frame: number;
    element.scrollTo({ top: 0, behavior: 'instant' });
    let lastScrollTop = element.scrollTop;

    function pauseForManualScroll() {
      if (!element) return;
      position = element.scrollTop;
      lastScrollTop = position;
      pauseUntil = performance.now() + pauseMilliseconds;
      if (position <= 0) direction = 1;
      else if (position >= element.scrollHeight - element.clientHeight) direction = -1;
    }

    function onScroll() {
      // Our own animation also fires scroll events; only pause for a different position.
      if (element && Math.abs(element.scrollTop - lastScrollTop) > 0.5) pauseForManualScroll();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
        pauseForManualScroll();
      }
    }

    element.addEventListener('scroll', onScroll, { passive: true });
    element.addEventListener('wheel', pauseForManualScroll, { passive: true });
    element.addEventListener('touchmove', pauseForManualScroll, { passive: true });
    element.addEventListener('keydown', onKeyDown);

    function scroll(time: number) {
      if (!element || document.fullscreenElement !== element) return;
      onScroll();
      // Cap elapsed time so returning from a background tab cannot jump through the scores.
      const elapsed = Math.min(time - previousTime, 100);
      previousTime = time;
      const bottom = Math.max(0, element.scrollHeight - element.clientHeight);
      if (bottom === 0) {
        position = 0;
        direction = 1;
        pauseUntil = time + pauseMilliseconds;
      } else if (time >= pauseUntil) {
        // Keep fractional pixels so slow scrolling is consistent across refresh rates.
        position = Math.max(0, Math.min(bottom, position + (direction * pixelsPerSecond * elapsed) / 1000));
        element.scrollTo({ top: position, behavior: 'instant' });
        lastScrollTop = element.scrollTop;
        if ((direction === 1 && position === bottom) || (direction === -1 && position === 0)) {
          direction *= -1;
          pauseUntil = time + pauseMilliseconds;
        }
      }
      frame = requestAnimationFrame(scroll);
    }

    frame = requestAnimationFrame(scroll);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('wheel', pauseForManualScroll);
      element.removeEventListener('touchmove', pauseForManualScroll);
      element.removeEventListener('keydown', onKeyDown);
    };
  }, [fullscreen, competitionId]);
  async function toggleFullscreen() {
    setFullscreenError('');
    try {
      if (document.fullscreenElement === panel.current) await document.exitFullscreen();
      else await panel.current?.requestFullscreen();
    } catch {
      setFullscreenError(t('ScoringSettings.fullscreen_failed'));
    }
  }
  return { panel, fullscreenButton, fullscreen, fullscreenError, toggleFullscreen };
}
