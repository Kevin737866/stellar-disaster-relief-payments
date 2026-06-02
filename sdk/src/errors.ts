/**
 * Custom Error Types for Stellar Disaster Relief Payments SDK
 * Provides detailed error information with error codes and contextual data
 */

export enum ErrorCode {
  // Fund Management Errors (1000-1099)
  FUND_NOT_FOUND = 'FUND_NOT_FOUND',
  FUND_ALREADY_EXISTS = 'FUND_ALREADY_EXISTS',
  FUND_EXPIRED = 'FUND_EXPIRED',
  FUND_INACTIVE = 'FUND_INACTIVE',
  FUND_INSUFFICIENT_BALANCE = 'FUND_INSUFFICIENT_BALANCE',
  FUND_CREATION_FAILED = 'FUND_CREATION_FAILED',
  FUND_UPDATE_FAILED = 'FUND_UPDATE_FAILED',
  
  // Trigger Errors (1100-1199)
  TRIGGER_NOT_FOUND = 'TRIGGER_NOT_FOUND',
  TRIGGER_ALREADY_EXISTS = 'TRIGGER_ALREADY_EXISTS',
  TRIGGER_INACTIVE = 'TRIGGER_INACTIVE',
  TRIGGER_EXECUTION_FAILED = 'TRIGGER_EXECUTION_FAILED',
  TRIGGER_VALIDATION_FAILED = 'TRIGGER_VALIDATION_FAILED',
  INSUFFICIENT_ORACLE_CONFIRMATIONS = 'INSUFFICIENT_ORACLE_CONFIRMATIONS',
  
  // Disbursement Errors (1200-1299)
  DISBURSEMENT_FAILED = 'DISBURSEMENT_FAILED',
  DISBURSEMENT_NOT_FOUND = 'DISBURSEMENT_NOT_FOUND',
  INSUFFICIENT_APPROVALS = 'INSUFFICIENT_APPROVALS',
  UNAUTHORIZED_APPROVER = 'UNAUTHORIZED_APPROVER',
  DISBURSEMENT_AMOUNT_EXCEEDS_LIMIT = 'DISBURSEMENT_AMOUNT_EXCEEDS_LIMIT',
  
  // Allocation Errors (1300-1399)
  ALLOCATION_FAILED = 'ALLOCATION_FAILED',
  ALLOCATION_BELOW_MINIMUM = 'ALLOCATION_BELOW_MINIMUM',
  ALLOCATION_EXCEEDS_MAXIMUM = 'ALLOCATION_EXCEEDS_MAXIMUM',
  INVALID_SECTOR = 'INVALID_SECTOR',
  
  // Beneficiary Errors (2000-2099)
  BENEFICIARY_NOT_FOUND = 'BENEFICIARY_NOT_FOUND',
  BENEFICIARY_ALREADY_EXISTS = 'BENEFICIARY_ALREADY_EXISTS',
  BENEFICIARY_VERIFICATION_FAILED = 'BENEFICIARY_VERIFICATION_FAILED',
  INVALID_BENEFICIARY_ID = 'INVALID_BENEFICIARY_ID',
  
  // Merchant Errors (3000-3099)
  MERCHANT_NOT_FOUND = 'MERCHANT_NOT_FOUND',
  MERCHANT_ALREADY_EXISTS = 'MERCHANT_ALREADY_EXISTS',
  MERCHANT_VERIFICATION_FAILED = 'MERCHANT_VERIFICATION_FAILED',
  MERCHANT_INACTIVE = 'MERCHANT_INACTIVE',
  MERCHANT_LIMIT_EXCEEDED = 'MERCHANT_LIMIT_EXCEEDED',
  
  // Transaction Errors (4000-4099)
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  TRANSACTION_NOT_FOUND = 'TRANSACTION_NOT_FOUND',
  TRANSACTION_EXPIRED = 'TRANSACTION_EXPIRED',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  TRANSACTION_REJECTED = 'TRANSACTION_REJECTED',
  
  // Network/Connection Errors (5000-5099)
  NETWORK_ERROR = 'NETWORK_ERROR',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  RPC_ERROR = 'RPC_ERROR',
  HORIZON_ERROR = 'HORIZON_ERROR',
  
  // Validation Errors (6000-6099)
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  
  // Authentication/Authorization Errors (7000-7099)
  UNAUTHORIZED = 'UNAUTHORIZED',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  
  // Generic Errors (9000-9099)
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
}

export class StellarDisasterReliefError extends Error {
  public readonly code: ErrorCode;
  public readonly context?: Record<string, any>;
  public readonly timestamp: number;
  public readonly originalError?: Error;

  constructor(
    code: ErrorCode,
    message: string,
    context?: Record<string, any>,
    originalError?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    this.timestamp = Date.now();
    this.originalError = originalError;
    
    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
      } : undefined,
    };
  }
}

export class FundNotFoundError extends StellarDisasterReliefError {
  constructor(fundId: string, context?: Record<string, any>) {
    super(
      ErrorCode.FUND_NOT_FOUND,
      `Fund with ID '${fundId}' not found or does not exist`,
      { fundId, ...context }
    );
  }
}

