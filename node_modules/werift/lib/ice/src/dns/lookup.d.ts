import mdns from "multicast-dns";
import worker_thread from "worker_threads";
export declare class MdnsLookup {
    cache: Map<string, Promise<string>>;
    mdnsInstance: mdns.MulticastDNS;
    constructor();
    lookup(host: string): Promise<string>;
    close(): void;
}
export declare class DnsLookup {
    thread: worker_thread.Worker;
    cache: Map<string, Promise<string>>;
    constructor();
    lookup(host: string): Promise<string>;
    close(): Promise<number>;
}
