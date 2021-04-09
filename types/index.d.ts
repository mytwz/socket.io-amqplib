import { Namespace } from "socket.io";
import { Adapter, BroadcastOptions, Room, SocketId } from "socket.io-adapter";
export interface AmqplibAdapterOptions {
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
/**
 * Returns a redis Adapter class.
 *
 * @param {String} uri - optional, redis uri
 * @param {String} opts - redis connection options
 * @return {AmqplibAdapter} adapter
 *
 * @public
 */
export declare function createAdapter(uri?: any, opts?: Partial<AmqplibAdapterOptions>): (nsp: Namespace) => AmqplibAdapter;
export declare class AmqplibAdapter extends Adapter {
    private uri;
    private opts;
    readonly uid: string;
    readonly requestsTimeout: number;
    private readonly channel;
    private readonly requestChannel;
    private readonly responseChannel;
    private requests;
    /**
     * Adapter constructor.
     *
     * @param nsp - the namespace
     * @param uri - the url of the Redis server
     * @param opts - the options for both the Redis adapter and the Redis client
     *
     * @public
     */
    constructor(nsp: Namespace, uri: string, opts?: Partial<AmqplibAdapterOptions>);
    private sendMessage;
    /**
     * Called with a subscription message
     *
     * @private
     */
    private onmessage;
    /**
     * Called on request from another node
     *
     * @private
     */
    private onrequest;
    /**
     * Called on response from another node
     *
     * @private
     */
    private onresponse;
    /**
     * Broadcasts a packet.
     *
     * @param {Object} packet - packet to emit
     * @param {Object} opts - options
     *
     * @public
     */
    broadcast(packet: any, opts: BroadcastOptions): void;
    /**
     * Gets a list of sockets by sid.
     *
     * @param {Set<Room>} rooms   the explicit set of rooms to check.
     */
    sockets(rooms: Set<Room>): Promise<Set<SocketId>>;
    /**
     * Gets the list of all rooms (across every node)
     *
     * @public
     */
    allRooms(): Promise<Set<Room>>;
    /**
     * Makes the socket with the given id join the room
     *
     * @param {String} id - socket id
     * @param {String} room - room name
     * @public
     */
    remoteJoin(id: SocketId, room: Room): Promise<void>;
    /**
     * Makes the socket with the given id leave the room
     *
     * @param {String} id - socket id
     * @param {String} room - room name
     * @public
     */
    remoteLeave(id: SocketId, room: Room): Promise<void>;
    /**
     * Makes the socket with the given id to be forcefully disconnected
     * @param {String} id - socket id
     * @param {Boolean} close - if `true`, closes the underlying connection
     *
     * @public
     */
    remoteDisconnect(id: SocketId, close?: boolean): Promise<void>;
    fetchSockets(opts: BroadcastOptions): Promise<any[]>;
    addSockets(opts: BroadcastOptions, rooms: Room[]): void;
    delSockets(opts: BroadcastOptions, rooms: Room[]): void;
    disconnectSockets(opts: BroadcastOptions, close: boolean): void;
}
