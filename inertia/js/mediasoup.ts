import { log, useSocket } from '~/js/composables'

import * as msClient from 'mediasoup-client'
import * as msTypes from 'mediasoup-client/types'

console.log('mediasoupClientVersion', `${msClient.version}`)

export async function useMediasoup() {
  // Create a device (use browser auto-detection).
  const device: msTypes.Device = new msClient.Device()
  interface MsHelper {
    init: () => Promise<void>
    startWebcam: () => Promise<void>
    stopWebcam: () => Promise<void>
    device?: msClient.Device
    sendTransport?: msClient.types.Transport
    webcamProducer?: msClient.types.Producer
    audioProducer?: msClient.types.Producer
    localStream?: MediaStream
  }
  let msHelper: MsHelper
  const socket = useSocket()

  msHelper = {
    async init() {
      this.device = new msClient.Device()
      console.log('init mediasoup')
      const routerRtpCapabilities = await socket.request('getRouterRtpCapabilities')
      await this.device.load({ routerRtpCapabilities })
      console.log(routerRtpCapabilities)
      const transportData = await socket.request('createWebRtcTransport', {
        direction: 'send',
        sctpCapabilities: this.device.sctpCapabilities,
      })
      console.log(transportData)
      this.sendTransport = this.device.createSendTransport({
        id: transportData.id,
        iceParameters: transportData.iceParameters,
        iceCandidates: transportData.iceCandidates,
        dtlsParameters: transportData.dtlsParameters,
      })

      this.sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await socket.emit('transport-connect', {
            transportId: this.sendTransport!.id,
            dtlsParameters,
          })
          callback()
        } catch (err) {
          errback(err)
        }
      })

      this.sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
        try {
          const { id } = await socket.request('produce', {
            transportId: this.sendTransport!.id,
            kind,
            rtpParameters,
          })
          callback({ id })
        } catch (err) {
          errback(err)
        }
      })
      this.sendTransport.on(
        'producedata',
        async ({ sctpStreamParameters, label, protocol, appData }, callback, errback) => {
          // Here we must communicate our local parameters to our remote transport.
          try {
            const { id } = await socket.request('produceData', {
              transportId: this.sendTransport.id,
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
    },

    async getWebcamStream() {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevice = devices.find(
        (d) => d.kind === 'videoinput' && d.label.includes('HD Camera')
      ) // adjust name

      return navigator.mediaDevices.getUserMedia({
        video: { deviceId: videoDevice?.deviceId || undefined },
      })
    },

    async startWebcam() {
      if (!this.device || !this.sendTransport) {
        await this.init()
      }

      try {
        // Must be called inside a user-gesture (button click)
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' }, // front camera on mobile
          audio: { echoCancellation: true },
        })

        // Attach to transport
        const [videoTrack] = this.localStream.getVideoTracks()
        const [audioTrack] = this.localStream.getAudioTracks()

        if (videoTrack) {
          this.webcamProducer = await this.sendTransport!.produce({ track: videoTrack })
        }
        if (audioTrack) {
          this.audioProducer = await this.sendTransport!.produce({ track: audioTrack })
        }

        return this.localStream
      } catch (err) {
        console.error('Failed to getUserMedia', err)
        throw err
      }
    },

    async stopWebcam() {
      if (this.webcamProducer) {
        await this.webcamProducer.close()
        this.webcamProducer = undefined
      }
      if (this.audioProducer) {
        await this.audioProducer.close()
        this.audioProducer = undefined
      }
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => track.stop())
        this.localStream = undefined
      }
    },
  }

  return { device, msClient, msHelper, socket }
}
