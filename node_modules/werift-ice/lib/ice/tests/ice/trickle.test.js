"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("timers/promises");
const src_1 = require("../../src");
const utils_1 = require("../utils");
describe("IceTrickleTest", () => {
    test("test_trickle_connect", async () => {
        const a = new src_1.Connection(true);
        a.stunServer = undefined;
        const b = new src_1.Connection(false);
        b.stunServer = undefined;
        await a.gatherCandidates();
        b.remoteUsername = a.localUsername;
        b.remotePassword = a.localPassword;
        await b.gatherCandidates();
        a.remoteUsername = b.localUsername;
        a.remotePassword = b.localPassword;
        (0, utils_1.assertCandidateTypes)(a, ["host"]);
        (0, utils_1.assertCandidateTypes)(b, ["host"]);
        const candidate = a.getDefaultCandidate();
        expect(candidate).not.toBeUndefined();
        expect(candidate.type).toBe("host");
        const addCandidatesLater = async (a, b) => {
            await (0, promises_1.setTimeout)(100);
            for (const candidate of b.localCandidates) {
                a.addRemoteCandidate(candidate);
                await (0, promises_1.setTimeout)(100);
            }
            a.addRemoteCandidate(undefined);
        };
        await Promise.all([
            a.connect(),
            b.connect(),
            addCandidatesLater(a, b),
            addCandidatesLater(b, a),
        ]);
        // # send data a -> b
        await a.send(Buffer.from("howdee"));
        let [data] = await b.onData.asPromise();
        expect(data.toString()).toBe("howdee");
        // # send data b -> a
        await b.send(Buffer.from("gotcha"));
        [data] = await a.onData.asPromise();
        expect(data.toString()).toBe("gotcha");
        await a.close();
        await b.close();
    });
});
//# sourceMappingURL=trickle.test.js.map