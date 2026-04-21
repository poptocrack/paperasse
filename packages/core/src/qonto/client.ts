import type { QontoTransaction } from '../types.js';

export const QONTO_BASE_URL = 'https://thirdparty.qonto.com/v2';

export type QontoCreds = {
  slug: string;
  secretKey: string;
};

export type QontoBankAccount = {
  id: string;
  slug: string;
  iban: string;
  currency: string;
  name: string;
};

export type QontoOrganization = {
  slug: string;
  legalName: string;
  bankAccounts: QontoBankAccount[];
};

function authHeaders(creds: QontoCreds): Record<string, string> {
  return {
    Authorization: `${creds.slug}:${creds.secretKey}`,
    Accept: 'application/json',
  };
}

export async function verifyQontoCreds(creds: QontoCreds): Promise<QontoOrganization> {
  return getOrganization(creds);
}

export async function getOrganization(creds: QontoCreds): Promise<QontoOrganization> {
  const res = await fetch(`${QONTO_BASE_URL}/organizations/${encodeURIComponent(creds.slug)}`, {
    headers: authHeaders(creds),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Qonto a renvoyé ${res.status}. Vérifie ton slug et ta secret key dans Paramètres > Intégrations et API.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Qonto API a renvoyé ${res.status} ${res.statusText}.`);
  }

  type RawAccount = {
    id?: string;
    slug?: string;
    iban?: string;
    currency?: string;
    name?: string;
  };
  type Raw = {
    organization?: {
      slug?: string;
      legal_name?: string;
      bank_accounts?: RawAccount[];
    };
  };
  const body = (await res.json()) as Raw;
  const org = body.organization;
  if (!org?.slug) {
    throw new Error('Réponse Qonto inattendue : champ `organization.slug` manquant.');
  }

  const bankAccounts: QontoBankAccount[] = (org.bank_accounts ?? [])
    .filter((a): a is RawAccount & { id: string } => typeof a.id === 'string')
    .map((a) => ({
      id: a.id,
      slug: a.slug ?? '',
      iban: a.iban ?? '',
      currency: a.currency ?? 'EUR',
      name: a.name ?? '',
    }));

  return {
    slug: org.slug,
    legalName: org.legal_name ?? org.slug,
    bankAccounts,
  };
}

export type ListTransactionsParams = {
  creds: QontoCreds;
  iban: string;
  // ISO 8601 date-times, e.g. 2026-01-01T00:00:00Z
  settledAtFrom: string;
  settledAtTo: string;
  maxResults?: number;
};

// Paginated list of transactions for a bank account, filtered by settled_at window.
// Returns them in the shape used by the matcher (amountCents, settledAt, label, rawLabel).
export async function listTransactions(
  params: ListTransactionsParams,
): Promise<QontoTransaction[]> {
  const maxResults = params.maxResults ?? 2000;
  const out: QontoTransaction[] = [];
  let page = 1;

  while (out.length < maxResults) {
    const url = new URL(`${QONTO_BASE_URL}/transactions`);
    url.searchParams.set('iban', params.iban);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('current_page', String(page));
    url.searchParams.set('sort_by', 'settled_at:desc');
    // Date filter params skipped on purpose — Qonto's filter field names are
    // inconsistent across doc versions (settled_at_from/emitted_at_from) and
    // get silently ignored when wrong. We filter client-side instead.

    const res = await fetch(url, { headers: authHeaders(params.creds) });
    if (!res.ok) {
      throw new Error(`Qonto /transactions a renvoyé ${res.status} ${res.statusText}.`);
    }

    type Raw = {
      transactions?: {
        transaction_id?: string;
        amount_cents?: number;
        currency?: string;
        local_amount_cents?: number;
        local_currency?: string;
        side?: 'debit' | 'credit';
        settled_at?: string;
        label?: string;
        clean_counterparty_name?: string;
        reference?: string;
        attachment_ids?: string[];
        operation_type?: string;
      }[];
      meta?: { current_page?: number; total_pages?: number };
    };
    const body = (await res.json()) as Raw;
    const rows = body.transactions ?? [];
    const fromDate = params.settledAtFrom.slice(0, 10);
    const toDate = params.settledAtTo.slice(0, 10);
    let allOlderThanWindow = rows.length > 0;
    for (const t of rows) {
      if (!t.transaction_id || typeof t.amount_cents !== 'number' || !t.settled_at) continue;
      if (t.side && t.side !== 'debit') continue;
      const day = t.settled_at.slice(0, 10);
      if (day >= fromDate) allOlderThanWindow = false;
      if (day < fromDate || day > toDate) continue;
      out.push({
        id: t.transaction_id,
        amountCents: t.amount_cents,
        currency: t.currency ?? 'EUR',
        localAmountCents: t.local_amount_cents ?? t.amount_cents,
        localCurrency: t.local_currency ?? t.currency ?? 'EUR',
        settledAt: day,
        label: t.clean_counterparty_name ?? t.label ?? '',
        rawLabel: t.label ?? t.reference ?? '',
        attachmentIds: t.attachment_ids ?? [],
        operationType: t.operation_type ?? '',
      });
    }

    const meta = body.meta;
    // With sort_by=settled_at:desc, once an entire page is older than the
    // window start, all subsequent pages are too — we're done.
    if (allOlderThanWindow) break;
    if (!meta || !meta.total_pages || page >= meta.total_pages) break;
    page += 1;
  }

  return out;
}
