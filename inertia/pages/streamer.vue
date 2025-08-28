<script setup lang="ts">
import Scaffold from '~/layouts/Scaffold.vue'
import { Head } from '@inertiajs/vue3'
import { __, useSocket } from '~/js/composables'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMediasoup } from '~/js/mediasoup'
const localVideo = ref<HTMLVideoElement | null>(null)

let device: any, msClient: any, msHelper: any, socket: any

const isStreaming = ref(false)
const cameras = ref<{ deviceId?: string; facingMode?: string; label: string }[]>([])
const selectedCamera = ref<any>(null)

const socketLeave = () => {
  if (socket) {
    // socket.off('connect')
  }
}
const toggleStream = async () => {
  if (!isStreaming.value) {
    await msHelper.startCamera()
    if (localVideo.value) localVideo.value.srcObject = msHelper.localStream || null
    console.log('play button', !!localVideo.value, localVideo.value.srcObject)
    isStreaming.value = true
  } else {
    await msHelper.stopCamera()
    if (localVideo.value) localVideo.value.srcObject = null
    isStreaming.value = false
  }
}
const onCameraChange = async (newCam) => {
  await msHelper.switchCamera(newCam)
  if (isStreaming.value && localVideo.value) {
    localVideo.value.srcObject = msHelper.localStream
  }
}
async function switchCam() {
  if (!selectedCamera.value) return
  const stream = await msHelper.switchCamera(selectedCamera.value)
  if (localVideo.value) localVideo.value.srcObject = stream
}
onMounted(async () => {
  const ms = await useMediasoup()
  ;({ device, msClient, msHelper, socket } = ms)

  await msHelper.initSend()
  cameras.value = await msHelper.getCameras()

  if (cameras.value.length) selectedCamera.value = cameras.value[0]
})
watch(selectedCamera, async (newCamera) => {
  if (!newCamera) return
  await onCameraChange(newCamera)
})
onBeforeUnmount(() => {
  socketLeave()
})
</script>

<template>
  <Scaffold>
    <Head :title="__('streamer')" />
    <div class="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <h1 class="text-2xl font-bold mb-4">Mediasoup Webcam Streamer</h1>

      <div class="w-full max-w-lg bg-white p-4 rounded-lg shadow-md">
        <video
          ref="localVideo"
          autoplay
          muted
          playsinline
          class="w-full rounded-md border border-gray-300"
        ></video>
        <select v-model="selectedCamera" class="border border-gray-300 my-2 rounded p-2 w-full">
          <option v-for="c in cameras" :key="c.deviceId || c.facingMode" :value="c">
            {{ c.label }}
          </option>
        </select>
        <button
          @click="toggleStream"
          :class="isStreaming ? 'bg-red-500 hover:bg-red-600 ' : 'bg-green-500 hover:bg-green-600'"
          class="px-6 w-full py-2 rounded text-white font-semibold transition-colors duration-200"
        >
          {{ isStreaming ? 'Stop Stream' : 'Start Stream' }}
        </button>

        <p class="text-gray-600">
          Status:
          <span :class="isStreaming ? 'text-green-600 animate-pulse' : 'text-red-600'">{{
            isStreaming ? 'Streaming' : 'Stopped'
          }}</span>
        </p>
      </div>
    </div>
  </Scaffold>
</template>

<style scoped></style>
