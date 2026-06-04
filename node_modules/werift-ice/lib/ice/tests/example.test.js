"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const src_1 = require("../src");
test("example", async () => {
    const a = new src_1.Connection(true, {
        stunServer: ["stun.l.google.com", 19302],
    });
    const b = new src_1.Connection(false, {
        stunServer: ["stun.l.google.com", 19302],
    });
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
    // # connect
    await Promise.all([a.connect(), b.connect()]);
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
//# sourceMappingURL=example.test.js.map