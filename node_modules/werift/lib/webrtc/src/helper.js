"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventTarget = exports.PromiseQueue = void 0;
exports.enumerate = enumerate;
exports.divide = divide;
const events_1 = __importDefault(require("events"));
function enumerate(arr) {
    return arr.map((v, i) => [i, v]);
}
function divide(from, split) {
    const arr = from.split(split);
    return [arr[0], arr.slice(1).join(split)];
}
class PromiseQueue {
    constructor() {
        Object.defineProperty(this, "queue", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "running", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "push", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (promise) => new Promise((r) => {
                this.queue.push({ promise, done: r });
                if (!this.running)
                    this.run();
            })
        });
    }
    async run() {
        const task = this.queue.shift();
        if (task) {
            this.running = true;
            await task.promise();
            task.done();
            this.run();
        }
        else {
            this.running = false;
        }
    }
}
exports.PromiseQueue = PromiseQueue;
class EventTarget extends events_1.default {
    constructor() {
        super(...arguments);
        Object.defineProperty(this, "addEventListener", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (type, listener) => {
                this.addListener(type, listener);
            }
        });
        Object.defineProperty(this, "removeEventListener", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (type, listener) => {
                this.removeListener(type, listener);
            }
        });
    }
}
exports.EventTarget = EventTarget;
//# sourceMappingURL=helper.js.map