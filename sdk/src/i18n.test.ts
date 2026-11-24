import {
  ERROR_MESSAGES,
  ErrorMessage,
  FALLBACK_LOCALE,
  findMissingTranslations,
  I18nManager,
  Language,
  LocalizedErrorMessages,
} from './i18n';

function entry(code: string): ErrorMessage {
  return {
    code,
    message: `message:${code}`,
    description: `description:${code}`,
    severity: 'error',
  };
}

describe('i18n dictionaries', () => {
  it('uses an explicit, deterministic fallback locale', () => {
    expect(FALLBACK_LOCALE).toBe('en');

    const manager = new I18nManager();
    expect(manager.getLanguage()).toBe(FALLBACK_LOCALE);
    expect(manager.getErrorMessage('INSUFFICIENT_FUNDS')).toEqual(
      ERROR_MESSAGES[FALLBACK_LOCALE].INSUFFICIENT_FUNDS,
    );
  });

  it('has complete dictionaries for every locale', () => {
    expect(findMissingTranslations()).toEqual([]);

    const referenceKeys = Object.keys(ERROR_MESSAGES[FALLBACK_LOCALE]).sort();
    for (const [locale, messages] of Object.entries(ERROR_MESSAGES)) {
      expect({ locale, keys: Object.keys(messages).sort() }).toEqual({
        locale,
        keys: referenceKeys,
      });
    }
  });

  it('reports missing keys with locale and key names in deterministic order', () => {
    const dictionaries: LocalizedErrorMessages = {
      en: { A: entry('A'), B: entry('B'), C: entry('C') },
      fr: { A: entry('A') },
      es: { B: entry('B') },
      de: { A: entry('A'), B: entry('B'), C: undefined as unknown as ErrorMessage },
    };

    expect(findMissingTranslations(dictionaries)).toEqual([
      { locale: 'de', key: 'C' },
      { locale: 'es', key: 'A' },
      { locale: 'es', key: 'C' },
      { locale: 'fr', key: 'B' },
      { locale: 'fr', key: 'C' },
    ]);
  });

  it('falls back to the reference locale when a locale omits a key', () => {
    const spanish = ERROR_MESSAGES.es as Record<string, ErrorMessage>;
    const original = spanish.FUND_NOT_ACTIVE;

    try {
      delete spanish.FUND_NOT_ACTIVE;

      expect(findMissingTranslations()).toEqual([{ locale: 'es', key: 'FUND_NOT_ACTIVE' }]);

      const manager = new I18nManager('es');
      expect(manager.getErrorMessage('FUND_NOT_ACTIVE')).toEqual(
        ERROR_MESSAGES[FALLBACK_LOCALE].FUND_NOT_ACTIVE,
      );
      expect(manager.getMessage('FUND_NOT_ACTIVE')).toBe(
        ERROR_MESSAGES[FALLBACK_LOCALE].FUND_NOT_ACTIVE.message,
      );
    } finally {
      spanish.FUND_NOT_ACTIVE = original;
    }
  });

  it('falls back to English for an unsupported locale', () => {
    const manager = new I18nManager('xx' as Language);
    expect(manager.getLanguage()).toBe('xx');
    expect(manager.getErrorMessage('TRANSFER_FAILED')).toEqual(
      ERROR_MESSAGES[FALLBACK_LOCALE].TRANSFER_FAILED,
    );

    manager.setLanguage('yy' as Language);
    expect(manager.getDescription('TRANSFER_FAILED')).toBe(
      ERROR_MESSAGES[FALLBACK_LOCALE].TRANSFER_FAILED.description,
    );
  });

  it('returns a generic error when neither the locale nor the fallback has the key', () => {
    const manager = new I18nManager('fr');
    expect(manager.getErrorMessage('NOT_A_REAL_CODE')).toEqual({
      code: 'NOT_A_REAL_CODE',
      message: 'Error: NOT_A_REAL_CODE',
      description: 'An unknown error occurred',
      severity: 'error',
    });
  });
});
