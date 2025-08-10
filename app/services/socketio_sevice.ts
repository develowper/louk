import { Server } from 'socket.io'
import server from '@adonisjs/core/services/server'
import {
  createWebRtcTransport,
  filterSupportedCodecs, getPeer,
  getRouterRtpCapabilities,
  initMediasoup, mapCodecsToRouter,
  mediaCodecs, router,
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
      socket.on('produce', async ({ kind, rtpParameters={}, sdp, type }, callback) => {
        // console.log('produce', kind, rtpParameters, sdp, type)
console.warn(router.rtpCapabilities.codecs)
        const peer = getPeer(socket.id )
        if (!peer.sendTransport) {
          return callback({ error: 'Peer not found' })
        }

        const transport = peer.sendTransport

        console.log('before rtpParameters', rtpParameters)
        rtpParameters.codecs = mapCodecsToRouter(rtpParameters.codecs );
        console.log('rtpParameters', rtpParameters)
        // Before calling produce:
        const { videoParams, audioParams } = filterSupportedCodecs(rtpParameters)
        console.log('produce video', videoParams)
        console.log('produce audio', audioParams )
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

        socket.on('stopProduce', async () => {
          const peer = setPeer(socket.id, 'init'); // get peer

          if (!peer) {
            console.warn(`Peer ${socket.id} not found on stopProduce`);
            return;
          }

          // Close and remove video producer if exists
          if (peer.videoProducer) {
            try {
              await peer.videoProducer.close();
              peer.videoProducer = null;
              console.log(`Video producer stopped for peer ${socket.id}`);
            } catch (err) {
              console.error(`Error closing video producer for ${socket.id}:`, err);
            }
          }

          // Close and remove audio producer if exists
          if (peer.audioProducer) {
            try {
              await peer.audioProducer.close();
              peer.audioProducer = null;
              console.log(`Audio producer stopped for peer ${socket.id}`);
            } catch (err) {
              console.error(`Error closing audio producer for ${socket.id}:`, err);
            }
          }

          // Optionally notify other clients that this streamer stopped producing
          socket.broadcast.emit('streamer-removed', { id: socket.id });

          // Optionally update peer state or remove if needed
          setPeer(socket.id, 'remove');

          console.log(`Peer ${socket.id} stopped producing`);
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
