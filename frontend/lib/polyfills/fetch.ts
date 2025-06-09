import { fetch as undiciFetch, Request } from 'undici';

globalThis.fetch = (input: any, init: RequestInit = {}) => {
    if (init.referrer === 'client') delete init.referrer;
    return undiciFetch(input, init);
};

// Optional: patch the Request constructor too,
// for libraries that construct new Request() directly.
(globalThis as any).Request = class extends Request {
    constructor(input: any, init: RequestInit = {}) {
        if (init.referrer === 'client') delete init.referrer;
        super(input, init);
    }
} as typeof Request;