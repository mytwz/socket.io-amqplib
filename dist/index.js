"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
/*
 * @Author: Summer
 * @LastEditors: Summer
 * @Description:
 * @Date: 2021-04-15 17:29:34 +0800
 * @LastEditTime: 2021-07-29 18:14:38 +0800
 * @FilePath: /socket.io-amqplib/src/index.ts
 */
const uid2 = require("uid2");
const amqplib_1 = require("amqplib");
const ioredis_1 = __importDefault(require("ioredis"));
const os_1 = require("os");
const msgpack = require("notepack.io");
const Adapter = require("socket.io-adapter");
const debug = require("debug")("socket.io-amqplib");
var RequestMethod;
(function (RequestMethod) {
    RequestMethod[RequestMethod["add"] = 0] = "add";
    RequestMethod[RequestMethod["del"] = 1] = "del";
    RequestMethod[RequestMethod["delAll"] = 2] = "delAll";
    RequestMethod[RequestMethod["broadcast"] = 3] = "broadcast";
    RequestMethod[RequestMethod["clients"] = 4] = "clients";
    RequestMethod[RequestMethod["clientRooms"] = 5] = "clientRooms";
    RequestMethod[RequestMethod["allRooms"] = 6] = "allRooms";
    RequestMethod[RequestMethod["customRequest"] = 7] = "customRequest";
    RequestMethod[RequestMethod["remoteDisconnec"] = 8] = "remoteDisconnec";
    ////////////////////
    RequestMethod[RequestMethod["response"] = 9] = "response";
    RequestMethod[RequestMethod["checkChannel"] = 10] = "checkChannel";
})(RequestMethod || (RequestMethod = {}));
ioredis_1.default.prototype.keys = async function (pattern) {
    let cursor = 0;
    let list = [];
    do {
        let res = await this.scan(cursor, "match", pattern, "count", 2000);
        cursor = +res[0];
        list = list.concat(res[1]);
    } while (cursor != 0);
    return list;
};
function createAdapter(uri, opts = {}) {
    // handle options only
    return function (nsp) {
        return new AmqplibAdapter(nsp, uri, opts);
    };
}
const REDIS_SURVIVAL_KEY = `socket.io-survival:${os_1.hostname()}:${process.pid}`;
let __mqconnect;
let __mqsub;
let __mqpub;
let redisdata;
class AmqplibAdapter extends Adapter {
    constructor(nsp, uri, opts = {}) {
        super(nsp);
        this.nsp = nsp;
        this.uri = uri;
        this.opts = opts;
        this.requests = new Map();
        this.msgbuffers = [];
        this.survivalid = 0;
        /**检查通道可用性 */
        this.checkchannelid = 0;
        this.ispublish = false;
        this.customHook = (data, cb) => cb(null);
        this.uid = uid2(6);
        this.requestsTimeout = this.opts.requestsTimeout || 5000;
        const prefix = opts.key || "socket.io";
        this.channel = prefix + "-message";
        this.init();
    }
    async init() {
        var _a;
        this.ispublish = true;
        clearInterval(this.survivalid);
        clearTimeout(this.checkchannelid);
        try {
            if (redisdata)
                redisdata.disconnect();
        }
        catch (error) {
            console.log(REDIS_SURVIVAL_KEY, error);
        }
        try {
            if (__mqsub)
                __mqsub.close();
        }
        catch (error) {
            console.log(REDIS_SURVIVAL_KEY, error);
        }
        try {
            if (__mqpub)
                __mqpub.close();
        }
        catch (error) {
            console.log(REDIS_SURVIVAL_KEY, error);
        }
        try {
            if (__mqconnect)
                __mqconnect.close();
        }
        catch (error) {
            console.log(REDIS_SURVIVAL_KEY, error);
        }
        redisdata = __mqsub = __mqpub = __mqconnect = null;
        redisdata = new ioredis_1.default(this.opts);
        if ((_a = this.opts) === null || _a === void 0 ? void 0 : _a.password)
            redisdata.auth(this.opts.password).then(_ => debug("redis", "Password verification succeeded"));
        __mqconnect = await amqplib_1.connect(this.uri);
        __mqsub = await __mqconnect.createChannel();
        await __mqsub.assertExchange(this.channel, "fanout", { durable: false });
        let qok = await __mqsub.assertQueue("", { exclusive: true });
        debug("QOK", qok);
        await __mqsub.bindQueue(qok.queue, this.channel, "");
        await __mqsub.consume(qok.queue, this.onmessage.bind(this), { noAck: true });
        __mqpub = await __mqconnect.createChannel();
        await __mqpub.assertExchange(this.channel, "fanout", { durable: false });
        this.survivalid = setInterval(this.survivalHeartbeat.bind(this), 1000);
        this.ispublish = false;
        this.sendCheckChannel();
        console.log(`[${REDIS_SURVIVAL_KEY}]["建立 MQ 消息通道完成", ${JSON.stringify(qok)}]`);
    }
    checkChannel() {
        console.log(`[${REDIS_SURVIVAL_KEY}]["MQ 消息通道超时响应，开始重新建立连接"]`);
        this.init();
    }
    sendCheckChannel() {
        this.msgbuffers.unshift(msgpack.encode([RequestMethod.checkChannel, this.uid]));
        this.checkchannelid = setTimeout(this.checkChannel.bind(this), this.requestsTimeout);
        this.startPublish();
    }
    survivalHeartbeat() {
        if (redisdata) {
            redisdata.set(REDIS_SURVIVAL_KEY, 1, "ex", 2);
        }
    }
    /**获取所有存活主机的数量 */
    async allSurvivalCount() {
        let keys = await redisdata.keys(`socket.io-survival:*`);
        return keys.length;
    }
    startPublish() {
        if (this.ispublish === false && __mqpub) {
            let msg = null;
            try {
                this.ispublish = true;
                while (msg = this.msgbuffers.pop()) {
                    __mqpub.publish(this.channel, "", msg);
                }
                this.ispublish = false;
            }
            catch (error) {
                msg && this.msgbuffers.unshift(msg);
                this.init();
                console.log(REDIS_SURVIVAL_KEY, error);
            }
        }
    }
    async publish(msg) {
        this.msgbuffers.push(msg);
        this.startPublish();
    }
    async onmessage(msg) {
        var _a;
        if (msg && msg.content) {
            try {
                const args = msgpack.decode(msg.content);
                const type = args.shift();
                const uid = args.shift();
                if (this.uid === uid) {
                    if (type == RequestMethod.checkChannel) {
                        clearTimeout(this.checkchannelid);
                        setTimeout(this.sendCheckChannel.bind(this), 1000);
                    }
                    return debug("ignore same uid");
                }
                switch (type) {
                    case RequestMethod.add: {
                        super.add.apply(this, args);
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
                    case RequestMethod.customRequest: {
                        let [requestid, __data] = args;
                        this.customHook(__data, (data) => {
                            this.publish(msgpack.encode([RequestMethod.response, uid, requestid, data]));
                        });
                        break;
                    }
                    case RequestMethod.remoteDisconnec: {
                        let [requestid, id, close] = args;
                        var socket = this.nsp.sockets.get(id);
                        if (!socket) {
                            return;
                        }
                        socket.disconnect(close);
                        this.publish(msgpack.encode([RequestMethod.response, uid, requestid, 1]));
                        break;
                    }
                    case RequestMethod.allRooms: {
                        let [requestid] = args;
                        let rooms = Object.keys(this.rooms);
                        this.publish(msgpack.encode([RequestMethod.response, uid, requestid, rooms]));
                        break;
                    }
                    case RequestMethod.clientRooms: {
                        let [requestid, id] = args;
                        let rooms = super.clientRooms.apply(this, id);
                        this.publish(msgpack.encode([RequestMethod.response, uid, requestid, rooms]));
                        break;
                    }
                    case RequestMethod.clients: {
                        let [requestid, rooms] = args;
                        let clients = super.clients.apply(this, rooms);
                        this.publish(msgpack.encode([RequestMethod.response, uid, requestid, clients]));
                        break;
                    }
                    case RequestMethod.response: {
                        if (this.uid == uid) {
                            let [requestid, result] = args;
                            (_a = this.requests.get(requestid)) === null || _a === void 0 ? void 0 : _a.call(this, result);
                        }
                        break;
                    }
                    default:
                        debug("ignoring unknown request type: %s", args[0]);
                }
            }
            catch (error) {
                this.emit("error", error);
            }
        }
    }
    /**
     * Adds a socket to a list of room.
     *
     * @param {SocketId}  id      the socket id
     * @param {Set<Room>} rooms   a set of rooms
     * @public
     */
    async add(id, rooms) {
        this.publish(msgpack.encode([RequestMethod.add, this.uid, id, rooms]));
        super.add(id, rooms);
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
    /**
     * Gets a list of clients by sid.
     *
     * @param {Array} explicit set of rooms to check.
     */
    clients(rooms) {
        return new Promise(async (resolve, reject) => {
            let requestoutid = setTimeout(_ => reject("Waiting for MQ to return [clients] message timed out"), this.requestsTimeout);
            let requestid = uid2(6);
            let servercount = await this.allSurvivalCount();
            let result = [];
            let callback = function (clients) {
                if (--servercount > 0) {
                    result = result.concat(clients);
                }
                else {
                    this.requests.delete(requestid);
                    clearInterval(requestoutid);
                    result = result.concat(clients);
                    resolve([...new Set(result)]);
                }
            };
            let msg = msgpack.encode([RequestMethod.clients, this.uid, requestid, [...rooms]]);
            this.publish(msg);
            this.requests.set(requestid, callback);
        });
    }
    /**
     * Gets the list of rooms a given client has joined.
     *
     * @param {String} client id
     */
    clientRooms(id) {
        return new Promise(async (resolve, reject) => {
            let requestoutid = setTimeout(_ => reject("Waiting for MQ to return [clientRooms] message timed out"), this.requestsTimeout);
            let requestid = uid2(6);
            let servercount = await this.allSurvivalCount();
            let result = [];
            let callback = function (rooms) {
                if (--servercount > 0) {
                    result = result.concat(rooms);
                }
                else {
                    this.requests.delete(requestid);
                    clearInterval(requestoutid);
                    result = result.concat(rooms);
                    resolve([...new Set(result)]);
                }
            };
            let msg = msgpack.encode([RequestMethod.clientRooms, this.uid, requestid, id]);
            this.publish(msg);
            this.requests.set(requestid, callback);
        });
    }
    /**
     * Gets the list of all rooms (accross every node)
     *
     */
    allRooms() {
        return new Promise(async (resolve, reject) => {
            let requestoutid = setTimeout(_ => reject("Waiting for MQ to return [allRooms] message timed out"), this.requestsTimeout);
            let requestid = uid2(6);
            let servercount = await this.allSurvivalCount();
            let result = [];
            let callback = function (rooms) {
                if (--servercount > 0) {
                    result = result.concat(rooms);
                }
                else {
                    this.requests.delete(requestid);
                    clearInterval(requestoutid);
                    result = result.concat(rooms);
                    resolve([...new Set(result)]);
                }
            };
            let msg = msgpack.encode([RequestMethod.allRooms, this.uid, requestid]);
            this.publish(msg);
            this.requests.set(requestid, callback);
        });
    }
    /**
     * Sends a new custom request to other nodes
     *
     * @param {Object} data (no binary)
     */
    customRequest(data) {
        return new Promise(async (resolve, reject) => {
            let requestoutid = setTimeout(_ => reject("Waiting for MQ to return [customRequest] message timed out"), this.requestsTimeout);
            let requestid = uid2(6);
            let servercount = await this.allSurvivalCount();
            let result = [];
            let callback = function (data) {
                if (--servercount > 0) {
                    result.push(data);
                }
                else {
                    this.requests.delete(requestid);
                    clearInterval(requestoutid);
                    result.push(data);
                    resolve(result);
                }
            };
            let msg = msgpack.encode([RequestMethod.customRequest, this.uid, requestid, data]);
            this.publish(msg);
            this.requests.set(requestid, callback);
        });
    }
    /**
     * Makes the socket with the given id to be disconnected forcefully
     * @param {String} socket id
     * @param {Boolean} close if `true`, closes the underlying connection
     */
    remoteDisconnec(id, close) {
        return new Promise(async (resolve, reject) => {
            let requestoutid = setTimeout(_ => reject("Waiting for MQ to return [remoteDisconnec] message timed out"), this.requestsTimeout);
            let requestid = uid2(6);
            let servercount = await this.allSurvivalCount();
            let callback = function (result) {
                if (--servercount > 0) { }
                else {
                    this.requests.delete(requestid);
                    clearInterval(requestoutid);
                    resolve();
                }
            };
            this.publish(msgpack.encode([RequestMethod.remoteDisconnec, this.uid, requestid, id, close]));
            this.requests.set(requestid, callback);
        });
    }
}
module.exports = createAdapter;
