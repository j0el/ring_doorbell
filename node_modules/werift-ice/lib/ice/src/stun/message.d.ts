import { type AttributePair, AttributeRepository } from "./attributes";
import { classes, methods } from "./const";
export declare function parseMessage(data: Buffer, integrityKey?: Buffer): Message | undefined;
export declare class Message extends AttributeRepository {
    messageMethod: methods;
    messageClass: classes;
    transactionId: Buffer;
    constructor(messageMethod: methods, messageClass: classes, transactionId?: Buffer, attributes?: AttributePair[]);
    toJSON(): {
        messageMethod: string;
        messageClass: string;
        attributes: AttributePair[];
    };
    get json(): {
        messageMethod: string;
        messageClass: string;
        attributes: AttributePair[];
    };
    get transactionIdHex(): string;
    get bytes(): Buffer;
    addMessageIntegrity(key: Buffer): this;
    messageIntegrity(key: Buffer): Buffer;
    addFingerprint(): void;
}
export declare function paddingLength(length: number): number;
