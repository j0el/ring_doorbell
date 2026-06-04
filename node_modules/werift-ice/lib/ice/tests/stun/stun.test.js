"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const const_1 = require("../../src/stun/const");
const message_1 = require("../../src/stun/message");
const transaction_1 = require("../../src/stun/transaction");
const utils_1 = require("../utils");
describe("stun", () => {
    test("test_binding_request", () => {
        const data = (0, utils_1.readMessage)("binding_request.bin");
        const message = (0, message_1.parseMessage)(data);
        expect(message.messageMethod).toBe(const_1.methods.BINDING);
        expect(message.messageClass).toBe(const_1.classes.REQUEST);
        expect(message.transactionId).toEqual(Buffer.from("Nvfx3lU7FUBF"));
        expect(message.getAttributes()).toEqual([]);
    });
    test("test_binding_request_ice_controlled", () => {
        const data = (0, utils_1.readMessage)("binding_request_ice_controlled.bin");
        const message = (0, message_1.parseMessage)(data);
        expect(message.messageMethod).toBe(const_1.methods.BINDING);
        expect(message.messageClass).toBe(const_1.classes.REQUEST);
        expect(message.transactionId).toEqual(Buffer.from("wxaNbAdXjwG3"));
        expect(message.getAttributes()).toEqual([
            ["USERNAME", "AYeZ:sw7YvCSbcVex3bhi"],
            ["PRIORITY", 1685987071],
            ["SOFTWARE", "FreeSWITCH (-37-987c9b9 64bit)"],
            ["ICE-CONTROLLED", BigInt("5491930053772927353")],
            [
                "MESSAGE-INTEGRITY",
                Buffer.from("1963108a4f764015a66b3fea0b1883dfde1436c8", "hex"),
            ],
            ["FINGERPRINT", 3230414530],
        ]);
    });
    test("test_binding_request_ice_controlled_bad_fingerprint", () => {
        const data = Buffer.concat([
            (0, utils_1.readMessage)("binding_request_ice_controlled.bin").slice(0, -1),
            Buffer.from("z"),
        ]);
        try {
            (0, message_1.parseMessage)(data);
        }
        catch (error) {
            expect(error.message).toBe("STUN message fingerprint does not match");
        }
    });
    test("test_binding_request_ice_controlled_bad_integrity", () => {
        const data = (0, utils_1.readMessage)("binding_request_ice_controlled.bin");
        try {
            (0, message_1.parseMessage)(data, Buffer.from("bogus-key"));
        }
        catch (error) {
            expect(error.message).toBe("STUN message integrity does not match");
        }
    });
    test("test_binding_request_ice_controlling", () => {
        const data = (0, utils_1.readMessage)("binding_request_ice_controlling.bin");
        const message = (0, message_1.parseMessage)(data);
        expect(message.messageMethod).toBe(const_1.methods.BINDING);
        expect(message.messageClass).toBe(const_1.classes.REQUEST);
        expect(message.transactionId).toEqual(Buffer.from("JEwwUxjLWaa2"));
        expect(message.getAttributes()).toEqual([
            ["USERNAME", "sw7YvCSbcVex3bhi:AYeZ"],
            ["ICE-CONTROLLING", BigInt("5943294521425135761")],
            ["USE-CANDIDATE", null],
            ["PRIORITY", 1853759231],
            [
                "MESSAGE-INTEGRITY",
                Buffer.from("c87b58eccbacdbc075d497ad0c965a82937ab587", "hex"),
            ],
            ["FINGERPRINT", 1347006354],
        ]);
    });
    test("test_binding_response", () => {
        const data = (0, utils_1.readMessage)("binding_response.bin");
        const message = (0, message_1.parseMessage)(data);
        expect(message.messageMethod).toBe(const_1.methods.BINDING);
        expect(message.messageClass).toBe(const_1.classes.RESPONSE);
        expect(message.transactionId).toEqual(Buffer.from("Nvfx3lU7FUBF"));
        expect(message.getAttributes()).toEqual([
            ["XOR-MAPPED-ADDRESS", ["80.200.136.90", 53054]],
            ["MAPPED-ADDRESS", ["80.200.136.90", 53054]],
            ["RESPONSE-ORIGIN", ["52.17.36.97", 3478]],
            ["OTHER-ADDRESS", ["52.17.36.97", 3479]],
            ["SOFTWARE", "Citrix-3.2.4.5 'Marshal West'"],
        ]);
    });
    test("test_message_body_length_mismatch", () => {
        const data = Buffer.concat([
            (0, utils_1.readMessage)("binding_response.bin"),
            Buffer.from("123"),
        ]);
        try {
            (0, message_1.parseMessage)(data);
        }
        catch (error) {
            expect(error.message).toBe("STUN message length does not match");
        }
    });
    test("test_message_shorter_than_header", () => {
        try {
            (0, message_1.parseMessage)(Buffer.from("123"));
        }
        catch (error) {
            expect(error.message).toBe("STUN message length is less than 20 bytes");
        }
    });
    test("test_timeout", async () => {
        const DummyProtocol = { sendStun: async () => { } };
        const request = new message_1.Message(const_1.methods.BINDING, const_1.classes.REQUEST);
        const transaction = new transaction_1.Transaction(request, ["127.0.0.1", 1234], DummyProtocol);
        try {
            await transaction.run();
        }
        catch (error) {
            expect(error.str).toBe("STUN transaction timed out");
        }
        const response = new message_1.Message(const_1.methods.BINDING, const_1.classes.RESPONSE);
        transaction.responseReceived(response, ["127.0.0.1", 1234]);
    }, 60 * 1000);
    test("test_bytes", () => {
        const request = new message_1.Message(const_1.methods.BINDING, const_1.classes.REQUEST);
        const bytes = request.bytes;
        const message = (0, message_1.parseMessage)(bytes);
        expect(request).toEqual(message);
    });
});
//# sourceMappingURL=stun.test.js.map