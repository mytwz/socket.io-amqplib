import { Namespace } from "socket.io";
declare const Adapter: any;
declare type BroadcastOptions = any;
declare type Room = string;
declare type SocketId = string;
interface AmqplibAdapterOptions {
    /**
     * the name of the key to pub/sub events on as prefix
     * @default socket.io
     */
    key: string;
    /**
     * after this timeout the adapter will stop waiting from responses to request
     * @default 5000
     */
    requestsTimeout: number;
}
declare function createAdapter(uri: string, opts?: Partial<AmqplibAdapterOptions>): (nsp: Namespace) => AmqplibAdapter;
declare class AmqplibAdapter extends Adapter {
    private uri;
    private opts;
    readonly uid: string;
    readonly requestsTimeout: number;
    private readonly channel;
    private requests;
    constructor(nsp: Namespace, uri: string, opts?: Partial<AmqplibAdapterOptions>);
    init(): Promise<void>;
    private publish;
    private onmessage;
    /**
     * Adds a socket to a list of room.
     *
     * @param {SocketId}  id      the socket id
     * @param {Set<Room>} rooms   a set of rooms
     * @public
     */
    add(id: SocketId, rooms: Set<Room>): Promise<void>;
    /**
     * Removes a socket from a room.
     *
     * @param {SocketId} id     the socket id
     * @param {Room}     room   the room name
     */
    del(id: SocketId, room: Room): Promise<void>;
    /**
     * Removes a socket from all rooms it's joined.
     *
     * @param {SocketId} id   the socket id
     */
    delAll(id: SocketId): Promise<void>;
    /**
     * Broadcasts a packet.
     *
     * Options:
     *  - `flags` {Object} flags for this packet
     *  - `except` {Array} sids that should be excluded
     *  - `rooms` {Array} list of rooms to broadcast to
     *
     * @param {Object} packet   the packet object
     * @param {Object} opts     the options
     * @public
     */
    broadcast(packet: any, opts: BroadcastOptions): Promise<void>;
    /**
     * Makes the matching socket instances join the specified rooms
     *
     * @param opts - the filters to apply
     * @param rooms - the rooms to join
     */
    addSockets(opts: BroadcastOptions, rooms: Room[]): Promise<void>;
    /**
     * Makes the matching socket instances leave the specified rooms
     *
     * @param opts - the filters to apply
     * @param rooms - the rooms to leave
     */
    delSockets(opts: BroadcastOptions, rooms: Room[]): Promise<void>;
    /**
     * Makes the matching socket instances disconnect
     *
     * @param opts - the filters to apply
     * @param close - whether to close the underlying connection
     */
    disconnectSockets(opts: BroadcastOptions, close: boolean): Promise<void>;
}
export = createAdapter;
