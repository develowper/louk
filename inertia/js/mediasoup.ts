import { log, useSocket } from '~/js/composables'

import * as msClient from 'mediasoup-client'
import * as msTypes from 'mediasoup-client/types'
import { Socket } from 'socket.io-client'
import { usePage } from '@inertiajs/vue3'

console.log('mediasoupClientVersion', `${msClient.version}`)

export async function useMediasoup() {
  // Create a device (use browser auto-detection).
  const device: msTypes.Device = new msClient.Device()
  interface MsHelper {
    initSend: () => Promise<any>
    initRecv: () => Promise<any>
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
    sendLogTimer: any
    recvLogTimer: any
  }
  let msHelper: MsHelper
  let socket

  msHelper = {
    localStream: null,
    currentTrack: null,
    selectedCamera: {},
    consumerTransport: null,
    sendLogTimer: null,
    recvLogTimer: null,
    consumers: [],

    async initSend() {
      socket = socket ?? (await useSocket())
      if (this.device) return
      this.device = new msClient.Device()
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
        iceServers: [
          // {
          //   // urls: 'turn:195.214.235.75:3478?transport=tcp',
          //   urls: 'turns:195.214.235.75:5349',
          //   username: 'turnserver',
          //   credential: usePage().props.PSWD ?? '',
          // },
          // { urls: 'stun:stun.l.google.com:19302' },
          // { urls: 'stun:stun1.l.google.com:19302' },
          // { urls: 'stun:stun2.l.google.com:19302' },
          // { urls: 'stun:stun3.l.google.com:19302' },
          // { urls: 'stun:stun4.l.google.com:19302' },
        ],
      })
      this.sendTransport.on('connectionstatechange', (state) => {
        console.log('sendTransport state:', state)
        if (state === 'failed' || state === 'closed' || state === 'disconnected') {
          // optional cleanup / retry logic
        }
      })
      this.sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        console.log("sendTransport.on('connect'")
        try {
          const connectRes = await socket.request('connectTransport', {
            transportId: this.sendTransport!.id,
            dtlsParameters,
          })
          console.log('connect res', connectRes)
          callback()
        } catch (err) {
          errback(err)
        }
      })

      this.sendTransport.on(
        'produce',
        async ({ kind, rtpParameters, appData }, callback, errback) => {
          console.log(`[CLIENT] Sending produce request, kind: ${kind}`, rtpParameters)

          try {
            const { id, video_producer_id, audio_producer_id } = await socket.request('produce', {
              transportId: this.sendTransport!.id,
              kind,
              rtpParameters,
              appData,
            })
            callback({ id })
          } catch (err) {
            errback(err)
          }
        }
      )
    },

    async initRecv() {
      console.log('initRecv')

      if (!this.device) {
        this.device = new msClient.Device({})
        const routerRtpCapabilities = await socket.request('getRouterRtpCapabilities')
        console.log('routerRtpCapabilities', routerRtpCapabilities)
        await this.device.load({ routerRtpCapabilities })
      }
      console.log('consumerTransport', this.consumerTransport)
      if (this.consumerTransport) return

      const transportData = await socket.request('createWebRtcTransport', { direction: 'receive' })
      this.consumerTransport = this.device.createRecvTransport({
        id: transportData.id,
        iceParameters: transportData.iceParameters,
        iceCandidates: transportData.iceCandidates,
        dtlsParameters: transportData.dtlsParameters,
        sctpParameters: transportData.sctpParameters,
      })

      this.consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          const connectRes = await socket.request('connectTransport', {
            transportId: this.consumerTransport!.id,
            dtlsParameters,
          })
          console.log("consumerTransport.on('connect'", connectRes)
          callback()
        } catch (err) {
          errback(err)
        }
      })
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
      console.log('cams', cams)
      return cams
    },

    // Start streaming (video + audio)
    async startCamera() {
      if (!this.device || !this.sendTransport) await this.initSend()

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
        console.log('localStream', this.localStream)
        console.log('localStreamtracks', this.localStream.getVideoTracks())
      } catch (err) {
        console.warn('Failed to get camera with constraints, fallback to default', err)
        this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      }
      this.sendTransport?.on('connectionstatechange', (state) => {
        console.log('Send transport state:', state)
      })
      this.sendTransport?.on('icecandidateerror', (e) => {
        console.log('ICE connection error:', e)
      })

      this.webcamProducer = await this.sendTransport!.produce({
        track: this.localStream.getVideoTracks()[0],
      })
      this.audioProducer = await this.sendTransport!.produce({
        track: this.localStream.getAudioTracks()[0],
      })

      console.log(`[CLIENT] Producing VIDEO track, Producer ID: ${this.webcamProducer.id}`)

      console.log(`[CLIENT] Producing AUDIO track, Producer ID: ${this.audioProducer.id}`)
      // Optional: log track events
      this.webcamProducer.on('trackended', () => {
        console.warn('[CLIENT] Video track ended')
      })
      this.audioProducer.on('trackended', () => {
        console.warn('[CLIENT] Audio track ended')
      })

      this.webcamProducer.on('transportclose', () => {
        console.warn('[CLIENT] Video transport closed')
      })
      this.audioProducer.on('transportclose', () => {
        console.warn('[CLIENT] Audio transport closed')
      })
      let lastVideoBytes = 0
      let lastAudioBytes = 0
      this.sendLogTimer = setInterval(async () => {
        if (this.webcamProducer) {
          const videoStats = await this.webcamProducer.getStats()
          videoStats.forEach((stat) => {
            if (stat.type === 'outbound-rtp') {
              const bytesSent = stat.bytesSent
              const packetsSent = stat.packetsSent
              const deltaBytes = bytesSent - lastVideoBytes
              console.log(
                `[VIDEO] packets: ${packetsSent}, bytes sent this interval: ${deltaBytes}`
              )
              lastVideoBytes = bytesSent
            }
          })
        }
      }, 5000)
    },

    // Stop streaming
    async stopCamera() {
      clearInterval(this.sendLogTimer)
      this.localStream?.getTracks().forEach((t) => t.stop())
      await this.webcamProducer?.close()
      await this.audioProducer?.close()
      this.localStream = null
      this.webcamProducer = null
      this.audioProducer = null
    },

    async switchCamera(camera: { deviceId?: string; label: string; facingMode?: string }) {
      this.selectedCamera = camera
      console.log('switch camera, change stream?', !(!this.webcamProducer || !this.localStream))
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
      await this.webcamProducer?.replaceTrack({ track: newTrack })

      // Replace track in local stream for <video>
      this.localStream?.getVideoTracks().forEach((t) => t.stop())
      this.localStream?.removeTrack(this.localStream.getVideoTracks()[0])
      this.localStream?.addTrack(newTrack)
    },
    async createRecvTransport() {
      console.log('createRecvTransport')
      console.log('!device', !this.device)
      if (!this.device) {
        await this.initRecv()
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
      socket = await useSocket()

      if (!this.device) await this.initRecv()
      if (!this.consumerTransport) await this.initRecv()

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
        console.log(`resume consume from producer ${streamerId}`)
        await socket.request('resumeConsumer', { producerId: streamerId, kind })

        let lastVideoBytes = 0
        let lastAudioBytes = 0

        this.recvLogTimer = setInterval(async () => {
          if (consumer) {
            const stats = await consumer.getStats()
            stats.forEach((stat) => {
              if (stat.type === 'inbound-rtp') {
                const bytesReceived = stat.bytesReceived
                const packetsReceived = stat.packetsReceived
                const deltaBytes = bytesReceived - lastVideoBytes
                console.log(
                  `[CONSUMER][VIDEO] packets: ${packetsReceived}, bytes received this interval: ${deltaBytes}`
                )
                lastVideoBytes = bytesReceived
              }
            })
          }
        }, 5000)
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
