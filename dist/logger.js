"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.Logger = void 0;
exports.validateLoggingConfig = validateLoggingConfig;
const LEVEL_RANK = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
};
const VALID_LEVELS = new Set(Object.keys(LEVEL_RANK));
const VALID_DESTINATIONS = new Set(['console', 'none']);
/** Validates a LoggingConfig and throws a descriptive error for invalid values. */
function validateLoggingConfig(config) {
    if (config.level !== undefined && !VALID_LEVELS.has(config.level)) {
        throw new Error(`Invalid log level "${config.level}". Must be one of: ${[...VALID_LEVELS].join(', ')}.`);
    }
    if (config.destination !== undefined && !VALID_DESTINATIONS.has(config.destination)) {
        throw new Error(`Invalid log destination "${config.destination}". Must be one of: ${[...VALID_DESTINATIONS].join(', ')}.`);
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
class Logger {
    constructor() {
        this.level = 'info';
        this.destination = 'console';
    }
    /** Apply (or re-apply) logging configuration. Validates values before applying. */
    configure(config) {
        validateLoggingConfig(config);
        if (config.level !== undefined)
            this.level = config.level;
        if (config.destination !== undefined)
            this.destination = config.destination;
    }
    /** Reset to defaults (useful in tests). */
    reset() {
        this.level = 'info';
        this.destination = 'console';
    }
    get currentLevel() {
        return this.level;
    }
    get currentDestination() {
        return this.destination;
    }
    debug(message, ...args) {
        this.emit('debug', message, ...args);
    }
    info(message, ...args) {
        this.emit('info', message, ...args);
    }
    warn(message, ...args) {
        this.emit('warn', message, ...args);
    }
    error(message, ...args) {
        this.emit('error', message, ...args);
    }
    emit(level, message, ...args) {
        if (this.destination === 'none')
            return;
        if (LEVEL_RANK[level] < LEVEL_RANK[this.level])
            return;
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
exports.Logger = Logger;
/** Shared logger instance consumed across the SDK. */
exports.logger = new Logger();
//# sourceMappingURL=logger.js.map