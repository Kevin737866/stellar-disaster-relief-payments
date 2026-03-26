export type SensorType =
  | 'gps_tracker'
  | 'temperature_logger'
  | 'shock_sensor'
  | 'seal_tamper'
  | 'photo_attestation'
  | 'community_witness';

export interface ShipmentContents {
  category: 'food' | 'medicine' | 'shelter' | 'mixed';
  description: string;
  quantity: number;
  unit: string;
  estimatedValueUsd?: number;
  requiresColdChain?: boolean;
}

export interface RouteCheckpoint {
  checkpointId: string;
  name: string;
  latitude: number;
  longitude: number;
  expectedArrival: number;
}

export interface ConditionSensor {
  temperature?: number;
  humidity?: number;
  shock?: number;
  light?: number;
}

export interface ConditionProof {
  sensor: ConditionSensor;
  proofHash: string;
  gpsAnchorHash: string;
  sealIntact: boolean;
  photoHash?: string;
  timestamp?: number;
  oracleSource?: string;
}

export interface CustodyEvent {
  location: string;
  timestamp: number;
  custodian: string;
  condition: ConditionSensor;
  proofHash: string;
  gpsAnchorHash: string;
  sealIntact: boolean;
  photoHash?: string;
}

export interface ShipmentAnomaly {
  id: string;
  shipmentId: string;
  type:
    | 'route_deviation'
    | 'delay'
    | 'condition_breach'
    | 'seal_tamper'
    | 'shock_impact'
    | 'delivery_mismatch';
  details: string;
  createdAt: number;
  proofHash?: string;
}

export interface TrackedShipment {
  id: string;
  contents: ShipmentContents;
  origin: string;
  destination: string;
  route: RouteCheckpoint[];
  sensors: SensorType[];
  custodyChain: CustodyEvent[];
  anomalies: ShipmentAnomaly[];
  status: 'registered' | 'in_transit' | 'quality_hold' | 'anomaly_flagged' | 'delivered';
  createdAt: number;
  updatedAt: number;
  expectedGpsAnchorIntervalMins: number;
  delayThresholdHours: number;
  delivery?: {
    beneficiarySignature: string;
    qrCode: string;
    pinHash: string;
    witnessSignatures: string[];
    photoHash?: string;
    deliveredAt: number;
  };
}

export interface BeneficiaryConfirmation {
  beneficiarySignature: string;
  qrCode: string;
  pinHash: string;
  witnessSignatures: string[];
  photoHash?: string;
}

export interface ChainOfCustodyReport {
  shipmentId: string;
  generatedAt: number;
  status: TrackedShipment['status'];
  origin: string;
  destination: string;
  custodyEvents: CustodyEvent[];
  anomalies: ShipmentAnomaly[];
  anchorCoverage: {
    expectedAnchors: number;
    receivedAnchors: number;
    dataLossRate: number;
  };
}

export interface SupplyChainHooks {
  onCreateShipment?: (shipment: TrackedShipment) => Promise<void>;
  onRecordCustodyEvent?: (shipment: TrackedShipment, event: CustodyEvent) => Promise<void>;
  onVerifyFinalDelivery?: (shipment: TrackedShipment) => Promise<void>;
  onFlagAnomaly?: (shipment: TrackedShipment, anomaly: ShipmentAnomaly) => Promise<void>;
}

export class SupplyChainClient {
  private readonly shipments = new Map<string, TrackedShipment>();
  private readonly hooks?: SupplyChainHooks;

  constructor(hooks?: SupplyChainHooks) {
    this.hooks = hooks;
  }

  async createShipment(
    contents: ShipmentContents,
    route: RouteCheckpoint[],
    sensors: SensorType[]
  ): Promise<TrackedShipment> {
    if (route.length < 2) {
      throw new Error('Route must include at least origin and destination checkpoints');
    }

    const now = Date.now();
    const shipmentId = `ship_${now}_${Math.random().toString(36).slice(2, 10)}`;
    const shipment: TrackedShipment = {
      id: shipmentId,
      contents,
      origin: route[0].name,
      destination: route[route.length - 1].name,
      route,
      sensors,
      custodyChain: [],
      anomalies: [],
      status: 'registered',
      createdAt: now,
      updatedAt: now,
      expectedGpsAnchorIntervalMins: 30,
      delayThresholdHours: 24,
    };

    this.shipments.set(shipmentId, shipment);

    if (this.hooks?.onCreateShipment) {
      await this.hooks.onCreateShipment(shipment);
    }

    return shipment;
  }

