// Trusted Types (CSP require-trusted-types-for 'script'): the only script addresses this page may start
// as workers are its own check worker and the vendored engine, on this site.
const ALLOWED = /^\/projects\/payment-xml-lab\/(js\/check-worker\.js|vendor\/xmllint-5\.3\.0\/xmllint-browser\.mjs)$/;
const policy = self.trustedTypes ? self.trustedTypes.createPolicy('pxl', {
  createScriptURL(u) {
    const x = new URL(u, self.location.href);
    if (x.origin !== self.location.origin || !ALLOWED.test(x.pathname)) throw new TypeError('Blocked script address: ' + x.href);
    return x.href;
  },
}) : null;
export const scriptURL = (u) => (policy ? policy.createScriptURL(String(u)) : u);
