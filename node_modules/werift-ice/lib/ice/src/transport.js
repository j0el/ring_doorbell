"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TcpTransport = exports.UdpTransport = void 0;
const dgram_1 = require("dgram");
const debug_1 = __importDefault(require("debug"));
const net_1 = require("net");
const src_1 = require("../../common/src");
const utils_1 = require("./utils");
const log = (0, debug_1.default)("werift-ice:packages/ice/src/transport.ts");
class UdpTransport {
    constructor(socketType, portRange, interfaceAddresses) {
        Object.defineProperty(this, "socketType", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: socketType
        });
        Object.defineProperty(this, "portRange", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: portRange
        });
        Object.defineProperty(this, "interfaceAddresses", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: interfaceAddresses
        });
        Object.defineProperty(this, "type", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: "udp"
        });
        Object.defineProperty(this, "socket", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "onData", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: () => { }
        });
        Object.defineProperty(this, "send", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (data, addr) => new Promise((r, f) => {
                this.socket.send(data, addr[1], addr[0], (error) => {
                    if (error) {
                        log("send error", addr, data);
                        f(error);
                    }
                    else {
                        r();
                    }
                });
            })
        });
        Object.defineProperty(this, "close", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: () => new Promise((r) => {
                this.socket.once("close", r);
                try {
                    this.socket.close();
                }
                catch (error) {
                    r();
                }
            })
        });
        this.socket = (0, dgram_1.createSocket)(socketType);
        this.socket.on("message", (data, info) => {
            if ((0, utils_1.normalizeFamilyNodeV18)(info.family) === 6) {
                [info.address] = info.address.split("%"); // example fe80::1d3a:8751:4ffd:eb80%wlp82s0
            }
            try {
                this.onData(data, [info.address, info.port]);
            }
            catch (error) {
                log("onData error", error);
            }
        });
    }
    static async init(type, portRange, interfaceAddresses) {
        const transport = new UdpTransport(type, portRange, interfaceAddresses);
        await transport.init();
        return transport;
    }
    async init() {
        const address = (0, src_1.interfaceAddress)(this.socketType, this.interfaceAddresses);
        if (this.portRange) {
            const port = await (0, src_1.findPort)(this.portRange[0], this.portRange[1], this.socketType, this.interfaceAddresses);
            this.socket.bind({ port, address });
        }
        else {
            this.socket.bind({ address });
        }
        await new Promise((r) => this.socket.once("listening", r));
    }
    address() {
        return this.socket.address();
    }
}
exports.UdpTransport = UdpTransport;
class TcpTransport {
    constructor(addr) {
        Object.defineProperty(this, "addr", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: addr
        });
        Object.defineProperty(this, "type", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: "tcp"
        });
        Object.defineProperty(this, "connecting", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "onData", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: () => { }
        });
        Object.defineProperty(this, "closed", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "send", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: async (data, addr) => {
                await this.connecting;
                this.client.write(data, (err) => {
                    if (err) {
                        console.log("err", err);
                    }
                });
            }
        });
        Object.defineProperty(this, "close", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: async () => {
                this.closed = true;
                this.client.destroy();
            }
        });
        this.connect();
    }
    connect() {
        if (this.closed) {
            return;
        }
        if (this.client) {
            this.client.destroy();
        }
        this.connecting = new Promise((r, f) => {
            try {
                this.client = (0, net_1.connect)({ port: this.addr[1], host: this.addr[0] }, r);
            }
            catch (error) {
                f(error);
            }
        });
        this.client.on("data", (data) => {
            const addr = [
                this.client.remoteAddress,
                this.client.remotePort,
            ];
            this.onData(data, addr);
        });
        this.client.on("end", () => {
            this.connect();
        });
        this.client.on("error", (error) => {
            console.log("error", error);
        });
    }
    async init() {
        await this.connecting;
    }
    static async init(addr) {
        const transport = new TcpTransport(addr);
        await transport.init();
        return transport;
    }
}
exports.TcpTransport = TcpTransport;
//# sourceMappingURL=transport.js.map