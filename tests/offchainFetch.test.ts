/**
 * Tests for the off-chain fetch guard.
 *
 * #238 — `discoverMerchantsFromStellarToml` interpolated a caller-supplied
 * domain straight into a URL and fetched it. These cover the host forms that
 * made that exploitable.
 *
 * Placed under `tests/` rather than `ui/src/__tests__` because the root
 * jest.config.js runs `roots: ['<rootDir>/tests']` with `testMatch:
 * ['**/*.test.ts']` — a test in the UI directory would silently never run.
 */
import {
  normaliseHost,
  isHostAllowed,
  assertSafeUrl,
  safeFetchText,
  OffchainRequestBlockedError,
} from '../sdk/src/offchainFetch';

const POLICY = {
  allowedHosts: ['merchants.relief.example'],
  allowedHostSuffixes: ['.relief.example'],
};

describe('normaliseHost', () => {
  it('accepts a bare hostname', () => {
    expect(normaliseHost('merchants.relief.example')).toBe('merchants.relief.example');
  });

  it('accepts a hostname with a port', () => {
    expect(normaliseHost('merchants.relief.example:8443')).toBe('merchants.relief.example:8443');
  });

  it('lowercases', () => {
    expect(normaliseHost('MERCHANTS.RELIEF.EXAMPLE')).toBe('merchants.relief.example');
  });

  it('trims surrounding whitespace', () => {
    expect(normaliseHost('  merchants.relief.example  ')).toBe('merchants.relief.example');
  });

  // Each of these would change which host `https://${input}/...` resolves to.
  it('rejects a scheme prefix', () => {
    expect(() => normaliseHost('https://evil.com')).toThrow();
  });

  it('rejects embedded credentials', () => {
    expect(() => normaliseHost('user:pass@evil.com')).toThrow();
    expect(() => normaliseHost('user@evil.com')).toThrow();
  });

  it('rejects a path', () => {
    expect(() => normaliseHost('evil.com/path')).toThrow();
  });

  it('rejects a query or fragment', () => {
    expect(() => normaliseHost('evil.com?a=1')).toThrow();
    expect(() => normaliseHost('evil.com#f')).toThrow();
  });

  it('rejects internal whitespace', () => {
    expect(() => normaliseHost('evil .com')).toThrow();
  });

  it('rejects empty and non-strings', () => {
    expect(() => normaliseHost('')).toThrow();
    expect(() => normaliseHost('   ')).toThrow();
    expect(() => normaliseHost(undefined as unknown as string)).toThrow();
    expect(() => normaliseHost(42 as unknown as string)).toThrow();
  });
});

describe('isHostAllowed', () => {
  it('matches an exact host', () => {
    expect(isHostAllowed('merchants.relief.example', POLICY)).toBe(true);
  });

  it('matches a suffix rule', () => {
    expect(isHostAllowed('shop.relief.example', POLICY)).toBe(true);
  });

  it('rejects an unrelated host', () => {
    expect(isHostAllowed('evil.com', POLICY)).toBe(false);
  });

  // The classic allowlist bypass: the attacker host merely *ends with* the
  // allowlisted string.
  it('rejects a host that merely ends with the allowed name', () => {
    expect(isHostAllowed('evil-merchants.relief.example', POLICY)).toBe(false);
    expect(isHostAllowed('merchants.relief.example.evil.com', POLICY)).toBe(false);
  });

  it('requires the suffix rule to have a leading dot', () => {
    expect(isHostAllowed('notrelief.example', { allowedHostSuffixes: ['.relief.example'] })).toBe(false);
  });

  it('allows nothing when the policy is empty', () => {
    expect(isHostAllowed('anything.example', {})).toBe(false);
  });
});

describe('assertSafeUrl', () => {
  it('accepts an allowlisted HTTPS URL', () => {
    expect(() => assertSafeUrl('https://merchants.relief.example/.well-known/stellar.toml', POLICY)).not.toThrow();
  });

  it('rejects plain HTTP', () => {
    expect(() => assertSafeUrl('http://merchants.relief.example/x', POLICY)).toThrow(
      OffchainRequestBlockedError
    );
  });

  it('rejects a non-allowlisted host', () => {
    expect(() => assertSafeUrl('https://evil.com/x', POLICY)).toThrow(
      OffchainRequestBlockedError
    );
  });

  it('rejects loopback and link-local literals', () => {
    for (const host of ['localhost', '127.0.0.1', '169.254.169.254', '10.1.2.3', '192.168.0.1']) {
      expect(() => assertSafeUrl(`https://${host}/x`, { allowedHosts: [host] })).toThrow(
        OffchainRequestBlockedError
      );
    }
  });

  it('rejects embedded credentials in the URL', () => {
    expect(() => assertSafeUrl('https://user:pass@merchants.relief.example/x', POLICY)).toThrow(
      OffchainRequestBlockedError
    );
  });

  it('rejects a non-absolute URL', () => {
    expect(() => assertSafeUrl('/relative/path', POLICY)).toThrow(OffchainRequestBlockedError);
  });

  it('can be configured to permit private hosts', () => {
    expect(() =>
      assertSafeUrl('https://127.0.0.1/x', { allowedHosts: ['127.0.0.1'], blockPrivateHosts: false })
    ).not.toThrow();
  });
});

