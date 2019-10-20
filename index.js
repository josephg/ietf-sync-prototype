const express = require('express')
const type = require('ot-text-unicode').type

const app = express()
app.use(express.static(__dirname + '/public'))

// We're going to make a simple text document
let document = 'hi'
let version = 1n

const clients = new Set()

const PATCH_TYPE = 'application/x-text-ot-unicode'

const vToTag = v => {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(version)
    return b.toString('hex')
}

app.get('/doc', (req, res) => {
    console.table(req.headers)
    res.setHeader('accept-patch', PATCH_TYPE)
    if (req.headers['accept'] === 'text/event-stream') {
        res.setHeader('content-type', 'text/event-stream')
        res.setHeader('cache-control', 'no-cache')
        res.setHeader('connection', 'keep-alive')

        const etagReq = req.headers['etag'] || req.headers['last-event-id']
        const etagCur = vToTag(version)
        if (etagReq == null || etagReq !== etagCur) {
            // We need to send a snapshot of the existing state of the document
            res.write(`id: ${etagCur}\n`)
            res.write(`data: ${JSON.stringify({type: 'snapshot', data: document})}\n\n`)
        }

        clients.add(res)

        const pinger = setInterval(() => {
            res.write('event: ping\ndata: \n\n')
        }, 5000)
        req.on('close', () => {
            console.log('es ended')
            clients.delete(res)
            clearInterval(pinger)
        })
        
    } else {
        res.setHeader('content-type', 'text/plain')
        res.setHeader('accept-patch', PATCH_TYPE)
        res.setHeader('etag', vToTag(version))
    
        res.send(document)
    }
})

app.patch('/doc', require('body-parser').json({
    type: PATCH_TYPE
}), (req, res) => {
    console.log('got patch', req.body)

    const ifmatch = req.headers['if-match']

    if (req.headers['content-type'] !== PATCH_TYPE) {
        res.setHeader('accept-patch', PATCH_TYPE)
        return res.sendStatus(415)
    } else if (ifmatch != null && ifmatch !== vToTag(version)) {
        // Do OT if we can...
        return res.sendStatus(409)
    }

    const op = req.body
    try {
        document = type.apply(document, op)
    } catch (e) {
        console.log(e.stack)
        return res.status(400).send(e.stack)
    }
    version++

    const etag = vToTag(version)
    res.setHeader('etag', etag)
    res.sendStatus(204)

    for (const c of clients) {
        c.write(`id: ${etag}\ndata: ${JSON.stringify({type: 'patch', data: op})}\n\n`)
    }
})

require('http').createServer(app).listen(4444)
console.log('listening on 4444')