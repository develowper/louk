import { usePage } from '@inertiajs/vue3'
import { io, Socket } from 'socket.io-client'

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
export function useSocket() {
  if (!socket) {
    socket = io(`${usePage().props.socket_url}`)
  }

  socket.request = function request<T = any>(event: string, ...args: any[]): Promise<T> {
    if (!socket) throw new Error('Socket not initialized')
    // Just call emitWithAck directly, return the Promise
    return socket.emitWithAck(event, ...args)
  }
  return socket
}

export function log(msg) {
  console.log(msg)
}
