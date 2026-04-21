import { type Auth, type gmail_v1, google } from 'googleapis';
import type { Credentials, OAuthClientCreds } from './oauth.js';

export type StoredGmailCreds = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
};

export type GmailSession = {
  auth: Auth.OAuth2Client;
  gmail: gmail_v1.Gmail;
};

// Builds an authenticated Gmail client from the refresh token we saved during init.
// Subscribe to `onTokensRefreshed` to persist new access tokens after googleapis
// auto-refreshes them (happens when the stored access_token is past expiry).
export function createGmailSession(
  clientCreds: OAuthClientCreds,
  stored: StoredGmailCreds,
): GmailSession {
  const auth = new google.auth.OAuth2(clientCreds.clientId, clientCreds.clientSecret);
  auth.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken,
    expiry_date: stored.expiresAt ? new Date(stored.expiresAt).getTime() : null,
  });
  return {
    auth,
    gmail: google.gmail({ version: 'v1', auth }),
  };
}

export function onTokensRefreshed(
  session: GmailSession,
  cb: (credentials: Credentials) => void,
): void {
  session.auth.on('tokens', cb);
}

export type MessageRef = { id: string; threadId: string };

// Paginated list of message IDs matching a Gmail search query. Caps at `maxResults`.
export async function listMessages(
  gmail: gmail_v1.Gmail,
  query: string,
  maxResults: number,
): Promise<MessageRef[]> {
  const out: MessageRef[] = [];
  let pageToken: string | undefined;
  while (out.length < maxResults) {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(100, maxResults - out.length),
      pageToken,
    });
    for (const m of res.data.messages ?? []) {
      if (m.id) out.push({ id: m.id, threadId: m.threadId ?? '' });
    }
    if (!res.data.nextPageToken) break;
    pageToken = res.data.nextPageToken;
  }
  return out;
}

export type ParsedAttachment = {
  filename: string;
  mimeType: string;
  attachmentId: string;
};

export type ParsedMessage = {
  id: string;
  from: string;
  fromDomain: string;
  subject: string;
  date: string; // ISO date (YYYY-MM-DD)
  bodyText: string;
  bodyHtml: string;
  attachments: ParsedAttachment[];
};

export async function getParsedMessage(gmail: gmail_v1.Gmail, id: string): Promise<ParsedMessage> {
  const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  return parseMessage(id, res.data);
}

function parseMessage(id: string, raw: gmail_v1.Schema$Message): ParsedMessage {
  const headers = raw.payload?.headers ?? [];
  const getHeader = (name: string): string => {
    const h = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
    return h?.value ?? '';
  };
  const from = getHeader('From');
  const subject = getHeader('Subject');
  const rawDate = getHeader('Date');
  const date = toIsoDate(rawDate) ?? new Date().toISOString().slice(0, 10);

  const parts = flattenParts(raw.payload ?? {});
  let bodyText = '';
  let bodyHtml = '';
  const attachments: ParsedAttachment[] = [];
  for (const p of parts) {
    const mime = p.mimeType ?? '';
    if (mime === 'text/plain' && !bodyText) {
      bodyText = decodeBody(p.body?.data);
    } else if (mime === 'text/html' && !bodyHtml) {
      bodyHtml = decodeBody(p.body?.data);
    } else if (p.filename && p.body?.attachmentId) {
      attachments.push({
        filename: p.filename,
        mimeType: mime,
        attachmentId: p.body.attachmentId,
      });
    }
  }

  return {
    id,
    from,
    fromDomain: extractDomain(from),
    subject,
    date,
    bodyText,
    bodyHtml,
    attachments,
  };
}

// Downloads a single attachment's raw bytes (Gmail returns base64url-encoded data).
export async function getAttachmentBytes(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });
  const data = res.data.data;
  if (!data) return Buffer.alloc(0);
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

function flattenParts(payload: gmail_v1.Schema$MessagePart): gmail_v1.Schema$MessagePart[] {
  const out: gmail_v1.Schema$MessagePart[] = [payload];
  for (const sub of payload.parts ?? []) {
    out.push(...flattenParts(sub));
  }
  return out;
}

function decodeBody(data: string | null | undefined): string {
  if (!data) return '';
  // Gmail returns base64url (- and _ instead of + and /).
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function extractDomain(from: string): string {
  const match = from.match(/<([^>]+)>|([^\s]+@[^\s]+)/);
  const email = match ? (match[1] ?? match[2] ?? '') : '';
  const at = email.indexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

function toIsoDate(rfcDate: string): string | null {
  if (!rfcDate) return null;
  const d = new Date(rfcDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
