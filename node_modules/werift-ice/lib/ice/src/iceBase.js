"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultOptions = exports.CandidatePairState = exports.CONSENT_FAILURES = exports.CONSENT_INTERVAL = exports.ICE_FAILED = exports.ICE_COMPLETED = exports.CandidatePair = void 0;
exports.validateRemoteCandidate = validateRemoteCandidate;
exports.sortCandidatePairs = sortCandidatePairs;
exports.candidatePairPriority = candidatePairPriority;
exports.serverReflexiveCandidate = serverReflexiveCandidate;
exports.validateAddress = validateAddress;
const crypto_1 = require("crypto");
const candidate_1 = require("./candidate");
const common_1 = require("./imports/common");
const const_1 = require("./stun/const");
const message_1 = require("./stun/message");
const log = (0, common_1.debug)("werift-ice : packages/ice/src/ice.ts : log");
class CandidatePair {
    get state() {
        return this._state;
    }
    toJSON() {
        return this.json;
    }
    get json() {
        return {
            protocol: this.protocol.type,
            localCandidate: this.localCandidate.toSdp(),
            remoteCandidate: this.remoteCandidate.toSdp(),
        };
    }
    constructor(protocol, remoteCandidate, iceControlling) {
        Object.defineProperty(this, "protocol", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: protocol
        });
        Object.defineProperty(this, "remoteCandidate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: remoteCandidate
        });
        Object.defineProperty(this, "iceControlling", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: iceControlling
        });
        Object.defineProperty(this, "id", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (0, crypto_1.randomUUID)()
        });
        Object.defineProperty(this, "handle", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "nominated", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "remoteNominated", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        // 5.7.4.  Computing States
        Object.defineProperty(this, "_state", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: CandidatePairState.FROZEN
        });
    }
    updateState(state) {
        this._state = state;
    }
    get localCandidate() {
        if (!this.protocol.localCandidate) {
            throw new Error("localCandidate not exist");
        }
        return this.protocol.localCandidate;
    }
    get remoteAddr() {
        return [this.remoteCandidate.host, this.remoteCandidate.port];
    }
    get component() {
        return this.localCandidate.component;
    }
    get priority() {
        return candidatePairPriority(this.localCandidate, this.remoteCandidate, this.iceControlling);
    }
}
exports.CandidatePair = CandidatePair;
exports.ICE_COMPLETED = 1;
exports.ICE_FAILED = 2;
exports.CONSENT_INTERVAL = 5;
exports.CONSENT_FAILURES = 6;
var CandidatePairState;
(function (CandidatePairState) {
    CandidatePairState[CandidatePairState["FROZEN"] = 0] = "FROZEN";
    CandidatePairState[CandidatePairState["WAITING"] = 1] = "WAITING";
    CandidatePairState[CandidatePairState["IN_PROGRESS"] = 2] = "IN_PROGRESS";
    CandidatePairState[CandidatePairState["SUCCEEDED"] = 3] = "SUCCEEDED";
    CandidatePairState[CandidatePairState["FAILED"] = 4] = "FAILED";
})(CandidatePairState || (exports.CandidatePairState = CandidatePairState = {}));
exports.defaultOptions = {
    useIpv4: true,
    useIpv6: true,
};
function validateRemoteCandidate(candidate) {
    // """
    // Check the remote candidate is supported.
    // """
    if (!["host", "relay", "srflx"].includes(candidate.type))
        throw new Error(`Unexpected candidate type "${candidate.type}"`);
    // ipaddress.ip_address(candidate.host)
    return candidate;
}
function sortCandidatePairs(pairs, iceControlling) {
    return pairs
        .sort((a, b) => candidatePairPriority(a.localCandidate, a.remoteCandidate, iceControlling) -
        candidatePairPriority(b.localCandidate, b.remoteCandidate, iceControlling))
        .reverse();
}
// 5.7.2.  Computing Pair Priority and Ordering Pairs
function candidatePairPriority(local, remote, iceControlling) {
    const G = (iceControlling && local.priority) || remote.priority;
    const D = (iceControlling && remote.priority) || local.priority;
    return (1 << 32) * Math.min(G, D) + 2 * Math.max(G, D) + (G > D ? 1 : 0);
}
async function serverReflexiveCandidate(protocol, stunServer) {
    // """
    // Query STUN server to obtain a server-reflexive candidate.
    // """
    // # perform STUN query
    const request = new message_1.Message(const_1.methods.BINDING, const_1.classes.REQUEST);
    try {
        const [response] = await protocol.request(request, stunServer);
        const localCandidate = protocol.localCandidate;
        if (!localCandidate) {
            throw new Error("not exist");
        }
        const candidate = new candidate_1.Candidate((0, candidate_1.candidateFoundation)("srflx", "udp", localCandidate.host), localCandidate.component, localCandidate.transport, (0, candidate_1.candidatePriority)("srflx"), response.getAttributeValue("XOR-MAPPED-ADDRESS")[0], response.getAttributeValue("XOR-MAPPED-ADDRESS")[1], "srflx", localCandidate.host, localCandidate.port);
        return candidate;
    }
    catch (error) {
        // todo fix
        log("error serverReflexiveCandidate", error);
    }
}
function validateAddress(addr) {
    if (addr && Number.isNaN(addr[1])) {
        return [addr[0], 443];
    }
    return addr;
}
//# sourceMappingURL=iceBase.js.map