import { SupplyShipment, Location, TemperatureRequirements, RecipientConfirmation, SupplyChainRequest } from './types';
import { ReadCache } from './readCache';
import { OfflineEnvelope } from './offlineSigner';
import { MultiSigManager } from './multiSig';
import { NetworkConfig } from './types';
export declare class TrackerClient {
    private server;
    private contract;
    private config;
    readonly cache: ReadCache;
    constructor(config: NetworkConfig);
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
    createSupplyChainRequest(donorId: string, supplyType: string, quantity: string, unit: string, originLatLng: string, originAddress: string, originFacility: string, originContact: string, destinationLatLng: string, destinationAddress: string, destinationFacility: string, destinationContact: string, estimatedArrival: number, temperatureRequirements?: TemperatureRequirements | null, specialHandling?: string[]): SupplyChainRequest;
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
    calculateEstimatedArrival(origin: Location, destination: Location, transportMethod: 'air' | 'ground' | 'sea', options?: {
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
    }): number;
    private calculateDistance;
    /**
     * Get shipment statistics.
     *
     * Returns a rich summary including quantity-loss analytics. When final
     * checkpoint data is incomplete (missing `quantityVerified`) or
     * `initialQuantity` is zero, `quantityLoss` is reported as `null` and
     * `quantityLossUncertain` is set to `true` rather than throwing or
     * returning a misleading number (Issue #183).
     */
    getShipmentStatistics(shipmentId: string): Promise<{
        totalCheckpoints: number;
        averageTimeBetweenCheckpoints: number;
        quantityLoss: number | null;
        quantityLossUncertain: boolean;
        deliveryStatus: string;
        onTimeDelivery: boolean;
        temperatureCompliance: boolean;
    }>;
    /**
     * Build a multi-sig transaction for creating a shipment.
     */
    buildMultiSigCreateShipment(sourceKey: string, request: SupplyChainRequest, authorizedSigners: string[], threshold: number): Promise<MultiSigManager>;
    /**
     * Build an unsigned transaction for creating a supply shipment.
     */
    buildOfflineCreateShipment(sourcePublicKey: string, request: SupplyChainRequest): Promise<OfflineEnvelope>;
    private getNetworkPassphrase;
}
//# sourceMappingURL=trackerClient.d.ts.map