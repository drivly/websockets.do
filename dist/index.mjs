// node_modules/nanoevents/index.js
var createNanoEvents = () => ({
  events: {},
  emit(event, ...args) {
    let callbacks = this.events[event] || [];
    for (let i = 0, length = callbacks.length; i < length; i++) {
      callbacks[i](...args);
    }
  },
  on(event, cb) {
    this.events[event]?.push(cb) || (this.events[event] = [cb]);
    return () => {
      this.events[event] = this.events[event]?.filter((i) => cb !== i);
    };
  }
});

// node_modules/nanoid/index.browser.js
var nanoid = (size = 21) => crypto.getRandomValues(new Uint8Array(size)).reduce((id2, byte) => {
  byte &= 63;
  if (byte < 36) {
    id2 += byte.toString(36);
  } else if (byte < 62) {
    id2 += (byte - 26).toString(36).toUpperCase();
  } else if (byte > 62) {
    id2 += "-";
  } else {
    id2 += "_";
  }
  return id2;
}, "");

// src/channels.durable.js
var id = (i) => `${i}_${nanoid(8)}`;
var ChannelHost = class {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.history = [];
    this.events = createNanoEvents();
    this.clients = {};
  }
  async fetch(req, env, context) {
    const url = new URL(req.url);
    const channelID = url.pathname.split("/")[1];
    if (url.pathname.includes("/history")) {
      let limit = 100;
      if (url.searchParams.has("limit")) {
        limit = parseInt(url.searchParams.get("limit"));
      }
      const history = await this.state.storage.list({
        prefix: "history:",
        limit
      });
      return json({
        "history": Array.from(history.values()).map(JSON.parse)
      });
    }
    if (url.pathname.includes("/listen")) {
      const pair = new WebSocketPair();
      const client = pair[1];
      const server = pair[0];
      server.accept();
      const clientID = id("client");
      let presence = {};
      let ping_timeout = 0;
      let ping_sent = new Date();
      let ping_latency = 0;
      const send = (type, payload, opt) => {
        server.send(JSON.stringify({ type, payload, clientID, latency: ping_latency, ...opt }, null, 2));
      };
      this.events.on("broadcast", async (payload, opt) => {
        send("DATA", payload, opt || {});
      });
      server.addEventListener("close", () => {
        delete this.clients[clientID];
        Object.values(this.clients).map((client2) => {
          client2.send("PRESENCE:LEFT", { clientID });
        });
      });
      server.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        switch (data?.type.toLowerCase()) {
          case "pong":
            ping_latency = new Date() - ping_sent;
            ping_sent = new Date();
            ping_timeout = 0;
            break;
          case "presence":
            presence = data.payload;
            Object.values(this.clients).map((client2) => {
              client2.send("PRESENCE:UPDATED", { clientID, presence });
            });
            this.clients[clientID].presence = presence;
            break;
          default:
            this.events.emit(`client:${clientID}:message`, data);
            break;
        }
      });
      let clr;
      clr = setInterval(() => {
        if (ping_timeout >= 50) {
          console.log(`[CHANNEL:${channelID}] Client ${clientID} timed out.`);
          clearInterval(clr);
          send(
            "ERROR",
            {
              message: "Failed to respond to ping in time.",
              code: "PING_TIMEOUT"
            }
          );
          delete this.clients[clientID];
          Object.values(this.clients).map((client2) => {
            client2.send("PRESENCE:LEFT", { clientID });
          });
          server.close();
          return;
        }
        send("PING", {});
        ping_timeout++;
      }, 1500);
      Object.values(this.clients).map((client2) => {
        client2.send("PRESENCE:JOINED", { clientID, presence });
      });
      send(
        "CONNECTED",
        {
          members: Object.values(this.clients).map((client2) => ({ clientID: client2.clientID, presence: client2.presence }))
        }
      );
      this.clients[clientID] = {
        clientID,
        presence,
        send
      };
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname.includes("/emit")) {
      const eventID = id("evt");
      let payload = {};
      if (req.method === "POST") {
        payload = await req.json();
      } else {
        payload = Object.fromEntries(url.searchParams.entries());
      }
      if (!Object.keys(payload).length) {
        return json({ success: false, error: "No payload provided." }, { status: 400 });
      }
      const clients = url.searchParams.get("clients") || "";
      const targets = [];
      if (clients.length && /^-?\d+$/.test(clients)) {
        const rand = Math.abs(parseInt(clients));
        if (rand > Object.keys(this.clients).length) {
          return json({ success: false, error: "Not enough clients to target." }, { status: 400 });
        }
        for (let i = 0; i < rand; i++) {
          let check = null;
          while (!check) {
            const clientID = Object.keys(this.clients)[Math.floor(Math.random() * Object.keys(this.clients).length)];
            check = targets.map((cli) => cli.clientID).includes(clientID) ? null : clientID;
          }
          targets.push(this.clients[check]);
        }
      } else if (clients.length) {
        clients.split(",").map((clientID) => {
          if (this.clients[clientID]) {
            targets.push(this.clients[clientID]);
          }
        });
      }
      if (targets.length) {
        const ack = url.searchParams.get("require-ack");
        targets.map((target) => {
          target.send("DATA", payload, { requires_ack: !!ack, eventID });
        });
        if (ack) {
          await Promise.race([
            Promise.all(targets.map((client) => {
              return new Promise((resolve, reject) => {
                let unbind;
                const listener = (data) => {
                  if (data?.type.toLowerCase() === "ack" && data?.payload?.eventID === eventID) {
                    unbind();
                    resolve(data.payload);
                    client.send(
                      "ACK-RECIEVED",
                      {
                        eventID
                      }
                    );
                  }
                };
                unbind = this.events.on(`client:${client.clientID}:message`, listener);
              });
            })),
            new Promise((res) => setTimeout(res, 5e3))
          ]);
        }
      } else {
        this.events.emit("broadcast", payload, { eventID });
      }
      await this.state.storage.put(
        `history:${id("evt")}`,
        JSON.stringify(payload)
      );
      return json({ success: true });
    }
  }
};
var json = (payload, opt) => new Response(JSON.stringify(payload, null, 2), { headers: { "Content-Type": "application/json" }, ...opt });

