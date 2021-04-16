"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmqplibAdapter = exports.createAdapter = void 0;
/*
 * @Author: Summer
 * @LastEditors: Summer
 * @Description:
 * @Date: 2021-04-15 17:29:34 +0800
 * @LastEditTime: 2021-04-16 11:07:29 +0800
 * @FilePath: /socket.io-amqplib/src/index.ts
 */
const uid2 = require("uid2");
const socket_io_adapter_1 = require("socket.io-adapter");
const amqplib_1 = require("amqplib");
const msgpack = require("notepack.io");
const debug = require("debug")("socket.io-amqplib");
module.exports = exports = createAdapter;
var RequestMethod;
(function (RequestMethod) {
    RequestMethod[RequestMethod["addAll"] = 0] = "addAll";
    RequestMethod[RequestMethod["del"] = 1] = "del";
    RequestMethod[RequestMethod["delAll"] = 2] = "delAll";
    RequestMethod[RequestMethod["broadcast"] = 3] = "broadcast";
    RequestMethod[RequestMethod["sockets"] = 4] = "sockets";
    RequestMethod[RequestMethod["socketRooms"] = 5] = "socketRooms";
    RequestMethod[RequestMethod["fetchSockets"] = 6] = "fetchSockets";
    RequestMethod[RequestMethod["addSockets"] = 7] = "addSockets";
    RequestMethod[RequestMethod["delSockets"] = 8] = "delSockets";
    RequestMethod[RequestMethod["disconnectSockets"] = 9] = "disconnectSockets";
    ////////////////////
    RequestMethod[RequestMethod["response"] = 10] = "response";
})(RequestMethod || (RequestMethod = {}));
function createAdapter(uri, opts = {}) {
    // handle options only
    return function (nsp) {
        return new AmqplibAdapter(nsp, uri, opts);
    };
}
exports.createAdapter = createAdapter;
let __mqsub;
let __mqpub;
class AmqplibAdapter extends socket_io_adapter_1.Adapter {
    constructor(nsp, uri, opts = {}) {
        super(nsp);
        this.uri = uri;
        this.opts = opts;
        this.requests = new Map();
        this.uid = uid2(6);
        this.requestsTimeout = this.opts.requestsTimeout || 5000;
        const prefix = opts.key || "socket.io";
        this.channel = prefix + "#" + nsp.name + "#";
    }
    async init() {
        try {
            const createChannel = async () => {
                let __mqconnect = await amqplib_1.connect(this.uri);
                return __mqconnect.createChannel();
            };
            __mqsub = await createChannel();
            await __mqsub.assertExchange(this.channel, "fanout", { durable: false });
            let qok = await __mqsub.assertQueue("", { exclusive: true });
            debug("QOK", qok);
            await __mqsub.bindQueue(qok.queue, this.channel, "");
            await __mqsub.consume(qok.queue, this.onmessage.bind(this), { noAck: true });
            __mqpub = await createChannel();
            await __mqpub.assertExchange(this.channel, "fanout", { durable: false });
        }
        catch (error) {
            this.emit("error", error);
        }
    }
    async publish(msg) {
        if (__mqpub) {
            await __mqpub.publish(this.channel, "", msg);
        }
    }
    async onmessage(msg) {
        if (msg && msg.content) {
            try {
                const args = msgpack.decode(msg.content);
                const type = args.shift();
                const uid = args.shift();
                if (this.uid === uid)
                    return debug("ignore same uid");
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
            }
            catch (error) {
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
    async addAll(id, rooms) {
        this.publish(msgpack.encode([RequestMethod.addAll, this.uid, id, rooms]));
        super.addAll(id, rooms);
    }
    /**
     * Removes a socket from a room.
     *
     * @param {SocketId} id     the socket id
     * @param {Room}     room   the room name
     */
    async del(id, room) {
        this.publish(msgpack.encode([RequestMethod.del, this.uid, id, room]));
        super.del(id, room);
    }
    /**
     * Removes a socket from all rooms it's joined.
     *
     * @param {SocketId} id   the socket id
     */
    async delAll(id) {
        this.publish(msgpack.encode([RequestMethod.delAll, this.uid, id]));
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
    async broadcast(packet, opts) {
        this.publish(msgpack.encode([RequestMethod.broadcast, this.uid, packet, opts]));
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
    async addSockets(opts, rooms) {
        this.publish(msgpack.encode([RequestMethod.addSockets, this.uid, opts, rooms]));
        super.addSockets(opts, rooms);
    }
    /**
     * Makes the matching socket instances leave the specified rooms
     *
     * @param opts - the filters to apply
     * @param rooms - the rooms to leave
     */
    async delSockets(opts, rooms) {
        this.publish(msgpack.encode([RequestMethod.delSockets, this.uid, opts, rooms]));
        super.delSockets(opts, rooms);
    }
    /**
     * Makes the matching socket instances disconnect
     *
     * @param opts - the filters to apply
     * @param close - whether to close the underlying connection
     */
    async disconnectSockets(opts, close) {
        this.publish(msgpack.encode([RequestMethod.disconnectSockets, this.uid, opts, close]));
        super.disconnectSockets(opts, close);
    }
}
exports.AmqplibAdapter = AmqplibAdapter;
