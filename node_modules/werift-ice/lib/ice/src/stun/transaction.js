"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transaction = void 0;
const common_1 = require("../imports/common");
const exceptions_1 = require("../exceptions");
const const_1 = require("./const");
const log = (0, common_1.debug)("werift-ice:packages/ice/src/stun/transaction.ts");
class Transaction {
    constructor(request, addr, protocol, retransmissions) {
        Object.defineProperty(this, "request", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: request
        });
        Object.defineProperty(this, "addr", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: addr
        });
        Object.defineProperty(this, "protocol", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: protocol
        });
        Object.defineProperty(this, "retransmissions", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: retransmissions
        });
        Object.defineProperty(this, "timeoutDelay", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: const_1.RETRY_RTO
        });
        Object.defineProperty(this, "timeoutHandle", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "tries", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "triesMax", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "onResponse", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new common_1.Event()
        });
        Object.defineProperty(this, "responseReceived", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (message, addr) => {
                if (this.onResponse.length > 0) {
                    if (message.messageClass === const_1.classes.RESPONSE) {
                        this.onResponse.execute(message, addr);
                        this.onResponse.complete();
                    }
                    else {
                        this.onResponse.error(new exceptions_1.TransactionFailed(message, addr));
                    }
                }
            }
        });
        Object.defineProperty(this, "run", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: async () => {
                try {
                    this.retry();
                    const res = await this.onResponse.asPromise();
                    return res;
                }
                catch (error) {
                    // log(
                    //   "transaction run failed",
                    //   error,
                    //   this.protocol.type,
                    //   this.request.toJSON(),
                    // );
                    throw error;
                }
                finally {
                    if (this.timeoutHandle) {
                        clearTimeout(this.timeoutHandle);
                    }
                }
            }
        });
        Object.defineProperty(this, "retry", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: () => {
                if (this.tries >= this.triesMax) {
                    log(`retry failed times:${this.tries} maxLimit:${this.triesMax}`);
                    this.onResponse.error(new exceptions_1.TransactionTimeout());
                    return;
                }
                this.protocol.sendStun(this.request, this.addr).catch((e) => {
                    log("send stun failed", e);
                });
                this.timeoutHandle = setTimeout(this.retry, this.timeoutDelay);
                this.timeoutDelay *= 2;
                this.tries++;
            }
        });
        this.triesMax =
            1 + (this.retransmissions ? this.retransmissions : const_1.RETRY_MAX);
    }
    cancel() {
        if (this.timeoutHandle)
            clearTimeout(this.timeoutHandle);
    }
}
exports.Transaction = Transaction;
//# sourceMappingURL=transaction.js.map