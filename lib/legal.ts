// lib/legal.ts — single source of truth for entity/contact info shown across
// /pricing, /terms, /refunds, and the site footer. Keep this in sync with
// whatever is on file with Stripe — a mismatch here is a common underwriting
// rejection reason.

export const ENTITY_NAME = "Morrbiz LLC";
export const CONTACT_EMAIL = "support@uxus.finance";
export const SITE_URL = "https://uxus.finance";

// Stripe's hosted customer-portal login page (portal configuration
// bpc_1UQA76RoquiH1GTZgOcgAF1s). The customer enters their billing email and
// Stripe emails a one-time link — cancel, card update and invoices need no
// account on our side. Not a secret.
export const BILLING_PORTAL_URL = "https://billing.stripe.com/p/login/28E00l8bh14XgAlexK24000";
