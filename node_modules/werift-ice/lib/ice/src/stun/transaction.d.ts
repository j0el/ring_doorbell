import { type Address } from "../imports/common";
import type { Protocol } from "../types/model";
import type { Message } from "./message";
export declare class Transaction {
    private request;
    private addr;
    private protocol;
    private retransmissions?;
    private timeoutDelay;
    private timeoutHandle?;
    private tries;
    private readonly triesMax;
    private readonly onResponse;
    constructor(request: Message, addr: Address, protocol: Protocol, retransmissions?: number | undefined);
    responseReceived: (message: Message, addr: Address) => void;
    run: () => Promise<[Message, readonly [string, number]]>;
    private retry;
    cancel(): void;
}
