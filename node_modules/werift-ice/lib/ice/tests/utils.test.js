"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dgram_1 = require("dgram");
const src_1 = require("../../common/src");
const helper_1 = require("../src/helper");
const utils_1 = require("../src/utils");
describe("utils", () => {
    test("randomString", () => {
        expect((0, helper_1.randomString)(23).length).toBe(23);
    });
    test("findPort", async () => {
        const port = await (0, src_1.findPort)(1234, 10000, "udp4");
        const socket = (0, dgram_1.createSocket)("udp4");
        socket.bind(port);
        await new Promise((r) => {
            socket.once("listening", r);
        });
        socket.close();
    }, 60000);
    test("getGlobalIp", async () => {
        const gip = await (0, utils_1.getGlobalIp)();
        expect(gip).toBeTruthy();
    });
});
//# sourceMappingURL=utils.test.js.map