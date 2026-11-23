/**
 * Internationalization (i18n) Module
 * Provides localized error messages and notifications in multiple languages
 */
export type Language = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ja' | 'zh' | 'ar' | 'hi';
export interface ErrorMessage {
    code: string;
    message: string;
    description: string;
    severity: 'error' | 'warning' | 'info';
}
export interface LocalizedErrorMessages {
    [language: string]: {
        [errorCode: string]: ErrorMessage;
    };
}
/**
 * Complete error message translations
 */
export declare const ERROR_MESSAGES: LocalizedErrorMessages;
/**
 * i18n Manager for handling error messages in multiple languages
 */
export declare class I18nManager {
    private currentLanguage;
    private fallbackLanguage;
    constructor(language?: Language);
    /**
     * Set the current language
     */
    setLanguage(language: Language): void;
    /**
     * Get the current language
     */
    getLanguage(): Language;
    /**
     * Get error message by code
     */
    getErrorMessage(errorCode: string): ErrorMessage;
    /**
     * Get localized error message string
     */
    getMessage(errorCode: string): string;
    /**
     * Get localized error description
     */
    getDescription(errorCode: string): string;
    /**
     * Get all available languages
     */
    getAvailableLanguages(): Language[];
    /**
     * Get all error codes
     */
    getAvailableErrorCodes(): string[];
    /**
     * Format error message with parameters
     */
    formatError(errorCode: string, params?: Record<string, string>): string;
}
export declare const defaultI18n: I18nManager;
//# sourceMappingURL=i18n.d.ts.map