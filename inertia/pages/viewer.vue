<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import Scaffold from '~/layouts/Scaffold.vue'
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useMediasoup } from '~/js/mediasoup'

const props = defineProps<{ id: string }>() // streamer id
let device: any, msClient: any, msHelper: any, socket: any
const videoEl = ref<HTMLVideoElement | null>(null)
const remoteStream = ref<MediaStream | null>(null)

onMounted(async () => {
  const ms = await useMediasoup()
  ;({ device, msClient, msHelper, socket } = ms)

  console.log('Joining viewer for streamer:', props.id)
  remoteStream.value = await msClient.consumeStream(props.id)

  if (videoEl.value && remoteStream.value) {
    videoEl.value.srcObject = remoteStream.value
    await videoEl.value.play().catch(console.error)
  }
})

onBeforeUnmount(() => {
  msHelper.closeConsumer()
})
</script>

<template>
  <Scaffold>
    <Head title="Viewer" />
    <div class="flex flex-col items-center justify-center min-h-screen bg-gray-100">
      <h1 class="text-xl font-bold mb-4">Watching Streamer: {{ props.id }}</h1>
      <video ref="videoEl" autoplay playsinline controls class="w-full max-w-2xl rounded shadow" />
    </div>
  </Scaffold>
</template>
