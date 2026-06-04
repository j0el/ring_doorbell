import { RingCamera } from '../ring-camera';
import { RingRestClient } from '../rest-client';
export declare class SimpleWebRtcSession {
    private readonly camera;
    private restClient;
    readonly sessionId: string;
    constructor(camera: RingCamera, restClient: RingRestClient);
    start(sdp: string): Promise<string>;
    end(): Promise<any>;
    activateCameraSpeaker(): Promise<void>;
}
