/**
 * Guarded off-chain HTTP fetches.
 *
 * #238 — the SDK performs off-chain lookups (merchant Stellar TOML files,
 * IPFS gateways). Any such call is an SSRF surface: if the URL is built from
 * caller-supplied input and passed to `fetch`, a caller can steer the request
 * at internal infrastructure, at a link-local metadata service, or at a host
 * they control, and have the response fed back into the SDK.
 *
 * The control here is an explicit allowlist plus per-hop revalidation, not
 * pattern-matching the URL after the fact. Two properties matter and are easy
 * to get wrong:
 *
 * 1. **Redirects must be re-validated.** `fetch` follows redirects by default,
 *    so an allowlisted host that answers `302 Location: http://169.254.169.254/`
 *    bypasses the allowlist entirely. Redirects are therefore followed
 *    manually, one hop at a time, with the allowlist applied to every hop.
 * 2. **Credentials must not be attached.** No `Authorization`, cookie, or API
 *    key header is ever set, so a misdirected request cannot leak a secret —
 *    there is nothing to leak.
 *
 * DNS-level rebinding is not defended against here. The allowlist is the
 * primary control; `blockPrivateHosts` is defence in depth for the common
 * case of a literal internal address, and does not survive an attacker
 * controlling DNS for an allowlisted name.
 */
import { StellarDisasterReliefError } from './errors';
export interface OffchainPolicy {
    /** Exact hostnames permitted, e.g. `"merchants.relief.example"`. */
    allowedHosts?: string[];
    /**
     * Suffix rules, e.g. `".relief.example"` matches `shop.relief.example` but
     * not `relief.example.evil.com`. A leading dot is required so a suffix can
     * never match a bare domain by accident.
     */
    allowedHostSuffixes?: string[];
    /**
     * Refuse hosts that are loopback, link-local, or private-range literals
     * (`localhost`, `127.0.0.1`, `169.254.169.254`, `10.0.0.0/8`, ...).
     * Defaults to `true`.
     */
    blockPrivateHosts?: boolean;
    /** Maximum redirects followed. Defaults to 2. Every hop is re-validated. */
    maxRedirects?: number;
    /** Maximum response body read, in bytes. Defaults to 64 KiB. */
    maxResponseBytes?: number;
    /** Per-request timeout in milliseconds. Defaults to 5000. */
    timeoutMs?: number;
}
export interface SafeFetchResult {
    /** Final URL after redirects — may differ from the requested URL. */
    url: string;
    status: number;
    body: string;
}
/** Raised when a URL is refused by policy before any request is made. */
export declare class OffchainRequestBlockedError extends StellarDisasterReliefError {
    constructor(url: string, reason: string);
}
/** Default policy: no host is permitted until one is explicitly allowed. */
export declare const DEFAULT_OFFCHAIN_POLICY: Required<Pick<OffchainPolicy, 'blockPrivateHosts' | 'maxRedirects' | 'maxResponseBytes' | 'timeoutMs'>>;
/**
 * Normalise a bare hostname, rejecting anything that is not one.
 *
 * Accepts `"example.com"` and `"example.com:8443"`. Rejects anything carrying
 * a scheme, credentials, a path, a query, a fragment, or an `@` — all of
 * which can otherwise be used to make `https://${input}/...` resolve to a
 * different host than the caller appears to have named.
 */
export declare function normaliseHost(rawHost: string): string;
/** True when `hostname` satisfies the policy's allowlist. */
export declare function isHostAllowed(hostname: string, policy: OffchainPolicy): boolean;
/**
 * Assert a URL is safe to fetch under `policy`.
 *
 * @throws {OffchainRequestBlockedError} if the scheme is not HTTPS, the host
 *   is a private/internal literal, or the host is not allowlisted.
 */
export declare function assertSafeUrl(rawUrl: string, policy: OffchainPolicy): URL;
/**
 * Fetch text from an allowlisted HTTPS URL.
 *
 * Redirects are followed manually so each hop is checked against the policy —
 * an allowlisted host must not be able to redirect to a non-allowlisted one.
 * No credential headers are ever set.
 */
export declare function safeFetchText(rawUrl: string, policy: OffchainPolicy): Promise<SafeFetchResult>;
//# sourceMappingURL=offchainFetch.d.ts.map