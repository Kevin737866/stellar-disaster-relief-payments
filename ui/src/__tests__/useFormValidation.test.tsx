import { act, renderHook } from '@testing-library/react';
import { useFormValidation } from '../validation/useFormValidation';
import { compose, required, stellarAddress, u256Amount } from '../validation/validators';

interface FinancialForm {
  amount: string;
  wallet: string;
}

describe('useFormValidation financial fields', () => {
  const rules = {
    amount: compose(required('Amount'), u256Amount),
    wallet: compose(required('Wallet address'), stellarAddress),
  };

  it('reports invalid amount and wallet values on submit', () => {
    const { result } = renderHook(() => useFormValidation<FinancialForm>(rules));

    let valid = true;
    act(() => {
      valid = result.current.validateAll({ amount: '1.25', wallet: 'not-a-wallet' });
    });

    expect(valid).toBe(false);
    expect(result.current.errors.amount).toMatch(/whole-number/i);
    expect(result.current.errors.wallet).toBeTruthy();
    expect(result.current.touched.amount).toBe(true);
    expect(result.current.touched.wallet).toBe(true);
  });

  it('accepts a valid u256 amount and checksum-valid Stellar public key', () => {
    const { result } = renderHook(() => useFormValidation<FinancialForm>(rules));

    let valid = false;
    act(() => {
      valid = result.current.validateAll({
        amount: '9007199254740993',
        wallet: 'GAAACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6CHU',
      });
    });

    expect(valid).toBe(true);
    expect(result.current.hasErrors).toBe(false);
  });
});
