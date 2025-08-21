import { log, useSocket } from '~/js/composables'

import * as msClient from 'mediasoup-client'
import * as msTypes from 'mediasoup-client/types'

console.log('mediasoupClientVersion', `${msClient.version}`)

export async function useMediasoup() {
  // Create a device (use browser auto-detection).
  const device: msTypes.Device = new msClient.Device()
  interface MsHelper {
    init: () => Promise<any>
    startWebcam: () => Promise<any>
    stopWebcam: () => Promise<any>
    device?: msClient.Device
    sendTransport?: msClient.types.Transport
    webcamProducer?: msClient.types.Producer
    audioProducer?: msClient.types.Producer
    localStream?: MediaStream | null
    currentTrack?: MediaStreamTrack | null
    selectedCamera: { deviceId?: string; facingMode?: 'user' | 'environment' }
  }
  let msHelper: MsHelper
  const socket = useSocket()

  msHelper = {
    localStream: null,
    currentTrack: null,
    selectedCamera: {},
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

    async startWebcam() {
      if (!this.device || !this.sendTransport) await this.init()

      const constraints: MediaStreamConstraints = {
        video: this.selectedCamera.deviceId
          ? { deviceId: { exact: this.selectedCamera.deviceId } }
          : this.selectedCamera.facingMode
            ? { facingMode: this.selectedCamera.facingMode }
            : true,
        audio: true,
      }

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints)

      this.webcamProducer = await this.sendTransport!.produce({
        track: this.localStream.getVideoTracks()[0],
      })
      this.audioProducer = await this.sendTransport!.produce({
        track: this.localStream.getAudioTracks()[0],
      })
    },

    async stopWebcam() {
      this.localStream?.getTracks().forEach((t) => t.stop())
      await this.webcamProducer?.close()
      await this.audioProducer?.close()
      this.localStream = undefined
    },
    async getCameras(): Promise<{ deviceId: string; label: string; facingMode?: string }[]> {
      const devices = await navigator.mediaDevices.enumerateDevices()
      let cams = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }))

      // If only one camera is detected, add fallback options for front/back
      if (cams.length <= 1) {
        cams = [
          { deviceId: 'user', label: 'Front Camera', facingMode: 'user' },
          { deviceId: 'environment', label: 'Back Camera', facingMode: 'environment' },
        ]
      }

      return cams
    },
    async startCamera(constraints?: MediaStreamConstraints): Promise<MediaStream> {
      this.localStream = await navigator.mediaDevices.getUserMedia(
        constraints || { video: true, audio: false }
      )
      return this.localStream
    },
    async switchCamera(deviceIdOrFacing: string) {
      if (deviceIdOrFacing === 'front') {
        this.selectedCamera = { facingMode: 'user' }
      } else if (deviceIdOrFacing === 'back') {
        this.selectedCamera = { facingMode: 'environment' }
      } else {
        this.selectedCamera = { deviceId: deviceIdOrFacing }
      }

      if (this.webcamProducer && this.localStream) {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: this.selectedCamera.deviceId
            ? { deviceId: { exact: this.selectedCamera.deviceId } }
            : { facingMode: this.selectedCamera.facingMode },
        })
        const newTrack = newStream.getVideoTracks()[0]
        await this.webcamProducer.replaceTrack({ track: newTrack })

        // cleanup old video track
        this.localStream.getVideoTracks().forEach((t) => t.stop())
        this.localStream.removeTrack(this.localStream.getVideoTracks()[0])
        this.localStream.addTrack(newTrack)
      }
    },
    stopCamera() {
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => track.stop())
        this.localStream = null
        this.currentTrack = null
      }
    },
  }

  return { device, msClient, msHelper, socket }
}
