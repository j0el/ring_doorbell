import type { Candidate } from "../candidate";
import { type Address, Event, type InterfaceAddresses, type Transport } from "../imports/common";
import { Message } from "../stun/message";
import { Transaction } from "../stun/transaction";
import type { Protocol } from "../types/model";
export declare class StunOverTurnProtocol implements Protocol {
    turn: TurnProtocol;
    static type: string;
    readonly type: string;
    localCandidate: Candidate;
    private disposer;
    onRequestReceived: Event<[Message, Address, Buffer]>;
    onDataReceived: Event<[Buffer]>;
    constructor(turn: TurnProtocol);
    private handleStunMessage;
    request(request: Message, addr: Address, integrityKey?: Buffer): Promise<[Message, readonly [string, number]]>;
    connectionMade(): Promise<void>;
    sendData(data: Buffer, addr: Address): Promise<void>;
    sendStun(message: Message, addr: Address): Promise<void>;
    close(): Promise<void>;
}
export declare class TurnProtocol implements Protocol {
    server: Address;
    username: string;
    password: string;
    lifetime: number;
    transport: Transport;
    options: {
        /**sec */
        channelRefreshTime?: number;
    };
    static type: string;
    readonly type: string;
    readonly onData: Event<[Buffer, readonly [string, number]]>;
    onRequestReceived: Event<[Message, Address, Buffer]>;
    onDataReceived: Event<[Buffer]>;
    integrityKey?: Buffer;
    nonce?: Buffer;
    realm?: string;
    relayedAddress: Address;
    mappedAddress: Address;
    localCandidate: Candidate;
    transactions: {
        [hexId: string]: Transaction;
    };
    private refreshHandle?;
    private channelNumber;
    private channelByAddr;
    private addrByChannel;
    /**sec */
    private channelRefreshTime;
    private channelBinding?;
    private channelRefreshAt;
    private tcpBuffer;
    private permissionByAddr;
    private creatingPermission;
    constructor(server: Address, username: string, password: string, lifetime: number, transport: Transport, options?: {
        /**sec */
        channelRefreshTime?: number;
    });
    connectionMade(): Promise<void>;
    private handleChannelData;
    private handleSTUNMessage;
    private dataReceived;
    private send;
    private createPermission;
    private refresh;
    request(request: Message, addr: Address): Promise<[Message, Address]>;
    requestWithRetry(request: Message, addr: Address): Promise<[Message, Address]>;
    sendData(data: Buffer, addr: Address): Promise<void>;
    getPermission(addr: Address): Promise<void>;
    getChannel(addr: Address): Promise<{
        number: number;
        address: Address;
    }>;
    private channelBind;
    sendStun(message: Message, addr: Address): Promise<void>;
    close(): Promise<void>;
}
export interface TurnClientConfig {
    address: Address;
    username: string;
    password: string;
}
export interface TurnClientOptions {
    lifetime?: number;
    ssl?: boolean;
    transport?: "udp" | "tcp";
    portRange?: [number, number];
    interfaceAddresses?: InterfaceAddresses;
}
export declare function createTurnClient({ address, username, password }: TurnClientConfig, { lifetime, portRange, interfaceAddresses, transport: transportType, }?: TurnClientOptions): Promise<TurnProtocol>;
export declare function createStunOverTurnClient({ address, username, password, }: {
    address: Address;
    username: string;
    password: string;
}, { lifetime, portRange, interfaceAddresses, transport: transportType, }?: {
    lifetime?: number;
    ssl?: boolean;
    transport?: "udp" | "tcp";
    portRange?: [number, number];
    interfaceAddresses?: InterfaceAddresses;
}): Promise<StunOverTurnProtocol>;
export declare function makeIntegrityKey(username: string, realm: string, password: string): Buffer;
