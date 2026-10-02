export const TOKEN_CHAT_MAX_LENGTH = 280;

function canonical(value) {
  return JSON.stringify(value);
}

export function normalizeTokenChatText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateTokenChatText(value) {
  const text = normalizeTokenChatText(value);
  if (!text) throw new Error('Write a message before posting.');
  if ([...text].length > TOKEN_CHAT_MAX_LENGTH) throw new Error(`Messages can contain up to ${TOKEN_CHAT_MAX_LENGTH} characters.`);
  if ((text.match(/https?:\/\//gi) || []).length > 2) throw new Error('Messages can include at most two links.');
  return text;
}

export function tokenChatPostStatement({ mint, author, text, nonce, issuedAt }) {
  return `funded.app token discussion post v1\n${canonical({ mint, author, text: validateTokenChatText(text), nonce: String(nonce), issuedAt: String(issuedAt) })}`;
}

export function tokenChatDeleteStatement({ mint, messageId, author, nonce, issuedAt }) {
  return `funded.app token discussion delete v1\n${canonical({ mint, messageId: String(messageId), author, nonce: String(nonce), issuedAt: String(issuedAt) })}`;
}

export function tokenChatSessionStatement({ address, nonce, issuedAt, expiresAt, origin }) {
  return `funded.app discussion access v1\n${canonical({ address: String(address), nonce: String(nonce), issuedAt: String(issuedAt), expiresAt: String(expiresAt), origin: String(origin) })}`;
}
