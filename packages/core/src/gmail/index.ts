export { runOAuthFlow, GMAIL_SCOPES } from './oauth.js';
export type { Credentials, OAuthClientCreds } from './oauth.js';
export {
  createGmailSession,
  onTokensRefreshed,
  listMessages,
  getParsedMessage,
  getAttachmentBytes,
} from './client.js';
export type {
  GmailSession,
  MessageRef,
  ParsedAttachment,
  ParsedMessage,
  StoredGmailCreds,
} from './client.js';
