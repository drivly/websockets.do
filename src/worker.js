export { ChannelHost } from './channels.durable.js'

export const api = {
  icon: '🚀',
  name: 'websockets.do',
  description: 'Cloudflare Worker Template',
  url: 'https://websockets.do/api',
  type: 'https://apis.do/scraping',
  endpoints: {
  },
  site: 'https://websockets.do',
  login: 'https://websockets.do/login',
  signup: 'https://websockets.do/signup',
  subscribe: 'https://websockets.do/subscribe',
  repo: 'https://github.com/drivly/websockets.do',
}
  
export const gettingStarted = [
  `If you don't already have a JSON Viewer Browser Extension, get that first:`,
  `https://extensions.do`,
]

export const examples = {
  listItems: 'https://websockets.do/worker',
}
  
export default {
  fetch: async (req, env) => {
    const { user, hostname, pathname, rootPath, pathSegments, query } = await env.CTX.fetch(req).then(res => res.json())
    if (rootPath) return json({ api, gettingStarted, examples, user })

    const durable = env.ChannelHost.get(env.ChannelHost.idFromName(pathSegments[0]))

    if (pathSegments[1] === 'listen') {
      const resp = await durable.fetch(
        'https://websocket.do/listen',
        {
          headers: { Upgrade: 'websocket' }
        }
      )

      return new Response(null, {
        status: 101,
        webSocket: resp.webSocket,
      })
    }

    const resp = await durable.fetch(req)

    return json({
      api,
      'data': await resp.json(),
      user
    }, { status: resp.status })
  }
}

const json = (payload, opt) => new Response(JSON.stringify(payload, null, 2), { headers: { 'Content-Type': 'application/json' }, ...opt })