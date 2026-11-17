// "Table for tonight": the pretend booking form that Test Pilot tests.
// The bug switch comes from the address (?bug=0 clean, 1 to 6 = one planted bug).
// Each bug is planted ON PURPOSE for the demo and named to the visitor after the run.
(function () {
  'use strict';
  const BUG = Number(new URLSearchParams(location.search).get('bug')) || 0;
  const C = window.TP_CLOCK;
  const $ = (id) => document.getElementById(id);
  const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  let bookings = 0;

  $('clock').textContent = C.label;

  // Returns an error message, or '' when the booking is accepted.
  function check(v) {
    if (!v.date || !v.time || v.guests === '') return 'Please choose a date, a time and the number of guests.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return 'Please choose a valid date.';
    if (v.date < C.today) return 'This date has already passed.';
    if (C.weekday(v.date) === 'Monday' && BUG !== 2) return 'We are closed on Mondays.';      // bug 2: Monday rule forgotten
    if (!/^\d{2}:\d{2}$/.test(v.time)) return 'Please choose a valid time.';
    const t = minutes(v.time);
    const lunchEnd = BUG === 3 ? '14:45' : '14:30';                                             // bug 3: lunch ends 15 minutes late
    const open = (t >= minutes('12:00') && t <= minutes(lunchEnd)) || (t >= minutes('19:00') && t <= minutes('22:00'));
    if (!open) return 'We take bookings from 12:00 to 14:30 and from 19:00 to 22:00.';
    if (!/^\d+$/.test(v.guests)) return 'Tables are for 1 to 8 guests.';
    const g = Number(v.guests);
    const max = BUG === 1 ? 9 : 8;                                                              // bug 1: off by one, 9 guests accepted
    if (g < 1 || g > max) return 'Tables are for 1 to 8 guests.';
    if (!v.email) return 'Please enter your email.';
    const emailOk = BUG === 5 ? /^[^\s@+]+@[^\s@]+\.[^\s@]+$/ : /^[^\s@]+@[^\s@]+\.[^\s@]+$/;   // bug 5: "+" refused
    if (!emailOk.test(v.email)) return 'Please enter a valid email.';
    return '';
  }

  function show(err, v) {
    $('error').hidden = !err; $('error').textContent = err;
    $('summary').hidden = !!err;
    if (!err) { $('sumDate').textContent = v.date; $('sumTime').textContent = v.time; $('sumGuests').textContent = v.guests; }
    $('result').dataset.state = err ? 'refused' : 'accepted';
  }

  let saving = false;
  $('booking').addEventListener('submit', (e) => {
    e.preventDefault();
    // A real form must ignore a second click while the first booking is being saved.
    if (saving && BUG !== 6) return;                                                            // bug 6: double click = two bookings
    const v = { date: $('date').value.trim(), time: $('time').value.trim(), guests: $('guests').value.trim(), email: $('email').value.trim() };
    const err = check(v);
    if (!err) { bookings++; $('count').textContent = String(bookings); saving = true; setTimeout(() => { saving = false; }, 400); }
    show(err, v);
  });

  // "Tonight" means today in the restaurant's time zone.
  $('tonight').addEventListener('click', () => {
    $('date').value = BUG === 4 ? C.dateAtOffset(13) : C.today;                                 // bug 4: date taken in Auckland (UTC+13)
    $('time').value = '19:30';
    $('date').dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Typing again clears the last answer, like a real form.
  $('booking').addEventListener('input', () => { $('result').dataset.state = 'none'; $('error').hidden = true; $('summary').hidden = true; });
})();
