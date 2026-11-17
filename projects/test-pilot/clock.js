// The demo clock, shared by the form and the test robot.
// Fixed on purpose: results must never depend on the real day or on the visitor's time zone.
// The restaurant is in Paris (UTC+1 in December). All dates are plain 'YYYY-MM-DD' strings.
(function (root) {
  'use strict';
  const CLOCK = {
    zone: 'Europe/Paris',
    today: '2026-12-01',          // a Tuesday
    time: '13:00',                // restaurant time
    instantUtc: Date.UTC(2026, 11, 1, 12, 0), // the same moment in UTC (13:00 Paris = 12:00 UTC)
    label: 'Demo clock: Tuesday 1 December 2026, 13:00 (restaurant time, Paris).'
  };
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Day of the week of a 'YYYY-MM-DD' date, worked out in UTC so no time zone can shift it.
  CLOCK.weekday = function (iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  };
  // The calendar date seen in another UTC offset at the demo instant (used only by planted bug 4).
  CLOCK.dateAtOffset = function (hours) {
    const t = new Date(CLOCK.instantUtc + hours * 3600000);
    return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0');
  };
  root.TP_CLOCK = CLOCK;
})(typeof window !== 'undefined' ? window : globalThis);
