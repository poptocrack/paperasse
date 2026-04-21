import { type Server, createServer } from 'node:http';
import { type Auth, google } from 'googleapis';
import open from 'open';

export type Credentials = Auth.Credentials;

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export type OAuthClientCreds = {
  clientId: string;
  clientSecret: string;
};

// Runs the Google OAuth 2.0 "loopback IP" flow for desktop apps:
// 1. start an HTTP server on a random localhost port,
// 2. open the user's browser to the Google consent screen,
// 3. receive the authorization code on the localhost callback,
// 4. exchange it for an access + refresh token.
export async function runOAuthFlow(creds: OAuthClientCreds): Promise<Credentials> {
  const { port, server, codePromise } = await startCallbackServer();
  const redirectUri = `http://localhost:${port}`;

  const oauth2 = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    prompt: 'consent',
  });

  console.log(
    `Ouvre cette URL dans ton navigateur si elle ne s'ouvre pas automatiquement :\n${authUrl}\n`,
  );
  await open(authUrl).catch(() => {
    // open() can fail on headless machines. We already printed the URL, so that's fine.
  });

  try {
    const code = await codePromise;
    const { tokens } = await oauth2.getToken(code);
    return tokens;
  } finally {
    server.close();
  }
}

type CallbackServer = {
  port: number;
  server: Server;
  codePromise: Promise<string>;
};

function startCallbackServer(): Promise<CallbackServer> {
  return new Promise((resolveSetup, rejectSetup) => {
    let resolveCode!: (code: string) => void;
    let rejectCode!: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400).end();
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');

      if (error) {
        respondHtml(
          res,
          400,
          `<p>OAuth error : ${escapeHtml(error)}. Tu peux fermer cet onglet.</p>`,
        );
        rejectCode(new Error(`OAuth error: ${error}`));
        return;
      }
      if (!code) {
        respondHtml(res, 400, '<p>Pas de code OAuth reçu.</p>');
        return;
      }
      respondHtml(
        res,
        200,
        '<p>paperasse : authentification Gmail OK. Tu peux fermer cet onglet et revenir au terminal.</p>',
      );
      resolveCode(code);
    });

    server.once('error', rejectSetup);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        rejectSetup(new Error('Impossible de démarrer le serveur OAuth local.'));
        return;
      }
      resolveSetup({ port: addr.port, server, codePromise });
    });
  });
}

function respondHtml(res: import('node:http').ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>paperasse</title>${html}`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    if (c === '&') return '&amp;';
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    if (c === '"') return '&quot;';
    return '&#39;';
  });
}
