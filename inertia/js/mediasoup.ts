import { log, useSocket } from '~/js/composables'

import * as msClient from 'mediasoup-client'
import * as msTypes from 'mediasoup-client/types'

console.log('mediasoupClientVersion', `${msClient.version}`)

export async function useMediasoup() {
  // Create a device (use browser auto-detection).
  const device: msTypes.Device = new msClient.Device()

  const socket = useSocket()
  // Communicate with our server app to retrieve router RTP capabilities.
  const routerRtpCapabilities = await socket.request('getRouterRtpCapabilities', {})
  console.log(routerRtpCapabilities)
  // Load the device with the router RTP capabilities.
  await device.load({ routerRtpCapabilities })

  // Check whether we can produce video to the router.
  console.log('canProduce', device.canProduce('video'))
  if (!device.canProduce('video')) {
    console.warn('cannot produce video')

    // Abort next steps.
  }

  // Create a transport in the server for sending our media through it.
  const { id, iceParameters, iceCandidates, dtlsParameters, sctpParameters } = await socket.request(
    'createWebRtcTransport',
    {
      direction: 'send',
      sctpCapabilities: device.sctpCapabilities,
    }
  )

  // console.log(id, iceParameters, iceCandidates, dtlsParameters, sctpParameters)

  // Create the local representation of our server-side transport.
  const sendTransport = device.createSendTransport({
    id,
    iceParameters,
    iceCandidates,
    dtlsParameters,
    sctpParameters,
  })

  // Set transport "connect" event handler.
  sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    // Here we must communicate our local parameters to our remote transport.
    try {
      await socket.emit('transport-connect', {
        transportId: sendTransport.id,
        dtlsParameters,
      })

      // Done in the server, tell our transport.
      callback()
    } catch (error) {
      // Something was wrong in server side.
      errback(error)
    }
  })

  // Set transport "produce" event handler.
  sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
    // Here we must communicate our local parameters to our remote transport.
    try {
      const { id } = await socket.request('produce', {
        peerID: socket.id,
        transportId: sendTransport.id,
        kind,
        rtpParameters,
        appData,
      })

      // Done in the server, pass the response to our transport.
      callback({ id })
    } catch (error) {
      // Something was wrong in server side.
      errback(error)
    }
  })

  // Set transport "producedata" event handler.
  sendTransport.on(
    'producedata',
    async ({ sctpStreamParameters, label, protocol, appData }, callback, errback) => {
      // Here we must communicate our local parameters to our remote transport.
      try {
        const { id } = await socket.request('produceData', {
          transportId: sendTransport.id,
          sctpStreamParameters,
          label,
          protocol,
          appData,
        })

        // Done in the server, pass the response to our transport.
        callback({ id })
      } catch (error) {
        // Something was wrong in server side.
        errback(error)
      }
    }
  )
  // Produce our webcam video.
  const stream = await navigator.mediaDevices.getUserMedia({ video: true })
  const webcamTrack = stream.getVideoTracks()[0]

  const webcamProducer = await sendTransport.produce({ track: webcamTrack })
  // Produce data (DataChannel).
  const dataProducer = await sendTransport.produceData({
    ordered: true,
    label: 'foo',
  })

  return { device, msClient }
}
