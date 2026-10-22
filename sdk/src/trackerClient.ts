import {
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
  Contract,
  Address,
  nativeToScVal,
  scValToNative
} from 'stellar-sdk';
const { Server } = SorobanRpc;
type Server = SorobanRpc.Server;

import {
  SupplyShipment,
  Checkpoint,
  Location,
  TemperatureRequirements,
  RecipientConfirmation,
  SupplyChainRequest
} from './types';
import {
  NetworkError,
  ValidationError,
} from './errors';
import { ReadCache } from './readCache';
import { OfflineSigner, OfflineEnvelope } from './offlineSigner';
import { MultiSigManager } from './multiSig';
import { withRetry } from './retry';
import { validateAddress } from './validation';
import { NetworkConfig } from './types';

export class TrackerClient {
  private server: any;
  private contract: any;
  private config: NetworkConfig;
  readonly cache: ReadCache;

  constructor(config: NetworkConfig) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
    this.contract = new Contract(config.contractIds.supplyChainTracker);
    this.cache = new ReadCache(config);
  }

  /**
   * Create a new supply shipment.
   *
   * Parameter order matches the Rust `create_shipment` contract function
   * (excluding `env`):
   * donor, shipment_id, donor_id, supply_type, quantity, unit,
   * origin_lat_lng, origin_address, origin_facility, origin_contact,
   * destination_lat_lng, destination_address, destination_facility,
   * destination_contact, estimated_arrival,
   * temperature_requirements (Option<TemperatureRequirements>),
   * special_handling (Vec<String>).
   *
   * `temperatureRequirements` is serialised as an Option:
   *   - null / undefined  →  nativeToScVal(null)  (None)
   *   - object            →  nativeToScVal(value)  (Some)
   */
  async createShipment(
    donorKey: string,
    request: SupplyChainRequest
  ): Promise<string> {
    const donorKeypair = Keypair.fromSecret(donorKey);
    const donorAccount = await withRetry<any>(() => this.server.getAccount(donorKeypair.publicKey()));
    const shipmentId = `shipment_${request.donorId}_${Date.now()}`;

    // Serialise Option<TemperatureRequirements>: null/undefined → None, object → Some
    const tempReqScVal = (request.temperatureRequirements != null)
      ? nativeToScVal(request.temperatureRequirements)
      : nativeToScVal(null);

    const tx = new TransactionBuilder(donorAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "create_shipment",
          ...[
            new Address(donorKeypair.publicKey()).toScVal(),
            nativeToScVal(shipmentId),
            nativeToScVal(request.donorId),
            nativeToScVal(request.supplyType),
            nativeToScVal(request.quantity),
            nativeToScVal(request.unit),
            nativeToScVal(request.originLatLng),
            nativeToScVal(request.originAddress),
            nativeToScVal(request.originFacility),
            nativeToScVal(request.originContact),
            nativeToScVal(request.destinationLatLng),
            nativeToScVal(request.destinationAddress),
            nativeToScVal(request.destinationFacility),
            nativeToScVal(request.destinationContact),
            nativeToScVal(request.estimatedArrival),
            tempReqScVal,
            nativeToScVal(request.specialHandling),
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(donorKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate('tracker:activeShipments');
      this.cache.invalidatePrefix(`tracker:donor:${request.donorId}`);
      return shipmentId;
    } else {
      throw new NetworkError('create shipment', result.status, { shipmentId });
    }
  }

  /**
   * Add checkpoint to shipment journey
   */
  async addCheckpoint(
    verifierKey: string,
    shipmentId: string,
    location: Location,
    quantityVerified: string,
    condition: string,
    photos: string[],
    notes: string,
    temperature?: number
  ): Promise<string> {
    const verifierKeypair = Keypair.fromSecret(verifierKey);
    const verifierAccount = await withRetry<any>(() => this.server.getAccount(verifierKeypair.publicKey()));

    const tx = new TransactionBuilder(verifierAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "add_checkpoint",
          ...[
            new Address(verifierKeypair.publicKey()).toScVal(),
            nativeToScVal(shipmentId),
            nativeToScVal(location),
            nativeToScVal(quantityVerified),
            nativeToScVal(condition),
            nativeToScVal(photos),
            nativeToScVal(notes),
            nativeToScVal(temperature)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(verifierKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`tracker:shipment:${shipmentId}`);
      this.cache.invalidate(`tracker:history:${shipmentId}`);
      this.cache.invalidate('tracker:activeShipments');
      this.cache.invalidate('tracker:temperatureAlerts');
      return `Checkpoint added to shipment ${shipmentId}`;
    } else {
      throw new NetworkError('add checkpoint', result.status, { shipmentId });
    }
  }

  /**
   * Assign transporter to shipment
   */
  async assignTransporter(
    donorKey: string,
    shipmentId: string,
    transporterAddress: string
  ): Promise<string> {
    validateAddress(transporterAddress, 'transporterAddress');
    const donorKeypair = Keypair.fromSecret(donorKey);
    const donorAccount = await withRetry<any>(() => this.server.getAccount(donorKeypair.publicKey()));

    const tx = new TransactionBuilder(donorAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "assign_transporter",
          ...[
            new Address(donorKeypair.publicKey()).toScVal(),
            nativeToScVal(shipmentId),
            new Address(transporterAddress).toScVal()
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(donorKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      return `Transporter assigned to shipment ${shipmentId}`;
    } else {
      throw new NetworkError('assign transporter', result.status, { shipmentId, transporterAddress });
    }
  }

  /**
   * Confirm final delivery
   */
  async confirmDelivery(
    recipientKey: string,
    shipmentId: string,
    recipientId: string,
    receivedQuantity: string,
    conditionReport: string,
    photos: string[]
  ): Promise<string> {
    const recipientKeypair = Keypair.fromSecret(recipientKey);
    const recipientAccount = await withRetry<any>(() => this.server.getAccount(recipientKeypair.publicKey()));

    const tx = new TransactionBuilder(recipientAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "confirm_delivery",
          ...[
            new Address(recipientKeypair.publicKey()).toScVal(),
            nativeToScVal(shipmentId),
            nativeToScVal(recipientId),
            nativeToScVal(receivedQuantity),
            nativeToScVal(conditionReport),
            nativeToScVal(photos)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(recipientKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`tracker:shipment:${shipmentId}`);
      this.cache.invalidate(`tracker:history:${shipmentId}`);
      this.cache.invalidate('tracker:activeShipments');
      return `Delivery confirmed for shipment ${shipmentId}`;
    } else {
      throw new NetworkError('confirm delivery', result.status, { shipmentId, recipientId });
    }
  }

  /**
   * Get shipment details
   */
  async getShipment(shipmentId: string): Promise<SupplyShipment | null> {
    return this.cache.get(`tracker:shipment:${shipmentId}`, async () => {
      try {
        const result = await this.contract.call("get_shipment", nativeToScVal(shipmentId));
        return scValToNative(result.result.retval);
      } catch (error) {
        console.error('Failed to get shipment:', error);
        return null;
      }
    });
  }

  /**
   * Get complete shipment history
   */
  async getShipmentHistory(shipmentId: string): Promise<{
    shipment?: SupplyShipment;
    confirmation?: RecipientConfirmation;
  }> {
    return this.cache.get(`tracker:history:${shipmentId}`, async () => {
      try {
        const result = await this.contract.call("get_shipment_history", nativeToScVal(shipmentId));
        const history = scValToNative(result.result.retval);
        return { shipment: history[0], confirmation: history[1] };
      } catch (error) {
        console.error('Failed to get shipment history:', error);
        return {};
      }
    });
  }

  /**
   * Track shipments by current location
   */
  async trackByLocation(
    latitude: number,
    longitude: number,
    radiusKm: number
  ): Promise<SupplyShipment[]> {
    try {
      const result = await this.contract.call(
        "track_by_location",
        nativeToScVal(latitude),
        nativeToScVal(longitude),
        nativeToScVal(radiusKm)
      );
      const shipments = scValToNative(result.result.retval);
      return shipments;
    } catch (error) {
      console.error('Failed to track by location:', error);
      return [];
    }
  }

  /**
   * Get all active shipments
   */
  async getActiveShipments(): Promise<SupplyShipment[]> {
    return this.cache.get('tracker:activeShipments', async () => {
      try {
        const result = await this.contract.call("get_active_shipments");
        return scValToNative(result.result.retval);
      } catch (error) {
        console.error('Failed to get active shipments:', error);
        return [];
      }
    });
  }

  /**
   * Report shipment as lost
   */
  async reportLost(
    reporterKey: string,
    shipmentId: string,
    reason: string
  ): Promise<string> {
    const reporterKeypair = Keypair.fromSecret(reporterKey);
    const reporterAccount = await withRetry<any>(() => this.server.getAccount(reporterKeypair.publicKey()));

    const tx = new TransactionBuilder(reporterAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "report_lost",
          ...[
            new Address(reporterKeypair.publicKey()).toScVal(),
            nativeToScVal(shipmentId),
            nativeToScVal(reason)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(reporterKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`tracker:shipment:${shipmentId}`);
      this.cache.invalidate(`tracker:history:${shipmentId}`);
      this.cache.invalidate('tracker:activeShipments');
      return `Shipment ${shipmentId} reported as lost`;
    } else {
      throw new NetworkError('report lost shipment', result.status, { shipmentId });
    }
  }

  /**
   * Get shipments by donor
   */
  async getShipmentsByDonor(donorId: string): Promise<SupplyShipment[]> {
    return this.cache.get(`tracker:donor:${donorId}`, async () => {
      try {
        const result = await this.contract.call("get_shipments_by_donor", nativeToScVal(donorId));
        return scValToNative(result.result.retval);
      } catch (error) {
        console.error('Failed to get shipments by donor:', error);
        return [];
      }
    });
  }

  /**
   * Get temperature alerts for cold chain shipments
   */
  async getTemperatureAlerts(): Promise<Array<{ shipmentId: string; alert: string }>> {
    return this.cache.get('tracker:temperatureAlerts', async () => {
      try {
        const result = await this.contract.call("get_temperature_alerts");
        return scValToNative(result.result.retval);
      } catch (error) {
        console.error('Failed to get temperature alerts:', error);
        return [];
      }
    });
  }

  /**
   * Create location object
   */
  createLocation(
    latitude: number,
    longitude: number,
    address: string,
    facilityName: string,
    contactPerson: string,
    city: string,
    country: string,
    postalCode: string
  ): Location {
    return {
      latitude,
      longitude,
      address,
      facilityName,
      contactPerson,
      city,
      country,
      postalCode
    };
  }

  /**
   * Create temperature requirements
   */
  createTemperatureRequirements(
    minTemp: number,
    maxTemp: number,
    critical: boolean
  ): TemperatureRequirements {
    return {
      minTemp,
      maxTemp,
      critical
    };
  }

  /**
   * Generate QR code for shipment tracking
   */
  generateShipmentQRCode(shipmentId: string, shipment: SupplyShipment): string {
    const qrData = {
      type: 'shipment',
      shipmentId,
      donorId: shipment.donorId,
      supplyType: shipment.supplyType,
      quantity: shipment.quantity,
      unit: shipment.unit,
      origin: shipment.origin,
      destination: shipment.destination,
      currentStatus: shipment.currentStatus,
      estimatedArrival: shipment.estimatedArrival,
      timestamp: Date.now()
    };

    return JSON.stringify(qrData);
  }

  /**
   * Validate shipment QR code
   */
  async validateShipmentQRCode(qrCodeData: string): Promise<boolean> {
    try {
      const data = JSON.parse(qrCodeData);
      
      if (data.type !== 'shipment') {
        return false;
      }

      // Verify shipment exists
      const shipment = await this.getShipment(data.shipmentId);
      return shipment !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create supply chain request with flat location strings.
   *
   * @param donorId             Donor identifier.
   * @param supplyType          Supply type description.
   * @param quantity            Quantity as a string-encoded number.
   * @param unit                Unit of measure.
   * @param originLatLng        Origin coordinates as "lat,lng" string.
   * @param originAddress       Origin street address.
   * @param originFacility      Origin facility name.
   * @param originContact       Origin contact person.
   * @param destinationLatLng   Destination coordinates as "lat,lng" string.
   * @param destinationAddress  Destination street address.
   * @param destinationFacility Destination facility name.
   * @param destinationContact  Destination contact person.
   * @param estimatedArrival    Estimated arrival timestamp (ms since epoch).
   * @param temperatureRequirements  Cold-chain requirements, or null/undefined if none.
   * @param specialHandling     Special handling instructions.
   */
  createSupplyChainRequest(
    donorId: string,
    supplyType: string,
    quantity: string,
    unit: string,
    originLatLng: string,
    originAddress: string,
    originFacility: string,
    originContact: string,
    destinationLatLng: string,
    destinationAddress: string,
    destinationFacility: string,
    destinationContact: string,
    estimatedArrival: number,
    temperatureRequirements?: TemperatureRequirements | null,
    specialHandling: string[] = []
  ): SupplyChainRequest {
    return {
      donorId,
      supplyType,
      quantity,
      unit,
      originLatLng,
      originAddress,
      originFacility,
      originContact,
      destinationLatLng,
      destinationAddress,
      destinationFacility,
      destinationContact,
      estimatedArrival,
      temperatureRequirements,
      specialHandling,
    };
  }

  /**
   * Calculate estimated arrival time.
   *
   * ⚠️ LIMITATIONS: This method uses a simplified great-circle distance heuristic
   * with fixed average speeds and does NOT account for real-world humanitarian
   * logistics constraints such as:
   * - Port/customs/border clearance delays (often 24–72+ hours)
   * - Weather disruptions (storms, monsoon, winter conditions)
   * - Security checkpoints and conflict zone routing
   * - Infrastructure damage (roads, bridges, runways)
   * - Transshipment and multi-modal handoffs
   * - Regulatory paperwork and documentation delays
   * - Local curfews or movement restrictions
   *
   * For production disaster logistics, use a dedicated routing engine
   * (e.g., OSRM, GraphHopper, or commercial APIs) and calibrate with
   * historical lane data. This method is provided as a rough baseline only.
   *
   * @param origin - Origin location with latitude/longitude
   * @param destination - Destination location with latitude/longitude
   * @param transportMethod - Transport mode: 'air', 'ground', or 'sea'
   * @param options - Optional configuration to improve estimate realism:
   *   - customSpeeds: Override default speeds (km/h) per transport method
   *   - delayFactors: Additive delay hours for common humanitarian constraints:
   *     * portCustomsHours: Port/customs clearance (default: 0)
   *     * weatherBufferHours: Weather contingency (default: 0)
   *     * securityCheckpointHours: Security/border delays (default: 0)
   *     * infrastructureBufferHours: Infrastructure damage buffer (default: 0)
   *     * transshipmentHours: Multi-modal handoff time (default: 0)
   *     * documentationHours: Paperwork/regulatory delays (default: 0)
   *   - customEstimator: Fully custom estimation function (distanceKm, transportMethod) => hours
   * @returns Unix timestamp (milliseconds) of estimated arrival
   */
  calculateEstimatedArrival(
    origin: Location,
    destination: Location,
    transportMethod: 'air' | 'ground' | 'sea',
    options?: {
      customSpeeds?: Partial<Record<'air' | 'ground' | 'sea', number>>;
      delayFactors?: {
        portCustomsHours?: number;
        weatherBufferHours?: number;
        securityCheckpointHours?: number;
        infrastructureBufferHours?: number;
        transshipmentHours?: number;
        documentationHours?: number;
      };
      customEstimator?: (distanceKm: number, transportMethod: 'air' | 'ground' | 'sea') => number;
    }
  ): number {
    // Simple distance calculation (in production, use routing APIs)
    const distance = this.calculateDistance(
      origin.latitude, origin.longitude,
      destination.latitude, destination.longitude
    );

    // If a fully custom estimator is provided, use it and return
    if (options?.customEstimator) {
      const travelHours = options.customEstimator(distance, transportMethod);
      return Date.now() + (travelHours * 60 * 60 * 1000);
    }

    // Default speeds (km/h) — can be overridden via options.customSpeeds
    const defaultSpeeds: Record<'air' | 'ground' | 'sea', number> = {
      air: 800,   // Average aircraft speed
      ground: 60, // Average truck speed
      sea: 30,    // Average ship speed
    };
    const speeds = { ...defaultSpeeds, ...options?.customSpeeds };
    const speedKmh = speeds[transportMethod];

    const travelHours = distance / speedKmh;

    // Base processing time (handling, loading/unloading)
    const processingHours = 24;

    // Additional humanitarian logistics delay factors
    const delays = options?.delayFactors ?? {};
    const additionalDelayHours =
      (delays.portCustomsHours ?? 0) +
      (delays.weatherBufferHours ?? 0) +
      (delays.securityCheckpointHours ?? 0) +
      (delays.infrastructureBufferHours ?? 0) +
      (delays.transshipmentHours ?? 0) +
      (delays.documentationHours ?? 0);

    const totalHours = travelHours + processingHours + additionalDelayHours;
    return Date.now() + (totalHours * 60 * 60 * 1000);
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /**
   * Get shipment statistics
   */
  async getShipmentStatistics(shipmentId: string): Promise<{
    totalCheckpoints: number;
    averageTimeBetweenCheckpoints: number;
    quantityLoss: number;
    deliveryStatus: string;
    onTimeDelivery: boolean;
    temperatureCompliance: boolean;
  }> {
    const history = await this.getShipmentHistory(shipmentId);
    
    if (!history.shipment) {
      throw new NetworkError('get shipment analytics', 'Shipment not found', { shipmentId });
    }

    const shipment = history.shipment;
    const totalCheckpoints = shipment.checkpoints.length;
    
    // Calculate average time between checkpoints
    let averageTime = 0;
    if (totalCheckpoints > 1) {
      const intervals: number[] = [];
      for (let i = 1; i < totalCheckpoints; i++) {
        intervals.push(shipment.checkpoints[i].timestamp - shipment.checkpoints[i-1].timestamp);
      }
      averageTime = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    }

    // Calculate quantity loss
    const initialQuantity = BigInt(shipment.quantity);
    const finalQuantity = totalCheckpoints > 0 
      ? BigInt(shipment.checkpoints[totalCheckpoints - 1].quantityVerified)
      : initialQuantity;
    const quantityLoss = Number((initialQuantity - finalQuantity) * BigInt(100) / initialQuantity);

    // Check on-time delivery
    const onTimeDelivery = shipment.currentStatus === 'delivered' && 
      (history.confirmation?.receivedAt || 0) <= shipment.estimatedArrival;

    // Check temperature compliance
    let temperatureCompliance = true;
    if (shipment.temperatureRequirements) {
      for (const checkpoint of shipment.checkpoints) {
        if (checkpoint.temperature) {
          const temp = checkpoint.temperature;
          const req = shipment.temperatureRequirements;
          if (temp < req.minTemp || temp > req.maxTemp) {
            temperatureCompliance = false;
            break;
          }
        }
      }
    }

    return {
      totalCheckpoints,
      averageTimeBetweenCheckpoints: averageTime,
      quantityLoss,
      deliveryStatus: shipment.currentStatus,
      onTimeDelivery,
      temperatureCompliance
    };
  }


  /**
   * Build a multi-sig transaction for creating a shipment.
   */
  async buildMultiSigCreateShipment(
    sourceKey: string,
    request: SupplyChainRequest,
    authorizedSigners: string[],
    threshold: number
  ): Promise<MultiSigManager> {
    const sourceKeypair = Keypair.fromSecret(sourceKey);
    const sourceAccount = await this.server.getAccount(sourceKeypair.publicKey());
    const shipmentId = `shipment_${request.donorId}_${Date.now()}`;
    const tempReqScVal = (request.temperatureRequirements != null)
      ? nativeToScVal(request.temperatureRequirements)
      : nativeToScVal(null);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          'create_shipment',
          ...[
            new Address(sourceKeypair.publicKey()).toScVal(),
            nativeToScVal(shipmentId),
            nativeToScVal(request.donorId),
            nativeToScVal(request.supplyType),
            nativeToScVal(request.quantity),
            nativeToScVal(request.unit),
            nativeToScVal(request.originLatLng),
            nativeToScVal(request.originAddress),
            nativeToScVal(request.originFacility),
            nativeToScVal(request.originContact),
            nativeToScVal(request.destinationLatLng),
            nativeToScVal(request.destinationAddress),
            nativeToScVal(request.destinationFacility),
            nativeToScVal(request.destinationContact),
            nativeToScVal(request.estimatedArrival),
            tempReqScVal,
            nativeToScVal(request.specialHandling),
          ]
        )
      )
      .setTimeout(30)
      .build();
    return MultiSigManager.create(tx, this.getNetworkPassphrase(), authorizedSigners, threshold);
  }
  /**
   * Build an unsigned transaction for creating a supply shipment.
   */
  async buildOfflineCreateShipment(
    sourcePublicKey: string,
    request: SupplyChainRequest
  ): Promise<OfflineEnvelope> {
    const sourceAccount = await this.server.getAccount(sourcePublicKey);
    const shipmentId = `shipment_${request.donorId}_${Date.now()}`;
    const tempReqScVal = (request.temperatureRequirements != null)
      ? nativeToScVal(request.temperatureRequirements)
      : nativeToScVal(null);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          'create_shipment',
          ...[
            new Address(sourcePublicKey).toScVal(),
            nativeToScVal(shipmentId),
            nativeToScVal(request.donorId),
            nativeToScVal(request.supplyType),
            nativeToScVal(request.quantity),
            nativeToScVal(request.unit),
            nativeToScVal(request.originLatLng),
            nativeToScVal(request.originAddress),
            nativeToScVal(request.originFacility),
            nativeToScVal(request.originContact),
            nativeToScVal(request.destinationLatLng),
            nativeToScVal(request.destinationAddress),
            nativeToScVal(request.destinationFacility),
            nativeToScVal(request.destinationContact),
            nativeToScVal(request.estimatedArrival),
            tempReqScVal,
            nativeToScVal(request.specialHandling),
          ]
        )
      )
      .setTimeout(0)
      .build();
    return OfflineSigner.serialize(tx);
  }

  private getNetworkPassphrase(): string {
    switch (this.config.network) {
      case 'testnet':
        return 'Test SDF Network ; September 2015';
      case 'mainnet':
        return 'Public Global Stellar Network ; September 2015';
      case 'standalone':
        return 'Standalone Network ; February 2017';
      default:
        throw new Error('Unsupported network');
    }
  }
}
