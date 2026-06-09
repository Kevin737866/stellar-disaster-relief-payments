/** Supported log levels in ascending severity order. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Output destination for log messages. */
export type LogDestination = 'console' | 'none';

export interface LoggingConfig {
  /** Minimum level to emit. Messages below this level are suppressed.
   *  Defaults to 'info'. */
  level?: LogLevel;
  /** Where to write log output. Defaults to 'console'. */
  destination?: LogDestination;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const VALID_LEVELS = new Set<string>(Object.keys(LEVEL_RANK));
const VALID_DESTINATIONS = new Set<string>(['console', 'none']);

/** Validates a LoggingConfig and throws a descriptive error for invalid values. */
export function validateLoggingConfig(config: LoggingConfig): void {
  if (config.level !== undefined && !VALID_LEVELS.has(config.level)) {
    throw new Error(
      `Invalid log level "${config.level}". Must be one of: ${[...VALID_LEVELS].join(', ')}.`
    );
  }
  if (config.destination !== undefined && !VALID_DESTINATIONS.has(config.destination)) {
    throw new Error(
      `Invalid log destination "${config.destination}". Must be one of: ${[...VALID_DESTINATIONS].join(', ')}.`
    );
  }
}

/**
 * Minimal logger that respects a configurable level and destination.
 *
 * A single shared instance is exported as `logger`. Call `logger.configure()`
 * once at startup (e.g. inside `createDisasterReliefSDK`) to apply the user's
 * settings. All SDK components import `logger` directly — no constructor
 * injection required.
 */
export class Logger {
  private level: LogLevel = 'info';
  private destination: LogDestination = 'console';

  /** Apply (or re-apply) logging configuration. Validates values before applying. */
  configure(config: LoggingConfig): void {
    validateLoggingConfig(config);
    if (config.level !== undefined) this.level = config.level;
    if (config.destination !== undefined) this.destination = config.destination;
  }

  /** Reset to defaults (useful in tests). */
  reset(): void {
    this.level = 'info';
    this.destination = 'console';
  }

  get currentLevel(): LogLevel {
    return this.level;
  }

  get currentDestination(): LogDestination {
    return this.destination;
  }

  debug(message: string, ...args: unknown[]): void {
    this.emit('debug', message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.emit('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.emit('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.emit('error', message, ...args);
  }

  private emit(level: LogLevel, message: string, ...args: unknown[]): void {
    if (this.destination === 'none') return;
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;

    const formatted = args.length ? `${message} ${args.map(String).join(' ')}` : message;
    const prefix = `[${level.toUpperCase()}]`;

    switch (level) {
      case 'debug':
      case 'info':
        console.log(`${prefix} ${formatted}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${formatted}`);
        break;
      case 'error':
        console.error(`${prefix} ${formatted}`);
        break;
    }
  }
}

/** Shared logger instance consumed across the SDK. */
export const logger = new Logger();
