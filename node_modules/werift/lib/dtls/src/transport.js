"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUdpTransport = exports.UdpTransport = void 0;
const debug_1 = __importDefault(require("debug"));
const log = (0, debug_1.default)("werift-dtls : packages/dtls/src/transport.ts");
class UdpTransport {
    constructor(upd, rinfo) {
        Object.defineProperty(this, "upd", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: upd
        });
        Object.defineProperty(this, "rinfo", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: rinfo
        });
        Object.defineProperty(this, "onData", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "send", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (buf) => new Promise((r, f) => {
                log("this.rinfo", this.rinfo);
                this.upd.send(buf, this.rinfo.port, this.rinfo.address, (err) => {
                    if (err) {
                        f(err);
                    }
                    else {
                        r();
                    }
                });
            })
        });
        upd.on("message", (buf, target) => {
            this.rinfo = target;
            if (this.onData)
                this.onData(buf);
        });
    }
    close() {
        try {
            this.upd.close();
        }
        catch (error) { }
    }
}
exports.UdpTransport = UdpTransport;
const createUdpTransport = (socket, rinfo = {}) => new UdpTransport(socket, rinfo);
exports.createUdpTransport = createUdpTransport;
//# sourceMappingURL=transport.js.map