// src/worker.js
var api = {
  icon: "\u{1F680}",
  name: "websockets.do",
  description: "Cloudflare Worker Template",
  url: "https://websockets.do/api",
  type: "https://apis.do/scraping",
  endpoints: {},
  site: "https://websockets.do",
  login: "https://websockets.do/login",
  signup: "https://websockets.do/signup",
  subscribe: "https://websockets.do/subscribe",
  repo: "https://github.com/drivly/websockets.do"
};
var gettingStarted = [
  `If you don't already have a JSON Viewer Browser Extension, get that first:`,
  `https://extensions.do`
];
var examples = {
  listItems: "https://websockets.do/worker"
};
var worker_default = {
  fetch: async (req, env) => {
    const { user, hostname, pathname, rootPath, pathSegments, query } = await env.CTX.fetch(req).then((res) => res.json());
    if (rootPath)
      return json2({ api, gettingStarted, examples, user });
    const durable = env.ChannelHost.get(env.ChannelHost.idFromName(pathSegments[0]));
    if (pathSegments[1] === "listen") {
      const resp2 = await durable.fetch(
        "https://websocket.do/listen",
        {
          headers: { Upgrade: "websocket" }
        }
      );
      return new Response(null, {
        status: 101,
        webSocket: resp2.webSocket
      });
    }
    const resp = await durable.fetch(req);
    return json2({
      api,
      "data": await resp.json(),
      user
    }, { status: resp.status });
  }
};
var json2 = (payload, opt) => new Response(JSON.stringify(payload, null, 2), { headers: { "Content-Type": "application/json" }, ...opt });
export {
  ChannelHost,
  api,
  worker_default as default,
  examples,
  gettingStarted
};
