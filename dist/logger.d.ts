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
/** Validates a LoggingConfig and throws a descriptive error for invalid values. */
export declare function validateLoggingConfig(config: LoggingConfig): void;
/**
 * Minimal logger that respects a configurable level and destination.
 *
 * A single shared instance is exported as `logger`. Call `logger.configure()`
 * once at startup (e.g. inside `createDisasterReliefSDK`) to apply the user's
 * settings. All SDK components import `logger` directly — no constructor
 * injection required.
 */
export declare class Logger {
    private level;
    private destination;
    /** Apply (or re-apply) logging configuration. Validates values before applying. */
    configure(config: LoggingConfig): void;
    /** Reset to defaults (useful in tests). */
    reset(): void;
    get currentLevel(): LogLevel;
    get currentDestination(): LogDestination;
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    private emit;
}
/** Shared logger instance consumed across the SDK. */
export declare const logger: Logger;
//# sourceMappingURL=logger.d.ts.map