"use strict";
/**
 * Custom Error Types for Stellar Disaster Relief Payments SDK
 * Provides detailed error information with error codes and contextual data
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnauthorizedError = exports.ValidationError = exports.NetworkError = exports.TransactionError = exports.MerchantNotFoundError = exports.BeneficiaryNotFoundError = exports.AllocationExceedsMaximumError = exports.AllocationBelowMinimumError = exports.AllocationError = exports.UnauthorizedApproverError = exports.InsufficientApprovalsError = exports.TriggerExecutionError = exports.InsufficientBalanceError = exports.FundExpiredError = exports.FundCreationError = exports.FundNotFoundError = exports.StellarDisasterReliefError = exports.ErrorCode = void 0;
var ErrorCode;
(function (ErrorCode) {
    // Fund Management Errors (1000-1099)
    ErrorCode["FUND_NOT_FOUND"] = "FUND_NOT_FOUND";
    ErrorCode["FUND_ALREADY_EXISTS"] = "FUND_ALREADY_EXISTS";
    ErrorCode["FUND_EXPIRED"] = "FUND_EXPIRED";
    ErrorCode["FUND_INACTIVE"] = "FUND_INACTIVE";
    ErrorCode["FUND_INSUFFICIENT_BALANCE"] = "FUND_INSUFFICIENT_BALANCE";
    ErrorCode["FUND_CREATION_FAILED"] = "FUND_CREATION_FAILED";
    ErrorCode["FUND_UPDATE_FAILED"] = "FUND_UPDATE_FAILED";
    // Trigger Errors (1100-1199)
    ErrorCode["TRIGGER_NOT_FOUND"] = "TRIGGER_NOT_FOUND";
    ErrorCode["TRIGGER_ALREADY_EXISTS"] = "TRIGGER_ALREADY_EXISTS";
    ErrorCode["TRIGGER_INACTIVE"] = "TRIGGER_INACTIVE";
    ErrorCode["TRIGGER_EXECUTION_FAILED"] = "TRIGGER_EXECUTION_FAILED";
    ErrorCode["TRIGGER_VALIDATION_FAILED"] = "TRIGGER_VALIDATION_FAILED";
    ErrorCode["INSUFFICIENT_ORACLE_CONFIRMATIONS"] = "INSUFFICIENT_ORACLE_CONFIRMATIONS";
    // Disbursement Errors (1200-1299)
    ErrorCode["DISBURSEMENT_FAILED"] = "DISBURSEMENT_FAILED";
    ErrorCode["DISBURSEMENT_NOT_FOUND"] = "DISBURSEMENT_NOT_FOUND";
    ErrorCode["INSUFFICIENT_APPROVALS"] = "INSUFFICIENT_APPROVALS";
    ErrorCode["UNAUTHORIZED_APPROVER"] = "UNAUTHORIZED_APPROVER";
    ErrorCode["DISBURSEMENT_AMOUNT_EXCEEDS_LIMIT"] = "DISBURSEMENT_AMOUNT_EXCEEDS_LIMIT";
    // Allocation Errors (1300-1399)
    ErrorCode["ALLOCATION_FAILED"] = "ALLOCATION_FAILED";
    ErrorCode["ALLOCATION_BELOW_MINIMUM"] = "ALLOCATION_BELOW_MINIMUM";
    ErrorCode["ALLOCATION_EXCEEDS_MAXIMUM"] = "ALLOCATION_EXCEEDS_MAXIMUM";
    ErrorCode["INVALID_SECTOR"] = "INVALID_SECTOR";
    // Beneficiary Errors (2000-2099)
    ErrorCode["BENEFICIARY_NOT_FOUND"] = "BENEFICIARY_NOT_FOUND";
    ErrorCode["BENEFICIARY_ALREADY_EXISTS"] = "BENEFICIARY_ALREADY_EXISTS";
    ErrorCode["BENEFICIARY_VERIFICATION_FAILED"] = "BENEFICIARY_VERIFICATION_FAILED";
    ErrorCode["INVALID_BENEFICIARY_ID"] = "INVALID_BENEFICIARY_ID";
    // Merchant Errors (3000-3099)
    ErrorCode["MERCHANT_NOT_FOUND"] = "MERCHANT_NOT_FOUND";
    ErrorCode["MERCHANT_ALREADY_EXISTS"] = "MERCHANT_ALREADY_EXISTS";
    ErrorCode["MERCHANT_VERIFICATION_FAILED"] = "MERCHANT_VERIFICATION_FAILED";
    ErrorCode["MERCHANT_INACTIVE"] = "MERCHANT_INACTIVE";
    ErrorCode["MERCHANT_LIMIT_EXCEEDED"] = "MERCHANT_LIMIT_EXCEEDED";
    // Transaction Errors (4000-4099)
    ErrorCode["TRANSACTION_FAILED"] = "TRANSACTION_FAILED";
    ErrorCode["TRANSACTION_NOT_FOUND"] = "TRANSACTION_NOT_FOUND";
    ErrorCode["TRANSACTION_EXPIRED"] = "TRANSACTION_EXPIRED";
    ErrorCode["INSUFFICIENT_FUNDS"] = "INSUFFICIENT_FUNDS";
    ErrorCode["TRANSACTION_REJECTED"] = "TRANSACTION_REJECTED";
    // Network/Connection Errors (5000-5099)
    ErrorCode["NETWORK_ERROR"] = "NETWORK_ERROR";
    ErrorCode["CONNECTION_TIMEOUT"] = "CONNECTION_TIMEOUT";
    ErrorCode["RPC_ERROR"] = "RPC_ERROR";
    ErrorCode["HORIZON_ERROR"] = "HORIZON_ERROR";
    // Validation Errors (6000-6099)
    ErrorCode["INVALID_ADDRESS"] = "INVALID_ADDRESS";
    ErrorCode["INVALID_AMOUNT"] = "INVALID_AMOUNT";
    ErrorCode["INVALID_SIGNATURE"] = "INVALID_SIGNATURE";
    ErrorCode["INVALID_PARAMETER"] = "INVALID_PARAMETER";
    ErrorCode["VALIDATION_FAILED"] = "VALIDATION_FAILED";
    // Authentication/Authorization Errors (7000-7099)
    ErrorCode["UNAUTHORIZED"] = "UNAUTHORIZED";
    ErrorCode["AUTHENTICATION_FAILED"] = "AUTHENTICATION_FAILED";
    ErrorCode["INSUFFICIENT_PERMISSIONS"] = "INSUFFICIENT_PERMISSIONS";
    // Generic Errors (9000-9099)
    ErrorCode["UNKNOWN_ERROR"] = "UNKNOWN_ERROR";
    ErrorCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
    ErrorCode["NOT_IMPLEMENTED"] = "NOT_IMPLEMENTED";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
class StellarDisasterReliefError extends Error {
    constructor(code, message, context, originalError) {
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
exports.StellarDisasterReliefError = StellarDisasterReliefError;
class FundNotFoundError extends StellarDisasterReliefError {
    constructor(fundId, context) {
        super(ErrorCode.FUND_NOT_FOUND, `Fund with ID '${fundId}' not found or does not exist`, { fundId, ...context });
    }
}
exports.FundNotFoundError = FundNotFoundError;
class FundCreationError extends StellarDisasterReliefError {
    constructor(fundId, reason, context) {
        super(ErrorCode.FUND_CREATION_FAILED, `Failed to create fund '${fundId}': ${reason}`, { fundId, reason, ...context });
    }
}
exports.FundCreationError = FundCreationError;
class FundExpiredError extends StellarDisasterReliefError {
    constructor(fundId, expiresAt, context) {
        super(ErrorCode.FUND_EXPIRED, `Fund '${fundId}' expired at ${new Date(expiresAt).toISOString()}`, { fundId, expiresAt, ...context });
    }
}
exports.FundExpiredError = FundExpiredError;
class InsufficientBalanceError extends StellarDisasterReliefError {
    constructor(fundId, requested, available, context) {
        super(ErrorCode.FUND_INSUFFICIENT_BALANCE, `Insufficient balance in fund '${fundId}': requested ${requested}, available ${available}`, { fundId, requested, available, ...context });
    }
}
exports.InsufficientBalanceError = InsufficientBalanceError;
class TriggerExecutionError extends StellarDisasterReliefError {
    constructor(triggerId, fundId, reason, context) {
        super(ErrorCode.TRIGGER_EXECUTION_FAILED, `Failed to execute trigger '${triggerId}' for fund '${fundId}': ${reason}`, { triggerId, fundId, reason, ...context });
    }
}
exports.TriggerExecutionError = TriggerExecutionError;
class InsufficientApprovalsError extends StellarDisasterReliefError {
    constructor(fundId, required, received, context) {
        super(ErrorCode.INSUFFICIENT_APPROVALS, `Insufficient approvals for fund '${fundId}': required ${required}, received ${received}`, { fundId, required, received, ...context });
    }
}
exports.InsufficientApprovalsError = InsufficientApprovalsError;
class UnauthorizedApproverError extends StellarDisasterReliefError {
    constructor(fundId, approver, context) {
        super(ErrorCode.UNAUTHORIZED_APPROVER, `Address '${approver}' is not authorized to approve disbursements for fund '${fundId}'`, { fundId, approver, ...context });
    }
}
exports.UnauthorizedApproverError = UnauthorizedApproverError;
class AllocationError extends StellarDisasterReliefError {
    constructor(fundId, sector, reason, context) {
        super(ErrorCode.ALLOCATION_FAILED, `Failed to allocate funds to sector '${sector}' for fund '${fundId}': ${reason}`, { fundId, sector, reason, ...context });
    }
}
exports.AllocationError = AllocationError;
class AllocationBelowMinimumError extends StellarDisasterReliefError {
    constructor(fundId, sector, amount, minimum, context) {
        super(ErrorCode.ALLOCATION_BELOW_MINIMUM, `Allocation amount ${amount} for sector '${sector}' is below minimum threshold ${minimum}`, { fundId, sector, amount, minimum, ...context });
    }
}
exports.AllocationBelowMinimumError = AllocationBelowMinimumError;
class AllocationExceedsMaximumError extends StellarDisasterReliefError {
    constructor(fundId, sector, amount, maximum, context) {
        super(ErrorCode.ALLOCATION_EXCEEDS_MAXIMUM, `Allocation amount ${amount} for sector '${sector}' exceeds maximum threshold ${maximum}`, { fundId, sector, amount, maximum, ...context });
    }
}
exports.AllocationExceedsMaximumError = AllocationExceedsMaximumError;
class BeneficiaryNotFoundError extends StellarDisasterReliefError {
    constructor(beneficiaryId, context) {
        super(ErrorCode.BENEFICIARY_NOT_FOUND, `Beneficiary with ID '${beneficiaryId}' not found`, { beneficiaryId, ...context });
    }
}
exports.BeneficiaryNotFoundError = BeneficiaryNotFoundError;
class MerchantNotFoundError extends StellarDisasterReliefError {
    constructor(merchantId, context) {
        super(ErrorCode.MERCHANT_NOT_FOUND, `Merchant with ID '${merchantId}' not found`, { merchantId, ...context });
    }
}
exports.MerchantNotFoundError = MerchantNotFoundError;
class TransactionError extends StellarDisasterReliefError {
    constructor(transactionId, reason, context) {
        super(ErrorCode.TRANSACTION_FAILED, `Transaction '${transactionId}' failed: ${reason}`, { transactionId, reason, ...context });
    }
}
exports.TransactionError = TransactionError;
class NetworkError extends StellarDisasterReliefError {
    constructor(operation, reason, context) {
        super(ErrorCode.NETWORK_ERROR, `Network error during ${operation}: ${reason}`, { operation, reason, ...context });
    }
}
exports.NetworkError = NetworkError;
class ValidationError extends StellarDisasterReliefError {
    constructor(field, reason, context) {
        super(ErrorCode.VALIDATION_FAILED, `Validation failed for field '${field}': ${reason}`, { field, reason, ...context });
    }
}
exports.ValidationError = ValidationError;
class UnauthorizedError extends StellarDisasterReliefError {
    constructor(operation, address, context) {
        super(ErrorCode.UNAUTHORIZED, `Unauthorized: address '${address}' is not authorized to perform ${operation}`, { operation, address, ...context });
    }
}
exports.UnauthorizedError = UnauthorizedError;
//# sourceMappingURL=errors.js.map