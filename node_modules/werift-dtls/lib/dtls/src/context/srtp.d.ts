import type { Profile } from "../imports/rtp";
export declare class SrtpContext {
    srtpProfile?: Profile;
    static findMatchingSRTPProfile(remote: Profile[], local: Profile[]): 1 | 7 | undefined;
}
