// Registry of known SaaS vendors with their billing portals. Used by `match`
// to guide the user when we can't auto-attach an invoice — either because the
// vendor emails only a link (not a PDF), or because we couldn't find a
// candidate email at all. Match against both normalized email domains and
// Qonto transaction labels.

export type PdfAvailability =
  // Vendor attaches the PDF to the email — paperasse should be able to auto-match.
  | 'email-pdf'
  // Vendor emails a one-click link (often magic/signed URL). Needs manual click.
  | 'email-link'
  // No email at all — user must log into the vendor's portal.
  | 'portal-login';

export type VendorHint = {
  key: string;
  name: string;
  billingUrl: string;
  pdfAvailability: PdfAvailability;
  // Patterns to match against Qonto label OR email `from` domain.
  matches: RegExp[];
  note?: string;
};

export const VENDOR_REGISTRY: VendorHint[] = [
  // Attaches PDF — paperasse handles these well.
  {
    key: 'anthropic',
    name: 'Anthropic',
    billingUrl: 'https://console.anthropic.com/settings/billing',
    pdfAvailability: 'email-pdf',
    matches: [/anthropic/i],
  },
  {
    key: 'stripe',
    name: 'Stripe',
    billingUrl: 'https://dashboard.stripe.com/settings/billing/invoices',
    pdfAvailability: 'email-pdf',
    matches: [/stripe/i],
  },
  {
    key: 'openai',
    name: 'OpenAI',
    billingUrl: 'https://platform.openai.com/account/billing/history',
    pdfAvailability: 'email-pdf',
    matches: [/openai/i],
  },
  {
    key: 'github',
    name: 'GitHub',
    billingUrl: 'https://github.com/settings/billing/summary',
    pdfAvailability: 'email-pdf',
    matches: [/github/i],
  },
  {
    key: 'hetzner',
    name: 'Hetzner',
    billingUrl: 'https://accounts.hetzner.com/invoices',
    pdfAvailability: 'email-pdf',
    matches: [/hetzner/i],
  },
  {
    key: 'linear',
    name: 'Linear',
    billingUrl: 'https://linear.app/settings/billing',
    pdfAvailability: 'email-pdf',
    matches: [/\blinear\b/i],
  },
  {
    key: 'figma',
    name: 'Figma',
    billingUrl: 'https://www.figma.com/settings/billing',
    pdfAvailability: 'email-pdf',
    matches: [/figma/i],
  },
  {
    key: 'scaleway',
    name: 'Scaleway',
    billingUrl: 'https://console.scaleway.com/billing/invoices',
    pdfAvailability: 'email-pdf',
    matches: [/scaleway/i],
  },
  {
    key: 'digitalocean',
    name: 'DigitalOcean',
    billingUrl: 'https://cloud.digitalocean.com/account/billing',
    pdfAvailability: 'email-pdf',
    matches: [/digitalocean|digital ocean/i],
  },
  {
    key: 'tiime',
    name: 'Tiime',
    billingUrl: 'https://app.tiime.fr',
    pdfAvailability: 'email-pdf',
    matches: [/tiime/i],
  },
  {
    key: 'alan',
    name: 'Alan',
    billingUrl: 'https://alan.com/app/billing',
    pdfAvailability: 'email-pdf',
    matches: [/\balan\b/i],
  },

  // Portal-only — user has to go download the PDF manually.
  {
    key: 'netlify',
    name: 'Netlify',
    billingUrl: 'https://app.netlify.com/teams/',
    pdfAvailability: 'portal-login',
    matches: [/netlify/i],
    note: "Netlify n'attache pas le PDF. Ouvre ta team → Billing → General, section Invoices. URL directe : app.netlify.com/teams/TA-TEAM/billing/general#invoices",
  },
  {
    key: 'vercel',
    name: 'Vercel',
    billingUrl: 'https://vercel.com/dashboard',
    pdfAvailability: 'portal-login',
    matches: [/vercel/i],
    note: 'Settings → Billing → Invoices (URL dépend du scope team/personal).',
  },
  {
    key: 'aws',
    name: 'AWS',
    billingUrl: 'https://console.aws.amazon.com/billing/home#/invoices',
    pdfAvailability: 'portal-login',
    matches: [/\baws\b|amazon web services/i],
  },
  {
    key: 'gcp',
    name: 'Google Cloud',
    billingUrl: 'https://console.cloud.google.com/billing',
    pdfAvailability: 'portal-login',
    matches: [/google cloud|gcp|google\.com.*(?:cloud|billing)/i],
  },
  {
    key: 'google-workspace',
    name: 'Google Workspace',
    billingUrl: 'https://admin.google.com/ac/billing',
    pdfAvailability: 'portal-login',
    matches: [/google workspace|gsuite|g[- ]suite/i],
  },
  {
    key: 'ovh',
    name: 'OVH',
    billingUrl: 'https://www.ovh.com/manager/#/dedicated/billing/history',
    pdfAvailability: 'portal-login',
    matches: [/\bovh\b/i],
  },
  {
    key: 'cloudflare',
    name: 'Cloudflare',
    billingUrl: 'https://dash.cloudflare.com/?to=/:account/billing',
    pdfAvailability: 'portal-login',
    matches: [/cloudflare/i],
  },
  {
    key: 'sentry',
    name: 'Sentry',
    billingUrl: 'https://sentry.io/settings/billing/',
    pdfAvailability: 'portal-login',
    matches: [/sentry/i],
  },
  {
    key: 'slack',
    name: 'Slack',
    billingUrl: 'https://slack.com/account/billing',
    pdfAvailability: 'portal-login',
    matches: [/slack/i],
  },
  {
    key: 'notion',
    name: 'Notion',
    billingUrl: 'https://www.notion.so/settings/plans',
    pdfAvailability: 'portal-login',
    matches: [/notion/i],
  },
  {
    key: 'expo',
    name: 'Expo',
    billingUrl: 'https://expo.dev/accounts',
    pdfAvailability: 'portal-login',
    matches: [/\bexpo\b/i],
    note: 'Sélectionne ton account → Billing. URL : expo.dev/accounts/TON-ACCOUNT/settings/billing',
  },
  {
    key: 'indy',
    name: 'Indy',
    billingUrl: 'https://app.indy.fr',
    pdfAvailability: 'portal-login',
    matches: [/\bindy\b/i],
    note: "Indy n'attache pas le PDF. Section Mon abonnement → Factures.",
  },
];

// Looks up a vendor hint from a Qonto transaction label OR email domain.
// Returns null when no registered vendor matches.
export function lookupVendor(text: string): VendorHint | null {
  if (!text) return null;
  for (const v of VENDOR_REGISTRY) {
    if (v.matches.some((r) => r.test(text))) return v;
  }
  return null;
}
