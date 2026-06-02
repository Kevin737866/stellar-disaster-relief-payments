import {
  Server,
  TransactionBuilder,
  Networks,
  Keypair,
  Contract,
  Address,
  nativeToScVal,
  scValToNative
} from 'stellar-sdk';
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

export class TrackerClient {
  private server: Server;
  private contract: Contract;
  private config: any;

  constructor(config: any) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
    this.contract = new Contract(config.contractIds.supplyChainTracker);
  }

  /**
   * Create a new supply shipment
   */
  async createShipment(
    donorKey: string,
    request: SupplyChainRequest
  ): Promise<string> {
    const donorKeypair = Keypair.fromSecret(donorKey);
    const donorAccount = await this.server.getAccount(donorKeypair.publicKey());
    const shipmentId = `shipment_${request.donorId}_${Date.now()}`;

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
            nativeToScVal(request.origin),
            nativeToScVal(request.destination),
            nativeToScVal(request.estimatedArrival),
            nativeToScVal(request.temperatureRequirements),
            nativeToScVal(request.specialHandling)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(donorKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
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
    const verifierAccount = await this.server.getAccount(verifierKeypair.publicKey());

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
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
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
    const donorKeypair = Keypair.fromSecret(donorKey);
    const donorAccount = await this.server.getAccount(donorKeypair.publicKey());

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
    const result = await this.server.sendTransaction(tx);
    
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
    const recipientAccount = await this.server.getAccount(recipientKeypair.publicKey());

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
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return `Delivery confirmed for shipment ${shipmentId}`;
    } else {
      throw new NetworkError('confirm delivery', result.status, { shipmentId, recipientId });
    }
  }

  /**
   * Get shipment details
   */
  async getShipment(shipmentId: string): Promise<SupplyShipment | null> {
    try {
      const result = await this.contract.call("get_shipment", nativeToScVal(shipmentId));
      const shipment = scValToNative(result.result.retval);
      return shipment;
    } catch (error) {
      console.error('Failed to get shipment:', error);
      return null;
    }
  }

  /**
   * Get complete shipment history
   */
  async getShipmentHistory(shipmentId: string): Promise<{
    shipment?: SupplyShipment;
    confirmation?: RecipientConfirmation;
  }> {
    try {
      const result = await this.contract.call("get_shipment_history", nativeToScVal(shipmentId));
      const history = scValToNative(result.result.retval);
      return {
        shipment: history[0],
        confirmation: history[1]
      };
    } catch (error) {
      console.error('Failed to get shipment history:', error);
      return {};
    }
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
    try {
      const result = await this.contract.call("get_active_shipments");
      const shipments = scValToNative(result.result.retval);
      return shipments;
    } catch (error) {
      console.error('Failed to get active shipments:', error);
      return [];
    }
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
    const reporterAccount = await this.server.getAccount(reporterKeypair.publicKey());

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
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return `Shipment ${shipmentId} reported as lost`;
    } else {
      throw new NetworkError('report lost shipment', result.status, { shipmentId });
    }
  }

  /**
   * Get shipments by donor
   */
  async getShipmentsByDonor(donorId: string): Promise<SupplyShipment[]> {
    try {
      const result = await this.contract.call("get_shipments_by_donor", nativeToScVal(donorId));
      const shipments = scValToNative(result.result.retval);
      return shipments;
    } catch (error) {
      console.error('Failed to get shipments by donor:', error);
      return [];
    }
  }

  /**
   * Get temperature alerts for cold chain shipments
   */
  async getTemperatureAlerts(): Promise<Array<{ shipmentId: string; alert: string }>> {
    try {
      const result = await this.contract.call("get_temperature_alerts");
      const alerts = scValToNative(result.result.retval);
      return alerts;
    } catch (error) {
      console.error('Failed to get temperature alerts:', error);
      return [];
    }
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
   * Create supply chain request template
   */
  createSupplyChainRequest(
    donorId: string,
    supplyType: string,
    quantity: string,
    unit: string,
    origin: Location,
    destination: Location,
    estimatedArrival: number,
    temperatureRequirements?: TemperatureRequirements,
    specialHandling: string[] = []
  ): SupplyChainRequest {
    return {
      donorId,
      supplyType,
      quantity,
      unit,
      origin,
      destination,
      estimatedArrival,
      temperatureRequirements,
      specialHandling
    };
  }

  /**
   * Calculate estimated arrival time
   */
  calculateEstimatedArrival(
    origin: Location,
    destination: Location,
    transportMethod: 'air' | 'ground' | 'sea'
  ): number {
    // Simple distance calculation (in production, use routing APIs)
    const distance = this.calculateDistance(
      origin.latitude, origin.longitude,
      destination.latitude, destination.longitude
    );

    // Estimate travel time based on transport method
    let speedKmh: number;
    switch (transportMethod) {
      case 'air':
        speedKmh = 800; // Average aircraft speed
        break;
      case 'ground':
        speedKmh = 60; // Average truck speed
        break;
      case 'sea':
        speedKmh = 30; // Average ship speed
        break;
    }

    const travelHours = distance / speedKmh;
    const processingHours = 24; // Add 24 hours for processing
    return Date.now() + ((travelHours + processingHours) * 60 * 60 * 1000);
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
