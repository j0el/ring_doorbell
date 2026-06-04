import { Candidate } from "./candidate";
import type { MdnsLookup } from "./dns/lookup";
import type { Cancelable } from "./helper";
import { type Address, type Event, type InterfaceAddresses } from "./imports/common";
import { Message } from "./stun/message";
import type { Protocol } from "./types/model";
export interface IceConnection {
    iceControlling: boolean;
    localUsername: string;
    localPassword: string;
    remotePassword: string;
    remoteUsername: string;
    remoteIsLite: boolean;
    checkList: CandidatePair[];
    localCandidates: Candidate[];
    stunServer?: Address;
    turnServer?: Address;
    generation: number;
    options: IceOptions;
    remoteCandidatesEnd: boolean;
    localCandidatesEnd: boolean;
    state: IceState;
    lookup?: MdnsLookup;
    nominated?: CandidatePair;
    readonly onData: Event<[Buffer]>;
    readonly stateChanged: Event<[IceState]>;
    readonly onIceCandidate: Event<[Candidate]>;
    restart(): void;
    setRemoteParams(params: {
        iceLite: boolean;
        usernameFragment: string;
        password: string;
    }): void;
    gatherCandidates(): Promise<void>;
    connect(): Promise<void>;
    close(): Promise<void>;
    addRemoteCandidate(remoteCandidate: Candidate | undefined): Promise<void>;
    send(data: Buffer): Promise<void>;
    getDefaultCandidate(): Candidate | undefined;
    resetNominatedPair(): void;
}
export declare class CandidatePair {
    protocol: Protocol;
    remoteCandidate: Candidate;
    iceControlling: boolean;
    readonly id: `${string}-${string}-${string}-${string}-${string}`;
    handle?: Cancelable<void>;
    nominated: boolean;
    remoteNominated: boolean;
    private _state;
    get state(): CandidatePairState;
    toJSON(): {
        protocol: string;
        localCandidate: string;
        remoteCandidate: string;
    };
    get json(): {
        protocol: string;
        localCandidate: string;
        remoteCandidate: string;
    };
    constructor(protocol: Protocol, remoteCandidate: Candidate, iceControlling: boolean);
    updateState(state: CandidatePairState): void;
    get localCandidate(): Candidate;
    get remoteAddr(): Address;
    get component(): number;
    get priority(): number;
}
export declare const ICE_COMPLETED: 1;
export declare const ICE_FAILED: 2;
export declare const CONSENT_INTERVAL = 5;
export declare const CONSENT_FAILURES = 6;
export declare enum CandidatePairState {
    FROZEN = 0,
    WAITING = 1,
    IN_PROGRESS = 2,
    SUCCEEDED = 3,
    FAILED = 4
}
export type IceState = "disconnected" | "closed" | "completed" | "new" | "connected";
export interface IceOptions {
    stunServer?: Address;
    turnServer?: Address;
    turnUsername?: string;
    turnPassword?: string;
    turnTransport?: "udp" | "tcp";
    forceTurn?: boolean;
    localPasswordPrefix?: string;
    useIpv4: boolean;
    useIpv6: boolean;
    portRange?: [number, number];
    interfaceAddresses?: InterfaceAddresses;
    additionalHostAddresses?: string[];
    filterStunResponse?: (message: Message, addr: Address, protocol: Protocol) => boolean;
    filterCandidatePair?: (pair: CandidatePair) => boolean;
}
export declare const defaultOptions: IceOptions;
export declare function validateRemoteCandidate(candidate: Candidate): Candidate;
export declare function sortCandidatePairs(pairs: {
    localCandidate: Pick<Candidate, "priority">;
    remoteCandidate: Pick<Candidate, "priority">;
}[], iceControlling: boolean): {
    localCandidate: Pick<Candidate, "priority">;
    remoteCandidate: Pick<Candidate, "priority">;
}[];
export declare function candidatePairPriority(local: Pick<Candidate, "priority">, remote: Pick<Candidate, "priority">, iceControlling: boolean): number;
export declare function serverReflexiveCandidate(protocol: Protocol, stunServer: Address): Promise<Candidate | undefined>;
export declare function validateAddress(addr?: Address): Address | undefined;
