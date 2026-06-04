import { IntercomHandsetAudioData, PushNotification } from './ring-types';
import { RingRestClient } from './rest-client';
import { BehaviorSubject, Subject } from 'rxjs';
export declare class RingIntercom {
    private initialData;
    private restClient;
    id: number;
    deviceType: import("./ring-types").RingDeviceType.IntercomHandsetAudio;
    onData: BehaviorSubject<IntercomHandsetAudioData>;
    onRequestUpdate: Subject<unknown>;
    onBatteryLevel: import("rxjs").Observable<number | null>;
    onDing: Subject<void>;
    onUnlocked: Subject<void>;
    constructor(initialData: IntercomHandsetAudioData, restClient: RingRestClient);
    updateData(update: IntercomHandsetAudioData): void;
    requestUpdate(): void;
    get data(): IntercomHandsetAudioData;
    get name(): string;
    get isOffline(): boolean;
    get batteryLevel(): number | null;
    unlock(): Promise<import("./rest-client").ExtendedResponse>;
    private doorbotUrl;
    subscribeToDingEvents(): Promise<void & import("./rest-client").ExtendedResponse>;
    unsubscribeFromDingEvents(): Promise<void & import("./rest-client").ExtendedResponse>;
    processPushNotification(notification: PushNotification): void;
}
