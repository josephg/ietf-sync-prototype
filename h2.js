const http2 = require('http2');
const https = require('https');
const fs = require('fs');
const streamToIter = require('ministreamiterator')

const makeStateMachine = (initialData, initialVersion, applyFn, versionFn) => {
  let data = initialData
  let version = initialVersion

  const listeners = new Set()

  return {
    get() {
      return {data, version}
    },

    subscribeNow() {
      const stream = streamToIter(() => listeners.delete(stream))
      stream.append({type: 'snapshot', data, version: ''+version})
      listeners.add(stream)
      return stream.iter
    },

    subscribeFrom(fromVersion) {
      if (fromVersion !== version) return this.subscribeNow()
      else {
        const stream = streamToIter(() => listeners.delete(stream))
        listeners.add(stream)
        return stream.iter
      }
    },

    mutate(patch) {
      data = applyFn(data, patch)
      version = versionFn(version, data)
      for (const stream of listeners) {
        stream.append({type: 'patch', data, version: ''+version})
      }
    }
  }
}

const simpleMachine = makeStateMachine(
  1, 1000n,
  (doc, patch) => doc + patch,
  v => v + 1
)

// const server = https.createServer({
const server = http2.createSecureServer({
  key: fs.readFileSync('localhost.key'),
  cert: fs.readFileSync('localhost.crt'),
  allowHTTP1: true,
}, (req, res) => {
  console.log('http version', req.httpVersion, req.method)

  if (req.url === '/stream' && req.method === 'SUBSCRIBE') {
    res.setHeader('content-type', 'text/plain')
    res.setHeader('x-patch-type', 'text/x-add')
    // res.setHeader('cache-control', 'no-cache')
    if (req.httpVersion === '1.1') res.setHeader('connection', 'keep-alive')

    const reqVersion = req.headers['etag']

    // For now the protocol is simply JSON messages separated by newlines.
    const stream = reqVersion == null
      ? simpleMachine.subscribeNow()
      : simpleMachine.subscribeFrom(BigInt(reqVersion))
    
    ;(async () => {
      for await (const event of stream) {
        res.write(JSON.stringify(event) + '\n')
      }
    })()
    
    // const timer = setInterval(() => {
    //   res.write('message\n\n')
    // }, 1000)
    req.on('close', () => {
      console.log('close')
      stream.return()
    })
  } else if (req.url === '/' && req.method === 'GET') {
    res.setHeader('content-type', 'text/html')
    res.end(fs.readFileSync('index2.html'))
  } else {
    res.writeHead(404)
    res.end()
  }
});
// server.on('error', (err) => console.error(err));



/*
server.on('stream', (stream, headers) => {
  console.log('stream')
  // stream is a Duplex
  stream.respond({
    'content-type': 'text/html',
    ':status': 200
  });
  stream.end('<h1>Hello World</h1>');
});
*/

server.listen(8443);
