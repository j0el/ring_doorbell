"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ATTRIBUTES_BY_NAME = exports.ATTRIBUTES_BY_TYPE = exports.AttributeRepository = void 0;
exports.unpackErrorCode = unpackErrorCode;
exports.unpackXorAddress = unpackXorAddress;
exports.packErrorCode = packErrorCode;
exports.packXorAddress = packXorAddress;
const jspack_1 = require("@shinyoshiaki/jspack");
const Int64 = __importStar(require("int64-buffer"));
const ip_1 = __importDefault(require("ip"));
const range_js_1 = __importDefault(require("lodash/range.js"));
const const_1 = require("./const");
function packAddress(value) {
    const [address] = value;
    const protocol = ip_1.default.isV4Format(address) ? const_1.IPV4_PROTOCOL : const_1.IPV6_PROTOCOL;
    return Buffer.concat([
        Buffer.from(jspack_1.jspack.Pack("!BBH", [0, protocol, value[1]])),
        ip_1.default.toBuffer(address),
    ]);
}
function unpackErrorCode(data) {
    if (data.length < 4)
        throw new Error("STUN error code is less than 4 bytes");
    const [, codeHigh, codeLow] = jspack_1.jspack.Unpack("!HBB", data.slice(0, 4));
    const reason = data.slice(4).toString("utf8");
    return [codeHigh * 100 + codeLow, reason];
}
function unpackAddress(data) {
    if (data.length < 4)
        throw new Error("STUN address length is less than 4 bytes");
    const [, protocol, port] = jspack_1.jspack.Unpack("!BBH", data.slice(0, 4));
    const address = data.slice(4);
    switch (protocol) {
        case const_1.IPV4_PROTOCOL:
            if (address.length != 4)
                throw new Error(`STUN address has invalid length for IPv4`);
            return [ip_1.default.toString(address), port];
        case const_1.IPV6_PROTOCOL:
            if (address.length != 16)
                throw new Error("STUN address has invalid length for IPv6");
            return [ip_1.default.toString(address), port];
        default:
            throw new Error("STUN address has unknown protocol");
    }
}
function xorAddress(data, transactionId) {
    const xPad = [
        ...jspack_1.jspack.Pack("!HI", [const_1.COOKIE >> 16, const_1.COOKIE]),
        ...transactionId,
    ];
    let xData = data.slice(0, 2);
    for (const i of (0, range_js_1.default)(2, data.length)) {
        const num = data[i] ^ xPad[i - 2];
        const buf = Buffer.alloc(1);
        buf.writeUIntBE(num, 0, 1);
        xData = Buffer.concat([xData, buf]);
    }
    return xData;
}
function unpackXorAddress(data, transactionId) {
    return unpackAddress(xorAddress(data, transactionId));
}
function packErrorCode(value) {
    const pack = Buffer.from(jspack_1.jspack.Pack("!HBB", [0, Math.floor(value[0] / 100), value[0] % 100]));
    const encode = Buffer.from(value[1], "utf8");
    return Buffer.concat([pack, encode]);
}
function packXorAddress(value, transactionId) {
    return xorAddress(packAddress(value), transactionId);
}
const packUnsigned = (value) => Buffer.from(jspack_1.jspack.Pack("!I", [value]));
const unpackUnsigned = (data) => jspack_1.jspack.Unpack("!I", data)[0];
const packUnsignedShort = (value) => Buffer.concat([
    Buffer.from(jspack_1.jspack.Pack("!H", [value])),
    Buffer.from("\x00\x00"),
]);
const unpackUnsignedShort = (data) => jspack_1.jspack.Unpack("!H", data.slice(0, 2))[0];
const packUnsigned64 = (value) => {
    return new Int64.Int64BE(value.toString()).toBuffer();
};
const unpackUnsigned64 = (data) => {
    const int = new Int64.Int64BE(data);
    return BigInt(int.toString());
};
const packString = (value) => Buffer.from(value, "utf8");
const unpackString = (data) => data.toString("utf8");
const packBytes = (value) => value;
const unpackBytes = (data) => data;
const packNone = (value) => Buffer.from([]);
const unpackNone = (data) => null;
const ATTRIBUTES = [
    [0x0001, "MAPPED-ADDRESS", packAddress, unpackAddress],
    [0x0003, "CHANGE-REQUEST", packUnsigned, unpackUnsigned],
    [0x0004, "SOURCE-ADDRESS", packAddress, unpackAddress],
    [0x0005, "CHANGED-ADDRESS", packAddress, unpackAddress],
    [0x0006, "USERNAME", packString, unpackString],
    [0x0008, "MESSAGE-INTEGRITY", packBytes, unpackBytes],
    [0x0009, "ERROR-CODE", packErrorCode, unpackErrorCode],
    [0x000c, "CHANNEL-NUMBER", packUnsignedShort, unpackUnsignedShort],
    [0x000d, "LIFETIME", packUnsigned, unpackUnsigned],
    [0x0012, "XOR-PEER-ADDRESS", packXorAddress, unpackXorAddress],
    [0x0013, "DATA", packBytes, unpackBytes],
    [0x0014, "REALM", packString, unpackString],
    [0x0015, "NONCE", packBytes, unpackBytes],
    [0x0016, "XOR-RELAYED-ADDRESS", packXorAddress, unpackXorAddress],
    [0x0019, "REQUESTED-TRANSPORT", packUnsigned, unpackUnsigned],
    [0x0020, "XOR-MAPPED-ADDRESS", packXorAddress, unpackXorAddress],
    [0x0024, "PRIORITY", packUnsigned, unpackUnsigned],
    [0x0025, "USE-CANDIDATE", packNone, unpackNone],
    [0x8022, "SOFTWARE", packString, unpackString],
    [0x8028, "FINGERPRINT", packUnsigned, unpackUnsigned],
    [0x8029, "ICE-CONTROLLED", packUnsigned64, unpackUnsigned64],
    [0x802a, "ICE-CONTROLLING", packUnsigned64, unpackUnsigned64],
    [0x802b, "RESPONSE-ORIGIN", packAddress, unpackAddress],
    [0x802c, "OTHER-ADDRESS", packAddress, unpackAddress],
];
class AttributeRepository {
    constructor(attributes = []) {
        Object.defineProperty(this, "attributes", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: attributes
        });
    }
    getAttributes() {
        return this.attributes;
    }
    setAttribute(key, value) {
        const exist = this.attributes.find((a) => a[0] === key);
        if (exist) {
            exist[1] = value;
        }
        else {
            this.attributes.push([key, value]);
        }
        return this;
    }
    getAttributeValue(key) {
        const attribute = this.attributes.find((a) => a[0] === key);
        if (!attribute) {
            return undefined;
        }
        return attribute[1];
    }
    get attributesKeys() {
        return this.attributes.map((a) => a[0]);
    }
    clear() {
        this.attributes = [];
    }
}
exports.AttributeRepository = AttributeRepository;
exports.ATTRIBUTES_BY_TYPE = ATTRIBUTES.reduce((acc, cur) => {
    acc[cur[0]] = cur;
    return acc;
}, {});
exports.ATTRIBUTES_BY_NAME = ATTRIBUTES.reduce((acc, cur) => {
    acc[cur[1]] = cur;
    return acc;
}, {});
//# sourceMappingURL=attributes.js.map