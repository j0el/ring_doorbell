"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Message = void 0;
exports.parseMessage = parseMessage;
exports.paddingLength = paddingLength;
const crypto_1 = require("crypto");
const jspack_1 = require("@shinyoshiaki/jspack");
const buffer_crc32_1 = __importDefault(require("buffer-crc32"));
const helper_1 = require("../helper");
const attributes_1 = require("./attributes");
const const_1 = require("./const");
function parseMessage(data, integrityKey) {
    if (data.length < const_1.HEADER_LENGTH) {
        return undefined;
    }
    const [messageType, length] = jspack_1.jspack.Unpack("!HHI", data.subarray(0, const_1.HEADER_LENGTH));
    const transactionId = Buffer.from(data.subarray(const_1.HEADER_LENGTH - 12, const_1.HEADER_LENGTH));
    if (data.length !== const_1.HEADER_LENGTH + length) {
        return undefined;
    }
    const attributeRepository = new attributes_1.AttributeRepository();
    for (let pos = const_1.HEADER_LENGTH; pos <= data.length - 4;) {
        const [attrType, attrLen] = jspack_1.jspack.Unpack("!HH", data.subarray(pos, pos + 4));
        const payload = data.subarray(pos + 4, pos + 4 + attrLen);
        const padLen = paddingLength(attrLen);
        const attributesTypes = Object.keys(attributes_1.ATTRIBUTES_BY_TYPE);
        if (attributesTypes.includes(attrType.toString())) {
            const [, attrName, , attrUnpack] = attributes_1.ATTRIBUTES_BY_TYPE[attrType];
            if (attrUnpack.name === attributes_1.unpackXorAddress.name) {
                attributeRepository.setAttribute(attrName, attrUnpack(payload, transactionId));
            }
            else {
                attributeRepository.setAttribute(attrName, attrUnpack(payload));
            }
            if (attrName === "FINGERPRINT") {
                const fingerprint = messageFingerprint(data.slice(0, pos));
                const expect = attributeRepository.getAttributeValue("FINGERPRINT");
                if (expect !== fingerprint) {
                    return undefined;
                }
            }
            else if (attrName === "MESSAGE-INTEGRITY") {
                if (integrityKey) {
                    const integrity = messageIntegrity(data.slice(0, pos), integrityKey);
                    const expect = attributeRepository.getAttributeValue("MESSAGE-INTEGRITY");
                    if (!integrity.equals(expect)) {
                        return undefined;
                    }
                }
            }
        }
        pos += 4 + attrLen + padLen;
    }
    const attributes = attributeRepository.getAttributes();
    attributeRepository.clear();
    return new Message(messageType & 0x3eef, messageType & 0x0110, transactionId, attributes);
}
class Message extends attributes_1.AttributeRepository {
    constructor(messageMethod, messageClass, transactionId = (0, helper_1.randomTransactionId)(), attributes = []) {
        super(attributes);
        Object.defineProperty(this, "messageMethod", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: messageMethod
        });
        Object.defineProperty(this, "messageClass", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: messageClass
        });
        Object.defineProperty(this, "transactionId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: transactionId
        });
    }
    toJSON() {
        return this.json;
    }
    get json() {
        return {
            messageMethod: const_1.methods[this.messageMethod],
            messageClass: const_1.classes[this.messageClass],
            attributes: this.attributes,
        };
    }
    get transactionIdHex() {
        return this.transactionId.toString("hex");
    }
    get bytes() {
        let data = Buffer.from([]);
        for (const attrName of this.attributesKeys) {
            const attrValue = this.getAttributeValue(attrName);
            const [attrType, , attrPack] = attributes_1.ATTRIBUTES_BY_NAME[attrName];
            const v = attrPack.name === attributes_1.packXorAddress.name
                ? attrPack(attrValue, this.transactionId)
                : attrPack(attrValue);
            const attrLen = v.length;
            const padLen = paddingLength(attrLen);
            data = Buffer.concat([
                data,
                Buffer.from(jspack_1.jspack.Pack("!HH", [attrType, attrLen])),
                v,
                ...[...Array(padLen)].map(() => Buffer.from("\x00")),
            ]);
        }
        const buf = Buffer.from(jspack_1.jspack.Pack("!HHI", [
            this.messageMethod | this.messageClass,
            data.length,
            const_1.COOKIE,
        ]));
        return Buffer.concat([buf, this.transactionId, data]);
    }
    addMessageIntegrity(key) {
        this.setAttribute("MESSAGE-INTEGRITY", this.messageIntegrity(key));
        return this;
    }
    messageIntegrity(key) {
        const checkData = setBodyLength(this.bytes, this.bytes.length - const_1.HEADER_LENGTH + const_1.INTEGRITY_LENGTH);
        return Buffer.from((0, crypto_1.createHmac)("sha1", key).update(checkData).digest("hex"), "hex");
    }
    addFingerprint() {
        this.setAttribute("FINGERPRINT", messageFingerprint(this.bytes));
    }
}
exports.Message = Message;
const setBodyLength = (data, length) => {
    return Buffer.concat([
        data.slice(0, 2),
        Buffer.from(jspack_1.jspack.Pack("!H", [length])),
        data.slice(4),
    ]);
};
function messageFingerprint(data) {
    const checkData = setBodyLength(data, data.length - const_1.HEADER_LENGTH + const_1.FINGERPRINT_LENGTH);
    const crc32Buf = (0, buffer_crc32_1.default)(checkData);
    const xorBuf = Buffer.alloc(4);
    xorBuf.writeInt32BE(const_1.FINGERPRINT_XOR, 0);
    const fingerprint = (0, helper_1.bufferXor)(crc32Buf, xorBuf);
    return fingerprint.readUInt32BE(0);
}
function messageIntegrity(data, key) {
    const checkData = setBodyLength(data, data.length - const_1.HEADER_LENGTH + const_1.INTEGRITY_LENGTH);
    return Buffer.from((0, crypto_1.createHmac)("sha1", key).update(checkData).digest("hex"), "hex");
}
function paddingLength(length) {
    const rest = length % 4;
    if (rest === 0) {
        return 0;
    }
    else {
        return 4 - rest;
    }
}
//# sourceMappingURL=message.js.map