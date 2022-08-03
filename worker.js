export default {
  fetch: (req, env, ctx) => {
    return new Response(JSON.stringify({hello: 123}, { headers: { 'content-type': 'application/json' }}) 
  }
}
