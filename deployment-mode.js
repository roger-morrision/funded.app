export const READ_ONLY_PREVIEW = String(import.meta.env?.VITE_READ_ONLY_PREVIEW || '').toLowerCase() === 'true';
export const PREVIEW_MESSAGE = 'Read-only preview: browsing is available. Wallet sign-in, launches, payments and account changes are disabled until server setup is complete.';
export function assertWritablePreview() {
  if (READ_ONLY_PREVIEW) throw new Error(PREVIEW_MESSAGE);
}
