import { Server } from 'socket.io'
import server from '@adonisjs/core/services/server'

import {
  createWebRtcTransport,
  filterSupportedCodecs,
  getPeer,
  getRouterRtpCapabilities,
  initMediasoup,
  mapCodecsToRouter,
  mediaCodecs,
  router,
  setPeer,
} from '#services/mediasoup_service'

export default class SocketioService {
  public static wsio: Server

  public async init() {
    SocketioService.wsio = new Server(server.getNodeServer(), {
      cors: {
        // origin: 'http://127.0.0.1:1191',
        origin: '*',
        methods: ['GET', 'POST'],
      },
    })

    await initMediasoup()

    const streamers = []
    SocketioService.wsio.on('connection', (socket) => {
      console.log(`    ------        Connection connected: ${socket.id}`)

      setPeer(socket.id, 'init')
      //***********mediasoup

      socket.on('disconnect', () => {
        setPeer(socket.id, 'remove')

        // Broadcast updated streamer list
        SocketioService.wsio.emit('streamer-removed', { id: socket.id })
      })
      // Step 1: Send Router RTP Capabilities
      socket.on('getRouterRtpCapabilities', (callback) => {
        console.log('getRouterRtpCapabilities')
        callback(getRouterRtpCapabilities())
      })
      // Step 2: Create WebRTC Transport
      socket.on('createWebRtcTransport', async ({ direction }, callback) => {
        const transport = await createWebRtcTransport({ peerId: socket.id, direction })
        console.log('createWebRtcTransport', transport.id)
        // Store transport in peers map
        setPeer(socket.id, `${direction}-transport`, transport)
        callback({
          status: 'success',
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
          sctpParameters: transport.sctpParameters,
        })
      })
      // Handle DTLS Connect
      socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
        const peer = getPeer(socket.id)
        const transport =
          peer?.sendTransport?.id == transportId
            ? peer?.sendTransport
            : peer?.receiveTransport?.id == transportId
              ? peer?.receiveTransport
              : null
        if (!transport) return callback({ status: 'error', message: 'Peer not found' })

        try {
          await transport.connect({ dtlsParameters })
          callback({ status: 'success' })
          console.log('connectTransport success')
        } catch (err) {
          callback({ status: 'error', message: err.message })
          console.error('connectTransport error', err.message)
        }
      })

      // Handle producer creation
      socket.on('produce', async ({ kind, rtpParameters = {}, sdp, type }, callback) => {
        // console.log('produce', kind, rtpParameters, sdp, type)
        console.log(`----------produce ${kind}-------------`)
        const peer = getPeer(socket.id)
        if (!peer.sendTransport) {
          console.warn(`Peer ${socket.id} not found`)
          return callback({ error: 'Peer not found' })
        }

        const transport = peer.sendTransport

        rtpParameters.codecs = mapCodecsToRouter(rtpParameters.codecs)
        // Before calling produce:
        // const { videoParams, audioParams } = filterSupportedCodecs(rtpParameters)
        console.log(`produce ${kind}`, rtpParameters.codecs)
        const producer = await transport.produce({
          kind: kind,
          rtpParameters: rtpParameters,
        })

        // const producer = await transport.produce({ kind, rtpParameters })
        console.log(
          `======${kind} producer for socket ${socket.id} start|  producer_id:`,
          producer.id
        )

        // Save both producers in the peer
        if (kind == 'video') peer.videoProducer = producer
        if (kind == 'audio') peer.audioProducer = producer

        // Notify others about each producer separately
        if (kind == 'video')
          SocketioService.wsio.emit('streamer-added', {
            id: socket.id,
            video_producer_id: peer.videoProducer?.id,
            audio_producer_id: peer.audioProducer?.id,
          })

        // socket.broadcast.emit('new-producer', {
        //   socketId: socket.id,
        //   producerId: videoProducer.id,
        //   kind: 'video',
        // })
        //
        // socket.broadcast.emit('new-producer', {
        //   socketId: socket.id,
        //   producerId: audioProducer.id,
        //   kind: 'audio',
        // })

        callback({
          id: producer.id,
          // id: socket.id,
          // video_producer_id: peer.videoProducer?.id,
          // audio_producer_id: peer.audioProducer?.id,
        })
      })

      // Handle consumer creation
      socket.on('consume', async ({ streamerId, kind, rtpCapabilities }, callback) => {
        const streamerPeer = getPeer(streamerId)
        const viewerPeer = getPeer(socket.id)
        // rtpCapabilities = router.rtpCapabilities
        if (!streamerPeer) {
          console.warn('Streamer not found')
          return callback({ error: 'Streamer not found' })
        }
        if (!viewerPeer) {
          console.warn('Viewer not found')
          return callback({ error: 'Viewer peer not found' })
        }
        if (!viewerPeer.receiveTransport) {
          console.warn('Recv transport not found')
          return callback({ error: 'Recv transport not found' })
        }

        try {
          let consumersData = {}
          console.log(
            `----------consume ${kind} streamer ${streamerId} producerId ${streamerPeer.videoProducer?.id}-------------`
          )

          // Consume video if available
          if (
            kind == 'video' &&
            streamerPeer.videoProducer &&
            router.canConsume({
              producerId: streamerPeer.videoProducer.id,
              rtpCapabilities,
            })
          ) {
            const videoConsumer = await viewerPeer.receiveTransport.consume({
              producerId: streamerPeer.videoProducer.id,
              rtpCapabilities,
              paused: true,
            })

            console.log('streamerPeer', streamerId)
            console.log('streamerPeerVideoProducerId', streamerPeer.videoProducer.id)
            viewerPeer.consumers.set(`${streamerId}-video`, videoConsumer)
            console.log('consume viewerPeer', socket.id)
            console.log(
              'viewerPeerConsumer for this streamer',
              viewerPeer.consumers.get(`${streamerId}-video`)
            )
            consumersData = {
              producerId: streamerPeer.videoProducer.id,
              id: videoConsumer.id,
              kind: videoConsumer.kind,
              rtpParameters: videoConsumer.rtpParameters,
            }
          }

          // Consume audio if available
          if (
            kind == 'audio' &&
            streamerPeer.audioProducer &&
            router.canConsume({
              producerId: streamerPeer.audioProducer.id,
              rtpCapabilities,
            })
          ) {
            const audioConsumer = await viewerPeer.receiveTransport.consume({
              producerId: streamerPeer.audioProducer.id,
              rtpCapabilities,
              paused: true,
            })
            viewerPeer.consumers.set(`${streamerId}-audio`, audioConsumer)
            consumersData = {
              producerId: streamerPeer.audioProducer.id,
              id: audioConsumer.id,
              kind: audioConsumer.kind,
              rtpParameters: audioConsumer.rtpParameters,
            }
          }
          console.log('send Consumer Data')
          callback(consumersData)
        } catch (error) {
          console.error('Error consuming stream:', error)
          callback({ error: error.message })
        }
      })
      socket.on('resumeConsumer', async ({ streamerId, kind }, callback) => {
        const streamerPeer = getPeer(streamerId)
        const viewerPeer = getPeer(socket.id)
        console.log(`----------resumeConsumer streamer ${streamerId}-------------`)
        // const transport = viewerPeer?.receiveTransport
        console.log('viewerPeer', viewerPeer)
        console.log('consumerId', `${streamerId}-${kind}`)
        const consumer = viewerPeer?.consumers?.get(`${streamerId}-${kind}`)
        console.log(`resume${kind}Consumer  ${consumer.id} for producer ${consumer.producerId}`)
        consumer?.resume() // start receiving packets
        callback({ status: 'success' })
      })
      socket.on('stopProduce', async () => {
        const peer = getPeer(socket.id) // get peer
        console.log(`----stopProduce ${peer?.id} `)

        if (!peer) {
          console.warn(`Peer ${socket.id} not found on stopProduce`)
          return
        }

        // Close and remove video producer if exists
        if (peer.videoProducer) {
          try {
            await peer.videoProducer.close()
            peer.videoProducer = null
            console.log(`Video producer stopped for peer ${socket.id}`)
          } catch (err) {
            console.error(`Error closing video producer for ${socket.id}:`, err)
          }
        }

        // Close and remove audio producer if exists
        if (peer.audioProducer) {
          try {
            await peer.audioProducer.close()
            peer.audioProducer = null
            console.log(`Audio producer stopped for peer ${socket.id}`)
          } catch (err) {
            console.error(`Error closing audio producer for ${socket.id}:`, err)
          }
        }

        // Optionally notify other clients that this streamer stopped producing
        SocketioService.wsio.emit('streamer-removed', { id: socket.id })

        // Optionally update peer state or remove if needed
        setPeer(socket.id, 'remove')

        console.log(`Peer ${socket.id} stopped producing`)
      })

      socket.on('stopConsume', ({ consumerId }, callback) => {
        try {
          console.log('stopConsume', consumerId)
          const peer = getPeer(socket.id) // or peers[socket.id] depending on your data structure
          if (!peer) throw new Error('Peer not found')
          const consumerVideo = peer.consumers.get(`${consumerId}-video`)
          const consumerAudio = peer.consumers.get(`${consumerId}-audio`)
          // if (!consumer) throw new Error('Consumer not found');

          // Close consumer and remove from peer's consumers
          consumerVideo?.close()
          consumerAudio?.close()
          peer.consumers?.delete(`${consumerId}-video`)
          peer.consumers?.delete(`${consumerId}-audio`)

          console.log(`Consumer ${consumerId} stopped and removed from peer ${socket.id}`)

          callback?.({ closed: true })
        } catch (err) {
          console.error(`ConsumerStop Error `)
          console.error(err)

          callback?.({ error: err.message })
        }
      })
      socket.on('transport-ice-candidate', ({ transportId, candidate }) => {
        const peer = getPeer(socket.id)
        if (!peer) {
          console.warn(`Peer not found for socket ${socket.id}`)
          return
        }
        const transport =
          peer?.sendTransport?.id == transportId
            ? peer?.sendTransport
            : peer?.receiveTransport?.id == transportId
              ? peer?.receiveTransport
              : null
        if (!transport) {
          console.warn(`Transport not found for id ${transportId}`)
          return
        }

        // mediasoup expects RTCIceCandidateInit-like object
        if (candidate) {
          transport
            .addIceCandidate(candidate)
            .then(() => console.log('ICE candidate added to transport'))
            .catch((e) => console.error('Error adding ICE candidate', e))
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
