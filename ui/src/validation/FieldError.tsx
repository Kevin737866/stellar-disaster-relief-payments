import React from 'react';

interface FieldErrorProps {
  error?: string | null;
  id?: string;
}

/**
 * Renders an inline validation error message below a form field.
 * Uses role="alert" so screen readers announce it immediately.
 */
export const FieldError: React.FC<FieldErrorProps> = ({ error, id }) => {
  if (!error) return null;
  return (
    <p
      id={id}
      role="alert"
      aria-live="polite"
      className="mt-1 text-sm text-red-600"
    >
      {error}
    </p>
  );
};
