import { Namespace } from "socket.io";
import { RedisOptions } from "ioredis";
declare const Adapter: any;
declare type BroadcastOptions = any;
declare type Room = string;
declare type SocketId = string;
declare type CustomHook = (data: any, cb: Function) => void;
interface AmqplibAdapterOptions extends RedisOptions {
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
    private nsp;
    private uri;
    private opts;
    readonly uid: string;
    readonly requestsTimeout: number;
    private readonly channel;
    private readonly requests;
    private readonly msgbuffers;
    private survivalid;
    /**检查通道可用性 */
    private checkchannelid;
    private ispublish;
    customHook: CustomHook;
    constructor(nsp: Namespace, uri: string, opts?: Partial<AmqplibAdapterOptions>);
    init(): Promise<void>;
    private checkChannel;
    private sendCheckChannel;
    private survivalHeartbeat;
    /**获取所有存活主机的数量 */
    private allSurvivalCount;
    private startPublish;
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
     * Gets a list of clients by sid.
     *
     * @param {Array} explicit set of rooms to check.
     */
    clients(rooms: Room[]): Promise<SocketId[]>;
    /**
     * Gets the list of rooms a given client has joined.
     *
     * @param {String} client id
     */
    clientRooms(id: SocketId): Promise<Room[] | undefined>;
    /**
     * Gets the list of all rooms (accross every node)
     *
     */
    allRooms(): Promise<string[]>;
    /**
     * Sends a new custom request to other nodes
     *
     * @param {Object} data (no binary)
     */
    customRequest(data: any): Promise<any[]>;
    /**
     * Makes the socket with the given id to be disconnected forcefully
     * @param {String} socket id
     * @param {Boolean} close if `true`, closes the underlying connection
     */
    remoteDisconnec(id: SocketId, close: boolean): Promise<void>;
}
export = createAdapter;
