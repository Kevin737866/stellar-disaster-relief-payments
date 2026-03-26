import {
  ChainOfCustodyReport,
  SupplyChainClient,
  TrackedShipment,
} from './supplyChain';

export interface MapShipmentMarker {
  shipmentId: string;
  label: string;
  latitude: number;
  longitude: number;
  status: TrackedShipment['status'];
  lastUpdated: number;
}

export interface ConditionDashboardRow {
  shipmentId: string;
  contents: string;
  latestTemperature?: number;
  latestHumidity?: number;
  latestShock?: number;
  status: TrackedShipment['status'];
  alerts: string[];
}

export interface DeliveryPhotoCard {
  shipmentId: string;
  blurredPhotoUrl: string;
  deliveredAt: number;
}

export interface ImpactMetrics {
  itemsDelivered: number;
  beneficiariesServed: number;
  costPerItem: number;
  activeShipments: number;
  deliveryConfirmationRate: number;
}

export class DonorPortal {
  private readonly tracker: SupplyChainClient;

  constructor(tracker: SupplyChainClient) {
    this.tracker = tracker;
  }

  getActiveShipmentMap(): MapShipmentMarker[] {
    return this.tracker.getActiveShipments().flatMap((shipment) => {
      const event = shipment.custodyChain[shipment.custodyChain.length - 1];
      if (!event) {
        return [];
      }

      const coordinates = this.extractCoordinates(event.location);
      return [
        {
          shipmentId: shipment.id,
          label: `${shipment.contents.category.toUpperCase()} - ${shipment.contents.description}`,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          status: shipment.status,
          lastUpdated: event.timestamp,
        },
      ];
    });
  }

  getConditionDashboards(): ConditionDashboardRow[] {
    return this.tracker
      .listShipments()
      .filter((shipment) => shipment.contents.requiresColdChain)
      .map((shipment) => {
        const lastEvent = shipment.custodyChain[shipment.custodyChain.length - 1];
        const alerts = shipment.anomalies.map((anomaly) => anomaly.type);

        return {
          shipmentId: shipment.id,
          contents: shipment.contents.description,
          latestTemperature: lastEvent?.condition.temperature,
          latestHumidity: lastEvent?.condition.humidity,
          latestShock: lastEvent?.condition.shock,
          status: shipment.status,
          alerts,
        };
      });
  }

  getDeliveryConfirmationPhotos(): DeliveryPhotoCard[] {
    return this.tracker
      .listShipments()
      .filter((shipment) => shipment.status === 'delivered' && shipment.delivery?.photoHash)
      .map((shipment) => ({
        shipmentId: shipment.id,
        blurredPhotoUrl: this.toBlurredIpfsUrl(shipment.delivery?.photoHash ?? ''),
        deliveredAt: shipment.delivery?.deliveredAt ?? 0,
      }));
  }

  getImpactMetrics(totalProgramCostUsd: number): ImpactMetrics {
    const shipments = this.tracker.listShipments();
    const delivered = shipments.filter((shipment) => shipment.status === 'delivered');

    const itemsDelivered = delivered.reduce((sum, shipment) => sum + shipment.contents.quantity, 0);
    const beneficiariesServed = delivered.length;
    const costPerItem = itemsDelivered > 0 ? totalProgramCostUsd / itemsDelivered : 0;
    const activeShipments = shipments.length - delivered.length;
    const deliveryConfirmationRate = shipments.length > 0 ? delivered.length / shipments.length : 0;

    return {
      itemsDelivered,
      beneficiariesServed,
      costPerItem,
      activeShipments,
      deliveryConfirmationRate,
    };
  }

  exportChainOfCustody(shipmentId: string): ChainOfCustodyReport {
    return this.tracker.generateChainOfCustody(shipmentId);
  }

  private extractCoordinates(location: string): { latitude: number; longitude: number } {
    const match = location.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!match) {
      return { latitude: 0, longitude: 0 };
    }

    return {
      latitude: Number(match[1]),
      longitude: Number(match[2]),
    };
  }

  private toBlurredIpfsUrl(hash: string): string {
    return `https://ipfs.io/ipfs/${hash}?blur=12`;
  }
}
