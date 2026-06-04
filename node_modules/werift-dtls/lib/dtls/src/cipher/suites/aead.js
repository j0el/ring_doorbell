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
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = __importStar(require("crypto"));
const binary_data_1 = require("@shinyoshiaki/binary-data");
const helper_1 = require("../../helper");
const common_1 = require("../../imports/common");
const prf_1 = require("../prf");
const abstract_1 = __importStar(require("./abstract"));
const { uint8, uint16be, uint48be } = binary_data_1.types;
const ContentType = uint8;
const ProtocolVersion = uint16be;
const AEADAdditionalData = {
    epoch: uint16be,
    sequence: uint48be,
    type: ContentType,
    version: ProtocolVersion,
    length: uint16be,
};
const err = (0, common_1.debug)("werift-dtls : packages/dtls/src/cipher/suites/aead.ts : err");
/**
 * This class implements AEAD cipher family.
 */
class AEADCipher extends abstract_1.default {
    constructor() {
        super();
        Object.defineProperty(this, "keyLength", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "nonceLength", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "ivLength", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "authTagLength", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "nonceImplicitLength", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "nonceExplicitLength", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "clientWriteKey", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "serverWriteKey", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "clientNonce", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "serverNonce", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
    }
    get summary() {
        return (0, helper_1.getObjectSummary)(this);
    }
    init(masterSecret, serverRandom, clientRandom) {
        const keys = (0, prf_1.prfEncryptionKeys)(masterSecret, clientRandom, serverRandom, this.keyLength, this.ivLength, this.nonceLength, this.hashAlgorithm);
        this.clientWriteKey = keys.clientWriteKey;
        this.serverWriteKey = keys.serverWriteKey;
        this.clientNonce = keys.clientNonce;
        this.serverNonce = keys.serverNonce;
    }
    /**
     * Encrypt message.
     */
    encrypt(type, data, header) {
        const isClient = type === abstract_1.SessionType.CLIENT;
        const iv = isClient ? this.clientNonce : this.serverNonce;
        const writeKey = isClient ? this.clientWriteKey : this.serverWriteKey;
        if (!iv || !writeKey)
            throw new Error();
        iv.writeUInt16BE(header.epoch, this.nonceImplicitLength);
        iv.writeUIntBE(header.sequenceNumber, this.nonceImplicitLength + 2, 6);
        const explicitNonce = iv.slice(this.nonceImplicitLength);
        const additionalData = {
            epoch: header.epoch,
            sequence: header.sequenceNumber,
            type: header.type,
            version: header.version,
            length: data.length,
        };
        const additionalBuffer = (0, binary_data_1.encode)(additionalData, AEADAdditionalData).slice();
        const cipher = crypto.createCipheriv(this.blockAlgorithm, writeKey, iv, {
            authTagLength: this.authTagLength,
        });
        cipher.setAAD(additionalBuffer, {
            plaintextLength: data.length,
        });
        const headPart = cipher.update(data);
        const finalPart = cipher.final();
        const authTag = cipher.getAuthTag();
        return Buffer.concat([explicitNonce, headPart, finalPart, authTag]);
    }
    /**
     * Decrypt message.
     */
    decrypt(type, data, header) {
        const isClient = type === abstract_1.SessionType.CLIENT;
        const iv = isClient ? this.serverNonce : this.clientNonce;
        const writeKey = isClient ? this.serverWriteKey : this.clientWriteKey;
        if (!iv || !writeKey)
            throw new Error();
        const final = (0, binary_data_1.createDecode)(data);
        const explicitNonce = final.readBuffer(this.nonceExplicitLength);
        explicitNonce.copy(iv, this.nonceImplicitLength);
        const encrypted = final.readBuffer(final.length - this.authTagLength);
        const authTag = final.readBuffer(this.authTagLength);
        const additionalData = {
            epoch: header.epoch,
            sequence: header.sequenceNumber,
            type: header.type,
            version: header.version,
            length: encrypted.length,
        };
        const additionalBuffer = (0, binary_data_1.encode)(additionalData, AEADAdditionalData).slice();
        const decipher = crypto.createDecipheriv(this.blockAlgorithm, writeKey, iv, {
            authTagLength: this.authTagLength,
        });
        decipher.setAuthTag(authTag);
        decipher.setAAD(additionalBuffer, {
            plaintextLength: encrypted.length,
        });
        const headPart = decipher.update(encrypted);
        try {
            const finalPart = decipher.final();
            return finalPart.length > 0
                ? Buffer.concat([headPart, finalPart])
                : headPart;
        }
        catch (error) {
            err("decrypt failed", error, type, (0, helper_1.dumpBuffer)(data), header, this.summary);
            throw error;
        }
    }
}
exports.default = AEADCipher;
//# sourceMappingURL=aead.js.map