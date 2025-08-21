import { log, useSocket } from '~/js/composables'

import * as msClient from 'mediasoup-client'
import * as msTypes from 'mediasoup-client/types'

console.log('mediasoupClientVersion', `${msClient.version}`)

export async function useMediasoup() {
  // Create a device (use browser auto-detection).
  const device: msTypes.Device = new msClient.Device()
  interface MsHelper {
    init: () => Promise<any>
    switchCamera: (camera) => Promise<void>
    startCamera: () => Promise<any>
    stopCamera: () => any
    getCameras: () => Promise<{ deviceId: string; label: string; facingMode?: string }[]>
    createRecvTransport: () => Promise<any>
    consumeStream: (streamerId) => Promise<any>
    closeConsumer: () => any
    device?: msClient.Device | null
    sendTransport?: msClient.types.Transport | null
    webcamProducer?: msClient.types.Producer | null
    audioProducer?: msClient.types.Producer | null
    localStream?: MediaStream | null
    currentTrack?: MediaStreamTrack | null
    selectedCamera: any
    consumerTransport: msClient.types.Transport | null
    consumers: msClient.types.Consumer[] | []
  }
  let msHelper: MsHelper
  const socket = useSocket()

  msHelper = {
    localStream: null,
    currentTrack: null,
    selectedCamera: {},
    consumerTransport: null,
    consumers: [],
    async init() {
      this.device = new msClient.Device()
      console.log('init mediasoup')
      const routerRtpCapabilities = await socket.request('getRouterRtpCapabilities')
      await this.device.load({ routerRtpCapabilities })
      const transportData = await socket.request('createWebRtcTransport', {
        direction: 'send',
        sctpCapabilities: this.device.sctpCapabilities,
      })
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
    async getCameras(): Promise<{ deviceId: string; label: string; facingMode?: string }[]> {
      // Request one stream first so labels become available
      await navigator.mediaDevices.getUserMedia({ video: true, audio: false }).catch(() => {})

      const devices = await navigator.mediaDevices.enumerateDevices()
      let cams = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }))

      // Detect if running on mobile (rough heuristic)
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

      // On mobile with only one detected cam, offer logical front/back
      if (isMobile && cams.length <= 1) {
        cams = [
          { deviceId: 'user', label: 'Front Camera', facingMode: 'user' },
          { deviceId: 'environment', label: 'Back Camera', facingMode: 'environment' },
        ]
      }

      return cams
    },

    // Start streaming (video + audio)
    async startCamera() {
      if (!this.device || !this.sendTransport) await this.init()

      const constraints: MediaStreamConstraints = { audio: true }

      if (this.selectedCamera.deviceId) {
        constraints.video = { deviceId: { exact: this.selectedCamera.deviceId } }
      } else if (this.selectedCamera.facingMode) {
        constraints.video = { facingMode: { exact: this.selectedCamera.facingMode } }
      } else {
        constraints.video = true // fallback
      }

      try {
        this.localStream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (err) {
        console.warn('Failed to get camera with constraints, fallback to default', err)
        this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      }

      this.webcamProducer = await this.sendTransport!.produce({
        track: this.localStream.getVideoTracks()[0],
      })
      this.audioProducer = await this.sendTransport!.produce({
        track: this.localStream.getAudioTracks()[0],
      })
    },

    // Stop streaming
    async stopCamera() {
      this.localStream?.getTracks().forEach((t) => t.stop())
      await this.webcamProducer?.close()
      await this.audioProducer?.close()
      this.localStream = null
      this.webcamProducer = null
      this.audioProducer = null
    },

    async switchCamera(camera: { deviceId?: string; label: string; facingMode?: string }) {
      this.selectedCamera = camera

      // If not streaming, nothing else to do
      if (!this.webcamProducer || !this.localStream) return

      // If streaming, replace track
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: camera.deviceId
          ? { deviceId: { exact: camera.deviceId } }
          : { facingMode: camera.facingMode },
      })

      const newTrack = newStream.getVideoTracks()[0]

      // Replace track in mediasoup
      await this.webcamProducer.replaceTrack({ track: newTrack })

      // Replace track in local stream for <video>
      this.localStream.getVideoTracks().forEach((t) => t.stop())
      this.localStream.removeTrack(this.localStream.getVideoTracks()[0])
      this.localStream.addTrack(newTrack)
    },
    async createRecvTransport() {
      if (!this.device) {
        await this.init()
      }

      const transportData = await socket.request('createWebRtcTransport', {
        direction: 'receive',
      })

      this.consumerTransport = this.device!.createRecvTransport({
        id: transportData.id,
        iceParameters: transportData.iceParameters,
        iceCandidates: transportData.iceCandidates,
        dtlsParameters: transportData.dtlsParameters,
        sctpParameters: transportData.sctpParameters,
      })

      this.consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await socket.request('connectTransport', {
            transportId: this.consumerTransport!.id,
            dtlsParameters,
          })
          callback()
        } catch (err) {
          errback(err)
        }
      })
    },

    async consumeStream(streamerId: string): Promise<MediaStream> {
      if (!this.device) await this.init()
      if (!this.consumerTransport) await this.createRecvTransport()

      const stream = new MediaStream()

      for (const kind of ['video', 'audio']) {
        const params = await socket.request('consume', {
          rtpCapabilities: this.device!.rtpCapabilities,
          streamerId,
          kind,
          transportId: this.consumerTransport!.id,
        })


        if (!params) continue

        const consumer = await this.consumerTransport!.consume(params)
        this.consumers.push(consumer)
        stream.addTrack(consumer.track)
      }

      return stream
    },

    async closeConsumer() {
      this.consumers.forEach((c) => c.close())
      this.consumers = []
      if (this.consumerTransport) {
        this.consumerTransport.close()
        this.consumerTransport = null
      }
    },
  }

  return { device, msClient, msHelper, socket }
}
