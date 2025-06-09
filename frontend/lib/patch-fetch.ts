/**
 * Next.js 15 dev shim adds `referrer:"client"` to every fetch().
 * Undici (Node 18/20) rejects that header.  We remove it here.
 *
 * IMPORTANT: run this file **server-side only** (no `window`).
 */
if (typeof window === 'undefined') {
    const originalFetch = globalThis.fetch;
  
    globalThis.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (init && (init as any).referrer === 'client') {
        delete (init as any).referrer;
      }
      return originalFetch(input, init);
    };
  
    const OriginalRequest = globalThis.Request;
  
    globalThis.Request = class FixedRequest extends OriginalRequest {
      constructor(input: RequestInfo | URL, init: RequestInit = {}) {
        if (init && (init as any).referrer === 'client') {
          delete (init as any).referrer;
        }
        super(input, init);
      }
    } as typeof Request;
  }