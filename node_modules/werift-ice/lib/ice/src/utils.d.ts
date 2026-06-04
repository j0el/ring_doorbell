import { type Address, type InterfaceAddresses } from "./imports/common";
export declare function getGlobalIp(stunServer?: Address, interfaceAddresses?: InterfaceAddresses): Promise<string>;
export declare function getHostAddresses(useIpv4: boolean, useIpv6: boolean): string[];
export declare const url2Address: (url?: string) => readonly [string, number] | undefined;
