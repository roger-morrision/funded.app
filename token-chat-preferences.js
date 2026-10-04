const key = cluster => `funded.chat.hidden-authors.${cluster}.v1`;
const validAuthor = value => typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
export function readHiddenChatAuthors(cluster, storage = globalThis.localStorage) {
  try {
    const values = JSON.parse(storage.getItem(key(cluster)) || '[]');
    return new Set(Array.isArray(values) ? values.filter(validAuthor).slice(-200) : []);
  } catch { return new Set(); }
}
export function hideChatAuthor(cluster, author, storage = globalThis.localStorage) {
  if (!validAuthor(author)) throw new Error('Invalid wallet address.');
  const hidden = readHiddenChatAuthors(cluster, storage);
  hidden.add(author);
  storage.setItem(key(cluster), JSON.stringify([...hidden].slice(-200)));
}
export function resetHiddenChatAuthors(cluster, storage = globalThis.localStorage) {
  storage.removeItem(key(cluster));
}
