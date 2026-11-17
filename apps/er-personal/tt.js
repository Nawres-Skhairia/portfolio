// Trusted Types: the pages build their screens from escaped text. This default policy is the only way HTML
// reaches the page, and it refuses anything that looks like a script or an inline event handler.
(function () {
  'use strict';
  if (!window.trustedTypes || !window.trustedTypes.createPolicy) return;
  var bad = /<\s*script|<\s*iframe|<\s*object|<\s*embed|\son[a-z]+\s*=|javascript:/i;
  window.trustedTypes.createPolicy('default', {
    createHTML: function (s) { if (bad.test(s)) throw new TypeError('Blocked unsafe HTML'); return s; },
    createScriptURL: function (u) { var url = new URL(u, location.href); if (url.origin !== location.origin) throw new TypeError('Blocked script'); return url.href; }
  });
})();
