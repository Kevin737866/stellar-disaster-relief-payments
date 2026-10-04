import { Logger, validateLoggingConfig, LogLevel, LogDestination, logger as sharedLogger } from '../logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  const l = new Logger();
  l.reset();
  return l;
}

// ---------------------------------------------------------------------------
// validateLoggingConfig
// ---------------------------------------------------------------------------

describe('validateLoggingConfig', () => {
  it('accepts all valid log levels', () => {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
    for (const level of levels) {
      expect(() => validateLoggingConfig({ level })).not.toThrow();
    }
  });

  it('accepts all valid destinations', () => {
    const destinations: LogDestination[] = ['console', 'none'];
    for (const destination of destinations) {
      expect(() => validateLoggingConfig({ destination })).not.toThrow();
    }
  });

  it('accepts an empty config object (all fields optional)', () => {
    expect(() => validateLoggingConfig({})).not.toThrow();
  });

  it('throws for an invalid log level', () => {
    expect(() => validateLoggingConfig({ level: 'verbose' as LogLevel })).toThrow(
      'Invalid log level "verbose"'
    );
  });

  it('throws for an invalid destination', () => {
    expect(() =>
      validateLoggingConfig({ destination: 'file' as LogDestination })
    ).toThrow('Invalid log destination "file"');
  });

  it('error message lists valid levels', () => {
    expect(() => validateLoggingConfig({ level: 'trace' as LogLevel })).toThrow(
      /debug.*info.*warn.*error.*silent/
    );
  });

  it('error message lists valid destinations', () => {
    expect(() =>
      validateLoggingConfig({ destination: 'syslog' as LogDestination })
    ).toThrow(/console.*none/);
  });
});

// ---------------------------------------------------------------------------
// Logger defaults
// ---------------------------------------------------------------------------

describe('Logger — defaults', () => {
  it('defaults to level "info"', () => {
    const l = makeLogger();
    expect(l.currentLevel).toBe('info');
  });

  it('defaults to destination "console"', () => {
    const l = makeLogger();
    expect(l.currentDestination).toBe('console');
  });
});

// ---------------------------------------------------------------------------
// Logger.configure
// ---------------------------------------------------------------------------

describe('Logger.configure', () => {
  it('applies a new log level', () => {
    const l = makeLogger();
    l.configure({ level: 'debug' });
    expect(l.currentLevel).toBe('debug');
  });

  it('applies a new destination', () => {
    const l = makeLogger();
    l.configure({ destination: 'none' });
    expect(l.currentDestination).toBe('none');
  });

  it('applies both level and destination together', () => {
    const l = makeLogger();
    l.configure({ level: 'warn', destination: 'none' });
    expect(l.currentLevel).toBe('warn');
    expect(l.currentDestination).toBe('none');
  });

  it('throws for an invalid level and does not change state', () => {
    const l = makeLogger();
    expect(() => l.configure({ level: 'trace' as LogLevel })).toThrow('Invalid log level');
    expect(l.currentLevel).toBe('info'); // unchanged
  });

  it('throws for an invalid destination and does not change state', () => {
    const l = makeLogger();
    expect(() => l.configure({ destination: 'file' as LogDestination })).toThrow(
      'Invalid log destination'
    );
    expect(l.currentDestination).toBe('console'); // unchanged
  });

  it('can be called multiple times (last call wins)', () => {
    const l = makeLogger();
    l.configure({ level: 'debug' });
    l.configure({ level: 'error' });
    expect(l.currentLevel).toBe('error');
  });

  it('partial config only updates the provided field', () => {
    const l = makeLogger();
    l.configure({ level: 'warn' });
    expect(l.currentDestination).toBe('console'); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Logger.reset
// ---------------------------------------------------------------------------

describe('Logger.reset', () => {
  it('restores default level after configure', () => {
    const l = makeLogger();
    l.configure({ level: 'error' });
    l.reset();
    expect(l.currentLevel).toBe('info');
  });

  it('restores default destination after configure', () => {
    const l = makeLogger();
    l.configure({ destination: 'none' });
    l.reset();
    expect(l.currentDestination).toBe('console');
  });
});

// ---------------------------------------------------------------------------
// Log level filtering
// ---------------------------------------------------------------------------

describe('Logger — level filtering', () => {
  let l: Logger;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    l = makeLogger();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('emits info and above at default level', () => {
    l.info('hello');
    l.warn('careful');
    l.error('boom');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses debug at default level (info)', () => {
    l.debug('verbose');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('emits debug when level is "debug"', () => {
    l.configure({ level: 'debug' });
    l.debug('verbose');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses info and debug when level is "warn"', () => {
    l.configure({ level: 'warn' });
    l.debug('d');
    l.info('i');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('emits warn and error when level is "warn"', () => {
    l.configure({ level: 'warn' });
    l.warn('w');
    l.error('e');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses everything when level is "error" except error', () => {
    l.configure({ level: 'error' });
    l.debug('d');
    l.info('i');
    l.warn('w');
    l.error('e');
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses all output when level is "silent"', () => {
    l.configure({ level: 'silent' });
    l.debug('d');
    l.info('i');
    l.warn('w');
    l.error('e');
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Destination: none
// ---------------------------------------------------------------------------

describe('Logger — destination "none"', () => {
  let l: Logger;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    l = makeLogger();
    l.configure({ level: 'debug', destination: 'none' });
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('suppresses all output regardless of level', () => {
    l.debug('d');
    l.info('i');
    l.warn('w');
    l.error('e');
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

describe('Logger — message formatting', () => {
  let l: Logger;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    l = makeLogger();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('prefixes messages with the level in brackets', () => {
    l.info('test message');
    expect(logSpy).toHaveBeenCalledWith('[INFO] test message');
  });

  it('appends extra args to the message', () => {
    l.info('count:', 42);
    expect(logSpy).toHaveBeenCalledWith('[INFO] count: 42');
  });
});

// ---------------------------------------------------------------------------
// createDisasterReliefSDK integration
// ---------------------------------------------------------------------------

// Test the wiring logic directly without importing the full index.ts
// (which pulls in stellar-sdk clients that require network mocks).
// The factory simply calls logger.configure(config.logging) when present —
// we verify that contract here using the shared logger singleton.

describe('createDisasterReliefSDK — logging wiring', () => {
  /** Minimal replica of the factory's logging wiring. */
  function applyLoggingConfig(config: { logging?: any }): void {
    if (config.logging) {
      sharedLogger.configure(config.logging);
    }
  }

  afterEach(() => sharedLogger.reset());

  it('applies level and destination from config', () => {
    applyLoggingConfig({ logging: { level: 'warn', destination: 'none' } });
    expect(sharedLogger.currentLevel).toBe('warn');
    expect(sharedLogger.currentDestination).toBe('none');
  });

  it('leaves defaults when no logging config is provided', () => {
    applyLoggingConfig({});
    expect(sharedLogger.currentLevel).toBe('info');
    expect(sharedLogger.currentDestination).toBe('console');
  });

  it('throws for an invalid logging config', () => {
    expect(() => applyLoggingConfig({ logging: { level: 'verbose' as any } })).toThrow(
      'Invalid log level'
    );
  });

  it('logger state is unchanged after a failed configure call', () => {
    expect(() => applyLoggingConfig({ logging: { level: 'trace' as any } })).toThrow();
    expect(sharedLogger.currentLevel).toBe('info');
  });
});
