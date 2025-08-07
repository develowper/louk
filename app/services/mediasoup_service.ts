import {
  types as msTypes,
  version,
  workerBin,
  observer,
  createWorker,
  createRouter,
  setLogEventListeners,
  getSupportedRtpCapabilities,
  parseScalabilityMode,
} from 'mediasoup'

let worker: msTypes.Worker
let router: msTypes.Router
let rtpParameters: msTypes.RtpParameters

let transports: any[] = []
export async function initMediasoup() {
  worker = await createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
  })

  router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
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
    ],
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