describe('safeFetchText', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(handler: (url: string, init: RequestInit) => Response): jest.Mock {
    const fn = jest.fn(async (url: string, init: RequestInit) => handler(url, init)) as unknown as jest.Mock;
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  function jsonResponse(body: string, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map([['content-length', String(body.length)]]) as unknown as Headers,
      text: async () => body,
    } as unknown as Response;
  }

  function redirectResponse(location: string, status = 302): Response {
    return {
      ok: false,
      status,
      headers: new Map([['location', location]]) as unknown as Headers,
      text: async () => '',
    } as unknown as Response;
  }

  it('returns the body for an allowlisted host', async () => {
    mockFetch(() => jsonResponse('hello'));
    const result = await safeFetchText('https://merchants.relief.example/x', POLICY);
    expect(result.body).toBe('hello');
    expect(result.status).toBe(200);
  });

  it('never follows redirects automatically', async () => {
    const fn = mockFetch(() => jsonResponse('ok'));
    await safeFetchText('https://merchants.relief.example/x', POLICY);
    expect(fn.mock.calls[0][1].redirect).toBe('manual');
  });

  it('never sends credential headers', async () => {
    const fn = mockFetch(() => jsonResponse('ok'));
    await safeFetchText('https://merchants.relief.example/x', POLICY);
    const headers = fn.mock.calls[0][1].headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('cookie');
  });

  // The allowlist bypass this closes: an allowed host redirecting inward.
  it('refuses a redirect to a non-allowlisted host', async () => {
    mockFetch(() => redirectResponse('https://169.254.169.254/latest/meta-data/'));
    await expect(safeFetchText('https://merchants.relief.example/x', POLICY)).rejects.toThrow(
      OffchainRequestBlockedError
    );
  });

  it('refuses a redirect to another unlisted public host', async () => {
    mockFetch(() => redirectResponse('https://evil.com/x'));
    await expect(safeFetchText('https://merchants.relief.example/x', POLICY)).rejects.toThrow(
      OffchainRequestBlockedError
    );
  });

  it('follows a redirect when the target is also allowlisted', async () => {
    let call = 0;
    mockFetch(() => {
      call += 1;
      return call === 1
        ? redirectResponse('https://shop.relief.example/y')
        : jsonResponse('followed');
    });
    const result = await safeFetchText('https://merchants.relief.example/x', POLICY);
    expect(result.body).toBe('followed');
    expect(result.url).toBe('https://shop.relief.example/y');
  });

  it('stops after maxRedirects', async () => {
    mockFetch(() => redirectResponse('https://shop.relief.example/y'));
    await expect(
      safeFetchText('https://merchants.relief.example/x', { ...POLICY, maxRedirects: 1 })
    ).rejects.toThrow(OffchainRequestBlockedError);
  });

  it('rejects a redirect with no Location header', async () => {
    mockFetch(() => redirectResponse(''));
    await expect(safeFetchText('https://merchants.relief.example/x', POLICY)).rejects.toThrow(
      OffchainRequestBlockedError
    );
  });

  it('throws on a non-OK response', async () => {
    mockFetch(() => jsonResponse('nope', 500));
    await expect(safeFetchText('https://merchants.relief.example/x', POLICY)).rejects.toThrow(
      OffchainRequestBlockedError
    );
  });

  it('rejects a response larger than the byte limit', async () => {
    mockFetch(() => jsonResponse('x'.repeat(200)));
    await expect(
      safeFetchText('https://merchants.relief.example/x', { ...POLICY, maxResponseBytes: 100 })
    ).rejects.toThrow(OffchainRequestBlockedError);
  });

  it('rejects before any request is made when the host is not allowlisted', async () => {
    const fn = mockFetch(() => jsonResponse('ok'));
    await expect(safeFetchText('https://evil.com/x', POLICY)).rejects.toThrow(
      OffchainRequestBlockedError
    );
    expect(fn).not.toHaveBeenCalled();
  });
});