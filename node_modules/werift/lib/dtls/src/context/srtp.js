"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Profiles = exports.ProtectionProfileAeadAes128Gcm = exports.ProtectionProfileAes128CmHmacSha1_80 = exports.SrtpContext = void 0;
class SrtpContext {
    constructor() {
        Object.defineProperty(this, "srtpProfile", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
    }
    static findMatchingSRTPProfile(remote, local) {
        for (const v of local) {
            if (remote.includes(v))
                return v;
        }
    }
}
exports.SrtpContext = SrtpContext;
exports.ProtectionProfileAes128CmHmacSha1_80 = 0x0001;
exports.ProtectionProfileAeadAes128Gcm = 0x0007;
exports.Profiles = [
    exports.ProtectionProfileAes128CmHmacSha1_80,
    exports.ProtectionProfileAeadAes128Gcm,
];
//# sourceMappingURL=srtp.js.map