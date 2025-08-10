import {
  types as msTypes,
  version,
  workerBin,
  observer,
  createWorker,
  setLogEventListeners,
  getSupportedRtpCapabilities,
  parseScalabilityMode,
} from 'mediasoup'
import { Consumer, Producer, Transport } from 'mediasoup/types'

let worker: msTypes.Worker
let router: msTypes.Router

let transports: any[] = []

interface PeerData {
  id: string | null
  sendTransport: Transport | null
  receiveTransport: Transport | null
  videoProducer: Producer | null
  audioProducer: Producer | null
  consumers: Map<string, Consumer>
}
const peers: Map<string, PeerData> = new Map()

export const mediaCodecs: any = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {},
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    // mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    },
  },
  // {
  //   kind: 'video',
  //   mimeType: 'video/H265',
  //   clockRate: 90000,
  //   parameters: {
  //     'profile-id': 1, // adjust as needed
  //   },
  // },
]
export async function initMediasoup() {
  worker = await createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
  })

  router = await worker.createRouter({
    mediaCodecs: mediaCodecs,
  })
  observer.on('newworker', (worker) => {
    console.log('new worker created [pid:%d]', worker.pid)
  })
  setLogEventListeners({
    ondebug: undefined,
    onwarn: (namespace, log) => {
      console.warn(`${namespace} ${log}`)
    },
    onerror: (namespace, log, error) => {
      if (error) {
        console.error(`${namespace} ${log}: ${error}`)
      } else {
        console.error(`${namespace} ${log}`)
      }
    },
  })
  console.log(`✅ Mediasoup (v-${version}) worker (${workerBin}) and router created.`)
}
export async function createWebRtcTransport() {
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0', announcedIp: null }], // Replace with your server's public IP if needed
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  })

  transports.push(transport)
  return transport
}

export function getRouterRtpCapabilities() {
  return router.rtpCapabilities
}

export async function createWebRtcServer() {
  await worker.createWebRtcServer({
    listenInfos: [
      {
        protocol: 'udp',
        ip: '9.9.9.9',
        port: 20000,
      },
      {
        protocol: 'tcp',
        ip: '9.9.9.9',
        port: 20000,
      },
    ],
  })
}
export { worker, router }
export function filterSupportedCodecs(rtpParameters: msTypes.RtpParameters) {
  const supportedCodecs = mediaCodecs.map((i) => i.mimeType.toLowerCase()) // add any other unsupported here

  const videoCodecs = rtpParameters.codecs.filter(
    (codec) =>
      supportedCodecs.includes(codec.mimeType.toLowerCase()) &&
      codec.mimeType.toLowerCase().startsWith('video/')
  )

  const audioCodecs = rtpParameters.codecs.filter(
    (codec) =>
      supportedCodecs.includes(codec.mimeType.toLowerCase()) &&
      codec.mimeType.toLowerCase().startsWith('audio/')
  )
  // For video encodings, keep those if videoCodecs exist
  const videoEncodings = videoCodecs.length > 0 ? rtpParameters.encodings : []

  // For audio encodings, keep those if audioCodecs exist
  const audioEncodings = audioCodecs.length > 0 ? rtpParameters.encodings : []

  const videoParams = {
    ...rtpParameters,
    codecs: videoCodecs,
    encodings: videoEncodings,
  }
  const audioParams = {
    ...rtpParameters,
    codecs: audioCodecs,
    encodings: audioEncodings,
  }
  return { videoParams, audioParams }
}
export function getPeer(id) {
  if (!peers.has(id))
    peers.set(id, {
      id: id,
      sendTransport: null,
      receiveTransport: null,
      videoProducer: null,
      audioProducer: null,
      consumers: new Map(),
    })
  return peers.get(id)
}
export function setPeer(id: any, cmnd: any, data: any = null): any {
  const peer: PeerData = getPeer(id)

  switch (cmnd) {
    case 'init':
      if (!peers.has(id))
        peers.set(id, {
          id: id,
          sendTransport: null,
          receiveTransport: null,
          videoProducer: null,
          audioProducer: null,
          consumers: new Map(),
        })
      return peers.get(id)

    case 'remove':
      try {
        // Close both producers if they exist
        peer.videoProducer?.close()
        peer.audioProducer?.close()
        // Close both transports
        peer.sendTransport?.close()
        peer.receiveTransport?.close()

        // Close all consumers

        // Close all consumers in the map
        peer.consumers.forEach((consumer) => {
          try {
            consumer.close()
          } catch (err) {
            console.error('Error closing consumer:', err)
          }
        })

        console.log(`✅ Cleaned up peer ${id}`)
      } catch (err) {
        console.error(`❌ Error cleaning peer ${id}:`, err)
      }
      break

    case 'send-transport':
    case 'receive-transport':
      if (cmnd === 'send-transport') {
        peer.sendTransport = data
      } else if (cmnd === 'receive-transport') {
        peer.receiveTransport = data
      }
      break
  }
}
export function mapCodecsToRouter(codecs) {
  return codecs
    .map((codec) => {
      const match = router?.rtpCapabilities?.codecs?.find(
        (c) =>
          c.mimeType.toLowerCase() === codec.mimeType.toLowerCase() &&
          c.clockRate === codec.clockRate
      )
      if (!match) {
        console.warn(`⚠ Skipping unsupported codec: ${codec.mimeType}`)
        return null
      }
      return {
        ...codec,
        payloadType: match.preferredPayloadType,
      }
    })
    .filter(Boolean)
}
