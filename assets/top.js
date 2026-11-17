// Home page only, loaded in the page head. On refresh, always start at the top (phones otherwise
// jump back to the last section). Going Back from a project page keeps the visitor's place (PORT-43).
// A file, not inline code, so the browser safety settings stay strict (PORT-26). Nothing is stored.
(function () {
  'use strict';
  var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  var reload = !!nav && nav.type === 'reload';
  // Only a reload changes anything; any other visit (first visit, Back, a link) keeps the browser's own behaviour.
  if ('scrollRestoration' in history) history.scrollRestoration = reload ? 'manual' : 'auto';
  if (!reload) return;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  var stopped = false;
  var stop = function () { stopped = true; };
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (e) { window.addEventListener(e, stop, { passive: true, once: true }); });
  var top = function () {
    if (stopped) return;
    document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); document.documentElement.style.scrollBehavior = '';
  };
  top();
  document.addEventListener('DOMContentLoaded', top);
  window.addEventListener('load', function () {
    top();
    // The browser may still restore the old position just after load: hold the top briefly.
    [50, 150, 300, 600].forEach(function (ms) { setTimeout(top, ms); });
  });
  window.addEventListener('pageshow', top);
})();

// Entrances on scroll and the page change from a tool. Runs in the head so nothing flashes before it starts.
// Only when the visitor allows motion; the page reads the same without it. Nothing is stored.
(function () {
  'use strict';
  var root = document.documentElement;
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Browser Back or Forward: show everything at once, so the browser puts the visitor back in the same place (PORT-43)
  var entry = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  if (entry && entry.type === 'back_forward') return;
  root.classList.add('fx');
  try {
    var ref = document.referrer && new URL(document.referrer);
    if (ref && ref.origin === location.origin && ref.pathname.indexOf('/projects/') === 0) root.classList.add('from-tool');
  } catch (e) {}
  var showAll = function () { document.querySelectorAll('.section-head, .rows li, .about, .contact-box').forEach(function (el) { el.classList.add('in'); }); };
  document.addEventListener('DOMContentLoaded', function () {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
    document.querySelectorAll('.section-head, .rows li, .about, .contact-box').forEach(function (el) { io.observe(el); });
    // printing or jumping straight to a section shows everything
    window.addEventListener('beforeprint', showAll);
    if (location.hash) setTimeout(showAll, 50);
  });
  // Back/forward from the browser cache: no panel left over
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    root.classList.remove('from-tool');
    document.querySelectorAll('.pt-panel, .pt-pic').forEach(function (n) { n.remove(); });
  });
})();