  async recordCustodyEvent(
    shipmentId: string,
    location: string,
    conditionProof: ConditionProof,
    custodian = 'iot_oracle'
  ): Promise<TrackedShipment> {
    const shipment = this.getRequiredShipment(shipmentId);
    const timestamp = conditionProof.timestamp ?? Date.now();

    const event: CustodyEvent = {
      location,
      timestamp,
      custodian,
      condition: conditionProof.sensor,
      proofHash: conditionProof.proofHash,
      gpsAnchorHash: conditionProof.gpsAnchorHash,
      sealIntact: conditionProof.sealIntact,
      photoHash: conditionProof.photoHash,
    };

    const previousEvent = shipment.custodyChain[shipment.custodyChain.length - 1];
    if (previousEvent && timestamp - previousEvent.timestamp > shipment.delayThresholdHours * 60 * 60 * 1000) {
      this.addAnomaly(shipment, {
        type: 'delay',
        details: 'Delay exceeded 24 hours at checkpoint',
        proofHash: conditionProof.proofHash,
      });
    }

    if (!shipment.route.some((checkpoint) => checkpoint.name === location)) {
      this.addAnomaly(shipment, {
        type: 'route_deviation',
        details: 'Shipment moved outside expected corridor geofence',
        proofHash: conditionProof.proofHash,
      });
    }

    if (shipment.contents.requiresColdChain) {
      const temp = conditionProof.sensor.temperature;
      if (typeof temp === 'number' && (temp < 2 || temp > 8)) {
        shipment.status = 'quality_hold';
        this.addAnomaly(shipment, {
          type: 'condition_breach',
          details: 'Cold-chain temperature outside 2-8C',
          proofHash: conditionProof.proofHash,
        });
      }
    }

    if (!conditionProof.sealIntact) {
      this.addAnomaly(shipment, {
        type: 'seal_tamper',
        details: 'Electronic seal integrity check failed',
        proofHash: conditionProof.proofHash,
      });
    }

    if ((conditionProof.sensor.shock ?? 0) > 3000) {
      this.addAnomaly(shipment, {
        type: 'shock_impact',
        details: 'Shock sensor exceeded safe threshold',
        proofHash: conditionProof.proofHash,
      });
    }

    shipment.custodyChain.push(event);
    shipment.updatedAt = timestamp;
    if (shipment.status === 'registered') {
      shipment.status = 'in_transit';
    }

    if (this.hooks?.onRecordCustodyEvent) {
      await this.hooks.onRecordCustodyEvent(shipment, event);
    }

    return shipment;
  }

  trackShipment(shipmentId: string): TrackedShipment {
    return this.getRequiredShipment(shipmentId);
  }

  async verifyFinalDelivery(
    shipmentId: string,
    beneficiaryConfirmation: BeneficiaryConfirmation
  ): Promise<TrackedShipment> {
    const shipment = this.getRequiredShipment(shipmentId);

    if (!beneficiaryConfirmation.qrCode || !beneficiaryConfirmation.pinHash) {
      throw new Error('QR code and PIN hash are required for beneficiary confirmation');
    }

    const highValue = (shipment.contents.estimatedValueUsd ?? 0) >= 10_000;
    if (highValue && beneficiaryConfirmation.witnessSignatures.length < 3) {
      throw new Error('High-value deliveries require 3 beneficiary witness signatures');
    }

    const lastLocation = shipment.custodyChain[shipment.custodyChain.length - 1]?.location;
    if (lastLocation && lastLocation !== shipment.destination) {
      this.addAnomaly(shipment, {
        type: 'delivery_mismatch',
        details: 'Final confirmation location differs from destination checkpoint',
      });
    }

    shipment.delivery = {
      beneficiarySignature: beneficiaryConfirmation.beneficiarySignature,
      qrCode: beneficiaryConfirmation.qrCode,
      pinHash: beneficiaryConfirmation.pinHash,
      witnessSignatures: beneficiaryConfirmation.witnessSignatures,
      photoHash: beneficiaryConfirmation.photoHash,
      deliveredAt: Date.now(),
    };
    shipment.status = 'delivered';
    shipment.updatedAt = shipment.delivery.deliveredAt;

    if (this.hooks?.onVerifyFinalDelivery) {
      await this.hooks.onVerifyFinalDelivery(shipment);
    }

    return shipment;
  }

  generateChainOfCustody(shipmentId: string): ChainOfCustodyReport {
    const shipment = this.getRequiredShipment(shipmentId);
    const durationMs = Math.max(shipment.updatedAt - shipment.createdAt, 1);
    const expectedAnchors = Math.max(
      1,
      Math.ceil(durationMs / (shipment.expectedGpsAnchorIntervalMins * 60 * 1000))
    );
    const receivedAnchors = shipment.custodyChain.length;
    const dataLossRate = Math.max(0, (expectedAnchors - receivedAnchors) / expectedAnchors);

    return {
      shipmentId,
      generatedAt: Date.now(),
      status: shipment.status,
      origin: shipment.origin,
      destination: shipment.destination,
      custodyEvents: [...shipment.custodyChain],
      anomalies: [...shipment.anomalies],
      anchorCoverage: {
        expectedAnchors,
        receivedAnchors,
        dataLossRate,
      },
    };
  }

  listShipments(): TrackedShipment[] {
    return Array.from(this.shipments.values());
  }

  getActiveShipments(): TrackedShipment[] {
    return this.listShipments().filter((shipment) => shipment.status !== 'delivered');
  }

  async flagAnomaly(
    shipmentId: string,
    type: ShipmentAnomaly['type'],
    details: string,
    proofHash?: string
  ): Promise<TrackedShipment> {
    const shipment = this.getRequiredShipment(shipmentId);
    shipment.status = 'anomaly_flagged';

    const anomaly = this.addAnomaly(shipment, { type, details, proofHash });

    if (this.hooks?.onFlagAnomaly) {
      await this.hooks.onFlagAnomaly(shipment, anomaly);
    }

    return shipment;
  }

  private getRequiredShipment(shipmentId: string): TrackedShipment {
    const shipment = this.shipments.get(shipmentId);
    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }

    return shipment;
  }

  private addAnomaly(
    shipment: TrackedShipment,
    anomaly: Pick<ShipmentAnomaly, 'type' | 'details' | 'proofHash'>
  ): ShipmentAnomaly {
    const created: ShipmentAnomaly = {
      id: `${shipment.id}_anomaly_${shipment.anomalies.length + 1}`,
      shipmentId: shipment.id,
      type: anomaly.type,
      details: anomaly.details,
      proofHash: anomaly.proofHash,
      createdAt: Date.now(),
    };

    shipment.anomalies.push(created);
    shipment.updatedAt = created.createdAt;
    return created;
  }
}
