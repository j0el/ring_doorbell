import { type Socket, type SocketType } from "dgram";
import { type InterfaceAddresses } from "../../common/src";
import type { Address } from "./types/model";
export declare class UdpTransport implements Transport {
    private socketType;
    private portRange?;
    private interfaceAddresses?;
    readonly type = "udp";
    readonly socket: Socket;
    onData: (data: Buffer, addr: Address) => void;
    private constructor();
    static init(type: SocketType, portRange?: [number, number], interfaceAddresses?: InterfaceAddresses): Promise<UdpTransport>;
    private init;
    send: (data: Buffer, addr: Address) => Promise<void>;
    address(): import("net").AddressInfo;
    close: () => Promise<void>;
}
export declare class TcpTransport implements Transport {
    private addr;
    readonly type = "tcp";
    private connecting;
    private client;
    onData: (data: Buffer, addr: Address) => void;
    closed: boolean;
    private constructor();
    private connect;
    private init;
    static init(addr: Address): Promise<TcpTransport>;
    send: (data: Buffer, addr: Address) => Promise<void>;
    close: () => Promise<void>;
}
export interface Transport {
    type: string;
    onData: (data: Buffer, addr: Address) => void;
    send: (data: Buffer, addr: Address) => Promise<void>;
    close: () => Promise<void>;
}
