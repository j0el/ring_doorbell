"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// eslint-disable-next-line no-shadow
var CloseReasonCode;
(function (CloseReasonCode) {
    CloseReasonCode[CloseReasonCode["NormalClose"] = 0] = "NormalClose";
    // reason: { code: 5, text: '[rsl-apps/webrtc-liveview-server/Session.cpp:429] [Auth] [0xd540]: [rsl-apps/session-manager/Manager.cpp:227] [AppAuth] Unauthorized: invalid or expired token' }
    // reason: { code: 5, text: 'Authentication failed: -1' }
    // reason: { code: 5, text: 'Sessions with the provided ID not found' }
    CloseReasonCode[CloseReasonCode["AuthenticationFailed"] = 5] = "AuthenticationFailed";
    // reason: { code: 6, text: 'Timeout waiting for ping' }
    CloseReasonCode[CloseReasonCode["Timeout"] = 6] = "Timeout";
})(CloseReasonCode || (CloseReasonCode = {}));
