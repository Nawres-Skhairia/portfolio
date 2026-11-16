// Site-wide script (moved out of the pages for the browser safety settings, PORT-26).
(function () {
  'use strict';
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
  // Home page only: on refresh, always start at the top (phones otherwise jump back to the last section).
  if (!document.body || !document.body.hasAttribute('data-top-on-reload')) return;
  var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  if (!nav || nav.type !== 'reload') return;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  var top = function () { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); document.documentElement.style.scrollBehavior = ''; };
  top(); window.addEventListener('load', top); window.addEventListener('pageshow', top);
})();
