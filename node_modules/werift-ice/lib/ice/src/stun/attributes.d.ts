import type { Address } from "../imports/common";
import { type AttributeKeys } from "./const";
export declare function unpackErrorCode(data: Buffer): [number, string];
export declare function unpackXorAddress(data: Buffer, transactionId: Buffer): Address;
export declare function packErrorCode(value: [number, string]): Buffer;
export declare function packXorAddress(value: Address, transactionId: Buffer): Buffer;
export type ATTRIBUTE = [
    number,
    AttributeKey,
    (...args: any) => Buffer,
    (...args: any) => any
];
export declare class AttributeRepository {
    protected attributes: AttributePair[];
    constructor(attributes?: AttributePair[]);
    getAttributes(): AttributePair[];
    setAttribute(key: (typeof AttributeKeys)[number], value: any): this;
    getAttributeValue(key: AttributeKey): any;
    get attributesKeys(): (typeof AttributeKeys)[number][];
    clear(): void;
}
export type AttributeKey = (typeof AttributeKeys)[number];
export type AttributePair = [AttributeKey, any];
export declare const ATTRIBUTES_BY_TYPE: {
    [key: string]: ATTRIBUTE;
};
export declare const ATTRIBUTES_BY_NAME: {
    [key: string]: ATTRIBUTE;
};
