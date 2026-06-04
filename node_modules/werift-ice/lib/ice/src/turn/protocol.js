"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TurnProtocol = exports.StunOverTurnProtocol = void 0;
exports.createTurnClient = createTurnClient;
exports.createStunOverTurnClient = createStunOverTurnClient;
exports.makeIntegrityKey = makeIntegrityKey;
const crypto_1 = require("crypto");
const jspack_1 = require("@shinyoshiaki/jspack");
const promises_1 = require("timers/promises");
const exceptions_1 = require("../exceptions");
const helper_1 = require("../helper");
const common_1 = require("../imports/common");
const const_1 = require("../stun/const");
const message_1 = require("../stun/message");
const transaction_1 = require("../stun/transaction");
const log = (0, common_1.debug)("werift-ice:packages/ice/src/turn/protocol.ts");
const DEFAULT_CHANNEL_REFRESH_TIME = 500;
const DEFAULT_ALLOCATION_LIFETIME = 600;
const UDP_TRANSPORT = 0x11000000;
class StunOverTurnProtocol {
    constructor(turn) {
        Object.defineProperty(this, "turn", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: turn
        });
        Object.defineProperty(this, "type", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: StunOverTurnProtocol.type
        });
        Object.defineProperty(this, "localCandidate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "disposer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new common_1.EventDisposer()
        });
        Object.defineProperty(this, "onRequestReceived", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new common_1.Event()
        });
        Object.defineProperty(this, "onDataReceived", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new common_1.Event()
        });
        Object.defineProperty(this, "handleStunMessage", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (data, addr) => {
                try {
                    const message = (0, message_1.parseMessage)(data);
                    if (!message) {
                        this.onDataReceived.execute(data);
                        return;
                    }
                    if (message.messageClass === const_1.classes.RESPONSE ||
                        message.messageClass === const_1.classes.ERROR) {
                        const transaction = this.turn.transactions[message.transactionIdHex];
                        if (transaction) {
                            transaction.responseReceived(message, addr);
                        }
                    }
                    else if (message.messageClass === const_1.classes.REQUEST) {
                        this.onRequestReceived.execute(message, addr, data);
                    }
                }
                catch (error) {
                    log("datagramReceived error", error);
                }
            }
        });
        turn.onData
            .subscribe((data, addr) => {
            this.handleStunMessage(data, addr);
        })
            .disposer(this.disposer);
    }
    async request(request, addr, integrityKey) {
        if (this.turn.transactions[request.transactionIdHex]) {
            throw new Error("exist");
        }
        if (integrityKey) {
            request.addMessageIntegrity(integrityKey);
            request.addFingerprint();
        }
        const transaction = new transaction_1.Transaction(request, addr, this);
        this.turn.transactions[request.transactionIdHex] = transaction;
        try {
            return await transaction.run();
        }
        catch (e) {
            throw e;
        }
        finally {
            delete this.turn.transactions[request.transactionIdHex];
        }
    }
    async connectionMade() { }
    async sendData(data, addr) {
        await this.turn.sendData(data, addr);
    }
    async sendStun(message, addr) {
        await this.turn.sendData(message.bytes, addr);
    }
    async close() {
        this.disposer.dispose();
        return this.turn.close();
    }
}
exports.StunOverTurnProtocol = StunOverTurnProtocol;
Object.defineProperty(StunOverTurnProtocol, "type", {
    enumerable: true,
    configurable: true,
    writable: true,
    value: "turn"
});
class TurnProtocol {
    constructor(server, username, password, lifetime, transport, options = {}) {
        Object.defineProperty(this, "server", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: server
        });
        Object.defineProperty(this, "username", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: username
        });
        Object.defineProperty(this, "password", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: password
        });
        Object.defineProperty(this, "lifetime", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: lifetime
        });
        Object.defineProperty(this, "transport", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: transport
        });
        Object.defineProperty(this, "options", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: options
        });
        Object.defineProperty(this, "type", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: TurnProtocol.type
        });
        Object.defineProperty(this, "onData", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new common_1.Event()
        });
        Object.defineProperty(this, "onRequestReceived", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new common_1.Event()
        });
        Object.defineProperty(this, "onDataReceived", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new common_1.Event()
        });
        Object.defineProperty(this, "integrityKey", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "nonce", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "realm", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "relayedAddress", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "mappedAddress", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "localCandidate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "transactions", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {}
        });
        Object.defineProperty(this, "refreshHandle", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "channelNumber", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0x4000
        });
        Object.defineProperty(this, "channelByAddr", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {}
        });
        Object.defineProperty(this, "addrByChannel", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {}
        });
        /**sec */
        Object.defineProperty(this, "channelRefreshTime", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "channelBinding", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "channelRefreshAt", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "tcpBuffer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: Buffer.alloc(0)
        });
        Object.defineProperty(this, "permissionByAddr", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {}
        });
        Object.defineProperty(this, "creatingPermission", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: Promise.resolve()
        });
        Object.defineProperty(this, "refresh", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (exp) => {
                this.refreshHandle = (0, helper_1.cancelable)(async (_, __, onCancel) => {
                    let run = true;
                    onCancel.once(() => {
                        run = false;
                    });
                    while (run) {
                        // refresh before expire
                        const delay = (5 / 6) * exp * 1000;
                        log("refresh delay", delay, { exp });
                        await (0, promises_1.setTimeout)(delay);
                        const request = new message_1.Message(const_1.methods.REFRESH, const_1.classes.REQUEST);
                        request.setAttribute("LIFETIME", exp);
                        try {
                            const [message] = await this.requestWithRetry(request, this.server);
                            exp = message.getAttributeValue("LIFETIME");
                            log("refresh", { exp });
                        }
                        catch (error) {
                            log("refresh error", error);
                        }
                    }
                });
            }
        });
        this.channelRefreshTime =
            this.options.channelRefreshTime ?? DEFAULT_CHANNEL_REFRESH_TIME;
    }
    async connectionMade() {
        this.transport.onData = (data, addr) => {
            this.dataReceived(data, addr);
        };
        const request = new message_1.Message(const_1.methods.ALLOCATE, const_1.classes.REQUEST);
        request
            .setAttribute("LIFETIME", this.lifetime)
            .setAttribute("REQUESTED-TRANSPORT", UDP_TRANSPORT);
        const [response] = await this.requestWithRetry(request, this.server).catch((e) => {
            log("connect error", e);
            throw e;
        });
        this.relayedAddress = response.getAttributeValue("XOR-RELAYED-ADDRESS");
        this.mappedAddress = response.getAttributeValue("XOR-MAPPED-ADDRESS");
        const exp = response.getAttributeValue("LIFETIME");
        log("connect", this.relayedAddress, this.mappedAddress, { exp });
        this.refresh(exp);
    }
    handleChannelData(data) {
        const [channel, length] = jspack_1.jspack.Unpack("!HH", data.slice(0, 4));
        const addr = this.addrByChannel[channel];
        if (addr) {
            const payload = data.subarray(4, 4 + length);
            this.onData.execute(payload, addr);
        }
    }
    handleSTUNMessage(data, addr) {
        try {
            const message = (0, message_1.parseMessage)(data);
            if (!message) {
                throw new Error("not stun message");
            }
            if (message.messageClass === const_1.classes.RESPONSE ||
                message.messageClass === const_1.classes.ERROR) {
                const transaction = this.transactions[message.transactionIdHex];
                if (transaction) {
                    transaction.responseReceived(message, addr);
                }
            }
            else if (message.messageClass === const_1.classes.REQUEST) {
                this.onData.execute(data, addr);
            }
            if (message.getAttributeValue("DATA")) {
                const buf = message.getAttributeValue("DATA");
                this.onData.execute(buf, addr);
            }
        }
        catch (error) {
            log("parse error", data.toString());
        }
    }
    dataReceived(data, addr) {
        const datagramReceived = (data, addr) => {
            if (data.length >= 4 && isChannelData(data)) {
                this.handleChannelData(data);
            }
            else {
                this.handleSTUNMessage(data, addr);
            }
        };
        if (this.transport.type === "tcp") {
            this.tcpBuffer = Buffer.concat([this.tcpBuffer, data]);
            while (this.tcpBuffer.length >= 4) {
                let [, length] = (0, common_1.bufferReader)(this.tcpBuffer.subarray(0, 4), [2, 2]);
                length += (0, message_1.paddingLength)(length);
                const fullLength = isChannelData(this.tcpBuffer)
                    ? 4 + length
                    : 20 + length;
                if (this.tcpBuffer.length < fullLength) {
                    break;
                }
                datagramReceived(this.tcpBuffer.subarray(0, fullLength), addr);
                this.tcpBuffer = this.tcpBuffer.subarray(fullLength);
            }
        }
        else {
            datagramReceived(data, addr);
        }
    }
    async send(data, addr) {
        if (this.transport.type === "tcp") {
            const padding = (0, message_1.paddingLength)(data.length);
            await this.transport.send(padding > 0 ? Buffer.concat([data, Buffer.alloc(padding)]) : data, addr);
        }
        else {
            await this.transport.send(data, addr);
        }
    }
    async createPermission(peerAddress) {
        const request = new message_1.Message(const_1.methods.CREATE_PERMISSION, const_1.classes.REQUEST);
        request
            .setAttribute("XOR-PEER-ADDRESS", peerAddress)
            .setAttribute("USERNAME", this.username)
            .setAttribute("REALM", this.realm)
            .setAttribute("NONCE", this.nonce);
        await this.request(request, this.server).catch((e) => {
            request;
            throw e;
        });
    }
    async request(request, addr) {
        if (this.transactions[request.transactionIdHex]) {
            throw new Error("exist");
        }
        if (this.integrityKey) {
            request
                .setAttribute("USERNAME", this.username)
                .setAttribute("REALM", this.realm)
                .setAttribute("NONCE", this.nonce)
                .addMessageIntegrity(this.integrityKey)
                .addFingerprint();
        }
        const transaction = new transaction_1.Transaction(request, addr, this);
        this.transactions[request.transactionIdHex] = transaction;
        try {
            return await transaction.run();
        }
        catch (e) {
            throw e;
        }
        finally {
            delete this.transactions[request.transactionIdHex];
        }
    }
    async requestWithRetry(request, addr) {
        let message, address;
        try {
            [message, address] = await this.request(request, addr);
        }
        catch (error) {
            if (error instanceof exceptions_1.TransactionFailed == false) {
                log("requestWithRetry error", error);
                throw error;
            }
            // resolve dns address
            this.server = error.addr;
            const [errorCode] = error.response.getAttributeValue("ERROR-CODE");
            const nonce = error.response.getAttributeValue("NONCE");
            const realm = error.response.getAttributeValue("REALM");
            if (((errorCode === 401 && realm) || (errorCode === 438 && this.realm)) &&
                nonce) {
                log("retry with nonce", errorCode);
                this.nonce = nonce;
                if (errorCode === 401) {
                    this.realm = realm;
                }
                this.integrityKey = makeIntegrityKey(this.username, this.realm, this.password);
                request.transactionId = (0, helper_1.randomTransactionId)();
                [message, address] = await this.request(request, this.server);
            }
            else {
                throw error;
            }
        }
        return [message, address];
    }
    async sendData(data, addr) {
        const channel = await this.getChannel(addr).catch((e) => {
            return new Error("channelBind error");
        });
        if (channel instanceof Error) {
            await this.getPermission(addr);
            const indicate = new message_1.Message(const_1.methods.SEND, const_1.classes.INDICATION)
                .setAttribute("DATA", data)
                .setAttribute("XOR-PEER-ADDRESS", addr);
            await this.sendStun(indicate, this.server);
            return;
        }
        const header = jspack_1.jspack.Pack("!HH", [channel.number, data.length]);
        await this.send(Buffer.concat([Buffer.from(header), data]), this.server);
    }
    async getPermission(addr) {
        await this.creatingPermission;
        const permitted = this.permissionByAddr[addr.join(":")];
        if (!permitted) {
            this.creatingPermission = this.createPermission(addr);
            this.permissionByAddr[addr.join(":")] = true;
            await this.creatingPermission.catch((e) => {
                log("createPermission error", e);
                throw e;
            });
        }
    }
    async getChannel(addr) {
        if (this.channelBinding) {
            await this.channelBinding;
        }
        let channel = this.channelByAddr[addr.join(":")];
        if (!channel) {
            this.channelByAddr[addr.join(":")] = {
                number: this.channelNumber++,
                address: addr,
            };
            channel = this.channelByAddr[addr.join(":")];
            this.addrByChannel[channel.number] = addr;
            this.channelBinding = this.channelBind(channel.number, addr);
            await this.channelBinding.catch((e) => {
                log("channelBind error", e);
                throw e;
            });
            this.channelRefreshAt = (0, common_1.int)(Date.now() / 1000) + this.channelRefreshTime;
            this.channelBinding = undefined;
            log("channelBind", channel);
        }
        else if (this.channelRefreshAt < (0, common_1.int)(Date.now() / 1000)) {
            this.channelBinding = this.channelBind(channel.number, addr);
            this.channelRefreshAt = (0, common_1.int)(Date.now() / 1000) + this.channelRefreshTime;
            await this.channelBinding.catch((e) => {
                log("channelBind error", e);
                throw e;
            });
            this.channelBinding = undefined;
            log("channelBind refresh", channel);
        }
        return channel;
    }
    async channelBind(channelNumber, addr) {
        const request = new message_1.Message(const_1.methods.CHANNEL_BIND, const_1.classes.REQUEST);
        request
            .setAttribute("CHANNEL-NUMBER", channelNumber)
            .setAttribute("XOR-PEER-ADDRESS", addr);
        const [response] = await this.requestWithRetry(request, this.server);
        if (response.messageMethod !== const_1.methods.CHANNEL_BIND) {
            throw new Error("should be CHANNEL_BIND");
        }
    }
    async sendStun(message, addr) {
        await this.send(message.bytes, addr);
    }
    async close() {
        this.refreshHandle?.resolve?.();
        await this.transport.close();
    }
}
exports.TurnProtocol = TurnProtocol;
Object.defineProperty(TurnProtocol, "type", {
    enumerable: true,
    configurable: true,
    writable: true,
    value: "turn"
});
async function createTurnClient({ address, username, password }, { lifetime, portRange, interfaceAddresses, transport: transportType, } = {}) {
    lifetime ?? (lifetime = DEFAULT_ALLOCATION_LIFETIME);
    transportType ?? (transportType = "udp");
    const transport = transportType === "udp"
        ? await common_1.UdpTransport.init("udp4", { portRange, interfaceAddresses })
        : await common_1.TcpTransport.init(address);
    const turn = new TurnProtocol(address, username, password, lifetime, transport);
    await turn.connectionMade();
    return turn;
}
async function createStunOverTurnClient({ address, username, password, }, { lifetime, portRange, interfaceAddresses, transport: transportType, } = {}) {
    const turn = await createTurnClient({
        address,
        username,
        password,
    }, {
        lifetime,
        portRange,
        interfaceAddresses,
        transport: transportType,
    });
    const turnTransport = new StunOverTurnProtocol(turn);
    return turnTransport;
}
function makeIntegrityKey(username, realm, password) {
    return (0, crypto_1.createHash)("md5")
        .update(Buffer.from([username, realm, password].join(":")))
        .digest();
}
function isChannelData(data) {
    return (data[0] & 0xc0) == 0x40;
}
//# sourceMappingURL=protocol.js.map