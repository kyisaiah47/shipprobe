/* Stripe integration checks: a read of what the app ships, plus a few probes against the app's OWN
 * endpoints. Nothing here talks to Stripe's API and nothing can create a charge or move money. The
 * probes send an unsigned, and then a badly signed, empty JSON body to the app's webhook route and
 * read the status code. A correct endpoint answers 4xx to both.
 *
 * Detection mirrors the Supabase detection: read the shipped HTML and bundles for what a Stripe
 * integration leaves behind (js.stripe.com, a publishable key, a Payment Link, a Connect
 * reference) and run the rest only when something was found.
 */
import crypto from 'node:crypto';
import { timedFetch } from '../net.mjs';

const AMOUNT_IN_BROWSER = [
  /line_items\[\d+\]\[price_data\]/,
  /\bprice_data["'`]?\s*:/,
  /\bunit_amount["'`]?\s*:\s*[\w$.(]/,
  /api\.stripe\.com\/v1\/(checkout\/sessions|payment_intents)[^"'`]*["'`][\s\S]{0,400}\b(amount|unit_amount)\b/,
];

const WEBHOOK_PATH_LITERAL = /["'`](\/[a-zA-Z0-9\-_/.]*webhook[a-zA-Z0-9\-_/.]*)["'`]/gi;
const SUCCESS_URL_LITERAL = /success_url["'`]?\s*[:=]\s*[^,;\n]*?["'`](\/[a-zA-Z0-9\-_/.{}]*)["'`]/gi;

const COMMON_WEBHOOK_PATHS = [
  '/api/stripe/webhook',
  '/api/webhooks/stripe',
  '/api/stripe-webhook',
  '/api/webhook/stripe',
  '/api/webhook',
  '/stripe/webhook',
  '/webhooks/stripe',
  '/.netlify/functions/stripe-webhook',
  '/api/payments/webhook',
];

const COMMON_SUCCESS_PATHS = ['/success', '/checkout/success', '/order-confirmation', '/order/success', '/payment-success', '/checkout/complete', '/thank-you'];

export function detectStripe(sources, html) {
  const all = sources.map((s) => s.text).join('\n') + '\n' + html;
  const scriptM = all.match(/js\.stripe\.com\/(v2|v3)\//);
  const scriptVersion = scriptM ? scriptM[1] : null;
  const pkM = all.match(/\bpk_(live|test)_[A-Za-z0-9]{16,}/);
  const publishableKeyMode = pkM ? pkM[1] : null;
  const paymentLink = /buy\.stripe\.com\//.test(all);
  const checkoutHost = /checkout\.stripe\.com\//.test(all);
  const stripeSdk = /\bStripe\(\s*["'`]pk_/.test(all) || /from\s+["']@stripe\//.test(all);
  const connectRef = /stripe\.com\/connect\//.test(all) || /\bconnected_account/i.test(all);
  const usesRedirectToCheckout = /\.redirectToCheckout\s*\(/.test(all);
  const apiVerM = all.match(/apiVersion["'`]?\s*:\s*["'`](\d{4}-\d{2}-\d{2})["'`]/);

  const webhookCandidates = new Set(COMMON_WEBHOOK_PATHS);
  let m;
  WEBHOOK_PATH_LITERAL.lastIndex = 0;
  while ((m = WEBHOOK_PATH_LITERAL.exec(all))) webhookCandidates.add(m[1]);
  const successCandidates = new Set(COMMON_SUCCESS_PATHS);
  SUCCESS_URL_LITERAL.lastIndex = 0;
  while ((m = SUCCESS_URL_LITERAL.exec(all))) successCandidates.add(m[1].replace(/\{[^}]*\}$/, ''));

  return {
    detected: !!(scriptVersion || pkM || paymentLink || checkoutHost || stripeSdk || connectRef),
    publishableKeyMode,
    scriptVersion,
    usesRedirectToCheckout,
    pinnedApiVersion: apiVerM ? apiVerM[1] : null,
    webhookCandidates: [...webhookCandidates].slice(0, 20),
    successCandidates: [...successCandidates].slice(0, 10),
    clientSideAmount: AMOUNT_IN_BROWSER.some((re) => re.test(all)),
  };
}

function isNonProdHost(host) {
  return (
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(host) ||
    /\.local$/i.test(host) ||
    /(^|\.)(staging|stage|dev|test|preview|sandbox)(\.|-)/i.test(host) ||
    /-git-[a-z0-9-]+\.vercel\.app$/i.test(host) ||
    /\.ngrok(-free)?\.(app|io)$/i.test(host)
  );
}

const randomSuffix = () => crypto.randomBytes(5).toString('hex') + Date.now().toString(36);

/** Strip what varies request to request on a catch-all page (nonces, hashes, numbers), so two
 *  hits on the SAME catch-all compare equal. */
const normalizeBody = (text) => text.slice(0, 2000).replace(/[0-9a-f]{12,}/gi, '#').replace(/\d+/g, '#');

function sameHandler(a, b) {
  if (a.status !== b.status) return false;
  if (normalizeBody(a.text) === normalizeBody(b.text)) return true;
  const lenDiff = Math.abs(a.text.length - b.text.length);
  const tolerance = Math.max(64, Math.round(0.03 * Math.max(a.text.length, b.text.length)));
  return lenDiff <= tolerance && a.text.slice(0, 200) === b.text.slice(0, 200);
}

/** POST `{}`, so an endpoint that wrongly trusts the payload has nothing in it to act on. With
 *  `badSignature`, a correctly shaped but fake stripe-signature header is added. A rendered HTML
 *  page is the site's own shell answering the guessed path, never a webhook handler. */
async function probeOnce(url, badSignature) {
  try {
    const headers = { 'content-type': 'application/json' };
    if (badSignature) headers['stripe-signature'] = `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`;
    const res = await timedFetch(url, { method: 'POST', headers, body: '{}', timeout: 8000 });
    const text = await res.text().catch(() => '');
    const ct = res.headers.get('content-type') || '';
    const html = /\btext\/html\b/i.test(ct) || /^\s*<(!doctype html|html[\s>])/i.test(text);
    return { status: res.status, text, html };
  } catch {
    return null;
  }
}

/* THE CONTROL COMES FROM THE SAME DIRECTORY AS THE CANDIDATE. A site's catch-all for unknown
 * /api/* paths can differ from its catch-all at the root, and a root-only control once let a
 * generic JSON "here is the API" page read as a webhook that accepts unsigned requests. */
async function probeWebhooks(base, candidates) {
  const rootControl = await probeOnce(`${base}/__shipprobe_stripe_probe_${randomSuffix()}`, false);
  const dirControls = new Map();
  async function controlFor(p) {
    const idx = p.lastIndexOf('/');
    const dir = idx > 0 ? p.slice(0, idx) : '';
    if (dirControls.has(dir)) return dirControls.get(dir);
    let url;
    try {
      url = new URL(`${dir}/__shipprobe_${randomSuffix()}`, base).toString();
    } catch {
      dirControls.set(dir, null);
      return null;
    }
    const c = await probeOnce(url, false);
    dirControls.set(dir, c);
    return c;
  }

  const checked = [];
  let anyUnsignedAccepted = false;
  let anyBadSigAccepted = false;
  for (const p of candidates.slice(0, 8)) {
    let url;
    try {
      url = new URL(p, base).toString();
    } catch {
      continue;
    }
    const unsigned = await probeOnce(url, false);
    if (!unsigned || unsigned.status === 404 || unsigned.html) continue;
    const dirControl = await controlFor(p);
    if (dirControl && sameHandler(unsigned, dirControl)) continue;
    if (!dirControl && rootControl && sameHandler(unsigned, rootControl)) continue;
    checked.push(p);
    if (unsigned.status >= 200 && unsigned.status < 300) anyUnsignedAccepted = true;
    const badSig = await probeOnce(url, true);
    if (badSig && !badSig.html && badSig.status >= 200 && badSig.status < 300) anyBadSigAccepted = true;
  }
  return {
    webhookChecked: checked,
    webhookRejectsUnsigned: checked.length ? !anyUnsignedAccepted : null,
    webhookRejectsBadSignature: checked.length ? !anyBadSigAccepted : null,
  };
}

/** A success page that renders "payment received" with nothing in the URL is trusting the URL
 *  alone. A purely client-rendered page answers a bare GET with an empty shell, so this reports
 *  "not run" for it rather than guessing at what its JavaScript would do. */
async function probeSuccessPage(base, candidates) {
  const MARKERS = /(thank you for your (order|purchase|payment)|payment (was )?successful|order confirmed|purchase complete|you'?re all set|payment received|order complete)/i;
  for (const p of candidates.slice(0, 5)) {
    let bareUrl;
    try {
      bareUrl = new URL(p, base).toString();
    } catch {
      continue;
    }
    const bare = await timedFetch(bareUrl, { timeout: 8000 }).then((r) => r.text()).catch(() => null);
    if (bare === null || !MARKERS.test(bare)) continue;
    const control = await timedFetch(new URL(`/__shipprobe_${randomSuffix()}`, base).toString(), { timeout: 8000 })
      .then((r) => r.text())
      .catch(() => null);
    return { successPageUrl: p, successPageTrustsQueryAlone: control === null || !MARKERS.test(control) };
  }
  return { successPageUrl: null, successPageTrustsQueryAlone: null };
}

export async function scanStripe(sources, html, baseUrl, host) {
  const d = detectStripe(sources, html);
  if (!d.detected) {
    return { detected: false, detail: 'No Stripe.js, publishable key, Payment Link or Connect reference was found, so the Stripe checks did not run.' };
  }
  const origin = new URL(baseUrl).origin;
  const [webhook, success] = await Promise.all([probeWebhooks(origin, d.webhookCandidates), probeSuccessPage(origin, d.successCandidates)]);
  const parts = [];
  parts.push(
    webhook.webhookChecked.length
      ? `Found a live webhook endpoint at ${webhook.webhookChecked.length} path(s) and sent it an unsigned request and a request with a fake signature.`
      : 'Could not find a reachable webhook endpoint to test among the paths the app references and the common defaults.',
  );
  return {
    detected: true,
    publishableKeyMode: d.publishableKeyMode,
    webhookCandidates: d.webhookCandidates,
    ...webhook,
    ...success,
    clientSideAmount: d.clientSideAmount,
    testKeyInProduction: d.publishableKeyMode === 'test' && !isNonProdHost(host),
    usesDeprecatedRedirectToCheckout: d.usesRedirectToCheckout,
    stripeJsVersion: d.scriptVersion === 'v3' ? 'current' : d.scriptVersion === 'v2' ? 'outdated' : 'unknown',
    pinnedApiVersion: d.pinnedApiVersion,
    detail: parts.join(' '),
  };
}

export function stripeFindings(r) {
  if (!r.detected) return [];
  const out = [];
  const where = (r.webhookChecked || []).join(', ');
  if (r.webhookRejectsUnsigned === false) {
    out.push({
      id: 'stripe-webhook-accepts-unsigned',
      category: 'stripe',
      severity: 'critical',
      title: 'Stripe webhook accepts requests with no signature',
      detail: 'The webhook endpoint returned success for a POST with no Stripe-Signature header. Anyone who finds the URL can post a fake event and have it processed as if Stripe sent it.',
      where,
    });
  } else if (r.webhookRejectsUnsigned === true) {
    out.push({ id: 'stripe-webhook-rejects-unsigned', category: 'stripe', severity: 'pass', title: 'Webhook rejects an unsigned request', detail: 'The endpoint returned an error status for a POST with no signature header.', where });
  }
  if (r.webhookRejectsBadSignature === false) {
    out.push({
      id: 'stripe-webhook-accepts-bad-signature',
      category: 'stripe',
      severity: 'critical',
      title: 'Stripe webhook does not verify its signature',
      detail: 'The webhook endpoint returned success for a POST with a made-up Stripe-Signature header. It does not verify the signature against a webhook secret, so anyone can forge an event.',
      where,
    });
  } else if (r.webhookRejectsBadSignature === true) {
    out.push({ id: 'stripe-webhook-rejects-bad-signature', category: 'stripe', severity: 'pass', title: 'Webhook rejects a forged signature', detail: 'The endpoint returned an error status for a POST with a fake signature header.', where });
  }
  if (r.clientSideAmount) {
    out.push({
      id: 'stripe-client-side-amount',
      category: 'stripe',
      severity: 'high',
      title: 'Charge amount looks like it is built in the browser',
      detail: 'The shipped bundle builds a Stripe price or line item (price_data, unit_amount) instead of only referencing a price id. If the amount travels from the browser to the server, a visitor can edit it before it reaches Stripe.',
      where: 'shipped JavaScript',
    });
  }
  if (r.testKeyInProduction) {
    out.push({
      id: 'stripe-test-key-in-production',
      category: 'stripe',
      severity: 'high',
      title: 'A Stripe test key is live on a production origin',
      detail: 'The publishable key on this production-looking origin is a test key. Checkout will not take real payment.',
    });
  }
  if (r.successPageTrustsQueryAlone === true) {
    out.push({
      id: 'stripe-success-trusts-query-string',
      category: 'stripe',
      severity: 'high',
      title: 'Success page shows a confirmation with nothing verified',
      detail: 'The success page rendered a payment-confirmed message with no session id in the URL. Anyone who opens that URL sees a confirmation whether or not they paid.',
      where: r.successPageUrl,
    });
  } else if (r.successPageTrustsQueryAlone === false) {
    out.push({ id: 'stripe-success-page-gated', category: 'stripe', severity: 'pass', title: 'Success page does not confirm on its own', detail: 'With no session id in the URL the success page did not render the same confirmation.' });
  }
  if (r.usesDeprecatedRedirectToCheckout) {
    out.push({
      id: 'stripe-deprecated-redirect-to-checkout',
      category: 'stripe',
      severity: 'medium',
      title: 'Using a retired Stripe.js checkout method',
      detail: 'The bundle calls stripe.redirectToCheckout(), a client-only integration that cannot enforce a server-decided price. A server-created Checkout Session can.',
      where: 'shipped JavaScript',
    });
  }
  if (r.stripeJsVersion === 'outdated') {
    out.push({
      id: 'stripe-js-outdated-version',
      category: 'stripe',
      severity: 'medium',
      title: 'Loading a retired version of Stripe.js',
      detail: 'The page loads js.stripe.com/v2/, which no longer receives the security and card-network updates v3 does.',
      where: 'shipped HTML',
    });
  }
  return out;
}
