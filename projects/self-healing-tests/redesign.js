// The redesign slider: every stop is a fixed, written-down list of changes to the shop page.
// Same stop, same page, every time. Stops add up: stop 2 also has every change of stop 1.
// Loaded by the shop page (to apply the changes) and by the tool page (to list them).
(function (root) {
  'use strict';
  const STOPS = [
    { stop: 0, name: 'Original', ops: [] },
    { stop: 1, name: 'Renamed', ops: [
      { op: 'rename', from: 'email', to: 'contact-email', note: 'Email box: test id renamed, label now "Email address".', label: 'Email address' },
      { op: 'rename', from: 'name', to: 'full-name', note: 'Name box: test id renamed, label now "Full name".', label: 'Full name' },
      { op: 'rename', from: 'total', to: 'order-total', note: 'Total: test id renamed, label now "Total to pay".', labelId: 'total-label', label: 'Total to pay' },
      { op: 'rename', from: 'place', to: 'btn-place', note: 'Order button: test id renamed.' }
    ] },
    { stop: 2, name: 'Moved and renamed', ops: [
      { op: 'rename', from: 'delivery', to: 'shipping', note: 'Delivery choice: test id renamed, label now "Shipping".', label: 'Shipping' },
      { op: 'rename', from: 'code', to: 'promo', note: 'Discount box: test id renamed, label now "Promo code".', label: 'Promo code' },
      { op: 'rename', from: 'apply', to: 'use-promo', note: 'Apply button: test id renamed, text now "Use code".', text: 'Use code' },
      { op: 'rename', from: 'qty-mug', to: 'mug-qty', note: 'Mug amount: test id renamed.' },
      { op: 'move', el: 'sec-delivery', before: 'sec-basket', note: 'Delivery moved above the basket.' },
      { op: 'wrap', el: 'sec-contact', note: 'Your details wrapped in a new "Step 2 of 3" block.', title: 'Step 2 of 3' }
    ] },
    { stop: 3, name: 'New layout', ops: [
      { op: 'rename', from: 'qty-beans', to: 'beans-qty', note: 'Coffee beans amount: test id renamed.' },
      { op: 'rename', from: 'code-msg', to: 'promo-note', note: 'Discount message: test id renamed, now called "Promo message".', aria: 'Promo message' },
      { op: 'rename', from: 'cancel', to: 'action-2', note: 'Cancel button: test id now a generic "action-2".' },
      { op: 'rename', from: 'btn-place', to: 'action-1', note: 'Order button: test id now a generic "action-1", text now "Confirm order".', text: 'Confirm order' },
      { op: 'rename', from: 'result', to: 'status-line', note: 'Order status line: test id renamed.' },
      { op: 'swap', a: 'action-1', b: 'action-2', note: 'The two buttons swapped places: Cancel is now where the order button was.' },
      { op: 'layout', note: 'New two-column layout.' },
      { op: 'bug', note: 'A developer mistake slipped in: the total now forgets the delivery fee.', hidden: true }
    ] }
  ];
  // All changes up to and including a stop.
  function opsUpTo(stop) {
    return STOPS.filter((s) => s.stop <= stop).reduce((all, s) => all.concat(s.ops.map((o) => Object.assign({ stop: s.stop }, o))), []);
  }
  root.SH_REDESIGN = { STOPS, opsUpTo };
})(typeof window !== 'undefined' ? window : globalThis);
