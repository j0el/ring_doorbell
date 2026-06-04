import { type ChildProcess } from "child_process";
import { MediaStreamTrack } from "../media/track";
export declare const getUserMedia: ({ path, loop, width, height, }: {
    path: string;
    loop?: boolean;
    width?: number;
    height?: number;
}) => Promise<MediaPlayerMp4 | MediaPlayerWebm>;
declare abstract class MediaPlayer {
    protected props: {
        videoPort: number;
        audioPort: number;
        path: string;
        loop?: boolean;
        width?: number;
        height?: number;
    };
    protected streamId: string;
    audio: MediaStreamTrack;
    video: MediaStreamTrack;
    protected process: ChildProcess;
    stopped: boolean;
    constructor(props: {
        videoPort: number;
        audioPort: number;
        path: string;
        loop?: boolean;
        width?: number;
        height?: number;
    });
    private setupTrack;
    stop(): void;
}
export declare class MediaPlayerMp4 extends MediaPlayer {
    start(): Promise<void>;
}
export declare class MediaPlayerWebm extends MediaPlayer {
    start(): Promise<void>;
}
export {};
