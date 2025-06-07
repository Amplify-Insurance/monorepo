import 'server-only';    // ✅ guarantee server-side only
import { fetch as undiciFetch } from 'undici';

(globalThis as any).fetch = (url: any, init: any = {}) => {
  if (init?.referrer === 'client') delete init.referrer;
  return undiciFetch(url, init);
};