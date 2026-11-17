// Site-wide script (same origin, no inline code, for the browser safety settings, PORT-26).
// Only small finishing touches: the page works and reads the same without it.
(function () {
  'use strict';
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || calm) return;

  var root = document.documentElement;
  root.classList.add('has-cursor');
  var ring = document.querySelector('.cursor');
  var tx = -100, ty = -100, cx = -100, cy = -100, raf = 0;

  function loop() {
    cx += (tx - cx) * 0.22;
    cy += (ty - cy) * 0.22;
    if (ring) { ring.style.setProperty('--cx', cx + 'px'); ring.style.setProperty('--cy', cy + 'px'); }
    raf = (Math.abs(tx - cx) + Math.abs(ty - cy) > 0.3) ? requestAnimationFrame(loop) : 0;
  }
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX; ty = e.clientY;
    root.classList.add('cursor-on');
    root.classList.toggle('cursor-link', !!e.target.closest('a, button'));
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });
  document.addEventListener('pointerleave', function () { root.classList.remove('cursor-on'); });
  document.addEventListener('pointerdown', function () { root.classList.add('cursor-down'); });
  document.addEventListener('pointerup', function () { root.classList.remove('cursor-down'); });

  // light that follows the pointer, and a slow drift of the screenshot
  function track(sel, fn) {
    document.querySelectorAll(sel).forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        fn(el, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e, r);
      }, { passive: true });
      el.addEventListener('pointerleave', function () { fn(el, null); });
    });
  }
  track('.row', function (el, x, yy) {
    var img = el.querySelector('.media img');
    if (x === null) { if (img) { img.style.removeProperty('--ix'); img.style.removeProperty('--iy'); } return; }
    el.style.setProperty('--mx', (x * 100) + '%');
    el.style.setProperty('--my', (yy * 100) + '%');
    if (img) { img.style.setProperty('--ix', ((0.5 - x) * 14) + 'px'); img.style.setProperty('--iy', ((0.5 - yy) * 10) + 'px'); }
  });
  track('.proof', function (el, x, yy) {
    if (x === null) { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); return; }
    el.style.setProperty('--mx', (x * 100) + '%');
    el.style.setProperty('--my', (yy * 100) + '%');
    el.style.setProperty('--rx', ((0.5 - yy) * 6) + 'deg');
    el.style.setProperty('--ry', ((x - 0.5) * 8) + 'deg');
  });
  track('.contact-box', function (el, x, yy) {
    if (x === null) return;
    el.style.setProperty('--mx', (x * 100) + '%');
    el.style.setProperty('--my', (yy * 100) + '%');
  });

  // buttons lean towards the pointer, and their fill starts where the pointer came in
  track('.magnetic', function (el, x, yy) {
    if (x === null) { el.style.setProperty('--tx', '0px'); el.style.setProperty('--ty', '0px'); return; }
    el.style.setProperty('--px', (x * 100) + '%');
    el.style.setProperty('--py', (yy * 100) + '%');
    el.style.setProperty('--tx', ((x - 0.5) * 10) + 'px');
    el.style.setProperty('--ty', ((yy - 0.5) * 8) + 'px');
  });
})();
