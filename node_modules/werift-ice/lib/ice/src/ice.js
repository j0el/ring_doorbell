"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Connection = void 0;
const crypto_1 = require("crypto");
const net_1 = require("net");
const Int64 = __importStar(require("int64-buffer"));
const isEqual_js_1 = __importDefault(require("lodash/isEqual.js"));
const promises_1 = __importDefault(require("timers/promises"));
const common_1 = require("./imports/common");
const candidate_1 = require("./candidate");
const lookup_1 = require("./dns/lookup");
const helper_1 = require("./helper");
const iceBase_1 = require("./iceBase");
const const_1 = require("./stun/const");
const message_1 = require("./stun/message");
const protocol_1 = require("./stun/protocol");
const protocol_2 = require("./turn/protocol");
const utils_1 = require("./utils");
const log = (0, common_1.debug)("werift-ice : packages/ice/src/ice.ts : log");
class Connection {
    constructor(_iceControlling, options) {
        Object.defineProperty(this, "_iceControlling", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: _iceControlling
        });
        Object.defineProperty(this, "localUsername", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (0, helper_1.randomString)(4)
        });
        Object.defineProperty(this, "localPassword", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (0, helper_1.randomString)(22)
        });
        Object.defineProperty(this, "remoteIsLite", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "remotePassword", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: ""
        });
        Object.defineProperty(this, "remoteUsername", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: ""
        });
        Object.defineProperty(this, "checkList", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "localCandidates", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "stunServer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "turnServer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "options", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "remoteCandidatesEnd", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "localCandidatesEnd", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "generation", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: -1
        });
        Object.defineProperty(this, "userHistory", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {}
        });
        Object.defineProperty(this, "tieBreaker", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: BigInt(new Int64.Uint64BE((0, crypto_1.randomBytes)(64)).toString())
        });
        Object.defineProperty(this, "state", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: "new"
        });
        Object.defineProperty(this, "lookup", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "_remoteCandidates", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        // P2P接続完了したソケット
        Object.defineProperty(this, "nominated", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "nominating", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "checkListDone", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "checkListState", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new helper_1.PQueue()
        });
        Object.defineProperty(this, "earlyChecks", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "earlyChecksDone", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "localCandidatesStart", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "protocols", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "queryConsentHandle", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "promiseGatherCandidates", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "onData", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new common_1.Event()
        });
        Object.defineProperty(this, "stateChanged", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new common_1.Event()
        });
        Object.defineProperty(this, "onIceCandidate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new common_1.Event()
        });
        // 4.1.1.4 ? 生存確認 life check
        Object.defineProperty(this, "queryConsent", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: () => {
                if (this.queryConsentHandle) {
                    this.queryConsentHandle.resolve();
                }
                this.queryConsentHandle = (0, helper_1.cancelable)(async (_, __, onCancel) => {
                    let failures = 0;
                    let canceled = false;
                    const cancelEvent = new AbortController();
                    onCancel.once(() => {
                        canceled = true;
                        failures += iceBase_1.CONSENT_FAILURES;
                        cancelEvent.abort();
                        this.queryConsentHandle = undefined;
                    });
                    const { localUsername, remoteUsername, iceControlling } = this;
                    // """
                    // Periodically check consent (RFC 7675).
                    // """
                    try {
                        while (this.state !== "closed" && !canceled) {
                            // # randomize between 0.8 and 1.2 times CONSENT_INTERVAL
                            await promises_1.default.setTimeout(iceBase_1.CONSENT_INTERVAL * (0.8 + 0.4 * Math.random()) * 1000, undefined, { signal: cancelEvent.signal });
                            const nominated = this.nominated;
                            if (!nominated || canceled) {
                                break;
                            }
                            const request = this.buildRequest({
                                nominate: false,
                                localUsername,
                                remoteUsername,
                                iceControlling,
                            });
                            try {
                                await nominated.protocol.request(request, nominated.remoteAddr, Buffer.from(this.remotePassword, "utf8"), 0);
                                failures = 0;
                                if (this.state === "disconnected") {
                                    this.setState("connected");
                                }
                            }
                            catch (error) {
                                if (nominated.id === this.nominated?.id) {
                                    log("no stun response");
                                    failures++;
                                    this.setState("disconnected");
                                    break;
                                }
                            }
                            if (failures >= iceBase_1.CONSENT_FAILURES) {
                                log("Consent to send expired");
                                this.queryConsentHandle = undefined;
                                this.setState("closed");
                                break;
                            }
                        }
                    }
                    catch (error) { }
                });
            }
        });
        Object.defineProperty(this, "send", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: async (data) => {
                const activePair = this.nominated;
                if (activePair) {
                    await activePair.protocol.sendData(data, activePair.remoteAddr);
                }
                else {
                    // log("Cannot send data, ice not connected");
                    return;
                }
            }
        });
        // 3.  Terminology : Check
        Object.defineProperty(this, "checkStart", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (pair) => (0, helper_1.cancelable)(async (r) => {
                // """
                // Starts a check.
                // """
                log("check start", pair.toJSON());
                pair.updateState(iceBase_1.CandidatePairState.IN_PROGRESS);
                const result = {};
                const { remotePassword, remoteUsername, generation } = this;
                const localUsername = pair.localCandidate.ufrag ?? this.localUsername;
                const nominate = this.iceControlling && !this.remoteIsLite;
                const request = this.buildRequest({
                    nominate,
                    localUsername,
                    remoteUsername,
                    iceControlling: this.iceControlling,
                });
                try {
                    const [response, addr] = await pair.protocol.request(request, pair.remoteAddr, Buffer.from(remotePassword, "utf8"), 4);
                    log("response received", request.toJSON(), response.toJSON(), addr, {
                        localUsername,
                        remoteUsername,
                        remotePassword,
                        generation,
                    });
                    result.response = response;
                    result.addr = addr;
                }
                catch (error) {
                    const exc = error;
                    // 7.1.3.1.  Failure Cases
                    log("failure case", request.toJSON(), exc.response ? JSON.stringify(exc.response.toJSON(), null, 2) : error, {
                        localUsername,
                        remoteUsername,
                        remotePassword,
                        generation,
                    });
                    if (exc.response?.getAttributeValue("ERROR-CODE")[0] === 487) {
                        if (request.attributesKeys.includes("ICE-CONTROLLED")) {
                            this.switchRole(true);
                        }
                        else if (request.attributesKeys.includes("ICE-CONTROLLING")) {
                            this.switchRole(false);
                        }
                        await this.checkStart(pair).awaitable;
                        r();
                        return;
                    }
                    if (exc.response?.getAttributeValue("ERROR-CODE")[0] === 401) {
                        log("retry 401", pair.toJSON());
                        await this.checkStart(pair).awaitable;
                        r();
                        return;
                    }
                    else {
                        // timeout
                        log("checkStart CandidatePairState.FAILED", pair.toJSON());
                        pair.updateState(iceBase_1.CandidatePairState.FAILED);
                        this.checkComplete(pair);
                        r();
                        return;
                    }
                }
                // # check remote address matches
                if (!(0, isEqual_js_1.default)(result.addr, pair.remoteAddr)) {
                    pair.updateState(iceBase_1.CandidatePairState.FAILED);
                    this.checkComplete(pair);
                    r();
                    return;
                }
                // # success
                if (nominate || pair.remoteNominated) {
                    // # nominated by agressive nomination or the remote party
                    pair.nominated = true;
                }
                else if (this.iceControlling && !this.nominating) {
                    // # perform regular nomination
                    this.nominating = true;
                    const request = this.buildRequest({
                        nominate: true,
                        localUsername,
                        remoteUsername,
                        iceControlling: this.iceControlling,
                    });
                    try {
                        await pair.protocol.request(request, pair.remoteAddr, Buffer.from(this.remotePassword, "utf8"));
                    }
                    catch (error) {
                        pair.updateState(iceBase_1.CandidatePairState.FAILED);
                        this.checkComplete(pair);
                        return;
                    }
                    pair.nominated = true;
                }
                pair.updateState(iceBase_1.CandidatePairState.SUCCEEDED);
                this.checkComplete(pair);
                r();
            })
        });
        Object.defineProperty(this, "pairRemoteCandidate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (remoteCandidate) => {
                for (const protocol of this.protocols) {
                    this.tryPair(protocol, remoteCandidate);
                }
            }
        });
        this.options = {
            ...iceBase_1.defaultOptions,
            ...options,
        };
        const { stunServer, turnServer } = this.options;
        this.stunServer = (0, iceBase_1.validateAddress)(stunServer) ?? [
            "stun.l.google.com",
            19302,
        ];
        this.turnServer = (0, iceBase_1.validateAddress)(turnServer);
        this.restart();
    }
    get iceControlling() {
        return this._iceControlling;
    }
    set iceControlling(value) {
        if (this.generation > 0 || this.nominated) {
            return;
        }
        this._iceControlling = value;
        for (const pair of this.checkList) {
            pair.iceControlling = value;
        }
    }
    async restart() {
        this.generation++;
        this.localUsername = (0, helper_1.randomString)(4);
        this.localPassword = (0, helper_1.randomString)(22);
        if (this.options.localPasswordPrefix) {
            this.localPassword =
                this.options.localPasswordPrefix +
                    this.localPassword.slice(this.options.localPasswordPrefix.length);
        }
        this.userHistory[this.localUsername] = this.localPassword;
        this.remoteUsername = "";
        this.remotePassword = "";
        this.localCandidates = [];
        this._remoteCandidates = [];
        this.remoteCandidatesEnd = false;
        this.localCandidatesEnd = false;
        this.state = "new";
        this.lookup?.close?.();
        this.lookup = undefined;
        this.nominated = undefined;
        this.nominating = false;
        this.checkList = [];
        this.checkListDone = false;
        this.checkListState = new helper_1.PQueue();
        this.earlyChecks = [];
        this.earlyChecksDone = false;
        this.localCandidatesStart = false;
        // protocolsはincomingのearlyCheckに使うかもしれないので残す
        for (const protocol of this.protocols) {
            if (protocol.localCandidate) {
                protocol.localCandidate.generation = this.generation;
                protocol.localCandidate.ufrag = this.localUsername;
            }
        }
        this.queryConsentHandle?.resolve?.();
        this.queryConsentHandle = undefined;
        this.promiseGatherCandidates = undefined;
    }
    resetNominatedPair() {
        log("resetNominatedPair");
        this.nominated = undefined;
        this.nominating = false;
    }
    setRemoteParams({ iceLite, usernameFragment, password, }) {
        log("setRemoteParams", { iceLite, usernameFragment, password });
        this.remoteIsLite = iceLite;
        this.remoteUsername = usernameFragment;
        this.remotePassword = password;
    }
    // 4.1.1 Gathering Candidates
    async gatherCandidates() {
        if (!this.localCandidatesStart) {
            this.localCandidatesStart = true;
            this.promiseGatherCandidates = new common_1.Event();
            let address = (0, utils_1.getHostAddresses)(this.options.useIpv4, this.options.useIpv6);
            const { interfaceAddresses } = this.options;
            if (interfaceAddresses) {
                const filteredAddresses = address.filter((check) => Object.values(interfaceAddresses).includes(check));
                if (filteredAddresses.length) {
                    address = filteredAddresses;
                }
            }
            if (this.options.additionalHostAddresses) {
                address = Array.from(new Set([...this.options.additionalHostAddresses, ...address]));
            }
            const candidates = await this.getCandidates(address, 5);
            this.localCandidates = [...this.localCandidates, ...candidates];
            this.localCandidatesEnd = true;
            this.promiseGatherCandidates.execute();
        }
        this.setState("completed");
    }
    ensureProtocol(protocol) {
        protocol.onRequestReceived.subscribe((msg, addr, data) => {
            if (msg.messageMethod !== const_1.methods.BINDING) {
                this.respondError(msg, addr, protocol, [400, "Bad Request"]);
                return;
            }
            const txUsername = msg.getAttributeValue("USERNAME");
            // 相手にとってのremoteは自分にとってのlocal
            const { remoteUsername: localUsername } = decodeTxUsername(txUsername);
            const localPassword = this.userHistory[localUsername] ?? this.localPassword;
            const { iceControlling } = this;
            // 7.2.1.1.  Detecting and Repairing Role Conflicts
            if (iceControlling && msg.attributesKeys.includes("ICE-CONTROLLING")) {
                if (this.tieBreaker >= msg.getAttributeValue("ICE-CONTROLLING")) {
                    this.respondError(msg, addr, protocol, [487, "Role Conflict"]);
                    return;
                }
                else {
                    this.switchRole(false);
                }
            }
            else if (!iceControlling &&
                msg.attributesKeys.includes("ICE-CONTROLLED")) {
                if (this.tieBreaker < msg.getAttributeValue("ICE-CONTROLLED")) {
                    this.respondError(msg, addr, protocol, [487, "Role Conflict"]);
                }
                else {
                    this.switchRole(true);
                    return;
                }
            }
            if (this.options.filterStunResponse &&
                !this.options.filterStunResponse(msg, addr, protocol)) {
                return;
            }
            // # send binding response
            const response = new message_1.Message(const_1.methods.BINDING, const_1.classes.RESPONSE, msg.transactionId);
            response
                .setAttribute("XOR-MAPPED-ADDRESS", addr)
                .addMessageIntegrity(Buffer.from(localPassword, "utf8"))
                .addFingerprint();
            protocol.sendStun(response, addr).catch((e) => {
                log("sendStun error", e);
            });
            if (this.checkList.length === 0 && !this.earlyChecksDone) {
                this.earlyChecks.push([msg, addr, protocol]);
            }
            else {
                this.checkIncoming(msg, addr, protocol);
            }
        });
        protocol.onDataReceived.subscribe((data) => {
            try {
                this.onData.execute(data);
            }
            catch (error) {
                log("dataReceived", error);
            }
        });
    }
    async getCandidates(addresses, timeout = 5) {
        let candidates = [];
        addresses = addresses.filter((address) => {
            // ice restartで同じアドレスが追加されるのを防ぐ
            if (this.protocols.find((protocol) => protocol.localIp === address)) {
                return false;
            }
            return true;
        });
        await Promise.allSettled(addresses.map(async (address) => {
            // # create transport
            const protocol = new protocol_1.StunProtocol();
            this.ensureProtocol(protocol);
            try {
                await protocol.connectionMade((0, net_1.isIPv4)(address), this.options.portRange, this.options.interfaceAddresses);
            }
            catch (error) {
                log("protocol STUN", error);
                return;
            }
            protocol.localIp = address;
            this.protocols.push(protocol);
            // # add host candidate
            const candidateAddress = [address, protocol.getExtraInfo()[1]];
            protocol.localCandidate = new candidate_1.Candidate((0, candidate_1.candidateFoundation)("host", "udp", candidateAddress[0]), 1, "udp", (0, candidate_1.candidatePriority)("host"), candidateAddress[0], candidateAddress[1], "host", undefined, undefined, undefined, this.generation, this.localUsername);
            this.pairLocalProtocol(protocol);
            candidates.push(protocol.localCandidate);
            this.onIceCandidate.execute(protocol.localCandidate);
        }));
        let candidatePromises = [];
        // # query STUN server for server-reflexive candidates (IPv4 only)
        const { stunServer, turnServer } = this;
        if (stunServer) {
            const stunPromises = this.protocols.map((protocol) => new Promise(async (r, f) => {
                const timer = setTimeout(f, timeout * 1000);
                if (protocol.localCandidate?.host &&
                    (0, net_1.isIPv4)(protocol.localCandidate?.host)) {
                    const candidate = await (0, iceBase_1.serverReflexiveCandidate)(protocol, stunServer).catch((error) => {
                        log("error", error);
                    });
                    if (candidate) {
                        this.onIceCandidate.execute(candidate);
                    }
                    clearTimeout(timer);
                    r(candidate);
                }
                else {
                    clearTimeout(timer);
                    r();
                }
            }).catch((error) => {
                log("query STUN server", error);
            }));
            candidatePromises.push(...stunPromises);
        }
        const { turnUsername, turnPassword } = this.options;
        if (turnServer && turnUsername && turnPassword) {
            const turnCandidate = (async () => {
                const protocol = await (0, protocol_2.createStunOverTurnClient)({
                    address: turnServer,
                    username: turnUsername,
                    password: turnPassword,
                }, {
                    portRange: this.options.portRange,
                    interfaceAddresses: this.options.interfaceAddresses,
                    transport: this.options.turnTransport === "tcp" ? "tcp" : "udp",
                }).catch(async (e) => {
                    if (this.options.turnTransport !== "tcp") {
                        return await (0, protocol_2.createStunOverTurnClient)({
                            address: turnServer,
                            username: turnUsername,
                            password: turnPassword,
                        }, {
                            portRange: this.options.portRange,
                            interfaceAddresses: this.options.interfaceAddresses,
                            transport: "tcp",
                        });
                    }
                    else {
                        throw e;
                    }
                });
                this.ensureProtocol(protocol);
                this.protocols.push(protocol);
                const candidateAddress = protocol.turn.relayedAddress;
                const relatedAddress = protocol.turn.mappedAddress;
                log("turn candidateAddress", candidateAddress);
                protocol.localCandidate = new candidate_1.Candidate((0, candidate_1.candidateFoundation)("relay", "udp", candidateAddress[0]), 1, "udp", (0, candidate_1.candidatePriority)("relay"), candidateAddress[0], candidateAddress[1], "relay", relatedAddress[0], relatedAddress[1], undefined, this.generation, this.localUsername);
                this.onIceCandidate.execute(protocol.localCandidate);
                return protocol.localCandidate;
            })().catch((error) => {
                log("query TURN server", error);
            });
            if (this.options.forceTurn) {
                candidates = [];
                candidatePromises = [];
            }
            candidatePromises.push(turnCandidate);
        }
        const extraCandidates = [...(await Promise.allSettled(candidatePromises))]
            .filter((v) => v.status === "fulfilled")
            .map((v) => v.value)
            .filter((v) => typeof v !== "undefined");
        candidates.push(...extraCandidates);
        return candidates;
    }
    async connect() {
        // """
        // Perform ICE handshake.
        //
        // This coroutine returns if a candidate pair was successfully nominated
        // and raises an exception otherwise.
        // """
        log("start connect ice");
        if (!this.localCandidatesEnd) {
            if (!this.localCandidatesStart) {
                throw new Error("Local candidates gathering was not performed");
            }
            if (this.promiseGatherCandidates) {
                // wait for GatherCandidates finish
                await this.promiseGatherCandidates.asPromise();
            }
        }
        if (!this.remoteUsername || !this.remotePassword) {
            throw new Error("Remote username or password is missing");
        }
        // # 5.7.1. Forming Candidate Pairs
        for (const c of this.remoteCandidates) {
            this.pairRemoteCandidate(c);
        }
        this.sortCheckList();
        this.unfreezeInitial();
        log("earlyChecks", this.localPassword, this.earlyChecks.length);
        // # handle early checks
        for (const earlyCheck of this.earlyChecks) {
            this.checkIncoming(...earlyCheck);
        }
        this.earlyChecks = [];
        this.earlyChecksDone = true;
        // # perform checks
        // 5.8.  Scheduling Checks
        for (;;) {
            if (this.state === "closed")
                break;
            if (!this.schedulingChecks())
                break;
            await promises_1.default.setTimeout(20);
        }
        // # wait for completion
        let res = iceBase_1.ICE_FAILED;
        while (this.checkList.length > 0 && res === iceBase_1.ICE_FAILED) {
            res = await this.checkListState.get();
        }
        // # cancel remaining checks
        for (const check of this.checkList) {
            check.handle?.resolve?.();
        }
        if (res !== iceBase_1.ICE_COMPLETED) {
            throw new Error("ICE negotiation failed");
        }
        // # start consent freshness tests
        this.queryConsent();
        this.setState("connected");
    }
    unfreezeInitial() {
        // # unfreeze first pair for the first component
        const [firstPair] = this.checkList;
        if (!firstPair)
            return;
        if (firstPair.state === iceBase_1.CandidatePairState.FROZEN) {
            firstPair.updateState(iceBase_1.CandidatePairState.WAITING);
        }
        // # unfreeze pairs with same component but different foundations
        const seenFoundations = new Set(firstPair.localCandidate.foundation);
        for (const pair of this.checkList) {
            if (pair.component === firstPair.component &&
                !seenFoundations.has(pair.localCandidate.foundation) &&
                pair.state === iceBase_1.CandidatePairState.FROZEN) {
                pair.updateState(iceBase_1.CandidatePairState.WAITING);
                seenFoundations.add(pair.localCandidate.foundation);
            }
        }
    }
    // 5.8 Scheduling Checks
    schedulingChecks() {
        // Ordinary Check
        {
            // # find the highest-priority pair that is in the waiting state
            const pair = this.checkList
                .filter((pair) => {
                if (this.options.forceTurn &&
                    pair.protocol.type === protocol_1.StunProtocol.type)
                    return false;
                return true;
            })
                .find((pair) => pair.state === iceBase_1.CandidatePairState.WAITING);
            if (pair) {
                pair.handle = this.checkStart(pair);
                return true;
            }
        }
        {
            // # find the highest-priority pair that is in the frozen state
            const pair = this.checkList.find((pair) => pair.state === iceBase_1.CandidatePairState.FROZEN);
            if (pair) {
                pair.handle = this.checkStart(pair);
                return true;
            }
        }
        // # if we expect more candidates, keep going
        if (!this.remoteCandidatesEnd) {
            return !this.checkListDone;
        }
        return false;
    }
    async close() {
        // """
        // Close the connection.
        // """
        this.setState("closed");
        // # stop consent freshness tests
        this.queryConsentHandle?.resolve?.();
        // # stop check list
        if (this.checkList && !this.checkListDone) {
            this.checkListState.put(new Promise((r) => {
                r(iceBase_1.ICE_FAILED);
            }));
        }
        this.nominated = undefined;
        for (const protocol of this.protocols) {
            if (protocol.close) {
                await protocol.close();
            }
        }
        this.protocols = [];
        this.localCandidates = [];
        this.lookup?.close?.();
        this.lookup = undefined;
    }
    setState(state) {
        this.state = state;
        this.stateChanged.execute(state);
    }
    async addRemoteCandidate(remoteCandidate) {
        // """
        // Add a remote candidate or signal end-of-candidates.
        // To signal end-of-candidates, pass `None`.
        // :param remote_candidate: A :class:`Candidate` instance or `None`.
        // """
        if (!remoteCandidate) {
            this.remoteCandidatesEnd = true;
            return;
        }
        if (remoteCandidate.host.includes(".local")) {
            try {
                if (!this.lookup) {
                    this.lookup = new lookup_1.MdnsLookup();
                }
                const host = await this.lookup.lookup(remoteCandidate.host);
                remoteCandidate.host = host;
            }
            catch (error) {
                return;
            }
        }
        try {
            (0, iceBase_1.validateRemoteCandidate)(remoteCandidate);
        }
        catch (error) {
            return;
        }
        log("addRemoteCandidate", remoteCandidate);
        this._remoteCandidates.push(remoteCandidate);
        this.pairRemoteCandidate(remoteCandidate);
        this.sortCheckList();
    }
    getDefaultCandidate() {
        const candidates = this.localCandidates.sort((a, b) => a.priority - b.priority);
        const [candidate] = candidates;
        return candidate;
    }
    // for test only
    set remoteCandidates(value) {
        if (this.remoteCandidatesEnd)
            throw new Error("Cannot set remote candidates after end-of-candidates.");
        this._remoteCandidates = [];
        for (const remoteCandidate of value) {
            try {
                (0, iceBase_1.validateRemoteCandidate)(remoteCandidate);
            }
            catch (error) {
                continue;
            }
            this._remoteCandidates.push(remoteCandidate);
        }
        this.remoteCandidatesEnd = true;
    }
    get remoteCandidates() {
        return this._remoteCandidates;
    }
    sortCheckList() {
        (0, iceBase_1.sortCandidatePairs)(this.checkList, this.iceControlling);
    }
    findPair(protocol, remoteCandidate) {
        const pair = this.checkList.find((pair) => (0, isEqual_js_1.default)(pair.protocol, protocol) &&
            (0, isEqual_js_1.default)(pair.remoteCandidate, remoteCandidate));
        return pair;
    }
    switchRole(iceControlling) {
        log("switch role", iceControlling);
        this.iceControlling = iceControlling;
        this.sortCheckList();
    }
    checkComplete(pair) {
        pair.handle = undefined;
        if (pair.state === iceBase_1.CandidatePairState.SUCCEEDED) {
            // Updating the Nominated Flag
            // https://www.rfc-editor.org/rfc/rfc8445#section-7.3.1.5,
            // Once the nominated flag is set for a component of a data stream, it
            // concludes the ICE processing for that component.  See Section 8.
            // So disallow overwriting of the pair nominated for that component
            if (pair.nominated &&
                // remoteのgenerationをチェックする.localのgenerationは更新が間に合わないかもしれないのでチェックしない
                (pair.remoteCandidate.generation != undefined
                    ? pair.remoteCandidate.generation === this.generation
                    : true) &&
                this.nominated == undefined) {
                log("nominated", pair.toJSON());
                this.nominated = pair;
                this.nominating = false;
                // 8.1.2.  Updating States
                // The agent MUST remove all Waiting and Frozen pairs in the check
                // list and triggered check queue for the same component as the
                // nominated pairs for that media stream.
                for (const p of this.checkList) {
                    if (p.component === pair.component &&
                        [iceBase_1.CandidatePairState.WAITING, iceBase_1.CandidatePairState.FROZEN].includes(p.state)) {
                        p.updateState(iceBase_1.CandidatePairState.FAILED);
                    }
                }
            }
            // Once there is at least one nominated pair in the valid list for
            // every component of at least one media stream and the state of the
            // check list is Running:
            if (this.nominated) {
                if (!this.checkListDone) {
                    log("ICE completed");
                    this.checkListState.put(new Promise((r) => r(iceBase_1.ICE_COMPLETED)));
                    this.checkListDone = true;
                }
                return;
            }
            log("not completed", pair.toJSON());
            // 7.1.3.2.3.  Updating Pair States
            for (const p of this.checkList) {
                if (p.localCandidate.foundation === pair.localCandidate.foundation &&
                    p.state === iceBase_1.CandidatePairState.FROZEN) {
                    p.updateState(iceBase_1.CandidatePairState.WAITING);
                }
            }
        }
        {
            const list = [iceBase_1.CandidatePairState.SUCCEEDED, iceBase_1.CandidatePairState.FAILED];
            if (this.checkList.find(({ state }) => !list.includes(state))) {
                return;
            }
        }
        if (!this.iceControlling) {
            const target = iceBase_1.CandidatePairState.SUCCEEDED;
            if (this.checkList.find(({ state }) => state === target)) {
                return;
            }
        }
        if (!this.checkListDone) {
            log("ICE failed");
            this.checkListState.put(new Promise((r) => {
                r(iceBase_1.ICE_FAILED);
            }));
        }
    }
    addPair(pair) {
        this.checkList.push(pair);
        this.sortCheckList();
    }
    // 7.2.  STUN Server Procedures
    // 7.2.1.3、7.2.1.4、および7.2.1.5
    checkIncoming(message, addr, protocol) {
        // """
        // Handle a successful incoming check.
        // """
        const txUsername = message.getAttributeValue("USERNAME");
        const { remoteUsername: localUsername } = decodeTxUsername(txUsername);
        // find remote candidate
        let remoteCandidate;
        const [host, port] = addr;
        for (const c of this.remoteCandidates) {
            if (c.host === host && c.port === port) {
                remoteCandidate = c;
                break;
            }
        }
        if (!remoteCandidate) {
            // 7.2.1.3.  Learning Peer Reflexive Candidates
            remoteCandidate = new candidate_1.Candidate((0, helper_1.randomString)(10), 1, "udp", message.getAttributeValue("PRIORITY"), host, port, "prflx", undefined, undefined, undefined, undefined, undefined);
            this._remoteCandidates.push(remoteCandidate);
        }
        // find pair
        let pair = this.findPair(protocol, remoteCandidate);
        if (!pair) {
            pair = new iceBase_1.CandidatePair(protocol, remoteCandidate, this.iceControlling);
            pair.updateState(iceBase_1.CandidatePairState.WAITING);
            this.addPair(pair);
        }
        pair.localCandidate.ufrag = localUsername;
        log("Triggered Checks", message.toJSON(), pair.toJSON(), {
            localUsername: this.localUsername,
            remoteUsername: this.remoteUsername,
            localPassword: this.localPassword,
            remotePassword: this.remotePassword,
            generation: this.generation,
        });
        // 7.2.1.4.  Triggered Checks
        if ([iceBase_1.CandidatePairState.WAITING, iceBase_1.CandidatePairState.FAILED].includes(pair.state)) {
            pair.handle = this.checkStart(pair);
        }
        else {
            pair;
        }
        // 7.2.1.5. Updating the Nominated Flag
        if (message.attributesKeys.includes("USE-CANDIDATE") &&
            !this.iceControlling) {
            pair.remoteNominated = true;
            if (pair.state === iceBase_1.CandidatePairState.SUCCEEDED) {
                pair.nominated = true;
                this.checkComplete(pair);
            }
        }
    }
    tryPair(protocol, remoteCandidate) {
        if (protocol.localCandidate?.canPairWith(remoteCandidate) &&
            !this.findPair(protocol, remoteCandidate)) {
            const pair = new iceBase_1.CandidatePair(protocol, remoteCandidate, this.iceControlling);
            if (this.options.filterCandidatePair &&
                !this.options.filterCandidatePair(pair)) {
                return;
            }
            pair.updateState(iceBase_1.CandidatePairState.WAITING);
            this.addPair(pair);
        }
    }
    pairLocalProtocol(protocol) {
        for (const remoteCandidate of this.remoteCandidates) {
            this.tryPair(protocol, remoteCandidate);
        }
    }
    buildRequest({ nominate, remoteUsername, localUsername, iceControlling, }) {
        const txUsername = encodeTxUsername({ remoteUsername, localUsername });
        const request = new message_1.Message(const_1.methods.BINDING, const_1.classes.REQUEST);
        request
            .setAttribute("USERNAME", txUsername)
            .setAttribute("PRIORITY", (0, candidate_1.candidatePriority)("prflx"));
        if (iceControlling) {
            request.setAttribute("ICE-CONTROLLING", this.tieBreaker);
            if (nominate) {
                request.setAttribute("USE-CANDIDATE", null);
            }
        }
        else {
            request.setAttribute("ICE-CONTROLLED", this.tieBreaker);
        }
        return request;
    }
    respondError(request, addr, protocol, errorCode) {
        const response = new message_1.Message(request.messageMethod, const_1.classes.ERROR, request.transactionId);
        response
            .setAttribute("ERROR-CODE", errorCode)
            .addMessageIntegrity(Buffer.from(this.localPassword, "utf8"))
            .addFingerprint();
        protocol.sendStun(response, addr).catch((e) => {
            log("sendStun error", e);
        });
    }
}
exports.Connection = Connection;
const encodeTxUsername = ({ remoteUsername, localUsername, }) => {
    return `${remoteUsername}:${localUsername}`;
};
const decodeTxUsername = (txUsername) => {
    const [remoteUsername, localUsername] = txUsername.split(":");
    return { remoteUsername, localUsername };
};
//# sourceMappingURL=ice.js.map