<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3'
import Scaffold from '~/layouts/Scaffold.vue'
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useMediasoup } from '~/js/mediasoup'

const streamer = usePage().props.streamer
const isMuted = ref(true)
let device: any, msClient: any, msHelper: any, socket: any
const videoEl = ref<HTMLVideoElement | null>(null)
const remoteStream = ref<MediaStream | null>(null)

onMounted(async () => {
  const ms = await useMediasoup()
  ;({ device, msClient, msHelper, socket } = ms)

  console.log('Joining viewer for streamer:', streamer.id)
  remoteStream.value = await msHelper.consumeStream(streamer.id)
  if (videoEl.value) {
    console.log('playing')
    videoEl.value.srcObject = remoteStream.value
    videoEl.value.muted = true

    await videoEl.value.play().catch((err) => {
      console.warn('Video play failed:', err)
    })
  }
})
function unmute() {
  if (videoEl.value) {
    videoEl.value.muted = false
    isMuted.value = false
  }
}

onBeforeUnmount(() => {
  msHelper.closeConsumer()
})
</script>

<template>
  <Scaffold>
    <Head title="Viewer" />
    <div class="flex flex-col items-center justify-center min-h-screen bg-gray-100">
      <h1 class="text-xl font-bold mb-4">Watching Streamer: {{ streamer?.id }}</h1>
      <video
        ref="videoEl"
        muted
        autoplay
        playsinline
        controls
        class="w-full m-2 max-w-2xl rounded shadow"
      />
      <button v-if="isMuted" @click="unmute">Unmute</button>
    </div>
  </Scaffold>
</template>
