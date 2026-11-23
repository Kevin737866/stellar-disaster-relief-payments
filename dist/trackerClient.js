"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrackerClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
const { Server } = stellar_sdk_1.SorobanRpc;
const errors_1 = require("./errors");
const readCache_1 = require("./readCache");
const offlineSigner_1 = require("./offlineSigner");
const multiSig_1 = require("./multiSig");
const retry_1 = require("./retry");
const validation_1 = require("./validation");
class TrackerClient {
    constructor(config) {
        this.config = config;
        this.server = new Server(config.rpcUrl);
        this.contract = new stellar_sdk_1.Contract(config.contractIds.supplyChainTracker);
        this.cache = new readCache_1.ReadCache(config);
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
    async createShipment(donorKey, request) {
        const donorKeypair = stellar_sdk_1.Keypair.fromSecret(donorKey);
        const donorAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(donorKeypair.publicKey()));
        const shipmentId = `shipment_${request.donorId}_${Date.now()}`;
        // Serialise Option<TemperatureRequirements>: null/undefined → None, object → Some
        const tempReqScVal = (request.temperatureRequirements != null)
            ? (0, stellar_sdk_1.nativeToScVal)(request.temperatureRequirements)
            : (0, stellar_sdk_1.nativeToScVal)(null);
        const tx = new stellar_sdk_1.TransactionBuilder(donorAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("create_shipment", ...[
            new stellar_sdk_1.Address(donorKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(shipmentId),
            (0, stellar_sdk_1.nativeToScVal)(request.donorId),
            (0, stellar_sdk_1.nativeToScVal)(request.supplyType),
            (0, stellar_sdk_1.nativeToScVal)(request.quantity),
            (0, stellar_sdk_1.nativeToScVal)(request.unit),
            (0, stellar_sdk_1.nativeToScVal)(request.originLatLng),
            (0, stellar_sdk_1.nativeToScVal)(request.originAddress),
            (0, stellar_sdk_1.nativeToScVal)(request.originFacility),
            (0, stellar_sdk_1.nativeToScVal)(request.originContact),
            (0, stellar_sdk_1.nativeToScVal)(request.destinationLatLng),
            (0, stellar_sdk_1.nativeToScVal)(request.destinationAddress),
            (0, stellar_sdk_1.nativeToScVal)(request.destinationFacility),
            (0, stellar_sdk_1.nativeToScVal)(request.destinationContact),
            (0, stellar_sdk_1.nativeToScVal)(request.estimatedArrival),
            tempReqScVal,
            (0, stellar_sdk_1.nativeToScVal)(request.specialHandling),
        ]))
            .setTimeout(30)
            .build();
        tx.sign(donorKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate('tracker:activeShipments');
            this.cache.invalidatePrefix(`tracker:donor:${request.donorId}`);
            return shipmentId;
        }
        else {
            throw new errors_1.NetworkError('create shipment', result.status, { shipmentId });
        }
    }
    /**
     * Add checkpoint to shipment journey
     */
    async addCheckpoint(verifierKey, shipmentId, location, quantityVerified, condition, photos, notes, temperature) {
        const verifierKeypair = stellar_sdk_1.Keypair.fromSecret(verifierKey);
        const verifierAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(verifierKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(verifierAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("add_checkpoint", ...[
            new stellar_sdk_1.Address(verifierKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(shipmentId),
            (0, stellar_sdk_1.nativeToScVal)(location),
            (0, stellar_sdk_1.nativeToScVal)(quantityVerified),
            (0, stellar_sdk_1.nativeToScVal)(condition),
            (0, stellar_sdk_1.nativeToScVal)(photos),
            (0, stellar_sdk_1.nativeToScVal)(notes),
            (0, stellar_sdk_1.nativeToScVal)(temperature)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(verifierKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`tracker:shipment:${shipmentId}`);
            this.cache.invalidate(`tracker:history:${shipmentId}`);
            this.cache.invalidate('tracker:activeShipments');
            this.cache.invalidate('tracker:temperatureAlerts');
            return `Checkpoint added to shipment ${shipmentId}`;
        }
        else {
            throw new errors_1.NetworkError('add checkpoint', result.status, { shipmentId });
        }
    }
    /**
     * Assign transporter to shipment
     */
    async assignTransporter(donorKey, shipmentId, transporterAddress) {
        (0, validation_1.validateAddress)(transporterAddress, 'transporterAddress');
        const donorKeypair = stellar_sdk_1.Keypair.fromSecret(donorKey);
        const donorAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(donorKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(donorAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("assign_transporter", ...[
            new stellar_sdk_1.Address(donorKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(shipmentId),
            new stellar_sdk_1.Address(transporterAddress).toScVal()
        ]))
            .setTimeout(30)
            .build();
        tx.sign(donorKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            return `Transporter assigned to shipment ${shipmentId}`;
        }
        else {
            throw new errors_1.NetworkError('assign transporter', result.status, { shipmentId, transporterAddress });
        }
    }
    /**
     * Confirm final delivery
     */
    async confirmDelivery(recipientKey, shipmentId, recipientId, receivedQuantity, conditionReport, photos) {
        const recipientKeypair = stellar_sdk_1.Keypair.fromSecret(recipientKey);
        const recipientAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(recipientKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(recipientAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("confirm_delivery", ...[
            new stellar_sdk_1.Address(recipientKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(shipmentId),
            (0, stellar_sdk_1.nativeToScVal)(recipientId),
            (0, stellar_sdk_1.nativeToScVal)(receivedQuantity),
            (0, stellar_sdk_1.nativeToScVal)(conditionReport),
            (0, stellar_sdk_1.nativeToScVal)(photos)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(recipientKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`tracker:shipment:${shipmentId}`);
            this.cache.invalidate(`tracker:history:${shipmentId}`);
            this.cache.invalidate('tracker:activeShipments');
            return `Delivery confirmed for shipment ${shipmentId}`;
        }
        else {
            throw new errors_1.NetworkError('confirm delivery', result.status, { shipmentId, recipientId });
        }
    }
    /**
     * Get shipment details
     */
    async getShipment(shipmentId) {
        return this.cache.get(`tracker:shipment:${shipmentId}`, async () => {
            try {
                const result = await this.contract.call("get_shipment", (0, stellar_sdk_1.nativeToScVal)(shipmentId));
                return (0, stellar_sdk_1.scValToNative)(result.result.retval);
            }
            catch (error) {
                console.error('Failed to get shipment:', error);
                return null;
            }
        });
    }
    /**
     * Get complete shipment history
     */
    async getShipmentHistory(shipmentId) {
        return this.cache.get(`tracker:history:${shipmentId}`, async () => {
            try {
                const result = await this.contract.call("get_shipment_history", (0, stellar_sdk_1.nativeToScVal)(shipmentId));
                const history = (0, stellar_sdk_1.scValToNative)(result.result.retval);
                return { shipment: history[0], confirmation: history[1] };
            }
            catch (error) {
                console.error('Failed to get shipment history:', error);
                return {};
            }
        });
    }
    /**
     * Track shipments by current location
     */
    async trackByLocation(latitude, longitude, radiusKm) {
        try {
            const result = await this.contract.call("track_by_location", (0, stellar_sdk_1.nativeToScVal)(latitude), (0, stellar_sdk_1.nativeToScVal)(longitude), (0, stellar_sdk_1.nativeToScVal)(radiusKm));
            const shipments = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return shipments;
        }
        catch (error) {
            console.error('Failed to track by location:', error);
            return [];
        }
    }
    /**
     * Get all active shipments
     */
    async getActiveShipments() {
        return this.cache.get('tracker:activeShipments', async () => {
            try {
                const result = await this.contract.call("get_active_shipments");
                return (0, stellar_sdk_1.scValToNative)(result.result.retval);
            }
            catch (error) {
                console.error('Failed to get active shipments:', error);
                return [];
            }
        });
    }
    /**
     * Report shipment as lost
     */
    async reportLost(reporterKey, shipmentId, reason) {
        const reporterKeypair = stellar_sdk_1.Keypair.fromSecret(reporterKey);
        const reporterAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(reporterKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(reporterAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("report_lost", ...[
            new stellar_sdk_1.Address(reporterKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(shipmentId),
            (0, stellar_sdk_1.nativeToScVal)(reason)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(reporterKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`tracker:shipment:${shipmentId}`);
            this.cache.invalidate(`tracker:history:${shipmentId}`);
            this.cache.invalidate('tracker:activeShipments');
            return `Shipment ${shipmentId} reported as lost`;
        }
        else {
            throw new errors_1.NetworkError('report lost shipment', result.status, { shipmentId });
        }
    }
    /**
     * Get shipments by donor
     */
    async getShipmentsByDonor(donorId) {
        return this.cache.get(`tracker:donor:${donorId}`, async () => {
            try {
                const result = await this.contract.call("get_shipments_by_donor", (0, stellar_sdk_1.nativeToScVal)(donorId));
                return (0, stellar_sdk_1.scValToNative)(result.result.retval);
            }
            catch (error) {
                console.error('Failed to get shipments by donor:', error);
                return [];
            }
        });
    }
    /**
     * Get temperature alerts for cold chain shipments
     */
    async getTemperatureAlerts() {
        return this.cache.get('tracker:temperatureAlerts', async () => {
            try {
                const result = await this.contract.call("get_temperature_alerts");
                return (0, stellar_sdk_1.scValToNative)(result.result.retval);
            }
            catch (error) {
                console.error('Failed to get temperature alerts:', error);
                return [];
            }
        });
    }
    /**
     * Create location object
     */
    createLocation(latitude, longitude, address, facilityName, contactPerson, city, country, postalCode) {
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
    createTemperatureRequirements(minTemp, maxTemp, critical) {
        return {
            minTemp,
            maxTemp,
            critical
        };
    }
    /**
     * Generate QR code for shipment tracking
     */
    generateShipmentQRCode(shipmentId, shipment) {
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
    async validateShipmentQRCode(qrCodeData) {
        try {
            const data = JSON.parse(qrCodeData);
            if (data.type !== 'shipment') {
                return false;
            }
            // Verify shipment exists
            const shipment = await this.getShipment(data.shipmentId);
            return shipment !== null;
        }
        catch (error) {
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
    createSupplyChainRequest(donorId, supplyType, quantity, unit, originLatLng, originAddress, originFacility, originContact, destinationLatLng, destinationAddress, destinationFacility, destinationContact, estimatedArrival, temperatureRequirements, specialHandling = []) {
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
    calculateEstimatedArrival(origin, destination, transportMethod, options) {
        // Simple distance calculation (in production, use routing APIs)
        const distance = this.calculateDistance(origin.latitude, origin.longitude, destination.latitude, destination.longitude);
        // If a fully custom estimator is provided, use it and return
        if (options?.customEstimator) {
            const travelHours = options.customEstimator(distance, transportMethod);
            return Date.now() + (travelHours * 60 * 60 * 1000);
        }
        // Default speeds (km/h) — can be overridden via options.customSpeeds
        const defaultSpeeds = {
            air: 800, // Average aircraft speed
            ground: 60, // Average truck speed
            sea: 30, // Average ship speed
        };
        const speeds = { ...defaultSpeeds, ...options?.customSpeeds };
        const speedKmh = speeds[transportMethod];
        const travelHours = distance / speedKmh;
        // Base processing time (handling, loading/unloading)
        const processingHours = 24;
        // Additional humanitarian logistics delay factors
        const delays = options?.delayFactors ?? {};
        const additionalDelayHours = (delays.portCustomsHours ?? 0) +
            (delays.weatherBufferHours ?? 0) +
            (delays.securityCheckpointHours ?? 0) +
            (delays.infrastructureBufferHours ?? 0) +
            (delays.transshipmentHours ?? 0) +
            (delays.documentationHours ?? 0);
        const totalHours = travelHours + processingHours + additionalDelayHours;
        return Date.now() + (totalHours * 60 * 60 * 1000);
    }
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    /**
     * Get shipment statistics.
     *
     * Returns a rich summary including quantity-loss analytics. When final
     * checkpoint data is incomplete (missing `quantityVerified`) or
     * `initialQuantity` is zero, `quantityLoss` is reported as `null` and
     * `quantityLossUncertain` is set to `true` rather than throwing or
     * returning a misleading number (Issue #183).
     */
    async getShipmentStatistics(shipmentId) {
        const history = await this.getShipmentHistory(shipmentId);
        if (!history.shipment) {
            throw new errors_1.NetworkError('get shipment analytics', 'Shipment not found', { shipmentId });
        }
        const shipment = history.shipment;
        const totalCheckpoints = shipment.checkpoints.length;
        // Calculate average time between checkpoints
        let averageTime = 0;
        if (totalCheckpoints > 1) {
            const intervals = [];
            for (let i = 1; i < totalCheckpoints; i++) {
                intervals.push(shipment.checkpoints[i].timestamp - shipment.checkpoints[i - 1].timestamp);
            }
            averageTime = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
        }
        // Calculate quantity loss with uncertainty guards (Issue #183):
        // 1. If initialQuantity is 0, division by zero → uncertain.
        // 2. If the last checkpoint exists but quantityVerified is missing/null/empty
        //    → BigInt() would throw → return uncertain instead.
        let quantityLoss = null;
        let quantityLossUncertain = false;
        const rawInitial = shipment.quantity;
        if (rawInitial == null || rawInitial === '' || rawInitial === '0') {
            // Zero or missing initial quantity — loss percentage is undefined
            quantityLossUncertain = true;
        }
        else {
            const initialQuantity = BigInt(rawInitial);
            if (initialQuantity === BigInt(0)) {
                quantityLossUncertain = true;
            }
            else if (totalCheckpoints === 0) {
                // No checkpoints yet — treat as 0% loss (nothing has been verified missing)
                quantityLoss = 0;
            }
            else {
                const lastCheckpoint = shipment.checkpoints[totalCheckpoints - 1];
                const rawFinal = lastCheckpoint.quantityVerified;
                if (rawFinal == null || rawFinal === '') {
                    // Checkpoint exists but quantityVerified was not recorded
                    quantityLossUncertain = true;
                }
                else {
                    try {
                        const finalQuantity = BigInt(rawFinal);
                        quantityLoss = Number((initialQuantity - finalQuantity) * BigInt(100) / initialQuantity);
                    }
                    catch {
                        // BigInt conversion failed for an unexpected value
                        quantityLossUncertain = true;
                    }
                }
            }
        }
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
            quantityLossUncertain,
            deliveryStatus: shipment.currentStatus,
            onTimeDelivery,
            temperatureCompliance
        };
    }
    /**
     * Build a multi-sig transaction for creating a shipment.
     */
    async buildMultiSigCreateShipment(sourceKey, request, authorizedSigners, threshold) {
        const sourceKeypair = stellar_sdk_1.Keypair.fromSecret(sourceKey);
        const sourceAccount = await this.server.getAccount(sourceKeypair.publicKey());
        const shipmentId = `shipment_${request.donorId}_${Date.now()}`;
        const tempReqScVal = (request.temperatureRequirements != null)
            ? (0, stellar_sdk_1.nativeToScVal)(request.temperatureRequirements)
            : (0, stellar_sdk_1.nativeToScVal)(null);
        const tx = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call('create_shipment', ...[
            new stellar_sdk_1.Address(sourceKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(shipmentId),
            (0, stellar_sdk_1.nativeToScVal)(request.donorId),
            (0, stellar_sdk_1.nativeToScVal)(request.supplyType),
            (0, stellar_sdk_1.nativeToScVal)(request.quantity),
            (0, stellar_sdk_1.nativeToScVal)(request.unit),
            (0, stellar_sdk_1.nativeToScVal)(request.originLatLng),
            (0, stellar_sdk_1.nativeToScVal)(request.originAddress),
            (0, stellar_sdk_1.nativeToScVal)(request.originFacility),
            (0, stellar_sdk_1.nativeToScVal)(request.originContact),
            (0, stellar_sdk_1.nativeToScVal)(request.destinationLatLng),
            (0, stellar_sdk_1.nativeToScVal)(request.destinationAddress),
            (0, stellar_sdk_1.nativeToScVal)(request.destinationFacility),
            (0, stellar_sdk_1.nativeToScVal)(request.destinationContact),
            (0, stellar_sdk_1.nativeToScVal)(request.estimatedArrival),
            tempReqScVal,
            (0, stellar_sdk_1.nativeToScVal)(request.specialHandling),
        ]))
            .setTimeout(30)
            .build();
        return multiSig_1.MultiSigManager.create(tx, this.getNetworkPassphrase(), authorizedSigners, threshold);
    }
    /**
     * Build an unsigned transaction for creating a supply shipment.
     */
    async buildOfflineCreateShipment(sourcePublicKey, request) {
        const sourceAccount = await this.server.getAccount(sourcePublicKey);
        const shipmentId = `shipment_${request.donorId}_${Date.now()}`;
        const tempReqScVal = (request.temperatureRequirements != null)
            ? (0, stellar_sdk_1.nativeToScVal)(request.temperatureRequirements)
            : (0, stellar_sdk_1.nativeToScVal)(null);
        const tx = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call('create_shipment', ...[
            new stellar_sdk_1.Address(sourcePublicKey).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(shipmentId),
            (0, stellar_sdk_1.nativeToScVal)(request.donorId),
            (0, stellar_sdk_1.nativeToScVal)(request.supplyType),
            (0, stellar_sdk_1.nativeToScVal)(request.quantity),
            (0, stellar_sdk_1.nativeToScVal)(request.unit),
            (0, stellar_sdk_1.nativeToScVal)(request.originLatLng),
            (0, stellar_sdk_1.nativeToScVal)(request.originAddress),
            (0, stellar_sdk_1.nativeToScVal)(request.originFacility),
            (0, stellar_sdk_1.nativeToScVal)(request.originContact),
            (0, stellar_sdk_1.nativeToScVal)(request.destinationLatLng),
            (0, stellar_sdk_1.nativeToScVal)(request.destinationAddress),
            (0, stellar_sdk_1.nativeToScVal)(request.destinationFacility),
            (0, stellar_sdk_1.nativeToScVal)(request.destinationContact),
            (0, stellar_sdk_1.nativeToScVal)(request.estimatedArrival),
            tempReqScVal,
            (0, stellar_sdk_1.nativeToScVal)(request.specialHandling),
        ]))
            .setTimeout(0)
            .build();
        return offlineSigner_1.OfflineSigner.serialize(tx);
    }
    getNetworkPassphrase() {
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
exports.TrackerClient = TrackerClient;
//# sourceMappingURL=trackerClient.js.map