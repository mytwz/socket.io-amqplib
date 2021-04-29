# socket.io-amqplib
使用　amqplib　作为　SocketIO 的消息中间件，该对象是根据　socket.io-redis@4.0.1  改的，　支持原先的 API ，不过删除了　remoteJoin　and remoteLeave


## 使用方式

```js
var io = require('socket.io')(3000);
var amqplib = require('socket.io-amqplib');
io.adapter(amqplib("amqp://user:123123@127.0.0.1", { key: "socketio", host: 'localhost', port: 6379 }));
```

### AmqplibAdapter#clients(rooms:Array)

返回所有节点上连接到“房间”的客户端ID列表. See [Namespace#clients()](https://github.com/mytwz/socket.io-amqplib#readme)

```js
io.of('/').adapter.clients().then(function (clients) {
  console.log(clients); // an array containing all connected socket ids
});

io.of('/').adapter.clients(['room1', 'room2']).then(function (clients) {
  console.log(clients); // an array containing socket ids in 'room1' and/or 'room2'
});

// you can also use

io.in('room3').clients().then(function (clients) {
  console.log(clients); // an array containing socket ids in 'room3'
});
```

### AmqplibAdapter#clientRooms(id:String)

返回具有给定ID的客户端已加入的房间列表（即使在另一个节点上）。

```js
io.of('/').adapter.clientRooms('<my-id>').then(function (rooms) {
  if (err) { /* unknown id */ }
  console.log(rooms); // an array containing every room a given id has joined.
});
```

### AmqplibAdapter#allRooms()

返回所有房间的列表。

```js
io.of('/').adapter.allRooms().then(function (rooms) {
  console.log(rooms); // an array containing all rooms (accross every node)
});
```

### AmqplibAdapter#join(room:String)

使具有给定id的套接字加入房间。

```js

socket.join(roomid).then(function(){
    console.log("success")
});

```

### AmqplibAdapter#leave(room:String)

使具有给定id的套接字离开房间。

```js

socket.leave(roomid).then(function(){
    console.log("success")
});
```

### AmqplibAdapter#remoteDisconnect(id:String, close:Boolean)

使具有给定id的套接字断开连接。 如果`close`设置为true，它也会关闭底层的套接字。

```js
io.of('/').adapter.remoteDisconnect('<my-id>', true).then(function () {
    console.log("success")
});
```

### AmqplibAdapter#customRequest(data:Object, fn:Function)

向每个节点发送一个请求，该请求将通过`customHook`方法进行响应。

```js
// on every node
io.of('/').adapter.customHook = function (data, cb) {
  cb('hello ' + data);
}

// then
io.of('/').adapter.customRequest('john').then(function(replies){
  console.log(replies); // an array ['hello john', ...] with one element per node
});
```

## License

MIT
