import uid2 = require("uid2");
import { Namespace } from "socket.io";
import { Adapter, BroadcastOptions, Room, SocketId } from "socket.io-adapter";
import { connect, Channel, ConsumeMessage } from "amqplib";

const msgpack = require("notepack.io");
const debug = require("debug")("socket.io-amqplib");

module.exports = exports = createAdapter;

/**
 * Request types, for messages between nodes
 */

enum RequestType {
    SOCKETS = 0,
    ALL_ROOMS = 1,
    REMOTE_JOIN = 2,
    REMOTE_LEAVE = 3,
    REMOTE_DISCONNECT = 4,
    REMOTE_FETCH = 5,
}

interface Request {
    type: RequestType;
    resolve: Function;
    timeout: NodeJS.Timeout;
    numSub?: number;
    msgCount?: number;
    [other: string]: any;
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

/**
 * Returns a redis Adapter class.
 *
 * @param {String} uri - optional, redis uri
 * @param {String} opts - redis connection options
 * @return {AmqplibAdapter} adapter
 *
 * @public
 */
export function createAdapter(uri?: any, opts: Partial<AmqplibAdapterOptions> = {}) {
    // handle options only
    if (typeof uri === "object") {
        opts = uri;
        uri = null;
    }

    return function (nsp: Namespace) {
        return new AmqplibAdapter(nsp, uri, opts);
    };
}

let __mqchannel: Channel;

export class AmqplibAdapter extends Adapter {
    public readonly uid: string;
    public readonly requestsTimeout: number;

    private readonly channel: string;
    private readonly requestChannel: string;
    private readonly responseChannel: string;
    private requests: Map<string, Request> = new Map();
    /**
     * Adapter constructor.
     *
     * @param nsp - the namespace
     * @param uri - the url of the Redis server
     * @param opts - the options for both the Redis adapter and the Redis client
     *
     * @public
     */
    constructor(nsp: Namespace, private uri: string, private opts: Partial<AmqplibAdapterOptions> = {}) {
        super(nsp);

        this.uid = uid2(6);
        this.requestsTimeout = this.opts.requestsTimeout || 5000;

        const prefix = opts.key || "socket.io";

        this.channel = prefix + "#" + nsp.name + "#";
        this.requestChannel = prefix + "-request#" + this.nsp.name + "#";
        this.responseChannel = prefix + "-response#" + this.nsp.name + "#";

        const onError = (err: any) => {
            if (err) {
                this.emit("error", err);
            }
        };

        connect(this.uri).then(async connect => {
            debug("连接 MQ 成功")
            __mqchannel = await connect.createChannel();
            debug("创建频道成功")
            __mqchannel.assertQueue(this.channel).then(ok => debug(`监听消息[${this.channel}]:`, ok)).catch(onError)
            __mqchannel.assertQueue(this.requestChannel).then(ok => debug(`监听消息[${this.requestChannel}]:`, ok)).catch(onError)
            __mqchannel.assertQueue(this.responseChannel).then(ok => debug(`监听消息[${this.responseChannel}]:`, ok)).catch(onError)

            __mqchannel.consume(this.channel, msg => msg && this.onmessage(msg))
            __mqchannel.consume(this.requestChannel, msg => msg && this.onrequest(msg))
            __mqchannel.consume(this.responseChannel, msg => msg && this.onresponse(msg))
        })
    }

    private async sendMessage(channel: string, msg: Buffer | string) {
        if (__mqchannel) {
            await __mqchannel.assertQueue(channel);
            await __mqchannel.sendToQueue(channel, Buffer.from(msg))
        }
    }

    /**
     * Called with a subscription message
     *
     * @private
     */
    private onmessage(msg: ConsumeMessage): void {

        const args = msgpack.decode(msg.content);

        const [uid, packet, opts, channel] = args;

        const room = channel.slice(this.channel.length, -1);
        if (room !== "" && !this.rooms.has(room)) {
            return debug("ignore unknown room %s", room);
        }

        if (this.uid === uid) return debug("ignore same uid");

        if (packet && packet.nsp === undefined) {
            packet.nsp = "/";
        }

        if (!packet || packet.nsp !== this.nsp.name) {
            return debug("ignore different namespace");
        }
        opts.rooms = new Set(opts.rooms);
        opts.except = new Set(opts.except);

        super.broadcast(packet, opts);
    }

