"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmqplibAdapter = exports.createAdapter = void 0;
const uid2 = require("uid2");
const socket_io_adapter_1 = require("socket.io-adapter");
const amqplib_1 = require("amqplib");
const msgpack = require("notepack.io");
const debug = require("debug")("socket.io-amqplib");
module.exports = exports = createAdapter;
/**
 * Request types, for messages between nodes
 */
var RequestType;
(function (RequestType) {
    RequestType[RequestType["SOCKETS"] = 0] = "SOCKETS";
    RequestType[RequestType["ALL_ROOMS"] = 1] = "ALL_ROOMS";
    RequestType[RequestType["REMOTE_JOIN"] = 2] = "REMOTE_JOIN";
    RequestType[RequestType["REMOTE_LEAVE"] = 3] = "REMOTE_LEAVE";
    RequestType[RequestType["REMOTE_DISCONNECT"] = 4] = "REMOTE_DISCONNECT";
    RequestType[RequestType["REMOTE_FETCH"] = 5] = "REMOTE_FETCH";
})(RequestType || (RequestType = {}));
/**
 * Returns a redis Adapter class.
 *
 * @param {String} uri - optional, redis uri
 * @param {String} opts - redis connection options
 * @return {AmqplibAdapter} adapter
 *
 * @public
 */
function createAdapter(uri, opts = {}) {
    // handle options only
    if (typeof uri === "object") {
        opts = uri;
        uri = null;
    }
    return function (nsp) {
        return new AmqplibAdapter(nsp, uri, opts);
    };
}
exports.createAdapter = createAdapter;
let __mqchannel;
class AmqplibAdapter extends socket_io_adapter_1.Adapter {
    /**
     * Adapter constructor.
     *
     * @param nsp - the namespace
     * @param uri - the url of the Redis server
     * @param opts - the options for both the Redis adapter and the Redis client
     *
     * @public
     */
    constructor(nsp, uri, opts = {}) {
        super(nsp);
        this.uri = uri;
        this.opts = opts;
        this.requests = new Map();
        this.uid = uid2(6);
        this.requestsTimeout = this.opts.requestsTimeout || 5000;
        const prefix = opts.key || "socket.io";
        this.channel = prefix + "#" + nsp.name + "#";
        this.requestChannel = prefix + "-request#" + this.nsp.name + "#";
        this.responseChannel = prefix + "-response#" + this.nsp.name + "#";
        const onError = (err) => {
            if (err) {
                this.emit("error", err);
            }
        };
        amqplib_1.connect(this.uri).then(async (connect) => {
            debug("连接 MQ 成功");
            __mqchannel = await connect.createChannel();
            debug("创建频道成功");
            __mqchannel.assertQueue(this.channel).then(ok => debug(`监听消息[${this.channel}]:`, ok)).catch(onError);
            __mqchannel.assertQueue(this.requestChannel).then(ok => debug(`监听消息[${this.requestChannel}]:`, ok)).catch(onError);
            __mqchannel.assertQueue(this.responseChannel).then(ok => debug(`监听消息[${this.responseChannel}]:`, ok)).catch(onError);
            __mqchannel.consume(this.channel, msg => msg && this.onmessage(msg));
            __mqchannel.consume(this.requestChannel, msg => msg && this.onrequest(msg));
            __mqchannel.consume(this.responseChannel, msg => msg && this.onresponse(msg));
        });
    }
    async sendMessage(channel, msg) {
        if (__mqchannel) {
            await __mqchannel.assertQueue(channel);
            await __mqchannel.sendToQueue(channel, Buffer.from(msg));
        }
    }
    /**
     * Called with a subscription message
     *
     * @private
     */
    onmessage(msg) {
        const args = msgpack.decode(msg.content);
        const [uid, packet, opts, channel] = args;
        const room = channel.slice(this.channel.length, -1);
        if (room !== "" && !this.rooms.has(room)) {
            return debug("ignore unknown room %s", room);
        }
        if (this.uid === uid)
            return debug("ignore same uid");
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
    async onrequest(msg) {
        let request;
        try {
            request = JSON.parse(msg.content.toString());
        }
        catch (err) {
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
                this.sendMessage(this.responseChannel, response);
                break;
            case RequestType.ALL_ROOMS:
                if (this.requests.has(request.requestId)) {
                    return;
                }
                response = JSON.stringify({
                    requestId: request.requestId,
                    rooms: [...this.rooms.keys()],
                });
                this.sendMessage(this.responseChannel, response);
                break;
            case RequestType.REMOTE_JOIN:
                if (request.opts) {
                    const opts = {
                        rooms: new Set(request.opts.rooms),
                        except: new Set(request.opts.except),
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
                this.sendMessage(this.responseChannel, response);
                break;
            case RequestType.REMOTE_LEAVE:
                if (request.opts) {
                    const opts = {
                        rooms: new Set(request.opts.rooms),
                        except: new Set(request.opts.except),
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
                this.sendMessage(this.responseChannel, response);
                break;
            case RequestType.REMOTE_DISCONNECT:
                if (request.opts) {
                    const opts = {
                        rooms: new Set(request.opts.rooms),
                        except: new Set(request.opts.except),
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
                this.sendMessage(this.responseChannel, response);
                break;
            case RequestType.REMOTE_FETCH:
                if (this.requests.has(request.requestId)) {
                    return;
                }
                const opts = {
                    rooms: new Set(request.opts.rooms),
                    except: new Set(request.opts.except),
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
                this.sendMessage(this.responseChannel, response);
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
    onresponse(msg) {
        let response;
        try {
            response = JSON.parse(msg.content.toString());
        }
        catch (err) {
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
    broadcast(packet, opts) {
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
            this.sendMessage(this.channel, msg);
        }
        super.broadcast(packet, opts);
    }
    /**
     * Gets a list of sockets by sid.
     *
     * @param {Set<Room>} rooms   the explicit set of rooms to check.
     */
    async sockets(rooms) {
        return new Set();
    }
    /**
     * Gets the list of all rooms (across every node)
     *
     * @public
     */
    async allRooms() {
        return new Set();
    }
    /**
     * Makes the socket with the given id join the room
     *
     * @param {String} id - socket id
     * @param {String} room - room name
     * @public
     */
    remoteJoin(id, room) {
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
                    reject(new Error("timeout reached while waiting for remoteJoin response"));
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
    remoteLeave(id, room) {
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
                    reject(new Error("timeout reached while waiting for remoteLeave response"));
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
    remoteDisconnect(id, close) {
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
                    reject(new Error("timeout reached while waiting for remoteDisconnect response"));
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
    async fetchSockets(opts) {
        return [];
    }
    addSockets(opts, rooms) {
        var _a;
        if ((_a = opts.flags) === null || _a === void 0 ? void 0 : _a.local) {
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
    delSockets(opts, rooms) {
        var _a;
        if ((_a = opts.flags) === null || _a === void 0 ? void 0 : _a.local) {
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
    disconnectSockets(opts, close) {
        var _a;
        if ((_a = opts.flags) === null || _a === void 0 ? void 0 : _a.local) {
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
    /**
     * Get the number of subscribers of the request channel
     *
     * @private
     */
    async getNumSub() {
        return 0;
    }
}
exports.AmqplibAdapter = AmqplibAdapter;
