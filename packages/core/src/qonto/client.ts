export const QONTO_BASE_URL = 'https://thirdparty.qonto.com/v2';

export type QontoCreds = {
  slug: string;
  secretKey: string;
};

export type QontoOrganization = {
  slug: string;
  legalName: string;
};

// Hits GET /v2/organizations/{slug} to confirm the creds work.
// Throws on any non-2xx or malformed response.
export async function verifyQontoCreds(creds: QontoCreds): Promise<QontoOrganization> {
  const res = await fetch(`${QONTO_BASE_URL}/organizations/${encodeURIComponent(creds.slug)}`, {
    headers: {
      Authorization: `${creds.slug}:${creds.secretKey}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Qonto a renvoyé ${res.status}. Vérifie ton slug et ta secret key dans Paramètres > Intégrations et API.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Qonto API a renvoyé ${res.status} ${res.statusText}.`);
  }

  const body = (await res.json()) as {
    organization?: { slug?: string; legal_name?: string };
  };
  const org = body.organization;
  if (!org?.slug) {
    throw new Error('Réponse Qonto inattendue : champ `organization.slug` manquant.');
  }
  return {
    slug: org.slug,
    legalName: org.legal_name ?? org.slug,
  };
}