    /**
     * Called on request from another node
     *
     * @private
     */
    private async onrequest(msg: ConsumeMessage): Promise<void> {

        let request;

        try {
            request = JSON.parse(msg.content.toString());
        } catch (err) {
            this.emit("error", err);
            return;
        }

        debug("received request %j", request);

        let response, socket;

        switch (request.type) {
            case RequestType.SOCKETS:
                if (this.requests.has(request.requestId)) {
                    return;
                }

                const sockets = await super.sockets(new Set(request.rooms));

                response = JSON.stringify({
                    requestId: request.requestId,
                    sockets: [...sockets],
                });

                this.sendMessage(this.responseChannel, response)
                break;

            case RequestType.ALL_ROOMS:
                if (this.requests.has(request.requestId)) {
                    return;
                }

                response = JSON.stringify({
                    requestId: request.requestId,
                    rooms: [...this.rooms.keys()],
                });

                this.sendMessage(this.responseChannel, response)
                break;

            case RequestType.REMOTE_JOIN:
                if (request.opts) {
                    const opts = {
                        rooms: new Set<Room>(request.opts.rooms),
                        except: new Set<Room>(request.opts.except),
                    };
                    return super.addSockets(opts, request.rooms);
                }

                socket = this.nsp.sockets.get(request.sid);
                if (!socket) {
                    return;
                }

                socket.join(request.room);

                response = JSON.stringify({
                    requestId: request.requestId,
                });

                this.sendMessage(this.responseChannel, response)
                break;

            case RequestType.REMOTE_LEAVE:
                if (request.opts) {
                    const opts = {
                        rooms: new Set<Room>(request.opts.rooms),
                        except: new Set<Room>(request.opts.except),
                    };
                    return super.delSockets(opts, request.rooms);
                }

                socket = this.nsp.sockets.get(request.sid);
                if (!socket) {
                    return;
                }

                socket.leave(request.room);

                response = JSON.stringify({
                    requestId: request.requestId,
                });

                this.sendMessage(this.responseChannel, response)
                break;

            case RequestType.REMOTE_DISCONNECT:
                if (request.opts) {
                    const opts = {
                        rooms: new Set<Room>(request.opts.rooms),
                        except: new Set<Room>(request.opts.except),
                    };
                    return super.disconnectSockets(opts, request.close);
                }

                socket = this.nsp.sockets.get(request.sid);
                if (!socket) {
                    return;
                }

                socket.disconnect(request.close);

                response = JSON.stringify({
                    requestId: request.requestId,
                });

                this.sendMessage(this.responseChannel, response)
                break;

            case RequestType.REMOTE_FETCH:
                if (this.requests.has(request.requestId)) {
                    return;
                }

                const opts = {
                    rooms: new Set<Room>(request.opts.rooms),
                    except: new Set<Room>(request.opts.except),
                };
                const localSockets = await super.fetchSockets(opts);

                response = JSON.stringify({
                    requestId: request.requestId,
                    sockets: localSockets.map((socket) => ({
                        id: socket.id,
                        handshake: socket.handshake,
                        rooms: [...socket.rooms],
                        data: socket.data,
                    })),
                });

                this.sendMessage(this.responseChannel, response)
                break;

            default:
                debug("ignoring unknown request type: %s", request.type);
        }
    }

    /**
     * Called on response from another node
     *
     * @private
     */
    private onresponse(msg: ConsumeMessage): void {
        let response;

        try {
            response = JSON.parse(msg.content.toString());
        } catch (err) {
            this.emit("error", err);
            return;
        }

        const requestId = response.requestId;
        const request = this.requests.get(requestId);

        if (!requestId || !this.requests.has(requestId) || !request) {
            debug("ignoring unknown request");
            return;
        }

        debug("received response %j", response);

        switch (request.type) {

            case RequestType.REMOTE_JOIN:
            case RequestType.REMOTE_LEAVE:
            case RequestType.REMOTE_DISCONNECT:
                clearTimeout(request.timeout);
                if (request.resolve) {
                    request.resolve();
                }
                this.requests.delete(requestId);
                break;

            default:
                debug("ignoring unknown request type: %s", request.type);
        }
    }

    /**
     * Broadcasts a packet.
     *
     * @param {Object} packet - packet to emit
     * @param {Object} opts - options
     *
     * @public
     */
    public broadcast(packet: any, opts: BroadcastOptions) {
        packet.nsp = this.nsp.name;

        const onlyLocal = opts && opts.flags && opts.flags.local;

        if (!onlyLocal) {
            let channel = this.channel;
            if (opts.rooms && opts.rooms.size === 1) {
                channel += opts.rooms.keys().next().value + "#";
            }
            const rawOpts = {
                rooms: [...opts.rooms],
                except: [...new Set(opts.except)],
                flags: opts.flags
            };
            const msg = msgpack.encode([this.uid, packet, rawOpts, channel]);
            debug("publishing message to channel %s", channel);
            this.sendMessage(this.channel, msg)
        }
        super.broadcast(packet, opts);
    }

