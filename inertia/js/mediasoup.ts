import { log, useSocket } from '~/js/composables'

import * as msClient from 'mediasoup-client'
import * as msTypes from 'mediasoup-client/types'

console.log('mediasoupClientVersion', `${msClient.version}`)

export async function useMediasoup() {
  // Create a device (use browser auto-detection).
  const device: msTypes.Device = new msClient.Device()
  interface MsHelper {
    init: () => Promise<any>
    startCamera: () => Promise<any>
    stopCamera: () => any
    getCameras: () => Promise<{ deviceId: string; label: string; facingMode?: string }[]>
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

    async startCamera() {
      // Ensure device and transport are initialized
      if (!this.device || !this.sendTransport) await this.init()

      // Media constraints based on selected camera
      const constraints: MediaStreamConstraints = {
        video: this.selectedCamera.deviceId
          ? { deviceId: { exact: this.selectedCamera.deviceId } }
          : this.selectedCamera.facingMode
            ? { facingMode: { exact: this.selectedCamera.facingMode } }
            : true,
        audio: true,
      }

      // Get user media
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints)

      // If we have a transport, produce tracks for Mediasoup
      if (this.sendTransport) {
        this.webcamProducer = await this.sendTransport.produce({
          track: this.localStream.getVideoTracks()[0],
        })
        this.audioProducer = await this.sendTransport.produce({
          track: this.localStream.getAudioTracks()[0],
        })
      }

      return this.localStream
    },

    async getCameras() {
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

    async switchCamera(deviceIdOrFacing: string) {
      // Update selected camera
      if (deviceIdOrFacing === 'front') {
        this.selectedCamera = { facingMode: 'user' }
      } else if (deviceIdOrFacing === 'back') {
        this.selectedCamera = { facingMode: 'environment' }
      } else {
        this.selectedCamera = { deviceId: deviceIdOrFacing }
      }

      // Prepare constraints
      const constraints: MediaStreamConstraints = {
        video: this.selectedCamera.deviceId
          ? { deviceId: { exact: this.selectedCamera.deviceId } }
          : this.selectedCamera.facingMode
            ? { facingMode: { exact: this.selectedCamera.facingMode } }
            : true,
        audio: false,
      }

      // If streaming, replace track in mediasoup
      if (this.webcamProducer && this.localStream) {
        const newStream = await navigator.mediaDevices.getUserMedia(constraints)
        const newTrack = newStream.getVideoTracks()[0]

        // Replace track in mediasoup
        await this.webcamProducer.replaceTrack({ track: newTrack })

        // Stop old track and update localStream for <video>
        const oldTrack = this.localStream.getVideoTracks()[0]
        oldTrack.stop()
        this.localStream.removeTrack(oldTrack)
        this.localStream.addTrack(newTrack)
      } else {
        // If not streaming, just update selectedCamera; startWebcam() will use it
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
