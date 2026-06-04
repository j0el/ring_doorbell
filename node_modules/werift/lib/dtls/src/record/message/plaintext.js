"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DtlsPlaintext = void 0;
/* eslint-disable @typescript-eslint/ban-ts-comment */
const binary_data_1 = require("@shinyoshiaki/binary-data");
const helper_1 = require("../../helper");
const header_1 = require("./header");
class DtlsPlaintext {
    constructor(recordLayerHeader, fragment) {
        Object.defineProperty(this, "recordLayerHeader", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: recordLayerHeader
        });
        Object.defineProperty(this, "fragment", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: fragment
        });
    }
    get summary() {
        return {
            header: this.recordLayerHeader,
            fragment: (0, helper_1.dumpBuffer)(this.fragment),
        };
    }
    static createEmpty() {
        return new DtlsPlaintext(undefined, undefined);
    }
    static deSerialize(buf) {
        const r = new DtlsPlaintext(
        //@ts-ignore
        ...Object.values((0, binary_data_1.decode)(buf, DtlsPlaintext.spec)));
        return r;
    }
    serialize() {
        const res = (0, binary_data_1.encode)(this, DtlsPlaintext.spec).slice();
        return Buffer.from(res);
    }
    computeMACHeader() {
        return new header_1.MACHeader(this.recordLayerHeader.epoch, this.recordLayerHeader.sequenceNumber, this.recordLayerHeader.contentType, this.recordLayerHeader.protocolVersion, this.recordLayerHeader.contentLen).serialize();
    }
}
exports.DtlsPlaintext = DtlsPlaintext;
Object.defineProperty(DtlsPlaintext, "spec", {
    enumerable: true,
    configurable: true,
    writable: true,
    value: {
        recordLayerHeader: header_1.DtlsPlaintextHeader.spec,
        fragment: binary_data_1.types.buffer((context) => context.current.recordLayerHeader.contentLen),
    }
});
//# sourceMappingURL=plaintext.js.map