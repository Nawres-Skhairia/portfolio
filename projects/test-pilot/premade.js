// The user story shipped with the page, and the PRE-MADE plan for it (R8: "pre-made plan, no AI").
// This file is written by hand. When AI comes in a later version, it will produce the same two things (rules + plan)
// from whatever story the visitor typed, and they go through exactly the same check.
(function (root) {
  'use strict';
  const STORY = 'As a guest, I want to book a table online. Rules: bookings for 1 to 8 guests; open Tuesday to Sunday, closed on Monday; lunch 12:00 to 14:30, dinner 19:00 to 22:00; no booking in the past ("tonight" means today in the restaurant\'s time zone); email is required and must look like an email (addresses with "+" are valid); after booking I see a summary with the same date, time and number of guests, and one click makes one booking.';

  // Step 2, Read: the story as rules with values. AC = acceptance criterion.
  const RULES = [
    { id: 'AC1', kind: 'guests_range', min: 1, max: 8, text: 'Bookings for 1 to 8 guests.' },
    { id: 'AC2', kind: 'closed_days', days: ['Monday'], text: 'Closed on Monday.' },
    { id: 'AC3', kind: 'opening_hours', windows: [['12:00', '14:30'], ['19:00', '22:00']], text: 'Lunch 12:00 to 14:30, dinner 19:00 to 22:00.' },
    { id: 'AC4', kind: 'no_past', text: 'No booking in the past; "tonight" means today in the restaurant\'s time zone.' },
    { id: 'AC5', kind: 'email', text: 'Email required and valid; "+" is allowed.' },
    { id: 'AC6', kind: 'summary', text: 'The summary repeats date, time and guests; one click makes one booking.' }
  ];

  // Step 3, Plan: tests picked from the library, with one plain "why" each.
  const PLAN = [
    { rule: 'AC6', technique: 'happy_path', field: 'booking', value: null, why: 'A normal booking must work before anything else matters.' },
    { rule: 'AC1', technique: 'boundary', field: 'guests', value: '0', why: 'Just below the smallest table: must be refused.' },
    { rule: 'AC1', technique: 'boundary', field: 'guests', value: '1', why: 'The smallest table allowed: must be accepted.' },
    { rule: 'AC1', technique: 'boundary', field: 'guests', value: '8', why: 'The largest table allowed: must be accepted.' },
    { rule: 'AC1', technique: 'boundary', field: 'guests', value: '9', why: 'One guest too many: off-by-one mistakes hide here.' },
    { rule: 'AC2', technique: 'day_rule', field: 'date', value: '2026-12-07', why: 'A Monday: the restaurant is closed.' },
    { rule: 'AC2', technique: 'day_rule', field: 'date', value: '2026-12-06', why: 'A Sunday, the day before closing: must be open.' },
    { rule: 'AC3', technique: 'time_window', field: 'time', value: '12:00', why: 'The first lunch slot: must be accepted.' },
    { rule: 'AC3', technique: 'time_window', field: 'time', value: '14:30', why: 'The last lunch slot: must be accepted.' },
    { rule: 'AC3', technique: 'time_window', field: 'time', value: '14:31', why: 'One minute after lunch ends: must be refused.' },
    { rule: 'AC3', technique: 'time_window', field: 'time', value: '18:59', why: 'One minute before dinner starts: must be refused.' },
    { rule: 'AC3', technique: 'time_window', field: 'time', value: '22:00', why: 'The last dinner slot: must be accepted.' },
    { rule: 'AC4', technique: 'past_date', field: 'date', value: '2026-11-30', why: 'Yesterday: a booking in the past must be refused.' },
    { rule: 'AC4', technique: 'day_rule', field: 'date', value: 'tonight', why: '"Tonight" must mean today where the restaurant is, not somewhere else.' },
    { rule: 'AC5', technique: 'required_empty', field: 'email', value: '', why: 'Email is required: an empty box must be refused.' },
    { rule: 'AC5', technique: 'format', field: 'email', value: 'alex.martin@', why: 'Half an address must be refused.' },
    { rule: 'AC5', technique: 'format', field: 'email', value: 'alex+tables@example.com', why: 'Addresses with "+" are valid and often wrongly refused.' },
    { rule: 'AC6', technique: 'summary', field: 'booking', value: null, why: 'The summary must repeat exactly what was booked.' },
    { rule: 'AC6', technique: 'state', field: 'booking', value: null, why: 'An impatient double click must not create two bookings.' }
  ];

  // The six planted bugs, shown only after a run (R14: "planted on purpose for this demo").
  const BUGS = [
    { n: 0, short: 'Clean form', long: 'No bug. Every test should pass.' },
    { n: 1, short: 'Bug 1', long: '9 guests are accepted (boundary, AC1).' },
    { n: 2, short: 'Bug 2', long: 'Monday is accepted (day rule, AC2).' },
    { n: 3, short: 'Bug 3', long: '14:45 is accepted at lunch (time window boundary, AC3).' },
    { n: 4, short: 'Bug 4', long: '"Tonight" is booked as tomorrow (time zone, AC4).' },
    { n: 5, short: 'Bug 5', long: 'An email with "+" is refused (valid input rejected, AC5).' },
    { n: 6, short: 'Bug 6', long: 'A double click creates two bookings (state, AC6).' }
  ];

  root.TP_PREMADE = { STORY, RULES, PLAN, BUGS };
})(typeof window !== 'undefined' ? window : globalThis);
