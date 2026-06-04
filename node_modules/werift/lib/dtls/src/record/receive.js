"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePlainText = exports.parsePacket = void 0;
const debug_1 = __importDefault(require("debug"));
const alert_1 = require("../handshake/message/alert");
const const_1 = require("./const");
const fragment_1 = require("./message/fragment");
const plaintext_1 = require("./message/plaintext");
const log = (0, debug_1.default)("werift-dtls : packages/dtls/record/receive.ts : log");
const err = (0, debug_1.default)("werift-dtls : packages/dtls/record/receive.ts : err");
const parsePacket = (data) => {
    let start = 0;
    const packets = [];
    while (data.length > start) {
        const fragmentLength = data.readUInt16BE(start + 11);
        if (data.length < start + (12 + fragmentLength))
            break;
        const packet = plaintext_1.DtlsPlaintext.deSerialize(data.slice(start));
        packets.push(packet);
        start += 13 + fragmentLength;
    }
    return packets;
};
exports.parsePacket = parsePacket;
const parsePlainText = (dtls, cipher) => (plain) => {
    const contentType = plain.recordLayerHeader.contentType;
    switch (contentType) {
        case const_1.ContentType.changeCipherSpec: {
            log(dtls.sessionId, "change cipher spec");
            return {
                type: const_1.ContentType.changeCipherSpec,
                data: undefined,
            };
        }
        case const_1.ContentType.handshake: {
            let raw = plain.fragment;
            try {
                if (plain.recordLayerHeader.epoch > 0) {
                    log(dtls.sessionId, "decrypt handshake");
                    raw = cipher.decryptPacket(plain);
                }
            }
            catch (error) {
                err(dtls.sessionId, "decrypt failed", error);
                throw error;
            }
            try {
                return {
                    type: const_1.ContentType.handshake,
                    data: fragment_1.FragmentedHandshake.deSerialize(raw),
                };
            }
            catch (error) {
                err(dtls.sessionId, "decSerialize failed", error, raw);
                throw error;
            }
        }
        case const_1.ContentType.applicationData: {
            return {
                type: const_1.ContentType.applicationData,
                data: cipher.decryptPacket(plain),
            };
        }
        case const_1.ContentType.alert: {
            let alert = alert_1.Alert.deSerialize(plain.fragment);
            // TODO impl more better about handle encrypted alert
            if (const_1.AlertDesc[alert.description] == undefined) {
                const dec = cipher.decryptPacket(plain);
                alert = alert_1.Alert.deSerialize(dec);
            }
            err(dtls.sessionId, "ContentType.alert", alert, const_1.AlertDesc[alert.description], "flight", dtls.flight, "lastFlight", dtls.lastFlight);
            if (alert.level > 1) {
                throw new Error("alert fatal error");
            }
        }
        // eslint-disable-next-line no-fallthrough
        default: {
            return { type: const_1.ContentType.alert, data: undefined };
        }
    }
};
exports.parsePlainText = parsePlainText;
//# sourceMappingURL=receive.js.map