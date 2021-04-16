
/*
 * @Author: Summer
 * @LastEditors: Summer
 * @Description: 
 * @Date: 2021-04-15 17:29:34 +0800
 * @LastEditTime: 2021-04-16 11:07:29 +0800
 * @FilePath: /socket.io-amqplib/src/index.ts
 */
import uid2 = require("uid2");
import { Namespace } from "socket.io";
import { Adapter, BroadcastOptions, Room, SocketId } from "socket.io-adapter";
import { connect, Channel, ConsumeMessage } from "amqplib";
const msgpack = require("notepack.io");
const debug = require("debug")("socket.io-amqplib");

module.exports = exports = createAdapter;

enum RequestMethod {
    addAll = 0,
    del,
    delAll,
    broadcast,
    sockets,
    socketRooms,
    fetchSockets,
    addSockets,
    delSockets,
    disconnectSockets,

    ////////////////////
    response
}

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


export function createAdapter(uri: string, opts: Partial<AmqplibAdapterOptions> = {}) {
    // handle options only
    return function (nsp: Namespace) {
        return new AmqplibAdapter(nsp, uri, opts);
    };
}


let __mqsub: Channel;
let __mqpub: Channel;

export class AmqplibAdapter extends Adapter {

    public readonly uid: string;
    public readonly requestsTimeout: number;

    private readonly channel: string;
    private requests: Map<string, Request> = new Map();

    constructor(nsp: Namespace, private uri: string, private opts: Partial<AmqplibAdapterOptions> = {}) {
        super(nsp);

        this.uid = uid2(6);
        this.requestsTimeout = this.opts.requestsTimeout || 5000;

        const prefix = opts.key || "socket.io";

        this.channel = prefix + "#" + nsp.name + "#";
    }

    async init() {
        try {
            const createChannel = async () => {
                let __mqconnect = await connect(this.uri);
                return __mqconnect.createChannel();
            }

            __mqsub = await createChannel();
            await __mqsub.assertExchange(this.channel, "fanout", { durable: false });
            let qok = await __mqsub.assertQueue("", { exclusive: true }); debug("QOK", qok);
            await __mqsub.bindQueue(qok.queue, this.channel, "");
            await __mqsub.consume(qok.queue, this.onmessage.bind(this), { noAck: true })

            __mqpub = await createChannel();
            await __mqpub.assertExchange(this.channel, "fanout", { durable: false });
        } catch (error) {
            this.emit("error", error);
        }
    }

    private async publish(msg: Buffer): Promise<void> {
        if (__mqpub) {
            await __mqpub.publish(this.channel, "", msg)
        }
    }


    private async onmessage(msg: ConsumeMessage | null): Promise<void> {
        if (msg && msg.content) {
            try {
                const args = msgpack.decode(msg.content);
                const type = args.shift();
                const uid = args.shift();

                if (this.uid === uid) return debug("ignore same uid");

                switch (type) {
                    case RequestMethod.addAll: {
                        super.addAll.apply(this, args);
                        break;
                    }
                    case RequestMethod.addSockets: {
                        super.addSockets.apply(this, args);
                        break;
                    }
                    case RequestMethod.broadcast: {
                        super.broadcast.apply(this, args);
                        break;
                    }
                    case RequestMethod.del: {
                        super.del.apply(this, args);
                        break;
                    }
                    case RequestMethod.delAll: {
                        super.delAll.apply(this, args);
                        break;
                    }
                    case RequestMethod.delSockets: {
                        super.delSockets.apply(this, args);
                        break;
                    }
                    case RequestMethod.disconnectSockets: {
                        super.disconnectSockets.apply(this, args);
                        break;
                    }
                    case RequestMethod.fetchSockets: {
                        super.fetchSockets.apply(this, args);
                        break;
                    }
                    case RequestMethod.socketRooms: {
                        super.socketRooms.apply(this, args);
                        break;
                    }
                    case RequestMethod.sockets: {
                        super.sockets.apply(this, args);
                        break;
                    }
                    case RequestMethod.response: {
                        break;
                    }
                    default:
                        debug("ignoring unknown request type: %s", args[0]);
                }


            } catch (error) {
                this.emit("error", error);
            }
            
            __mqpub.ack(msg);
        }
    }


    /**
     * Adds a socket to a list of room.
     *
     * @param {SocketId}  id      the socket id
     * @param {Set<Room>} rooms   a set of rooms
     * @public
     */
    public async addAll(id: SocketId, rooms: Set<Room>): Promise<void> {
        this.publish(msgpack.encode([RequestMethod.addAll, this.uid, id, rooms]))
        super.addAll(id, rooms);
    }
    /**
     * Removes a socket from a room.
     *
     * @param {SocketId} id     the socket id
     * @param {Room}     room   the room name
     */
    public async del(id: SocketId, room: Room): Promise<void> {
        this.publish(msgpack.encode([RequestMethod.del, this.uid, id, room]))
        super.del(id, room);
    }
    /**
     * Removes a socket from all rooms it's joined.
     *
     * @param {SocketId} id   the socket id
     */
    public async delAll(id: SocketId): Promise<void> {
        this.publish(msgpack.encode([RequestMethod.delAll, this.uid, id]))
        super.delAll(id);
    }
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
    public async broadcast(packet: any, opts: BroadcastOptions): Promise<void> {
        this.publish(msgpack.encode([RequestMethod.broadcast, this.uid, packet, opts]))
        super.broadcast(packet, opts);
    }
    // /**
    //  * Gets a list of sockets by sid.
    //  *
    //  * @param {Set<Room>} rooms   the explicit set of rooms to check.
    //  */
    // public async sockets(rooms: Set<Room>): Promise<Set<SocketId>> {
    //     const requestId = uid2(6);
    //     return;
    // }
    // /**
    //  * Gets the list of rooms a given socket has joined.
    //  *
    //  * @param {SocketId} id   the socket id
    //  */
    // public async remoteSocketRooms(id: SocketId): Promise<Set<Room> | undefined> {
    //     return;
    // }
    // /**
    //  * Returns the matching socket instances
    //  *
    //  * @param opts - the filters to apply
    //  */
    // public async fetchSockets(opts: BroadcastOptions): Promise<any[]> {
    //     return;
    // }
    /**
     * Makes the matching socket instances join the specified rooms
     *
     * @param opts - the filters to apply
     * @param rooms - the rooms to join
     */
    public async addSockets(opts: BroadcastOptions, rooms: Room[]): Promise<void> {
        this.publish(msgpack.encode([RequestMethod.addSockets, this.uid, opts, rooms]))
        super.addSockets(opts, rooms);
    }
    /**
     * Makes the matching socket instances leave the specified rooms
     *
     * @param opts - the filters to apply
     * @param rooms - the rooms to leave
     */
    public async delSockets(opts: BroadcastOptions, rooms: Room[]): Promise<void> {
        this.publish(msgpack.encode([RequestMethod.delSockets, this.uid, opts, rooms]))
        super.delSockets(opts, rooms);
    }
    /**
     * Makes the matching socket instances disconnect
     *
     * @param opts - the filters to apply
     * @param close - whether to close the underlying connection
     */
    public async disconnectSockets(opts: BroadcastOptions, close: boolean): Promise<void> {
        this.publish(msgpack.encode([RequestMethod.disconnectSockets, this.uid, opts, close]))
        super.disconnectSockets(opts, close);
    }
}
