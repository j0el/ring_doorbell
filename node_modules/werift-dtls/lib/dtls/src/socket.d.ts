import { Event, type Transport } from "./imports/common";
import { type SignatureHash } from "./cipher/const";
import { type SessionTypes } from "./cipher/suites/abstract";
import { CipherContext } from "./context/cipher";
import { DtlsContext } from "./context/dtls";
import { SrtpContext } from "./context/srtp";
import { TransportContext } from "./context/transport";
import type { Profile } from "./imports/rtp";
import { FragmentedHandshake } from "./record/message/fragment";
import type { Extension } from "./typings/domain";
export declare class DtlsSocket {
    options: Options;
    sessionType: SessionTypes;
    readonly onConnect: Event<any[]>;
    readonly onData: Event<[Buffer]>;
    readonly onError: Event<[Error]>;
    readonly onClose: Event<any[]>;
    readonly transport: TransportContext;
    cipher: CipherContext;
    dtls: DtlsContext;
    srtp: SrtpContext;
    connected: boolean;
    extensions: Extension[];
    onHandleHandshakes: (assembled: FragmentedHandshake[]) => Promise<void>;
    private bufferFragmentedHandshakes;
    constructor(options: Options, sessionType: SessionTypes);
    renegotiation(): void;
    private udpOnMessage;
    private setupExtensions;
    protected waitForReady: (condition: () => boolean) => Promise<void>;
    handleFragmentHandshake(messages: FragmentedHandshake[]): FragmentedHandshake[];
    /**send application data */
    send: (buf: Buffer) => Promise<void>;
    close(): void;
    extractSessionKeys(keyLength: number, saltLength: number): {
        localKey: any;
        localSalt: any;
        remoteKey: any;
        remoteSalt: any;
    };
    exportKeyingMaterial(label: string, length: number): Buffer;
}
export interface Options {
    transport: Transport;
    srtpProfiles?: Profile[];
    cert?: string;
    key?: string;
    signatureHash?: SignatureHash;
    certificateRequest?: boolean;
    extendedMasterSecret?: boolean;
}
