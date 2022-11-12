# websockets.do

### Routes
#### /:channel/emit - GET/POST
Emits an event to all connected clients. Payload can be either via a JSON POST body or a GET URL parameters.

##### Optional parameters
`?clients=<numberOrClientIDs>`

This query parameter will signal to the API that the message should only be sent to either specific, or a random range of clients.

`?require-ack=true`
This will signal to the API that the HTTP response should wait until all clients have acknowledged the message before returning. There is a built in timeout of 5 seconds, after which the API will return a 408 error.

#### /:channel/listen - GET/WS
Returns a Websocket that returns all events sent to the channel.

### Protocol specification

All messages will be sent as JSON objects. Inside the messages, will always contain at least 4 properties: `type`, `payload`, `eventID`, and `clientID`. These properties are used to signal to the client and server what event is being processed.

##### Server -> Client
###### `type: "DATA"`
This is the default type of message. Sent after an emit event comes from either a GET or POST request. The payload will be the data that was sent from the client.

This event may also include optional parameters such as `require_ack`. If this parameter is set to true, the client will be expected to send an ACK message back to the server.

**Example event**
```json
{
  "type": "DATA",
  "payload": {
    "hello": "world"
  },
  "clientID": "client_fXoSDfqi",
  "latency": 0,
  "requires_ack": true,
  "eventID": "evt_gPVZZQC5"
}
```

###### `type: "PING"`
This is a message that is sent to the client to check if the connection is still alive. The client should respond with a `PONG` message (see below on how to send messages to the server).

**Example event**
```json
{
  "type": "PING",
  "payload": {},
  "latency": 0,
  "clientID": "client_fXoSDfqi",
}
```

###### `type: "CONNECTED"`
This is a message that is sent to the client when the connection is first established. The client will receive a unique ID that will be used to identify the client. The server will also send the current member list of the channel.

**Example event**
```json
{
  "type": "CONNECTED",
  "payload": {
    "members": [
      {
        "clientID": "client_X0JBf69q",
        "presence": {
          "username": "Cerulean"
        }
      }
    ]
  },
  "clientID": "client_ZAqKx5ho",
  "latency": 0
}
```

###### `type: "PRESENCE:JOINED"`
An event sent to the client when a new client joins the channel. The payload will contain the clientID and presence data of the new client.

**Example event**
```json
{
  "type": "PRESENCE:JOINED",
  "payload": {
    "clientID": "client_ZAqKx5ho",
    "presence": {}
  },
  "clientID": "client_X0JBf69q",
  "latency": 0
}
```

###### `type: "PRESENCE:LEFT"`
An event sent to the client when a client leaves the channel. The payload will contain the clientID of the client that left.

**Example event**
```json
{
  "type": "PRESENCE:LEFT",
  "payload": {
    "clientID": "client_rTLNQ28O"
  },
  "clientID": "client_hp39x_sa",
  "latency": 0
}
```

###### `type: "PRESENCE:UPDATED"`
An event sent to the client when a client updates their presence data. The payload will contain the clientID and presence data of the client that updated.

**Example event**
```json
{
  "type": "PRESENCE:UPDATED",
  "payload": {
    "clientID": "client_hp39x_sa",
    "presence": {
      "username": "Cerulean"
    }
  },
  "clientID": "client_hp39x_sa",
  "latency": 0
}
```

###### `type: "ERROR"`
This is a message that is sent to the client when an error occurs. The payload will contain the error message. Depending on the error, the client may be disconnected. For example, if you dont respond to PING events, the server will return an `ERROR` event and disconnect the client.

**Example event**
```json
{
  "type": "ERROR",
  "payload": {
	"message": "Client did not respond to PING event",
	"code": "PING_TIMEOUT"
  },
  "latency": 0,
  "clientID": "client_fXoSDfqi",
}
```

##### Client -> Server
###### `type: "ACK"`
This is a message that is sent to the server to acknowledge that the client has received the message. The payload will contain the eventID of the message that was acknowledged.

**Example event**
```json
{
  "type": "ACK",
  "payload": {
	"eventID": "evt_gPVZZQC5"
  }
}
```

###### `type: "PONG"`
This is a message that is sent to the server to acknowledge that the client is still connected. This is a **required** event to send back to the server after receiving a `PING` event. If the client does not respond to a `PING` event, the server will disconnect the client after a timeout.

**Example event**
```json
{
  "type": "PONG",
}
```