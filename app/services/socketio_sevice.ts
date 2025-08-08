import { Server } from 'socket.io'
import server from '@adonisjs/core/services/server'
import {
  createWebRtcTransport,
  getRouterRtpCapabilities,
  initMediasoup,
} from '#services/mediasoup_service'

export default class SocketioService {
  public static wsio: Server

  public async init() {
    SocketioService.wsio = new Server(server.getNodeServer(), {})

    await initMediasoup()

    const peers = new Map()

    SocketioService.wsio.on('connection', (socket) => {
      console.log(`    ------        Connection connected: ${socket.id}`)
      //***********mediasoup
      peers.set(socket.id, {
        transports: [],
        producers: [],
        consumers: [],
      })
      socket.on('disconnect', () => {
        // Clean up
        const peer = peers.get(socket.id)
        if (peer) {
          peer.producers.forEach((p) => p.close())
          peer.transports.forEach((t) => t.close())
        }
        peers.delete(socket.id)
      })
      // Step 1: Send Router RTP Capabilities
      socket.on('getRouterRtpCapabilities', (_, callback) => {
        const rtpCapabilities = getRouterRtpCapabilities()
        callback(rtpCapabilities)
      })
      // Step 2: Create WebRTC Transport
      socket.on('createWebRtcTransport', async (callback) => {
        try {
          const transport = await createWebRtcTransport()
          console.log('transport', transport)
          // Store transport in peers map
          if (!peers.has(socket.id)) {
            peers.set(socket.id, { transports: [], producers: [], consumers: [] })
          }
          peers.get(socket.id).transports.push(transport)

          callback({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          })

          // Handle DTLS Connect
          socket.on('connectTransport', async ({ dtlsParameters }) => {
            await transport.connect({ dtlsParameters })
            console.log('connectTransport')
          })

          // Handle producer creation
          socket.on('produce', async (data, callback) => {
            console.log('produce', data)
            const peer = peers.get(socket.id)
            if (!peer) {
              return callback({ error: 'Peer not found' })
            }

            // Usually you use the first transport created by this peer for producing:
            const transport = peer.transports[0]
            if (!transport) {
              return callback({ error: 'Transport not found' })
            }
            const producer = await transport.produce({ kind, rtpParameters })
            console.log(`producer ${socket.id} start stream`, producer)

            // Save it
            peers.get(socket.id).producers.push(producer)
            // Notify others
            socket.broadcast.emit('new-producer', {
              socketId: socket.id,
              producerId: producer.id,
              kind,
            })
            callback({ id: producer.id })
          })

          // Handle consumer creation
          socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
            function findProducerById(producerId) {
              for (const [socketId, peer] of peers.entries()) {
                const producer = peer.producers.find((p) => p.id === producerId)
                if (producer) return producer
              }
              return null
            }

            const producer = findProducerById(producerId) // search in peers
            if (!producer) {
              return callback({ error: 'Producer not found' })
            }
            const transport = peers.get(socket.id)?.transports[0]
            const consumer = await transport.consume({
              producerId: producer?.id,
              rtpCapabilities,
              paused: false,
            })
            // Save consumer
            peers.get(socket.id).consumers.push(consumer)

            callback({
              id: consumer.id,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
            })
          })
        } catch (err) {
          console.error('❌ Error creating WebRTC Transport:', err)
          callback({ error: err.message })
        }
      })

      //***********end mediasoup

      socket.on('JoinRoom', (data) => {
        console.log(`    ------ Joined room: ${data.roomId}`)
        socket.join(`stream-${data.roomId}`)
        socket.emit('JoinedRoom', data)
        SocketioService.wsio
          .to(`stream-${data.roomId}`)
          .emit('UserJoined', `user ${socket.id} joined in stream-${data.roomId}`)
      })
      socket.on('Disconnect', () => {
        console.log(`    ------ Disconnected from stream-${socket.id}`)
        SocketioService.wsio
          .to(`stream-${data.roomId}`)
          .emit('UserDisconnected', `user ${socket.id} disconnected from stream-${data.roomId}`)
      })
    })
  }
}
