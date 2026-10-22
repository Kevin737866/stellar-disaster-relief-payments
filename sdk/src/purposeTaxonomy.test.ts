import {
  categorizePurpose,
  classifyPurpose,
  isDisbursementPurposeCategory,
  normalizePurpose,
  validatePurpose,
} from './purposeTaxonomy';
import { PURPOSE_MAX_LENGTH } from './types';

describe('purpose taxonomy', () => {
  describe('normalizePurpose', () => {
    it('lower-cases, trims, and converts separators to underscores', () => {
      expect(normalizePurpose('  Food Supplies  ')).toBe('food_supplies');
      expect(normalizePurpose('cash-for-work')).toBe('cash_for_work');
      expect(normalizePurpose('water / sanitation')).toBe('water_sanitation');
    });

    it('strips punctuation and collapses repeated underscores', () => {
      expect(normalizePurpose('Food: rice & beans!')).toBe('food_rice_beans');
      expect(normalizePurpose('__medical__supplies__')).toBe('medical_supplies');
    });

    it('returns an empty string for empty input', () => {
      expect(normalizePurpose('')).toBe('');
      expect(normalizePurpose('   ')).toBe('');
    });
  });

  describe('categorizePurpose', () => {
    it('keeps canonical categories unchanged', () => {
      expect(categorizePurpose('food')).toBe('food');
      expect(categorizePurpose('MEDICAL')).toBe('medical');
      expect(categorizePurpose('administration')).toBe('administration');
    });

    it('maps known keywords and phrases', () => {
      expect(categorizePurpose('Food supplies')).toBe('food');
      expect(categorizePurpose('hot meals')).toBe('food');
      expect(categorizePurpose('cash-for-work')).toBe('livelihoods');
      expect(categorizePurpose('first aid kits')).toBe('medical');
      expect(categorizePurpose('child protection')).toBe('protection');
    });

    it('does not match keywords inside unrelated words', () => {
      expect(categorizePurpose('seafood processing')).toBe('other');
      expect(categorizePurpose('watermelon seeds')).toBe('other');
    });

    it('falls back to other for unknown purposes', () => {
      expect(categorizePurpose('mystery grant')).toBe('other');
      expect(categorizePurpose('')).toBe('other');
    });
  });

  describe('classifyPurpose', () => {
    it('returns the raw, normalised, category, and canonical flag', () => {
      expect(classifyPurpose('Food supplies')).toEqual({
        raw: 'Food supplies',
        normalized: 'food_supplies',
        category: 'food',
        isCanonical: false,
      });

      expect(classifyPurpose('food')).toEqual({
        raw: 'food',
        normalized: 'food',
        category: 'food',
        isCanonical: true,
      });
    });
  });

  describe('isDisbursementPurposeCategory', () => {
    it('recognises canonical categories case-insensitively', () => {
      expect(isDisbursementPurposeCategory('food')).toBe(true);
      expect(isDisbursementPurposeCategory('Medical')).toBe(true);
      expect(isDisbursementPurposeCategory('food_supplies')).toBe(false);
    });
  });

  describe('validatePurpose', () => {
    it('rejects empty and whitespace-only values', () => {
      expect(validatePurpose('')).toBe('Purpose is required.');
      expect(validatePurpose('   ')).toBe('Purpose is required.');
    });

    it('rejects values above the maximum length', () => {
      expect(validatePurpose('x'.repeat(PURPOSE_MAX_LENGTH + 1))).toBe(
        `Purpose must be ${PURPOSE_MAX_LENGTH} characters or fewer.`
      );
    });

    it('accepts values at the boundary', () => {
      expect(validatePurpose('x'.repeat(PURPOSE_MAX_LENGTH))).toBeNull();
      expect(validatePurpose('food')).toBeNull();
    });
  });
});
