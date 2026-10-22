import React from 'react';
import { FieldError } from '../validation/FieldError';

export interface FormFieldProps {
  /** Must match the `id` of the form control rendered as `children`. */
  id: string;
  label: string;
  /** Validation message to show and associate with the control. */
  error?: string;
  /** Optional helper text, linked with `aria-describedby` by the caller. */
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}

/**
 * Consistent label + error wrapper for form controls.
 *
 * The control rendered as `children` must use the same `id`, plus
 * `aria-invalid` and `aria-describedby={`${id}-error`}` when `error` is set so
 * assistive technology associates the message with the field.
 */
export const FormField: React.FC<FormFieldProps> = ({
  id,
  label,
  error,
  hint,
  required,
  children,
}) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium mb-1">
      {label}
      {required && (
        <span className="text-red-600" aria-hidden="true">
          {' '}
          *
        </span>
      )}
    </label>
    {children}
    {hint && (
      <p id={`${id}-hint`} className="mt-1 text-xs text-gray-500">
        {hint}
      </p>
    )}
    <FieldError id={`${id}-error`} error={error} />
  </div>
);
