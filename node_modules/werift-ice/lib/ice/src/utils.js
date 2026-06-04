"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.url2Address = void 0;
exports.getGlobalIp = getGlobalIp;
exports.getHostAddresses = getHostAddresses;
const os_1 = __importDefault(require("os"));
const ip_1 = __importDefault(require("ip"));
const common_1 = require("./imports/common");
const const_1 = require("./stun/const");
const message_1 = require("./stun/message");
const protocol_1 = require("./stun/protocol");
async function getGlobalIp(stunServer, interfaceAddresses) {
    const protocol = new protocol_1.StunProtocol();
    await protocol.connectionMade(true, undefined, interfaceAddresses);
    const request = new message_1.Message(const_1.methods.BINDING, const_1.classes.REQUEST);
    const [response] = await protocol.request(request, stunServer ?? ["stun.l.google.com", 19302]);
    await protocol.close();
    const address = response.getAttributeValue("XOR-MAPPED-ADDRESS");
    return address[0];
}
function isAutoconfigurationAddress(info) {
    return ((0, common_1.normalizeFamilyNodeV18)(info.family) === 4 &&
        info.address?.startsWith("169.254."));
}
function nodeIpAddress(family) {
    // https://chromium.googlesource.com/external/webrtc/+/master/rtc_base/network.cc#236
    const costlyNetworks = ["ipsec", "tun", "utun", "tap"];
    const banNetworks = ["vmnet", "veth"];
    const interfaces = os_1.default.networkInterfaces();
    const all = Object.keys(interfaces)
        .map((nic) => {
        for (const word of [...costlyNetworks, ...banNetworks]) {
            if (nic.startsWith(word)) {
                return {
                    nic,
                    addresses: [],
                };
            }
        }
        const addresses = interfaces[nic].filter((details) => (0, common_1.normalizeFamilyNodeV18)(details.family) === family &&
            !ip_1.default.isLoopback(details.address) &&
            !isAutoconfigurationAddress(details));
        return {
            nic,
            addresses: addresses.map((address) => address.address),
        };
    })
        .filter((address) => !!address);
    // os.networkInterfaces doesn't actually return addresses in a good order.
    // have seen instances where en0 (ethernet) is after en1 (wlan), etc.
    // eth0 > eth1
    all.sort((a, b) => a.nic.localeCompare(b.nic));
    return Object.values(all).flatMap((entry) => entry.addresses);
}
function getHostAddresses(useIpv4, useIpv6) {
    const address = [];
    if (useIpv4)
        address.push(...nodeIpAddress(4));
    if (useIpv6)
        address.push(...nodeIpAddress(6));
    return address;
}
const url2Address = (url) => {
    if (!url)
        return;
    const [address, port] = url.split(":");
    return [address, Number.parseInt(port)];
};
exports.url2Address = url2Address;
//# sourceMappingURL=utils.js.map