import { Server } from 'socket.io'
import server from '@adonisjs/core/services/server'
import {
  createWebRtcTransport,
  filterSupportedCodecs,
  getRouterRtpCapabilities,
  initMediasoup,
  mediaCodecs,
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
          socket.on('connectTransport', async ({ dtlsParameters }, callback) => {
            await transport.connect({ dtlsParameters })
            console.log('connectTransport')
            callback({ status: 'success' })
          })

          // Handle producer creation
          socket.on('produce', async ({ kind, rtpParameters, sdp, type }, callback) => {
            console.log('produce', kind, rtpParameters, sdp, type)
            const peer = peers.get(socket.id)
            if (!peer) {
              return callback({ error: 'Peer not found' })
            }

            // Usually you use the first transport created by this peer for producing:
            const transport = peer.transports[0]
            if (!transport) {
              return callback({ error: 'Transport not found' })
            }

            // Before calling produce:
            const { videoParams, audioParams } = filterSupportedCodecs(rtpParameters)
            const videoProducer = await transport.produce({
              kind: 'video',
              rtpParameters: videoParams,
            })
            const audioProducer = await transport.produce({
              kind: 'audio',
              rtpParameters: audioParams,
            })
            // const producer = await transport.produce({ kind, rtpParameters })
            console.log(`======video producer ${socket.id} start stream`, videoProducer)
            console.log(`======audio producer ${socket.id} start stream`, audioProducer)

            // Save both producers in the peer
            const peer = peers.get(socket.id)
            if (!peer.producers) peer.producers = []
            peer.producers.push(videoProducer)
            peer.producers.push(audioProducer)

            // Notify others about each producer separately
            socket.broadcast.emit('new-producer', {
              socketId: socket.id,
              producerId: videoProducer.id,
              kind: 'video',
            })

            socket.broadcast.emit('new-producer', {
              socketId: socket.id,
              producerId: audioProducer.id,
              kind: 'audio',
            })

            callback({
              audioProducerId: audioProducer.id,
              videoProducerId: videoProducer.id,
            })
          })

          // Handle consumer creation
          socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
            // Find producer by id in all peers
            function findProducerById(producerId) {
              for (const [socketId, peer] of peers.entries()) {
                const producer = peer.producers.find((p) => p.id === producerId)
                if (producer) return producer
              }
              return null
            }

            const producer = findProducerById(producerId)
            if (!producer) {
              return callback({ error: 'Producer not found' })
            }

            const peer = peers.get(socket.id)
            if (!peer) {
              return callback({ error: 'Peer not found' })
            }

            // If you have multiple transports per peer, pick the right one by kind
            // Example assumes transport.appData.kind is set to 'audio' or 'video' during creation
            let transport = peer.transports[0]
            if (peer.transports.length > 1) {
              transport =
                peer.transports.find((t) => t.appData?.kind === producer.kind) || peer.transports[0]
            }

            try {
              const consumer = await transport.consume({
                producerId: producer.id,
                rtpCapabilities,
                paused: false,
              })

              peer.consumers.push(consumer)

              callback({
                id: consumer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
              })
            } catch (error) {
              console.error('Error consuming:', error)
              callback({ error: error.message })
            }
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
      socket.on('Disconnect', (data) => {
        console.log(`    ------ Disconnected from stream-${socket.id}`)
        SocketioService.wsio
          .to(`stream-${data.roomId}`)
          .emit('UserDisconnected', `user ${socket.id} disconnected from stream-${data.roomId}`)
      })
    })
  }
}
