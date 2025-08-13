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
    SocketioService.wsio = new Server(server.getNodeServer(), {})

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
      socket.on('getRouterRtpCapabilities', (_, callback) => {
        const rtpCapabilities = getRouterRtpCapabilities()
        callback(rtpCapabilities)
      })
      // Step 2: Create WebRTC Transport
      socket.on('createWebRtcTransport', async ({ direction }, callback) => {
        const transport = await createWebRtcTransport()
        console.log('createWebRtcTransport', transport.id)
        // Store transport in peers map
        setPeer(socket.id, `${direction}-transport`, transport)
        callback({
          status: 'success',
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
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
      socket.on(
        'produce',
        async ({ kind, rtpVideoParams = {}, rtpAudioParams = {}, sdp, type }, callback) => {
          // console.log('produce', kind, rtpParameters, sdp, type)

          const peer = getPeer(socket.id)
          if (!peer.sendTransport) {
            return callback({ error: 'Peer not found' })
          }

          const transport = peer.sendTransport

          rtpVideoParams.codecs = mapCodecsToRouter(rtpVideoParams.codecs)
          rtpAudioParams.codecs = mapCodecsToRouter(rtpAudioParams.codecs)
          console.log('rtpParameters', rtpVideoParams, rtpAudioParams)
          // Before calling produce:
          // const { videoParams, audioParams } = filterSupportedCodecs(rtpParameters)
          console.log('produce video', rtpVideoParams)
          console.log('produce audio', rtpAudioParams)
          const videoProducer =
            peer.videoProducer ??
            (await transport.produce({
              kind: 'video',
              rtpParameters: rtpVideoParams,
            }))
          const audioProducer =
            peer.audioProducer ??
            (await transport.produce({
              kind: 'audio',
              rtpParameters: rtpAudioParams,
            }))
          // const producer = await transport.produce({ kind, rtpParameters })
          console.log(`======video producer ${socket.id} start stream`, videoProducer)
          console.log(`======audio producer ${socket.id} start stream`, audioProducer)

          // Save both producers in the peer

          peer.videoProducer = videoProducer
          peer.audioProducer = audioProducer

          // Notify others about each producer separately
          SocketioService.wsio.emit('streamer-added', {
            id: socket.id,
            video_producer_id: videoProducer.id,
            audio_producer_id: audioProducer.id,
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
            id: socket.id,
            video_producer_id: videoProducer.id,
            audio_producer_id: audioProducer.id,
          })
        }
      )

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
          console.log('----------consume-------------')
          console.log(
            kind == 'video' &&
              streamerPeer.videoProducer &&
              router.canConsume({
                producerId: streamerPeer.videoProducer.id,
                rtpCapabilities,
              })
          )
          // Consume video if available
          if (
            (kind == 'video',
            streamerPeer.videoProducer,
            router.canConsume({
              producerId: streamerPeer.videoProducer.id,
              rtpCapabilities,
            }))
          ) {
            const videoConsumer = await viewerPeer.receiveTransport.consume({
              producerId: streamerPeer.videoProducer.id,
              rtpCapabilities,
              paused: false,
            })

            console.log('streamerPeer', streamerId)
            console.log('streamerPeerVideoProducerId', streamerPeer.videoProducer.id)
            viewerPeer.consumers.set(`${streamerId}-video`, videoConsumer)
            console.log('consume viewerPeer', socket.id)
            console.log('viewerPeerConsumers', viewerPeer.consumers)
            consumersData = {
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
              paused: false,
            })
            viewerPeer.consumers.set(`${streamerId}-audio`, audioConsumer)
            consumersData = {
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
      socket.on('resumeConsumer', async ({ producerId, kind }, callback) => {
        const streamerPeer = getPeer(producerId)
        const viewerPeer = getPeer(socket.id)

        // const transport = viewerPeer?.receiveTransport
        console.log('viewerPeer', viewerPeer)
        console.log('consumerId', `${producerId}-${kind}`)
        const consumer = viewerPeer?.consumers?.get(`${producerId}-${kind}`)
        console.log('resumeConsumer', consumer)
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
