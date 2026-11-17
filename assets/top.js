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
