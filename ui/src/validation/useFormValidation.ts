import { useState, useCallback, useRef } from 'react';
import { Validator } from './validators';

export type FieldErrors<T> = Partial<Record<keyof T, string>>;
export type FieldTouched<T> = Partial<Record<keyof T, boolean>>;
export type FieldRules<T> = Partial<Record<keyof T, Validator>>;

export interface UseFormValidationReturn<T> {
  errors: FieldErrors<T>;
  touched: FieldTouched<T>;
  /** Validate a single field and mark it touched */
  validateField: (name: keyof T, value: string) => string | null;
  /** Validate all fields at once (for submit). Returns true if valid. */
  validateAll: (values: Record<keyof T, string>) => boolean;
  /** Mark a field as touched (on blur) */
  touchField: (name: keyof T) => void;
  /** Clear all errors and touched state */
  reset: () => void;
  /** Whether the form has any errors */
  hasErrors: boolean;
}

/**
 * Minimal form validation hook.
 * Pass a rules map of { fieldName: Validator } and it tracks errors + touched state.
 */
export function useFormValidation<T extends Record<string, string>>(
  rules: FieldRules<T>
): UseFormValidationReturn<T> {
  const [errors, setErrors] = useState<FieldErrors<T>>({});
  const [touched, setTouched] = useState<FieldTouched<T>>({});
  // Keep rules in a ref so callers don't need to memoize
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const validateField = useCallback((name: keyof T, value: string): string | null => {
    const validator = rulesRef.current[name];
    const error = validator ? validator(value) : null;
    setErrors((prev) => ({ ...prev, [name]: error ?? undefined }));
    setTouched((prev) => ({ ...prev, [name]: true }));
    return error;
  }, []);

  const touchField = useCallback((name: keyof T) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
  }, []);

  const validateAll = useCallback((values: Record<keyof T, string>): boolean => {
    const newErrors: FieldErrors<T> = {};
    const newTouched: FieldTouched<T> = {};
    let valid = true;

    for (const name of Object.keys(rulesRef.current) as (keyof T)[]) {
      const validator = rulesRef.current[name];
      if (!validator) continue;
      const error = validator(values[name] ?? '');
      newTouched[name] = true;
      if (error) {
        newErrors[name] = error;
        valid = false;
      }
    }

    setErrors(newErrors);
    setTouched(newTouched);
    return valid;
  }, []);

  const reset = useCallback(() => {
    setErrors({});
    setTouched({});
  }, []);

  const hasErrors = Object.values(errors).some(Boolean);

  return { errors, touched, validateField, validateAll, touchField, reset, hasErrors };
}
