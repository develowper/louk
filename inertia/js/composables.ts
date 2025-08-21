import { usePage } from '@inertiajs/vue3'
import { io, Socket } from 'socket.io-client'
import { DefaultEventsMap } from 'socket.io'

let socket: any
export function __(key, replace = {}) {
  let $lang = usePage().props.language
  var translation = $lang[key] ? $lang[key] : key

  Object.keys(replace).forEach(function (key) {
    translation = translation.replace(`{${key}}`, replace[key])
  })
  return translation
}

export function dir() {
  let $lang = usePage().props.language
  if ($lang === 'en') return 'ltr'
  else return 'rtl'
}

interface CustomSocket extends Socket<DefaultEventsMap, DefaultEventsMap> {
  request<T = any>(event: string, ...args: any[]): Promise<T>
}
let socketPromise: Promise<CustomSocket> | null = null

export function useSocket(): Promise<CustomSocket> {
  if (!socketPromise) {
    socketPromise = new Promise((resolve, reject) => {
      const s: CustomSocket = io(`${usePage().props.socket_url}`, {
        autoConnect: false,
      }) as CustomSocket

      // wait until connected
      s.on('connect', () => {
        console.log('✅ Socket connected:', s.id)

        // add request wrapper only after connect
        s.request = function <T = any>(event: string, ...args: any[]): Promise<T> {
          return s.emitWithAck(event, ...args)
        }

        resolve(s)
      })

      s.on('connect_error', (err) => {
        console.error('❌ Socket connection error:', err)
        reject(err)
      })

      s.connect()
    })
  }

  return socketPromise
}

export function log(msg) {
  console.log(msg)
}
