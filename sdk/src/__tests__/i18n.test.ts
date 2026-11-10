import {
  DEFAULT_FALLBACK_LANGUAGE,
  ERROR_MESSAGES,
  I18nManager,
  assertTranslationsComplete,
  validateTranslations,
} from '../i18n';

describe('i18n completeness and deterministic fallback (#295)', () => {
  it('verifies all shipped ERROR_MESSAGES locales contain every reference key', () => {
    const report = validateTranslations(ERROR_MESSAGES);
    expect(report.valid).toBe(true);
    expect(report.referenceLocale).toBe('en');
    expect(report.missingKeys).toEqual([]);
    expect(report.extraKeys).toEqual([]);
    expect(() => assertTranslationsComplete(ERROR_MESSAGES)).not.toThrow();
  });

  it('reports missing keys with exact locale and key names', () => {
    const partial = {
      en: { ...ERROR_MESSAGES.en },
      es: { ...ERROR_MESSAGES.es },
    };
    delete (partial.es as Record<string, unknown>).BENEFICIARY_NOT_FOUND;
    delete (partial.es as Record<string, unknown>).UNAUTHORIZED_ACCESS;

    const report = validateTranslations(partial);
    expect(report.valid).toBe(false);
    expect(report.missingKeys).toEqual(
      expect.arrayContaining([
        { locale: 'es', key: 'BENEFICIARY_NOT_FOUND' },
        { locale: 'es', key: 'UNAUTHORIZED_ACCESS' },
      ])
    );
    expect(() => assertTranslationsComplete(partial)).toThrow(/es\.BENEFICIARY_NOT_FOUND/);
    expect(() => assertTranslationsComplete(partial)).toThrow(/es\.UNAUTHORIZED_ACCESS/);
  });

  it('falls back deterministically to DEFAULT_FALLBACK_LANGUAGE and generic message', () => {
    expect(DEFAULT_FALLBACK_LANGUAGE).toBe('en');

    const frManager = new I18nManager('fr');
    expect(frManager.getFallbackOrder()).toEqual(['fr', 'en']);

    const enManager = new I18nManager('en');
    expect(enManager.getFallbackOrder()).toEqual(['en']);

    // Unsupported runtime locale safely falls back to English
    const unsupported = new I18nManager('xx' as any);
    expect(unsupported.getErrorMessage('FUND_NOT_FOUND')).toEqual(
      ERROR_MESSAGES.en.FUND_NOT_FOUND
    );

    // Unknown error code falls back to deterministic generic descriptor
    const unknown = frManager.getErrorMessage('NON_EXISTENT_CODE');
    expect(unknown).toEqual({
      code: 'NON_EXISTENT_CODE',
      message: 'Error: NON_EXISTENT_CODE',
      description: 'An unknown error occurred',
      severity: 'error',
    });
  });
});
