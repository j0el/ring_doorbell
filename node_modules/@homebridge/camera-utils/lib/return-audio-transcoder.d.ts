/// <reference types="node" />
import { RtpSplitter } from './rtp-splitter';
import { FfmpegProcess, FfmpegProcessOptions } from './ffmpeg-process';
interface Source {
    srtp_key: Buffer;
    srtp_salt: Buffer;
}
interface PrepareStreamRequest {
    targetAddress: string;
    addressVersion: 'ipv4' | 'ipv6';
    audio: Source;
}
interface StartStreamRequest {
    audio: {
        codec: 'OPUS' | 'AAC_eld' | string;
        channel: number;
        sample_rate: number;
        pt: number;
    };
}
export declare class ReturnAudioTranscoder {
    private options;
    readonly returnRtpSplitter: RtpSplitter;
    private startStreamRequest;
    readonly ffmpegProcess: FfmpegProcess;
    readonly reservedPortsPromise: Promise<number[]>;
    constructor(options: {
        outputArgs: (string | number)[];
        prepareStreamRequest: PrepareStreamRequest;
        incomingAudioOptions: {
            ssrc: number;
            rtcpPort: number;
        };
        returnAudioSplitter?: RtpSplitter;
        startStreamRequest?: StartStreamRequest;
    } & Omit<FfmpegProcessOptions, 'ffmpegArgs'>);
    start(): Promise<number>;
    stop(): void;
}
export {};
