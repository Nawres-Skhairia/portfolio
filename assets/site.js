// Site-wide script (moved out of the pages for the browser safety settings, PORT-26).
(function () {
  'use strict';
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();
