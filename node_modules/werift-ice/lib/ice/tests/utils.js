"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readMessage = readMessage;
exports.inviteAccept = inviteAccept;
exports.assertCandidateTypes = assertCandidateTypes;
const assert_1 = require("assert");
const fs_1 = require("fs");
function readMessage(name) {
    let data;
    try {
        data = (0, fs_1.readFileSync)("./tests/data/" + name);
    }
    catch (error) {
        data = (0, fs_1.readFileSync)("./packages/ice/tests/data/" + name);
    }
    return data;
}
async function inviteAccept(a, b) {
    // # invite
    await a.gatherCandidates();
    b.remoteCandidates = a.localCandidates;
    b.remoteUsername = a.localUsername;
    b.remotePassword = a.localPassword;
    // # accept
    await b.gatherCandidates();
    a.remoteCandidates = b.localCandidates;
    a.remoteUsername = b.localUsername;
    a.remotePassword = b.localPassword;
}
function assertCandidateTypes(conn, expected) {
    const types = conn.localCandidates.map((v) => v.type);
    (0, assert_1.deepStrictEqual)(new Set(types), new Set(expected));
}
//# sourceMappingURL=utils.js.map