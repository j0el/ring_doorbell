"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReturnAudioTranscoder = void 0;
const rtp_splitter_1 = require("./rtp-splitter");
const ffmpeg_process_1 = require("./ffmpeg-process");
const srtp_1 = require("./srtp");
const ports_1 = require("./ports");
const rtp_1 = require("./rtp");
const defaultStartStreamReqeuest = {
    audio: {
        codec: 'AAC_eld',
        channel: 1,
        sample_rate: 16,
        pt: 110,
    },
};
class ReturnAudioTranscoder {
    constructor(options) {
        this.options = options;
        this.startStreamRequest = this.options.startStreamRequest || defaultStartStreamReqeuest;
        this.ffmpegProcess = new ffmpeg_process_1.FfmpegProcess(Object.assign({ ffmpegArgs: [
                '-hide_banner',
                '-protocol_whitelist',
                'pipe,udp,rtp,file,crypto',
                '-f',
                'sdp',
                '-acodec',
                this.startStreamRequest.audio.codec === 'OPUS' ? 'libopus' : 'libfdk_aac',
                '-i',
                'pipe:',
                '-map',
                '0:0',
                ...this.options.outputArgs,
            ] }, this.options));
        this.reservedPortsPromise = (0, ports_1.reservePorts)({ count: 2 });
        // allow return audio splitter to be passed in if you want to create one in the prepare stream phase, and create the transcoder in the stream request phase
        this.returnRtpSplitter = options.returnAudioSplitter || new rtp_splitter_1.RtpSplitter();
    }
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            const [rtpPort, rtcpPort] = yield this.reservedPortsPromise, { targetAddress, addressVersion, audio: { srtp_key: srtpKey, srtp_salt: srtpSalt }, } = this.options.prepareStreamRequest, { ssrc: incomingAudioSsrc, rtcpPort: incomingAudioRtcpPort } = this.options.incomingAudioOptions, { codec, sample_rate, channel, pt: packetType, } = this.startStreamRequest.audio;
            this.ffmpegProcess.writeStdin(
            // This SDP was generated using ffmpeg, and describes the type of packets we expect to receive from HomeKit.
            [
                'v=0',
                'o=- 0 0 IN IP4 127.0.0.1',
                's=Talk',
                `c=IN ${addressVersion
                    .replace('v', '')
                    .toUpperCase()} ${targetAddress}`,
                't=0 0',
                'a=tool:libavformat 58.38.100',
                `m=audio ${rtpPort} RTP/AVP ${packetType}`,
                'b=AS:24',
                ...(codec === 'OPUS'
                    ? [
                        `a=rtpmap:${packetType} opus/${sample_rate}000/${channel}`,
                        `a=fmtp:${packetType} minptime=10;useinbandfec=1`,
                    ]
                    : [
                        `a=rtpmap:${packetType} MPEG4-GENERIC/${sample_rate}000/${channel}`,
                        `a=fmtp:${packetType} profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; config=F8F0212C00BC00`,
                    ]),
                (0, srtp_1.createCryptoLine)({
                    srtpKey,
                    srtpSalt,
                }),
            ].join('\n'));
            this.returnRtpSplitter.addMessageHandler(({ isRtpMessage, message }) => {
                // This splitter will receive all audio-related packets from HomeKit.
                // This includes RTP + RTCP for return audio, as well as RTCP for incoming audio
                if (!isRtpMessage && (0, rtp_1.getSsrc)(message) === incomingAudioSsrc) {
                    return {
                        port: incomingAudioRtcpPort,
                    };
                }
                return {
                    port: isRtpMessage ? rtpPort : rtcpPort,
                };
            });
            // this is the port that needs to be passed to homebridge as audio.port
            return this.returnRtpSplitter.portPromise;
        });
    }
    stop() {
        this.ffmpegProcess.stop();
        this.returnRtpSplitter.close();
    }
}
exports.ReturnAudioTranscoder = ReturnAudioTranscoder;
