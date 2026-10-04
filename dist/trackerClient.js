"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrackerClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
class TrackerClient {
    constructor(config) {
        this.config = config;
        this.server = new stellar_sdk_1.Server(config.rpcUrl);
        this.contract = new stellar_sdk_1.Contract(config.contractIds.supplyChainTracker);
    }
    /**
     * Create a new supply shipment
     */
    async createShipment(donorKey, request) {
        const donorKeypair = stellar_sdk_1.Keypair.fromSecret(donorKey);
        const donorAccount = await this.server.getAccount(donorKeypair.publicKey());
        const shipmentId = `shipment_${request.donorId}_${Date.now()}`;
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
            (0, stellar_sdk_1.nativeToScVal)(request.origin),
            (0, stellar_sdk_1.nativeToScVal)(request.destination),
            (0, stellar_sdk_1.nativeToScVal)(request.estimatedArrival),
            (0, stellar_sdk_1.nativeToScVal)(request.temperatureRequirements),
            (0, stellar_sdk_1.nativeToScVal)(request.specialHandling)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(donorKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return shipmentId;
        }
        else {
            throw new Error(`Failed to create shipment: ${result.status}`);
        }
    }
    /**
     * Add checkpoint to shipment journey
     */
    async addCheckpoint(verifierKey, shipmentId, location, quantityVerified, condition, photos, notes, temperature) {
        const verifierKeypair = stellar_sdk_1.Keypair.fromSecret(verifierKey);
        const verifierAccount = await this.server.getAccount(verifierKeypair.publicKey());
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
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Checkpoint added to shipment ${shipmentId}`;
        }
        else {
            throw new Error(`Failed to add checkpoint: ${result.status}`);
        }
    }
    /**
     * Assign transporter to shipment
     */
    async assignTransporter(donorKey, shipmentId, transporterAddress) {
        const donorKeypair = stellar_sdk_1.Keypair.fromSecret(donorKey);
        const donorAccount = await this.server.getAccount(donorKeypair.publicKey());
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
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Transporter assigned to shipment ${shipmentId}`;
        }
        else {
            throw new Error(`Failed to assign transporter: ${result.status}`);
        }
    }
    /**
     * Confirm final delivery
     */
    async confirmDelivery(recipientKey, shipmentId, recipientId, receivedQuantity, conditionReport, photos) {
        const recipientKeypair = stellar_sdk_1.Keypair.fromSecret(recipientKey);
        const recipientAccount = await this.server.getAccount(recipientKeypair.publicKey());
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
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Delivery confirmed for shipment ${shipmentId}`;
        }
        else {
            throw new Error(`Failed to confirm delivery: ${result.status}`);
        }
    }
    /**
     * Get shipment details
     */
    async getShipment(shipmentId) {
        try {
            const result = await this.contract.call("get_shipment", (0, stellar_sdk_1.nativeToScVal)(shipmentId));
            const shipment = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return shipment;
        }
        catch (error) {
            console.error('Failed to get shipment:', error);
            return null;
        }
    }
    /**
     * Get complete shipment history
     */
    async getShipmentHistory(shipmentId) {
        try {
            const result = await this.contract.call("get_shipment_history", (0, stellar_sdk_1.nativeToScVal)(shipmentId));
            const history = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return {
                shipment: history[0],
                confirmation: history[1]
            };
        }
        catch (error) {
            console.error('Failed to get shipment history:', error);
            return {};
        }
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
        try {
            const result = await this.contract.call("get_active_shipments");
            const shipments = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return shipments;
        }
        catch (error) {
            console.error('Failed to get active shipments:', error);
            return [];
        }
    }
    /**
     * Report shipment as lost
     */
    async reportLost(reporterKey, shipmentId, reason) {
        const reporterKeypair = stellar_sdk_1.Keypair.fromSecret(reporterKey);
        const reporterAccount = await this.server.getAccount(reporterKeypair.publicKey());
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
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Shipment ${shipmentId} reported as lost`;
        }
        else {
            throw new Error(`Failed to report lost shipment: ${result.status}`);
        }
    }
    /**
     * Get shipments by donor
     */
    async getShipmentsByDonor(donorId) {
        try {
            const result = await this.contract.call("get_shipments_by_donor", (0, stellar_sdk_1.nativeToScVal)(donorId));
            const shipments = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return shipments;
        }
        catch (error) {
            console.error('Failed to get shipments by donor:', error);
            return [];
        }
    }
    /**
     * Get temperature alerts for cold chain shipments
     */
    async getTemperatureAlerts() {
        try {
            const result = await this.contract.call("get_temperature_alerts");
            const alerts = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return alerts;
        }
        catch (error) {
            console.error('Failed to get temperature alerts:', error);
            return [];
        }
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
     * Create supply chain request template
     */
    createSupplyChainRequest(donorId, supplyType, quantity, unit, origin, destination, estimatedArrival, temperatureRequirements, specialHandling = []) {
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
    calculateEstimatedArrival(origin, destination, transportMethod) {
        // Simple distance calculation (in production, use routing APIs)
        const distance = this.calculateDistance(origin.latitude, origin.longitude, destination.latitude, destination.longitude);
        // Estimate travel time based on transport method
        let speedKmh;
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
     * Get shipment statistics
     */
    async getShipmentStatistics(shipmentId) {
        const history = await this.getShipmentHistory(shipmentId);
        if (!history.shipment) {
            throw new Error(`Shipment ${shipmentId} not found`);
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