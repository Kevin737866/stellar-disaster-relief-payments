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

import { ErrorCode, StellarDisasterReliefError, ValidationError } from './errors';

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
export class OffchainRequestBlockedError extends StellarDisasterReliefError {
  constructor(url: string, reason: string) {
    super(
      ErrorCode.VALIDATION_FAILED,
      `Off-chain request blocked: ${reason}`,
      { url, reason }
    );
  }
}

/** Default policy: no host is permitted until one is explicitly allowed. */
export const DEFAULT_OFFCHAIN_POLICY: Required<
  Pick<OffchainPolicy, 'blockPrivateHosts' | 'maxRedirects' | 'maxResponseBytes' | 'timeoutMs'>
> = {
  blockPrivateHosts: true,
  maxRedirects: 2,
  maxResponseBytes: 64 * 1024,
  timeoutMs: 5_000,
};

/** Literal hosts that always indicate an internal or metadata target. */
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^fc00:/i,
  /^fe80:/i,
  /^\[?fd[0-9a-f]{2}:/i,
];

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

/**
 * Normalise a bare hostname, rejecting anything that is not one.
 *
 * Accepts `"example.com"` and `"example.com:8443"`. Rejects anything carrying
 * a scheme, credentials, a path, a query, a fragment, or an `@` — all of
 * which can otherwise be used to make `https://${input}/...` resolve to a
 * different host than the caller appears to have named.
 */
export function normaliseHost(rawHost: string): string {
  if (typeof rawHost !== 'string') {
    throw new ValidationError('host', 'must be a string');
  }

  const host = rawHost.trim();

  if (host === '') {
    throw new ValidationError('host', 'must not be empty');
  }
  if (host.includes('://')) {
    throw new ValidationError('host', 'must be a bare hostname without a scheme');
  }
  if (host.includes('/')) {
    throw new ValidationError('host', 'must not contain a path');
  }
  if (host.includes('@')) {
    throw new ValidationError('host', 'must not contain credentials');
  }
  if (host.includes('?') || host.includes('#')) {
    throw new ValidationError('host', 'must not contain a query or fragment');
  }
  if (/\s/.test(host)) {
    throw new ValidationError('host', 'must not contain whitespace');
  }
  if (host.includes(':') && !/^\[[0-9a-fA-F:]+\](:\d+)?$/.test(host)) {
    // Allow `example.com:8443`, reject malformed IPv6.
    if (!/^[^:]+:\d+$/.test(host)) {
      throw new ValidationError('host', 'has a malformed port');
    }
  }

  return host.toLowerCase();
}

/** True when `hostname` satisfies the policy's allowlist. */
export function isHostAllowed(hostname: string, policy: OffchainPolicy): boolean {
  const host = hostname.toLowerCase();
  const allowedHosts = (policy.allowedHosts ?? []).map((h) => h.toLowerCase());

  if (allowedHosts.includes(host)) {
    return true;
  }

  return (policy.allowedHostSuffixes ?? []).some((suffix) => {
    // A leading dot is required so `relief.example` does not match
    // `evil-relief.example`, and `relief.example` itself must be listed
    // explicitly if it should be allowed.
    const normalised = suffix.startsWith('.') ? suffix : `.${suffix}`;
    return host.endsWith(normalised);
  });
}

/**
 * Assert a URL is safe to fetch under `policy`.
 *
 * @throws {OffchainRequestBlockedError} if the scheme is not HTTPS, the host
 *   is a private/internal literal, or the host is not allowlisted.
 */
export function assertSafeUrl(rawUrl: string, policy: OffchainPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OffchainRequestBlockedError(rawUrl, 'not a valid absolute URL');
  }

  if (url.protocol !== 'https:') {
    throw new OffchainRequestBlockedError(
      rawUrl,
      `scheme "${url.protocol}" is not permitted; HTTPS is required`
    );
  }

  if (url.username || url.password) {
    throw new OffchainRequestBlockedError(rawUrl, 'embedded credentials are not permitted');
  }

  const blockPrivate = policy.blockPrivateHosts ?? DEFAULT_OFFCHAIN_POLICY.blockPrivateHosts;

  if (blockPrivate && isPrivateHost(url.hostname)) {
    throw new OffchainRequestBlockedError(
      rawUrl,
      `"${url.hostname}" is a private or link-local address`
    );
  }

  if (!isHostAllowed(url.hostname, policy)) {
    throw new OffchainRequestBlockedError(
      rawUrl,
      `host "${url.hostname}" is not in the allowlist`
    );
  }

  return url;
}

/**
 * Fetch text from an allowlisted HTTPS URL.
 *
 * Redirects are followed manually so each hop is checked against the policy —
 * an allowlisted host must not be able to redirect to a non-allowlisted one.
 * No credential headers are ever set.
 */
export async function safeFetchText(
  rawUrl: string,
  policy: OffchainPolicy
): Promise<SafeFetchResult> {
  const maxRedirects = policy.maxRedirects ?? DEFAULT_OFFCHAIN_POLICY.maxRedirects;
  const maxBytes = policy.maxResponseBytes ?? DEFAULT_OFFCHAIN_POLICY.maxResponseBytes;
  const timeoutMs = policy.timeoutMs ?? DEFAULT_OFFCHAIN_POLICY.timeoutMs;

  let current = assertSafeUrl(rawUrl, policy);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await fetch(current.toString(), {
      // Followed by hand so every hop can be re-validated.
      redirect: 'manual',
      // No credentials are attached to any hop.
      headers: { Accept: 'text/plain, application/json;q=0.9, */*;q=0.8' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const isRedirect = response.status >= 300 && response.status < 400;

    if (isRedirect) {
      const location = response.headers.get('location');

      if (!location) {
        throw new OffchainRequestBlockedError(
          current.toString(),
          `redirect (${response.status}) had no Location header`
        );
      }
      if (hop === maxRedirects) {
        throw new OffchainRequestBlockedError(
          current.toString(),
          `exceeded maxRedirects (${maxRedirects})`
        );
      }

      const next = new URL(location, current);
      // Re-validate the hop: the allowlist must apply to the redirect target,
      // not just the original host.
      current = assertSafeUrl(next.toString(), policy);
      continue;
    }

    if (!response.ok) {
      throw new OffchainRequestBlockedError(
        current.toString(),
        `upstream responded ${response.status}`
      );
    }

    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null && Number(declaredLength) > maxBytes) {
      throw new OffchainRequestBlockedError(
        current.toString(),
        `response of ${declaredLength} bytes exceeds the ${maxBytes} byte limit`
      );
    }

    const body = await response.text();

    if (body.length > maxBytes) {
      throw new OffchainRequestBlockedError(
        current.toString(),
        `response exceeds the ${maxBytes} byte limit`
      );
    }

    return { url: current.toString(), status: response.status, body };
  }

  // Unreachable: the loop either returns or throws on the final hop.
  throw new OffchainRequestBlockedError(rawUrl, 'redirect handling did not terminate');
}