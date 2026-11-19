/**
 * Convert wallet, RPC, and Soroban failures into actionable messages.
 * Raw provider errors are deliberately never returned to the UI because they
 * can contain URLs, request payloads, wallet details, or other internals.
 */
export function getTransactionErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  const message = rawMessage.toLowerCase();

  if (/insufficient.?balance|underfunded|insufficient.?funds/.test(message)) {
    return 'The account does not have enough funds to complete this transaction. Check the balance and try again.';
  }
  if (/unauthori[sz]ed|not.?authori[sz]ed|bad.?auth|signature/.test(message)) {
    return 'The connected wallet is not authorized to perform this action. Check the selected account and its permissions.';
  }
  if (/already.?exists|duplicate|already.?registered/.test(message)) {
    return 'A record with these details already exists. Review the existing record before trying again.';
  }
  if (/expired|too.?late|timeout/.test(message)) {
    return 'The transaction expired or took too long. Refresh the data and submit it again.';
  }
  if (/network|fetch|connection|rpc|gateway/.test(message)) {
    return 'The blockchain network could not be reached. Check your connection and try again.';
  }
  if (/reject|denied|cancelled|canceled/.test(message)) {
    return 'The transaction was cancelled in your wallet. Approve it to continue.';
  }

  return 'The transaction could not be completed. Check your wallet connection and permissions, then try again.';
}
