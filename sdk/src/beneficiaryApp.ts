import {
  ConditionalTransferRecord,
  ConditionalTransfersClient,
  MerchantCategory,
} from './conditionalTransfers';

export interface MerchantDirectoryEntry {
  id: string;
  name: string;
  category: MerchantCategory;
  latitude: number;
  longitude: number;
  supportsAid: boolean;
}

export class BeneficiaryApp {
  private readonly transfers: ConditionalTransfersClient;
  private readonly hotline = '+234-800-NGO-HELP';

  constructor(transfers: ConditionalTransfersClient) {
    this.transfers = transfers;
  }

  smsBalanceCheck(message: string, transferId: string): string {
    if (message.trim().toUpperCase() !== 'BAL') {
      return 'Invalid command. Send BAL to check transfer balance.';
    }

    const balance = this.transfers.getTransferBalance(transferId);
    return `Balance: ${balance.toFixed(2)}`;
  }

  findNearestMerchants(
    transferId: string,
    latitude: number,
    longitude: number,
    merchants: MerchantDirectoryEntry[],
    maxResults = 5
  ): MerchantDirectoryEntry[] {
    const transfer = this.transfers.getTransfer(transferId);
    const locks = transfer.rules.categoryLocks;

    return merchants
      .filter((merchant) => merchant.supportsAid)
      .filter((merchant) => !locks || locks.includes(merchant.category))
      .map((merchant) => ({
        merchant,
        distance: this.distanceKm(latitude, longitude, merchant.latitude, merchant.longitude),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxResults)
      .map((item) => item.merchant);
  }

  getSpendingHistoryByCategory(transferId: string): Record<string, number> {
    const transfer = this.transfers.getTransfer(transferId);
    const summary: Record<string, number> = {};

    for (const spend of transfer.spends) {
      summary[spend.merchantCategory] = (summary[spend.merchantCategory] ?? 0) + spend.amount;
    }

    return summary;
  }

  getTransferOverview(transferId: string): ConditionalTransferRecord {
    return this.transfers.getTransfer(transferId);
  }

  supportHotline(): string {
    return this.hotline;
  }

  private distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
