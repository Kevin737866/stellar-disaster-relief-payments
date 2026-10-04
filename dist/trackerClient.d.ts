import { SupplyShipment, Location, TemperatureRequirements, RecipientConfirmation, SupplyChainRequest } from './types';
export declare class TrackerClient {
    private server;
    private contract;
    private config;
    constructor(config: any);
    /**
     * Create a new supply shipment
     */
    createShipment(donorKey: string, request: SupplyChainRequest): Promise<string>;
    /**
     * Add checkpoint to shipment journey
     */
    addCheckpoint(verifierKey: string, shipmentId: string, location: Location, quantityVerified: string, condition: string, photos: string[], notes: string, temperature?: number): Promise<string>;
    /**
     * Assign transporter to shipment
     */
    assignTransporter(donorKey: string, shipmentId: string, transporterAddress: string): Promise<string>;
    /**
     * Confirm final delivery
     */
    confirmDelivery(recipientKey: string, shipmentId: string, recipientId: string, receivedQuantity: string, conditionReport: string, photos: string[]): Promise<string>;
    /**
     * Get shipment details
     */
    getShipment(shipmentId: string): Promise<SupplyShipment | null>;
    /**
     * Get complete shipment history
     */
    getShipmentHistory(shipmentId: string): Promise<{
        shipment?: SupplyShipment;
        confirmation?: RecipientConfirmation;
    }>;
    /**
     * Track shipments by current location
     */
    trackByLocation(latitude: number, longitude: number, radiusKm: number): Promise<SupplyShipment[]>;
    /**
     * Get all active shipments
     */
    getActiveShipments(): Promise<SupplyShipment[]>;
    /**
     * Report shipment as lost
     */
    reportLost(reporterKey: string, shipmentId: string, reason: string): Promise<string>;
    /**
     * Get shipments by donor
     */
    getShipmentsByDonor(donorId: string): Promise<SupplyShipment[]>;
    /**
     * Get temperature alerts for cold chain shipments
     */
    getTemperatureAlerts(): Promise<Array<{
        shipmentId: string;
        alert: string;
    }>>;
    /**
     * Create location object
     */
    createLocation(latitude: number, longitude: number, address: string, facilityName: string, contactPerson: string, city: string, country: string, postalCode: string): Location;
    /**
     * Create temperature requirements
     */
    createTemperatureRequirements(minTemp: number, maxTemp: number, critical: boolean): TemperatureRequirements;
    /**
     * Generate QR code for shipment tracking
     */
    generateShipmentQRCode(shipmentId: string, shipment: SupplyShipment): string;
    /**
     * Validate shipment QR code
     */
    validateShipmentQRCode(qrCodeData: string): Promise<boolean>;
    /**
     * Create supply chain request template
     */
    createSupplyChainRequest(donorId: string, supplyType: string, quantity: string, unit: string, origin: Location, destination: Location, estimatedArrival: number, temperatureRequirements?: TemperatureRequirements, specialHandling?: string[]): SupplyChainRequest;
    /**
     * Calculate estimated arrival time
     */
    calculateEstimatedArrival(origin: Location, destination: Location, transportMethod: 'air' | 'ground' | 'sea'): number;
    private calculateDistance;
    /**
     * Get shipment statistics
     */
    getShipmentStatistics(shipmentId: string): Promise<{
        totalCheckpoints: number;
        averageTimeBetweenCheckpoints: number;
        quantityLoss: number;
        deliveryStatus: string;
        onTimeDelivery: boolean;
        temperatureCompliance: boolean;
    }>;
    private getNetworkPassphrase;
}
//# sourceMappingURL=trackerClient.d.ts.map