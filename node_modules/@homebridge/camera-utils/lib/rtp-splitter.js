"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RtpSplitter = void 0;
const dgram_1 = require("dgram");
const ports_1 = require("./ports");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const rtp_1 = require("./rtp");
class RtpSplitter {
    constructor(messageHandler) {
        this.socket = (0, dgram_1.createSocket)('udp4');
        this.portPromise = (0, ports_1.bindToPort)(this.socket);
        this.onClose = new rxjs_1.ReplaySubject();
        this.onMessage = (0, rxjs_1.fromEvent)(this.socket, 'message').pipe((0, operators_1.map)(([message, info]) => {
            const payloadType = (0, rtp_1.getPayloadType)(message);
            return {
                message,
                info,
                isRtpMessage: (0, rtp_1.isRtpMessagePayloadType)(payloadType),
                payloadType,
            };
        }), (0, operators_1.takeUntil)(this.onClose), (0, operators_1.share)());
        this.cleanedUp = false;
        this.closed = false;
        if (messageHandler) {
            this.addMessageHandler(messageHandler);
        }
        (0, rxjs_1.merge)((0, rxjs_1.fromEvent)(this.socket, 'close'), (0, rxjs_1.fromEvent)(this.socket, 'error'))
            .pipe((0, operators_1.takeUntil)(this.onClose))
            .subscribe(() => {
            this.cleanUp();
        });
    }
    addMessageHandler(handler) {
        this.onMessage.subscribe((description) => {
            const forwardingTarget = handler(description);
            if (forwardingTarget) {
                this.send(description.message, forwardingTarget);
            }
        });
    }
    send(message, sendTo) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.portPromise;
            if (this.closed) {
                // If we send a message on a closed socket, it will throw an ERR_SOCKET_DGRAM_NOT_RUNNING error
                return;
            }
            this.socket.send(message, sendTo.port, sendTo.address || '127.0.0.1');
        });
    }
    cleanUp() {
        this.closed = true;
        if (this.cleanedUp) {
            return;
        }
        this.cleanedUp = true;
        this.onClose.next(null);
    }
    close() {
        if (this.closed) {
            return;
        }
        this.socket.close();
        this.cleanUp();
    }
}
exports.RtpSplitter = RtpSplitter;
