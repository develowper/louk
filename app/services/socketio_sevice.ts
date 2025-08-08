import { Server } from 'socket.io'
import server from '@adonisjs/core/services/server'
import {
  createWebRtcTransport,
  filterSupportedCodecs,
  getRouterRtpCapabilities,
  initMediasoup,
  mediaCodecs,
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
        socket.broadcast.emit('streamer-removed', { id: socket.id })

      })
      // Step 1: Send Router RTP Capabilities
      socket.on('getRouterRtpCapabilities', (_, callback) => {
        const rtpCapabilities = getRouterRtpCapabilities()
        callback(rtpCapabilities)
      })
      // Step 2: Create WebRTC Transport
      socket.on('createWebRtcTransport', async ({ direction }, callback) => {
        try {
          const transport = await createWebRtcTransport()
          console.log('transport', transport)
          // Store transport in peers map
        setPeer(socket.id,`${direction}-transport`,transport)
          callback({
            status: 'success',
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          })
      })
      // Handle DTLS Connect
      socket.on('connectTransport', async ({transportId, dtlsParameters }, callback) => {

     const peer= setPeer(socket.id,'init' )
        const transport =peer?.sendTransport?.id==transportId? peer?.sendTransport :peer?.receiveTransport?.id==transportId? peer?.receiveTransport :null
        if(!transport)
          return callback({status:'error', message: 'Peer not found' });

        try {
          await transport.connect({ dtlsParameters })
            callback({ status: 'success' })
          console.log('connectTransport')

        } catch (err) {
            callback({ status: 'error', message: err.message })
          console.error('connectTransport error',err.message)

        }
      })

      // Handle producer creation
      socket.on('produce', async ({ kind, rtpParameters, sdp, type }, callback) => {
        console.log('produce', kind, rtpParameters, sdp, type)
        const peer = setPeer(socket.id,'init')
        if (!peer.sendTransport) {
          return callback({ error: 'Peer not found' })
        }

        const transport = peer.sendTransport


        // Before calling produce:
        const { videoParams, audioParams } = filterSupportedCodecs(rtpParameters)
        const videoProducer =peer.videoProducer?? await transport.produce({
          kind: 'video',
          rtpParameters: videoParams,
        })
        const audioProducer =peer.audioProducer?? await transport.produce({
          kind: 'audio',
          rtpParameters: audioParams,
        })
        // const producer = await transport.produce({ kind, rtpParameters })
        console.log(`======video producer ${socket.id} start stream`, videoProducer)
        console.log(`======audio producer ${socket.id} start stream`, audioProducer)

        // Save both producers in the peer


        peer.videoProducer=videoProducer
        peer.audioProducer=audioProducer

        // Notify others about each producer separately
        SocketioService.wsio.emit('streamer-added', {
          id: socket.id,
           video_id: videoProducer.id,
          audio_id: audioProducer.id,
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

        // callback({
        //   audioProducerId: audioProducer.id,
        //   videoProducerId: videoProducer.id,
        // })
      })

      // Handle consumer creation
        socket.on('consume', async ({ streamerId, rtpCapabilities }, callback) => {
          const streamerPeer = setPeer(streamerId,'init')
          const viewerPeer = setPeer(socket.id,'init')

          if (!streamerPeer) {
            return callback({ error: 'Streamer not found' })
          }
          if (!viewerPeer) {
            return callback({ error: 'Viewer peer not found' })
          }
          if (!viewerPeer.receiveTransport) {
            return callback({ error: 'Recv transport not found' })
          }

          try {
            const consumersData:{video: any,audio:any} = {
              video: null,
              audio: null,
            };

            // Consume video if available
            if (streamerPeer.videoProducer) {
              const videoConsumer = await viewerPeer.receiveTransport.consume({
                producerId: streamerPeer.videoProducer.id,
                rtpCapabilities,
                paused: false,
              });
              viewerPeer.consumers.set(`${streamerId}-video`, videoConsumer);
              consumersData.video = {
                id: videoConsumer.id,
                kind: videoConsumer.kind,
                rtpParameters: videoConsumer.rtpParameters,
              };
            }

            // Consume audio if available
            if (streamerPeer.audioProducer) {
              const audioConsumer = await viewerPeer.receiveTransport.consume({
                producerId: streamerPeer.audioProducer.id,
                rtpCapabilities,
                paused: false,
              });
              viewerPeer.consumers.set(`${streamerId}-audio`, audioConsumer);
              consumersData.audio = {
                id: audioConsumer.id,
                kind: audioConsumer.kind,
                rtpParameters: audioConsumer.rtpParameters,
              };
            }

            callback(consumersData);
          } catch (error) {
            console.error('Error consuming stream:', error);
            callback({ error: error.message });
          }
        });

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
