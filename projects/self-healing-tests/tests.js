// The 8 automated tests, as data. Each step names its target by the test id it had
// on the original page. FINGERPRINTS is what was recorded about each target on that page
// (stop 0): the healer uses it to find the element again when the test id is gone.
(function (root) {
  'use strict';
  const TESTS = [
    { id: 'T1', name: 'Two mugs, picked up in the shop', steps: [
      { do: 'set', target: 'delivery', value: 'pickup', say: 'Choose "Pick up in the shop"' },
      { do: 'set', target: 'qty-mug', value: '2', say: 'Set mugs to 2' },
      { do: 'expect', target: 'total', equals: '€29.00', say: 'Total shows €29.00' }] },
    { id: 'T2', name: 'Standard delivery adds €4.90', steps: [
      { do: 'set', target: 'delivery', value: 'standard', say: 'Choose standard delivery' },
      { do: 'expect', target: 'total', equals: '€25.40', say: 'Total shows €25.40' }] },
    { id: 'T3', name: 'Picking up in the shop is free', steps: [
      { do: 'set', target: 'delivery', value: 'pickup', say: 'Choose "Pick up in the shop"' },
      { do: 'expect', target: 'total', equals: '€20.50', say: 'Total shows €20.50' }] },
    { id: 'T4', name: 'The code WELCOME10 gives 10% off', steps: [
      { do: 'set', target: 'code', value: 'WELCOME10', say: 'Type WELCOME10' },
      { do: 'click', target: 'apply', say: 'Press Apply' },
      { do: 'expect', target: 'code-msg', contains: '10% off', say: 'Message says 10% off' }] },
    { id: 'T5', name: 'A wrong code is refused', steps: [
      { do: 'set', target: 'code', value: 'SAVE99', say: 'Type SAVE99' },
      { do: 'click', target: 'apply', say: 'Press Apply' },
      { do: 'expect', target: 'code-msg', equals: 'Code not valid', say: 'Message says "Code not valid"' }] },
    { id: 'T6', name: 'No email, no order', steps: [
      { do: 'set', target: 'name', value: 'Ada Test', say: 'Type the name Ada Test' },
      { do: 'click', target: 'place', say: 'Press the order button' },
      { do: 'expect', target: 'result', equals: 'Please enter your email', say: 'Asks for the email' }] },
    { id: 'T7', name: 'A complete order is placed', steps: [
      { do: 'set', target: 'name', value: 'Ada Test', say: 'Type the name Ada Test' },
      { do: 'set', target: 'email', value: 'ada@example.test', say: 'Type ada@example.test' },
      { do: 'click', target: 'place', say: 'Press the order button' },
      { do: 'expect', target: 'result', contains: 'Order placed', say: 'Says "Order placed"' }] },
    { id: 'T8', name: 'Cancel empties the basket', steps: [
      { do: 'click', target: 'cancel', say: 'Press Cancel order' },
      { do: 'expect', target: 'result', equals: 'Order cancelled', say: 'Says "Order cancelled"' },
      { do: 'expect', target: 'qty-beans', equals: '0', say: 'Coffee beans back to 0' }] }
  ];
  // Recorded on the original page (stop 0) by record.mjs. The check fails if they drift.
  const FINGERPRINTS = /*FP*/{
    "qty-beans": {
      "id": "qty-beans",
      "test": "qty-beans",
      "kind": "number box",
      "text": "",
      "label": "Coffee beans, 250 g · €12.00",
      "shape": "type-number min-0 max-9 mode-numeric",
      "near": "Basket",
      "x": 0.88,
      "y": 0.15
    },
    "qty-mug": {
      "id": "qty-mug",
      "test": "qty-mug",
      "kind": "number box",
      "text": "",
      "label": "Mug · €8.50",
      "shape": "type-number min-0 max-9 mode-numeric",
      "near": "Basket",
      "x": 0.88,
      "y": 0.2
    },
    "delivery": {
      "id": "delivery",
      "test": "delivery",
      "kind": "choice list",
      "text": "",
      "label": "Delivery",
      "shape": "Standard, €4.90 Pick up in the shop, free",
      "near": "Delivery",
      "x": 0.74,
      "y": 0.33
    },
    "code": {
      "id": "code",
      "test": "code",
      "kind": "text box",
      "text": "",
      "label": "Discount code",
      "shape": "type-text auto-off",
      "near": "Discount",
      "x": 0.69,
      "y": 0.45
    },
    "apply": {
      "id": "apply",
      "test": "apply",
      "kind": "button",
      "text": "Apply",
      "label": "",
      "shape": "type-button",
      "near": "Discount",
      "x": 0.89,
      "y": 0.45
    },
    "code-msg": {
      "id": "code-msg",
      "test": "code-msg",
      "kind": "text output",
      "text": "",
      "label": "Discount message",
      "shape": "tag-output",
      "near": "Discount",
      "x": 0.5,
      "y": 0.5
    },
    "name": {
      "id": "name",
      "test": "name",
      "kind": "text box",
      "text": "",
      "label": "Name",
      "shape": "type-text auto-off",
      "near": "Your details",
      "x": 0.72,
      "y": 0.6
    },
    "email": {
      "id": "email",
      "test": "email",
      "kind": "text box",
      "text": "",
      "label": "Email",
      "shape": "type-email auto-off",
      "near": "Your details",
      "x": 0.72,
      "y": 0.66
    },
    "total": {
      "id": "total",
      "test": "total",
      "kind": "text output",
      "text": "",
      "label": "Total",
      "shape": "tag-output",
      "near": "",
      "x": 0.89,
      "y": 0.75
    },
    "cancel": {
      "id": "cancel",
      "test": "cancel",
      "kind": "button",
      "text": "Cancel order",
      "label": "",
      "shape": "type-button",
      "near": "actions",
      "x": 0.65,
      "y": 0.81
    },
    "place": {
      "id": "place",
      "test": "place",
      "kind": "button",
      "text": "Place order",
      "label": "",
      "shape": "type-button",
      "near": "actions",
      "x": 0.87,
      "y": 0.81
    },
    "result": {
      "id": "result",
      "test": "result",
      "kind": "text output",
      "text": "",
      "label": "Order status",
      "shape": "role-status tag-p",
      "near": "",
      "x": 0.5,
      "y": 0.87
    }
  }/*FP*/;
  root.SH_TESTS = { TESTS, FINGERPRINTS };
})(typeof window !== 'undefined' ? window : globalThis);