export class FundCreationError extends StellarDisasterReliefError {
  constructor(fundId: string, reason: string, context?: Record<string, any>) {
    super(
      ErrorCode.FUND_CREATION_FAILED,
      `Failed to create fund '${fundId}': ${reason}`,
      { fundId, reason, ...context }
    );
  }
}

export class FundExpiredError extends StellarDisasterReliefError {
  constructor(fundId: string, expiresAt: number, context?: Record<string, any>) {
    super(
      ErrorCode.FUND_EXPIRED,
      `Fund '${fundId}' expired at ${new Date(expiresAt).toISOString()}`,
      { fundId, expiresAt, ...context }
    );
  }
}

export class InsufficientBalanceError extends StellarDisasterReliefError {
  constructor(fundId: string, requested: string, available: string, context?: Record<string, any>) {
    super(
      ErrorCode.FUND_INSUFFICIENT_BALANCE,
      `Insufficient balance in fund '${fundId}': requested ${requested}, available ${available}`,
      { fundId, requested, available, ...context }
    );
  }
}

export class TriggerExecutionError extends StellarDisasterReliefError {
  constructor(triggerId: string, fundId: string, reason: string, context?: Record<string, any>) {
    super(
      ErrorCode.TRIGGER_EXECUTION_FAILED,
      `Failed to execute trigger '${triggerId}' for fund '${fundId}': ${reason}`,
      { triggerId, fundId, reason, ...context }
    );
  }
}

export class InsufficientApprovalsError extends StellarDisasterReliefError {
  constructor(fundId: string, required: number, received: number, context?: Record<string, any>) {
    super(
      ErrorCode.INSUFFICIENT_APPROVALS,
      `Insufficient approvals for fund '${fundId}': required ${required}, received ${received}`,
      { fundId, required, received, ...context }
    );
  }
}

export class UnauthorizedApproverError extends StellarDisasterReliefError {
  constructor(fundId: string, approver: string, context?: Record<string, any>) {
    super(
      ErrorCode.UNAUTHORIZED_APPROVER,
      `Address '${approver}' is not authorized to approve disbursements for fund '${fundId}'`,
      { fundId, approver, ...context }
    );
  }
}

export class AllocationError extends StellarDisasterReliefError {
  constructor(fundId: string, sector: string, reason: string, context?: Record<string, any>) {
    super(
      ErrorCode.ALLOCATION_FAILED,
      `Failed to allocate funds to sector '${sector}' for fund '${fundId}': ${reason}`,
      { fundId, sector, reason, ...context }
    );
  }
}

export class AllocationBelowMinimumError extends StellarDisasterReliefError {
  constructor(fundId: string, sector: string, amount: string, minimum: string, context?: Record<string, any>) {
    super(
      ErrorCode.ALLOCATION_BELOW_MINIMUM,
      `Allocation amount ${amount} for sector '${sector}' is below minimum threshold ${minimum}`,
      { fundId, sector, amount, minimum, ...context }
    );
  }
}

export class AllocationExceedsMaximumError extends StellarDisasterReliefError {
  constructor(fundId: string, sector: string, amount: string, maximum: string, context?: Record<string, any>) {
    super(
      ErrorCode.ALLOCATION_EXCEEDS_MAXIMUM,
      `Allocation amount ${amount} for sector '${sector}' exceeds maximum threshold ${maximum}`,
      { fundId, sector, amount, maximum, ...context }
    );
  }
}

export class BeneficiaryNotFoundError extends StellarDisasterReliefError {
  constructor(beneficiaryId: string, context?: Record<string, any>) {
    super(
      ErrorCode.BENEFICIARY_NOT_FOUND,
      `Beneficiary with ID '${beneficiaryId}' not found`,
      { beneficiaryId, ...context }
    );
  }
}

export class MerchantNotFoundError extends StellarDisasterReliefError {
  constructor(merchantId: string, context?: Record<string, any>) {
    super(
      ErrorCode.MERCHANT_NOT_FOUND,
      `Merchant with ID '${merchantId}' not found`,
      { merchantId, ...context }
    );
  }
}

export class TransactionError extends StellarDisasterReliefError {
  constructor(transactionId: string, reason: string, context?: Record<string, any>) {
    super(
      ErrorCode.TRANSACTION_FAILED,
      `Transaction '${transactionId}' failed: ${reason}`,
      { transactionId, reason, ...context }
    );
  }
}

export class NetworkError extends StellarDisasterReliefError {
  constructor(operation: string, reason: string, context?: Record<string, any>) {
    super(
      ErrorCode.NETWORK_ERROR,
      `Network error during ${operation}: ${reason}`,
      { operation, reason, ...context }
    );
  }
}

export class ValidationError extends StellarDisasterReliefError {
  constructor(field: string, reason: string, context?: Record<string, any>) {
    super(
      ErrorCode.VALIDATION_FAILED,
      `Validation failed for field '${field}': ${reason}`,
      { field, reason, ...context }
    );
  }
}

export class UnauthorizedError extends StellarDisasterReliefError {
  constructor(operation: string, address: string, context?: Record<string, any>) {
    super(
      ErrorCode.UNAUTHORIZED,
      `Unauthorized: address '${address}' is not authorized to perform ${operation}`,
      { operation, address, ...context }
    );
  }
}
