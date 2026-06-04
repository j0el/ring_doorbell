import type { Transport } from "../imports/common";
export declare class TransportContext {
    socket: Transport;
    constructor(socket: Transport);
    readonly send: (buf: Buffer) => Promise<void>;
}
