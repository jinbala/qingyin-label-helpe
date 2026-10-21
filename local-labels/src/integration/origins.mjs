import { SELLER_HOSTS } from '../core/core.mjs';

// One definition of "the TEMU seller back office" for the service worker, the
// popup and the page bridge. A page URL must be HTTPS and on a supported host;
// anything unparsable is rejected rather than guessed at.
export function isSellerUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' && SELLER_HOSTS.has(parsed.hostname);
  } catch { return false; }
}
