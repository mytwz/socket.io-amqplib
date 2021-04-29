
/*
 * @Author: Summer
 * @LastEditors: Summer
 * @Description: 
 * @Date: 2021-04-15 17:29:34 +0800
 * @LastEditTime: 2021-04-29 16:31:19 +0800
 * @FilePath: /socket.io-amqplib/src/index.ts
 */
import uid2 = require("uid2");
import { Namespace } from "socket.io";
import { connect, Channel, ConsumeMessage } from "amqplib";
import { Redis, RedisOptions } from "ioredis"
import ioredis from "ioredis"
import { hostname } from "os";
const msgpack = require("notepack.io");
const Adapter = require("socket.io-adapter");
const debug = require("debug")("socket.io-amqplib");

type BroadcastOptions = any
type Room = string;
type SocketId = string
type CustomHook = (data: any, cb:Function) => void;

enum RequestMethod {
    add = 0,
    del,
    delAll,
    broadcast,

    clients,
    clientRooms,
    allRooms,
    customRequest,
    remoteDisconnec,
    ////////////////////
    response
}

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

ioredis.prototype.keys = async function (pattern: string) {
    let cursor = 0;
    let list: string[] = [];
    do {
        let res = await this.scan(cursor, "match", pattern, "count", 2000);
        cursor = +res[0];
        list = list.concat(res[1]);
    } while (cursor != 0);

    return list;
}

function createAdapter(uri: string, opts: Partial<AmqplibAdapterOptions> = {}) {
    // handle options only
    return function (nsp: Namespace) {
        return new AmqplibAdapter(nsp, uri, opts);
    };
}

const REDIS_SURVIVAL_KEY = `socket.io-survival:${hostname()}:${process.pid}`


let __mqsub: Channel;
let __mqpub: Channel;
let redisdata: Redis;

class AmqplibAdapter extends Adapter {

    public readonly uid: string;
    public readonly requestsTimeout: number;

    private readonly channel: string;
    private readonly requests: Map<string, Function> = new Map();

    public customHook: CustomHook = (data: any, cb: Function) => cb(null);

    constructor(private nsp: Namespace, private uri: string, private opts: Partial<AmqplibAdapterOptions> = {}) {
        super(nsp);

        this.uid = uid2(6);
        this.requestsTimeout = this.opts.requestsTimeout || 5000;

        const prefix = opts.key || "socket.io";

        this.channel = prefix + "-message";

        this.init()
    }

    async init() {
        try {

            redisdata = new ioredis(this.opts);
            if(this.opts?.password) redisdata.auth(this.opts.password).then(_=> debug("redis", "Password verification succeeded"))
            
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
            
            setInterval(this.survivalHeartbeat.bind(this), 1000);
        } catch (error) {
            this.emit("error", error);
        }
    }
    
    private survivalHeartbeat(){
        if(redisdata){
            redisdata.set(REDIS_SURVIVAL_KEY, 1, "ex", 2);
        }
    }

