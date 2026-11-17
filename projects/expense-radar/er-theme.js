// Expense Radar light and dark. Opens light; a choice made with the switch is kept
// only for this visit (sessionStorage, erased when the tab closes), never sent anywhere. No cookie.
(function () {
  'use strict';
  var root = document.documentElement, KEY = 'er-theme', saved = null;
  try { saved = sessionStorage.getItem(KEY); } catch (e) {}
  root.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
  function sync() { document.querySelectorAll('.theme-switch').forEach(function (b) { b.setAttribute('aria-pressed', root.getAttribute('data-theme') === 'dark' ? 'true' : 'false'); }); }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.theme-switch'); if (!btn) return;
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { sessionStorage.setItem(KEY, next); } catch (err) {}
    sync();
  });
  document.addEventListener('DOMContentLoaded', sync);
  window.erThemeSync = sync;
})();
