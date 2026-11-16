// Lenis 1.3.27 + its official Snap extension (MIT), bundled locally by Hugo.
import Lenis from './vendor/lenis.mjs';
import Snap from './vendor/lenis-snap.mjs';

const home = document.querySelector('.home--landing');
const reading = document.querySelector('#featured');
const motion = window.matchMedia('(prefers-reduced-motion: no-preference) and (min-height: 601px) and (pointer: fine)');
let cleanup;

function setupMotion() {
  cleanup?.();
  cleanup = undefined;
  if (!home || !reading || !motion.matches) return;

  const lenis = new Lenis({
    autoRaf: true,
    lerp: 0.11,
    smoothWheel: true,
    syncTouch: false,
    anchors: { duration: 0.95 },
  });
  const snap = new Snap(lenis, {
    type: 'proximity',
    distanceThreshold: '60%',
    debounce: 180,
    lerp: 0.1,
  });
  // Only magnetise the entrance to reading. Returning upward and scrolling
  // through longer recommendations remain under the reader's control.
  snap.addElement(reading, { align: 'start' });
  snap.stop();
  lenis.on('virtual-scroll', ({ deltaY }) => {
    if (deltaY > 0 && lenis.scroll < reading.offsetTop - 2) snap.start();
    else snap.stop();
  });
  const update = () => {
    const progress = Math.max(0, Math.min(1, lenis.scroll / reading.offsetTop));
    home.style.setProperty('--home-drift', `${progress * 24}px`);
    home.style.setProperty('--home-opacity', String(1 - progress * 0.18));
    home.style.setProperty('--home-hint-opacity', String(Math.max(0, 1 - progress * 3)));
  };
  lenis.on('scroll', update);
  update();
  cleanup = () => {
    snap.destroy();
    lenis.destroy();
    for (const name of ['--home-drift', '--home-opacity', '--home-hint-opacity']) home.style.removeProperty(name);
  };
}

setupMotion();
motion.addEventListener('change', setupMotion);