    /**获取所有存活主机的数量 */
    private async allSurvivalCount(): Promise<number> {
        let keys = await redisdata.keys(`socket.io-survival:*`);
        return keys.length;
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
                        this.customHook(__data, (data: any) => {
                            this.publish(msgpack.encode([RequestMethod.response, uid, requestid, data]));
                        })
                        break;
                    }
                    case RequestMethod.remoteDisconnec: {
                        let [requestid, id, close] = args;
                        var socket = this.nsp.sockets.get(id);
                        if (!socket) { return; }
                        socket.disconnect(close);
                        this.publish(msgpack.encode([RequestMethod.response, uid, requestid, 1]));
                        break;
                    }
                    case RequestMethod.allRooms: {
                        let [requestid] = args;
                        let rooms =  Object.keys(this.rooms);
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
                        if(this.uid == uid){
                            let [requestid, result] = args;
                            this.requests.get(requestid)?.call(this, result);
                        }
                        break;
                    }
                    default:
                        debug("ignoring unknown request type: %s", args[0]);
                }

            } catch (error) {
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
    public async add(id: SocketId, rooms: Set<Room>): Promise<void> {
        this.publish(msgpack.encode([RequestMethod.add, this.uid, id, rooms]))
        super.add(id, rooms);
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
    /**
     * Gets a list of clients by sid.
     *
     * @param {Array} explicit set of rooms to check.
     */
    public clients(rooms: Room[]): Promise<SocketId[]> {
        return new Promise(async (resolve, reject) => {
            let requestoutid = setTimeout(_ => reject("Waiting for MQ to return [clients] message timed out"), this.requestsTimeout);
            let requestid = uid2(6);
            let servercount = await this.allSurvivalCount();
            let result:string[] = [];
            let callback:(this: this, clients:SocketId[]) => void = function(clients: SocketId[]){
                if(--servercount > 0){
                    result = result.concat(clients)
                }
                else {
                    this.requests.delete(requestid)
                    clearInterval(requestoutid)
                    result = result.concat(clients)
                    resolve([...new Set(result)])
                }
            }
            let msg = msgpack.encode([RequestMethod.clients, this.uid, requestid, [...rooms]])
            this.publish(msg)
            this.requests.set(requestid, callback);
        })
    }
    
    /**
     * Gets the list of rooms a given client has joined.
     *
     * @param {String} client id
     */
    public clientRooms(id: SocketId): Promise<Room[] | undefined> {
        return new Promise(async (resolve, reject) => {
            let requestoutid = setTimeout(_ => reject("Waiting for MQ to return [clientRooms] message timed out"), this.requestsTimeout);
            let requestid = uid2(6);
            let servercount = await this.allSurvivalCount();
            let result:string[] = [];
            let callback:(this: this, rooms:string[]) => void = function(rooms: string[]){
                if(--servercount > 0){
                    result = result.concat(rooms)
                }
                else {
                    this.requests.delete(requestid)
                    clearInterval(requestoutid)
                    result = result.concat(rooms)
                    resolve([...new Set(result)])
                }
            }
            let msg = msgpack.encode([RequestMethod.clientRooms, this.uid, requestid, id])
            this.publish(msg)
            this.requests.set(requestid, callback);
        })
    }
    
    /**
     * Gets the list of all rooms (accross every node)
     *
     */
    public allRooms(): Promise<string[]> {
        return new Promise(async (resolve, reject) => {
            let requestoutid = setTimeout(_ => reject("Waiting for MQ to return [allRooms] message timed out"), this.requestsTimeout);
            let requestid = uid2(6);
            let servercount = await this.allSurvivalCount();
            let result:string[] = [];
            let callback:(this: this, rooms:string[]) => void = function(rooms: string[]){
                if(--servercount > 0){
                    result = result.concat(rooms)
                }
                else {
                    this.requests.delete(requestid)
                    clearInterval(requestoutid)
                    result = result.concat(rooms)
                    resolve([...new Set(result)])
                }
            }
            let msg = msgpack.encode([RequestMethod.allRooms, this.uid, requestid])
            this.publish(msg)
            this.requests.set(requestid, callback);
        })
    }
    
    /**
     * Sends a new custom request to other nodes
     *
     * @param {Object} data (no binary)
     */
    public customRequest(data: any): Promise<any[]> {
        return new Promise(async (resolve, reject) => {
            let requestoutid = setTimeout(_ => reject("Waiting for MQ to return [customRequest] message timed out"), this.requestsTimeout);
            let requestid = uid2(6);
            let servercount = await this.allSurvivalCount();
            let result:any[] = [];
            let callback:(this: this, data:any) => void = function(data: any){
                if(--servercount > 0){
                    result.push(data);
                }
                else {
                    this.requests.delete(requestid)
                    clearInterval(requestoutid)
                    result.push(data);
                    resolve(result)
                }
            }
            let msg = msgpack.encode([RequestMethod.customRequest, this.uid, requestid, data])
            this.publish(msg)
            this.requests.set(requestid, callback);
        })
    }
    /**
     * Makes the socket with the given id to be disconnected forcefully
     * @param {String} socket id
     * @param {Boolean} close if `true`, closes the underlying connection
     */
    public remoteDisconnec(id:SocketId, close: boolean): Promise<void> {

        return new Promise(async (resolve, reject) => {
            let requestoutid = setTimeout(_ => reject("Waiting for MQ to return [remoteDisconnec] message timed out"), this.requestsTimeout);
            let requestid = uid2(6);
            let servercount = await this.allSurvivalCount();
            let callback:(this: this, result:boolean) => void = function(result: boolean){
                if(--servercount > 0){ }
                else {
                    this.requests.delete(requestid)
                    clearInterval(requestoutid)
                    resolve()
                }
            }
            this.publish(msgpack.encode([RequestMethod.remoteDisconnec, this.uid, requestid, id, close]))
            this.requests.set(requestid, callback);
        })
    }
}

export = createAdapter;