    /**
     * Gets a list of sockets by sid.
     *
     * @param {Set<Room>} rooms   the explicit set of rooms to check.
     */
    public async sockets(rooms: Set<Room>): Promise<Set<SocketId>> {
        return new Set();
    }

    /**
     * Gets the list of all rooms (across every node)
     *
     * @public
     */
    public async allRooms(): Promise<Set<Room>> {
        return new Set();
    }

    /**
     * Makes the socket with the given id join the room
     *
     * @param {String} id - socket id
     * @param {String} room - room name
     * @public
     */
    public remoteJoin(id: SocketId, room: Room): Promise<void> {
        const requestId = uid2(6);

        const socket = this.nsp.sockets.get(id);
        if (socket) {
            socket.join(room);
            return Promise.resolve();
        }

        const request = JSON.stringify({
            requestId,
            type: RequestType.REMOTE_JOIN,
            sid: id,
            room,
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.requests.has(requestId)) {
                    reject(
                        new Error("timeout reached while waiting for remoteJoin response")
                    );
                    this.requests.delete(requestId);
                }
            }, this.requestsTimeout);

            this.requests.set(requestId, {
                type: RequestType.REMOTE_JOIN,
                resolve,
                timeout,
            });

            this.sendMessage(this.requestChannel, request);
        });
    }

    /**
     * Makes the socket with the given id leave the room
     *
     * @param {String} id - socket id
     * @param {String} room - room name
     * @public
     */
    public remoteLeave(id: SocketId, room: Room): Promise<void> {
        const requestId = uid2(6);

        const socket = this.nsp.sockets.get(id);
        if (socket) {
            socket.leave(room);
            return Promise.resolve();
        }

        const request = JSON.stringify({
            requestId,
            type: RequestType.REMOTE_LEAVE,
            sid: id,
            room,
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.requests.has(requestId)) {
                    reject(
                        new Error("timeout reached while waiting for remoteLeave response")
                    );
                    this.requests.delete(requestId);
                }
            }, this.requestsTimeout);

            this.requests.set(requestId, {
                type: RequestType.REMOTE_LEAVE,
                resolve,
                timeout,
            });

            this.sendMessage(this.requestChannel, request);
        });
    }

    /**
     * Makes the socket with the given id to be forcefully disconnected
     * @param {String} id - socket id
     * @param {Boolean} close - if `true`, closes the underlying connection
     *
     * @public
     */
    public remoteDisconnect(id: SocketId, close?: boolean): Promise<void> {
        const requestId = uid2(6);

        const socket = this.nsp.sockets.get(id);
        if (socket) {
            socket.disconnect(close);
            return Promise.resolve();
        }

        const request = JSON.stringify({
            requestId,
            type: RequestType.REMOTE_DISCONNECT,
            sid: id,
            close,
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.requests.has(requestId)) {
                    reject(
                        new Error(
                            "timeout reached while waiting for remoteDisconnect response"
                        )
                    );
                    this.requests.delete(requestId);
                }
            }, this.requestsTimeout);

            this.requests.set(requestId, {
                type: RequestType.REMOTE_DISCONNECT,
                resolve,
                timeout,
            });

            this.sendMessage(this.requestChannel, request);
        });
    }

    public async fetchSockets(opts: BroadcastOptions): Promise<any[]> {
        return [];
    }

    public addSockets(opts: BroadcastOptions, rooms: Room[]) {
        if (opts.flags?.local) {
            return super.addSockets(opts, rooms);
        }

        const request = JSON.stringify({
            type: RequestType.REMOTE_JOIN,
            opts: {
                rooms: [...opts.rooms],
                except: [...opts.except || []],
            },
            rooms: [...rooms],
        });

        this.sendMessage(this.requestChannel, request);
    }

    public delSockets(opts: BroadcastOptions, rooms: Room[]) {
        if (opts.flags?.local) {
            return super.delSockets(opts, rooms);
        }

        const request = JSON.stringify({
            type: RequestType.REMOTE_LEAVE,
            opts: {
                rooms: [...opts.rooms],
                except: [...opts.except || []],
            },
            rooms: [...rooms],
        });

        this.sendMessage(this.requestChannel, request);
    }

    public disconnectSockets(opts: BroadcastOptions, close: boolean) {
        if (opts.flags?.local) {
            return super.disconnectSockets(opts, close);
        }

        const request = JSON.stringify({
            type: RequestType.REMOTE_DISCONNECT,
            opts: {
                rooms: [...opts.rooms],
                except: [...opts.except || []],
            },
            close,
        });

        this.sendMessage(this.requestChannel, request);
    }

}
