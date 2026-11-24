/**
 * Custom Error Types for Stellar Disaster Relief Payments SDK
 * Provides detailed error information with error codes and contextual data
 */
export declare enum ErrorCode {
    FUND_NOT_FOUND = "FUND_NOT_FOUND",
    FUND_ALREADY_EXISTS = "FUND_ALREADY_EXISTS",
    FUND_EXPIRED = "FUND_EXPIRED",
    FUND_INACTIVE = "FUND_INACTIVE",
    FUND_INSUFFICIENT_BALANCE = "FUND_INSUFFICIENT_BALANCE",
    FUND_CREATION_FAILED = "FUND_CREATION_FAILED",
    FUND_UPDATE_FAILED = "FUND_UPDATE_FAILED",
    TRIGGER_NOT_FOUND = "TRIGGER_NOT_FOUND",
    TRIGGER_ALREADY_EXISTS = "TRIGGER_ALREADY_EXISTS",
    TRIGGER_INACTIVE = "TRIGGER_INACTIVE",
    TRIGGER_EXECUTION_FAILED = "TRIGGER_EXECUTION_FAILED",
    TRIGGER_VALIDATION_FAILED = "TRIGGER_VALIDATION_FAILED",
    INSUFFICIENT_ORACLE_CONFIRMATIONS = "INSUFFICIENT_ORACLE_CONFIRMATIONS",
    DISBURSEMENT_FAILED = "DISBURSEMENT_FAILED",
    DISBURSEMENT_NOT_FOUND = "DISBURSEMENT_NOT_FOUND",
    INSUFFICIENT_APPROVALS = "INSUFFICIENT_APPROVALS",
    UNAUTHORIZED_APPROVER = "UNAUTHORIZED_APPROVER",
    DISBURSEMENT_AMOUNT_EXCEEDS_LIMIT = "DISBURSEMENT_AMOUNT_EXCEEDS_LIMIT",
    ALLOCATION_FAILED = "ALLOCATION_FAILED",
    ALLOCATION_BELOW_MINIMUM = "ALLOCATION_BELOW_MINIMUM",
    ALLOCATION_EXCEEDS_MAXIMUM = "ALLOCATION_EXCEEDS_MAXIMUM",
    INVALID_SECTOR = "INVALID_SECTOR",
    BENEFICIARY_NOT_FOUND = "BENEFICIARY_NOT_FOUND",
    BENEFICIARY_ALREADY_EXISTS = "BENEFICIARY_ALREADY_EXISTS",
    BENEFICIARY_VERIFICATION_FAILED = "BENEFICIARY_VERIFICATION_FAILED",
    INVALID_BENEFICIARY_ID = "INVALID_BENEFICIARY_ID",
    MERCHANT_NOT_FOUND = "MERCHANT_NOT_FOUND",
    MERCHANT_ALREADY_EXISTS = "MERCHANT_ALREADY_EXISTS",
    MERCHANT_VERIFICATION_FAILED = "MERCHANT_VERIFICATION_FAILED",
    MERCHANT_INACTIVE = "MERCHANT_INACTIVE",
    MERCHANT_LIMIT_EXCEEDED = "MERCHANT_LIMIT_EXCEEDED",
    TRANSACTION_FAILED = "TRANSACTION_FAILED",
    TRANSACTION_NOT_FOUND = "TRANSACTION_NOT_FOUND",
    TRANSACTION_EXPIRED = "TRANSACTION_EXPIRED",
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
    TRANSACTION_REJECTED = "TRANSACTION_REJECTED",
    NETWORK_ERROR = "NETWORK_ERROR",
    CONNECTION_TIMEOUT = "CONNECTION_TIMEOUT",
    RPC_ERROR = "RPC_ERROR",
    HORIZON_ERROR = "HORIZON_ERROR",
    INVALID_ADDRESS = "INVALID_ADDRESS",
    INVALID_AMOUNT = "INVALID_AMOUNT",
    INVALID_SIGNATURE = "INVALID_SIGNATURE",
    INVALID_PARAMETER = "INVALID_PARAMETER",
    VALIDATION_FAILED = "VALIDATION_FAILED",
    UNAUTHORIZED = "UNAUTHORIZED",
    AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED",
    INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS",
    UNKNOWN_ERROR = "UNKNOWN_ERROR",
    INTERNAL_ERROR = "INTERNAL_ERROR",
    NOT_IMPLEMENTED = "NOT_IMPLEMENTED"
}
export declare class StellarDisasterReliefError extends Error {
    readonly code: ErrorCode;
    readonly context?: Record<string, any>;
    readonly timestamp: number;
    readonly originalError?: Error;
    constructor(code: ErrorCode, message: string, context?: Record<string, any>, originalError?: Error);
    toJSON(): {
        name: string;
        code: ErrorCode;
        message: string;
        context: Record<string, any> | undefined;
        timestamp: number;
        originalError: {
            name: string;
            message: string;
        } | undefined;
    };
}
export declare class FundNotFoundError extends StellarDisasterReliefError {
    constructor(fundId: string, context?: Record<string, any>);
}
export declare class FundCreationError extends StellarDisasterReliefError {
    constructor(fundId: string, reason: string, context?: Record<string, any>);
}
export declare class FundExpiredError extends StellarDisasterReliefError {
    constructor(fundId: string, expiresAt: number, context?: Record<string, any>);
}
export declare class InsufficientBalanceError extends StellarDisasterReliefError {
    constructor(fundId: string, requested: string, available: string, context?: Record<string, any>);
}
export declare class TriggerExecutionError extends StellarDisasterReliefError {
    constructor(triggerId: string, fundId: string, reason: string, context?: Record<string, any>);
}
export declare class InsufficientApprovalsError extends StellarDisasterReliefError {
    constructor(fundId: string, required: number, received: number, context?: Record<string, any>);
}
export declare class UnauthorizedApproverError extends StellarDisasterReliefError {
    constructor(fundId: string, approver: string, context?: Record<string, any>);
}
export declare class AllocationError extends StellarDisasterReliefError {
    constructor(fundId: string, sector: string, reason: string, context?: Record<string, any>);
}
export declare class AllocationBelowMinimumError extends StellarDisasterReliefError {
    constructor(fundId: string, sector: string, amount: string, minimum: string, context?: Record<string, any>);
}
export declare class AllocationExceedsMaximumError extends StellarDisasterReliefError {
    constructor(fundId: string, sector: string, amount: string, maximum: string, context?: Record<string, any>);
}
export declare class BeneficiaryNotFoundError extends StellarDisasterReliefError {
    constructor(beneficiaryId: string, context?: Record<string, any>);
}
export declare class MerchantNotFoundError extends StellarDisasterReliefError {
    constructor(merchantId: string, context?: Record<string, any>);
}
export declare class TransactionError extends StellarDisasterReliefError {
    constructor(transactionId: string, reason: string, context?: Record<string, any>);
}
export declare class NetworkError extends StellarDisasterReliefError {
    constructor(operation: string, reason: string, context?: Record<string, any>);
}
export declare class ValidationError extends StellarDisasterReliefError {
    constructor(field: string, reason: string, context?: Record<string, any>);
}
export declare class UnauthorizedError extends StellarDisasterReliefError {
    constructor(operation: string, address: string, context?: Record<string, any>);
}
//# sourceMappingURL=errors.d.ts.map