import { ConditionalTransfer, TransferTransaction, DisbursementRecord, Transaction, EmergencyFund, Merchant } from '../../../sdk/src/types';
import { ExportField, formatTimestamp } from './exportUtils';

export const emergencyFundFields: ExportField<EmergencyFund>[] = [
  { key: 'id',                 label: 'Fund ID',              value: r => r.id },
  { key: 'name',               label: 'Name',                 value: r => r.name },
  { key: 'description',        label: 'Description',          value: r => r.description },
  { key: 'disasterType',       label: 'Disaster Type',        value: r => r.disasterType },
  { key: 'geographicScope',    label: 'Geographic Scope',     value: r => r.geographicScope },
  { key: 'totalAmount',        label: 'Total Amount',         value: r => r.totalAmount },
  { key: 'releasedAmount',     label: 'Released Amount',      value: r => r.releasedAmount },
  { key: 'isActive',           label: 'Active',               value: r => r.isActive },
  { key: 'requiredSignatures', label: 'Required Signatures',  value: r => r.requiredSignatures },
  { key: 'createdAt',          label: 'Created At (UTC)',     value: r => formatTimestamp(r.createdAt) },
  { key: 'expiresAt',          label: 'Expires At (UTC)',     value: r => formatTimestamp(r.expiresAt) },
];

export const conditionalTransferFields: ExportField<ConditionalTransfer>[] = [
  { key: 'id',              label: 'Transfer ID',       value: r => r.id },
  { key: 'beneficiaryId',   label: 'Beneficiary ID',    value: r => r.beneficiaryId },
  { key: 'creator',         label: 'Creator',           value: r => r.creator },
  { key: 'amount',          label: 'Amount',            value: r => r.amount },
  { key: 'token',           label: 'Token',             value: r => r.token },
  { key: 'spentAmount',     label: 'Spent Amount',      value: r => r.spentAmount },
  { key: 'remainingAmount', label: 'Remaining Amount',  value: r => r.remainingAmount },
  { key: 'purpose',         label: 'Purpose',           value: r => r.purpose },
  { key: 'isActive',        label: 'Active',            value: r => r.isActive },
  { key: 'createdAt',       label: 'Created At (UTC)',  value: r => formatTimestamp(r.createdAt) },
  { key: 'expiresAt',       label: 'Expires At (UTC)',  value: r => formatTimestamp(r.expiresAt) },
];

export const transferTransactionFields: ExportField<TransferTransaction>[] = [
  { key: 'id',              label: 'Transaction ID',    value: r => r.id },
  { key: 'transferId',      label: 'Transfer ID',       value: r => r.transferId },
  { key: 'merchantId',      label: 'Merchant ID',       value: r => r.merchantId },
  { key: 'amount',          label: 'Amount',            value: r => r.amount },
  { key: 'category',        label: 'Category',          value: r => r.category },
  { key: 'location',        label: 'Location',          value: r => r.location },
  { key: 'isApproved',      label: 'Approved',          value: r => r.isApproved },
  { key: 'rejectionReason', label: 'Rejection Reason',  value: r => r.rejectionReason },
  { key: 'timestamp',       label: 'Timestamp (UTC)',   value: r => formatTimestamp(r.timestamp) },
];

export const disbursementFields: ExportField<DisbursementRecord>[] = [
  { key: 'id',              label: 'Disbursement ID',   value: r => r.id },
  { key: 'fundId',          label: 'Fund ID',           value: r => r.fundId },
  { key: 'beneficiary',     label: 'Beneficiary',       value: r => r.beneficiary },
  { key: 'amount',          label: 'Amount',            value: r => r.amount },
  { key: 'purpose',         label: 'Purpose',           value: r => r.purpose },
  { key: 'approvedBy',      label: 'Approved By',       value: r => r.approvedBy.join('; ') },
  { key: 'transactionHash', label: 'Transaction Hash',  value: r => r.transactionHash },
  { key: 'timestamp',       label: 'Timestamp (UTC)',   value: r => formatTimestamp(r.timestamp) },
];

export const merchantFields: ExportField<Merchant>[] = [
  { key: 'id',               label: 'Merchant ID',       value: r => r.id },
  { key: 'name',             label: 'Name',              value: r => r.name },
  { key: 'owner',            label: 'Owner',             value: r => r.owner },
  { key: 'businessType',     label: 'Business Type',     value: r => r.businessType },
  { key: 'contactInfo',      label: 'Contact Info',      value: r => r.contactInfo },
  { key: 'isVerified',       label: 'Verified',          value: r => r.isVerified },
  { key: 'isActive',         label: 'Active',            value: r => r.isActive },
  { key: 'reputationScore',  label: 'Reputation Score',  value: r => r.reputationScore },
  { key: 'acceptedTokens',   label: 'Accepted Tokens',   value: r => r.acceptedTokens.join('; ') },
  { key: 'dailyLimit',       label: 'Daily Limit',       value: r => r.dailyLimit },
  { key: 'monthlyLimit',     label: 'Monthly Limit',     value: r => r.monthlyLimit },
  { key: 'address',          label: 'Address',           value: r => r.location.address },
  { key: 'city',             label: 'City',              value: r => r.location.city },
  { key: 'country',          label: 'Country',           value: r => r.location.country },
  { key: 'latitude',         label: 'Latitude',          value: r => r.location.latitude },
  { key: 'longitude',        label: 'Longitude',         value: r => r.location.longitude },
  { key: 'registrationDate', label: 'Registered At (UTC)', value: r => formatTimestamp(r.registrationDate) },
];

export const merchantTransactionFields: ExportField<Transaction>[] = [
  { key: 'id',                  label: 'Transaction ID',        value: r => r.id },
  { key: 'merchantId',          label: 'Merchant ID',           value: r => r.merchantId },
  { key: 'beneficiaryId',       label: 'Beneficiary ID',        value: r => r.beneficiaryId },
  { key: 'amount',              label: 'Amount',                value: r => r.amount },
  { key: 'token',               label: 'Token',                 value: r => r.token },
  { key: 'purpose',             label: 'Purpose',               value: r => r.purpose },
  { key: 'isSettled',           label: 'Settled',               value: r => r.isSettled },
  { key: 'merchantSignature',   label: 'Merchant Signature',    value: r => r.merchantSignature },
  { key: 'beneficiarySignature',label: 'Beneficiary Signature', value: r => r.beneficiarySignature },
  { key: 'timestamp',           label: 'Timestamp (UTC)',       value: r => formatTimestamp(r.timestamp) },
];
