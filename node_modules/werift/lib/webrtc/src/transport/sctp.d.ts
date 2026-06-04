import { Event } from "../imports/common";
import { SCTP } from "../../../sctp/src";
import { RTCDataChannel } from "../dataChannel";
import type { RTCDtlsTransport } from "./dtls";
export declare class RTCSctpTransport {
    port: number;
    dtlsTransport: RTCDtlsTransport;
    sctp: SCTP;
    readonly onDataChannel: Event<[RTCDataChannel]>;
    readonly id: string;
    mid?: string;
    mLineIndex?: number;
    bundled: boolean;
    dataChannels: {
        [key: number]: RTCDataChannel;
    };
    private dataChannelQueue;
    private dataChannelId?;
    private eventDisposer;
    constructor(port?: number);
    setDtlsTransport(dtlsTransport: RTCDtlsTransport): void;
    private get isServer();
    channelByLabel(label: string): RTCDataChannel | undefined;
    private datachannelReceive;
    dataChannelAddNegotiated(channel: RTCDataChannel): void;
    dataChannelOpen(channel: RTCDataChannel): void;
    private dataChannelFlush;
    datachannelSend: (channel: RTCDataChannel, data: Buffer | string) => void;
    static getCapabilities(): RTCSctpCapabilities;
    setRemotePort(port: number): void;
    start(remotePort: number): Promise<void>;
    stop(): Promise<void>;
    dataChannelClose(channel: RTCDataChannel): void;
}
export declare class RTCSctpCapabilities {
    maxMessageSize: number;
    constructor(maxMessageSize: number);
}
