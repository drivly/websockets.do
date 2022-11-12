import { createNanoEvents } from 'nanoevents'
import { nanoid } from 'nanoid'

const id = (i) => `${i}_${nanoid(8)}`

export class ChannelHost {
	constructor(state, env) {
	  // Setup the durable object
	  this.state = state
	  this.env = env

	  this.history = [] // Capped at 1000mb
    this.events = createNanoEvents()
    this.clients = {}
	}
  
	async fetch(req, env, context) {
    const url = new URL(req.url)

    const channelID = url.pathname.split('/')[1]

    if (url.pathname.includes('/history')) {
      let limit = 100
      if (url.searchParams.has('limit')) {
        limit = parseInt(url.searchParams.get('limit'))
      }

      const history = await this.state.storage.list({
        prefix: 'history:',
        limit
      })

      return json({
        'history': Array.from(history.values()).map(JSON.parse)
      })
    }

    if (url.pathname.includes('/listen')) {
      const pair = new WebSocketPair()

      const client = pair[1]
      const server = pair[0]
      
      server.accept()

      const clientID = id('client')
      let presence = {}
      let ping_timeout = 0
      let ping_sent = new Date()
      let ping_latency = 0

      const send = (type, payload, opt) => {
        server.send(JSON.stringify({ type, payload, clientID, latency: ping_latency, ...opt }, null, 2))
      }

      this.events.on('broadcast', async (payload, opt) => {
        send('DATA', payload, opt || {})
      })

      server.addEventListener('close', () => {
        delete this.clients[clientID]
        Object.values(this.clients).map(client => {
          client.send('PRESENCE:LEFT', { clientID })
        })
      })

      server.addEventListener('message', (event) => {
        const data = JSON.parse(event.data)

        switch (data?.type.toLowerCase()) {
          case 'pong':
            ping_latency = new Date() - ping_sent
            ping_sent = new Date()
            ping_timeout = 0
            break
          case 'presence':
            // This client has set or wants to update their presence
            // Transmit to all other clients that this client is now known as this
            presence = data.payload

            Object.values(this.clients).map(client => {
              client.send('PRESENCE:UPDATED', { clientID, presence })
            })

            this.clients[clientID].presence = presence
            break
          default:
            // In case of no type we are specifically watching for,
            // just broadcast the data and see who picks up.
            this.events.emit(`client:${clientID}:message`, data)
            break
        }
      })

      let clr
      clr = setInterval(() => {
        if (ping_timeout >= 50) {
          // No response after 3 pings.
          console.log(`[CHANNEL:${channelID}] Client ${clientID} timed out.`)
          clearInterval(clr)

          send(
            'ERROR',
            {
              message: 'Failed to respond to ping in time.',
              code: 'PING_TIMEOUT'
            }
          )

          // Remove the client from the list.
          delete this.clients[clientID]

          // Send a presence update to all other clients.
          Object.values(this.clients).map(client => {
            client.send('PRESENCE:LEFT', { clientID })
          })

          server.close()
          return
        }

        send('PING', {})
        ping_timeout++
      }, 1500)
      
      // Transmit to all other clients that this client has joined
      Object.values(this.clients).map(client => {
        client.send('PRESENCE:JOINED', { clientID, presence })
      })

      send(
        'CONNECTED',
        {
          members: Object.values(this.clients).map(client => ({ clientID: client.clientID, presence: client.presence }))
        }
      )
      
      // Add this client to our global list of connected clients.
      this.clients[clientID] = {
        clientID,
        presence,
        send,
      }
      
      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname.includes('/emit')) {
      const eventID = id('evt')
      let payload = {}

      if (req.method === 'POST') {
        payload = await req.json()
      } else {
        // Convert all query params to an object
        payload = Object.fromEntries(url.searchParams.entries())
      }

      if (!Object.keys(payload).length) {
        return json({success: false, error: 'No payload provided.'}, { status: 400 })
      }

      // The clients URL parameter could be used as a way to target specific clients.
      // It is either a number, or a comma separated list of IDs.
      // If its a number, we need to pick that many random clients.

      const clients = url.searchParams.get('clients') || ''
      const targets = []

      if (clients.length && /^-?\d+$/.test(clients)) {
        // Its a number, pick that many random clients.
        const rand = Math.abs(parseInt(clients))

        if (rand > Object.keys(this.clients).length) {
          return json({success: false, error: 'Not enough clients to target.'}, { status: 400 })
        }

        for (let i = 0; i < rand; i++) {
          let check = null

          while (!check) {
            const clientID = Object.keys(this.clients)[Math.floor(Math.random() * Object.keys(this.clients).length)]

            check = targets.map(cli => cli.clientID).includes(clientID) ? null : clientID
          }
          
          targets.push(this.clients[check])
        }
      } else if (clients.length) {
        // Its a comma separated list of IDs.
        clients.split(',').map(clientID => {
          if (this.clients[clientID]) {
            targets.push(this.clients[clientID])
          }
        })
      }

      if (targets.length) {
        // Now we can check if we require acknowledgement from the clients.
        
        const ack = url.searchParams.get('require-ack')

        targets.map(target => {
          target.send('DATA', payload, { requires_ack: !!ack, eventID })
        })

        if (ack) {
          // Setup listners
          await Promise.race([
            Promise.all(targets.map(client => {
              return new Promise((resolve, reject) => {
                let unbind
                const listener = (data) => {
                  if (data?.type.toLowerCase() === 'ack' && data?.payload?.eventID === eventID) {
                    unbind()
                    resolve(data.payload)
  
                    client.send(
                      'ACK-RECIEVED',
                      {
                        eventID
                      }
                    )
                  }
                }
  
                unbind = this.events.on(`client:${client.clientID}:message`, listener)
              })
            })),
            new Promise(res => setTimeout(res, 5000))
          ])
        }
      } else {
        this.events.emit('broadcast', payload, { eventID })
      }

      await this.state.storage.put(
        `history:${id('evt')}`,
        JSON.stringify(payload)
      )
      
      return json({ success: true })
    }
	}
}

const json = (payload, opt) => new Response(JSON.stringify(payload, null, 2), { headers: { 'Content-Type': 'application/json' }, ...opt })