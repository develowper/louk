<script setup lang="ts">
import { Head, usePage, Link } from '@inertiajs/vue3'
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { __, useSocket } from '~/js/composables'
import Scaffold from '~/layouts/Scaffold.vue'
import icon from '~/images/logo.png'
import { route } from '@izzyjs/route/client'
const socket = useSocket()
const streamers = ref<Record<string, any>>({})

const socketinit = () => {
  //

  socket.on('connect', () => {
    console.log(`..... Client Connected To Socket:  ${socket.id}`)
    socket.emit('JoinRoom', { roomId: 1 })
  })
  socket.on('JoinedRoom', (data) => {
    console.log(`Welcome to Room:  ${data.roomId}`)
  })
  socket.on('UserJoined', (data) => {
    console.log(data)
  })

  socket.on('streamer-added', (data) => {
    if (data?.id) streamers.value[data.id] = data
    console.log(data)
    console.log('streamer-added')
    console.log(Object.values(streamers.value))
    for (let i of Object.values(streamers.value)) console.log(i.id)
  })
  socket.on('streamer-removed', (data) => {
    console.log('streamer-removed', data)
    if (data?.id && streamers.value[data.id]) {
      delete streamers.value[data.id] // remove from object
    }
  })
}

const socketLeave = () => {
  if (socket) {
    socket.off('streamer-removed')
    socket.off('streamer-added')
    socket.off('UserJoined')
    socket.off('JoinedRoom')
    socket.off('connect')
  }
}
onMounted(() => {
  socketinit()
})
onBeforeUnmount(() => {
  socketLeave()
})
</script>

<template>
  <Scaffold>
    <Head title="Louk" />
    <div
      class="fixed xl:absolute left-8 right-8 top-0 bottom-0 xl:inset-0 max-w-screen-xl mx-auto before:content-[''] before:[background:repeating-linear-gradient(0deg,var(--sand-5)_0_4px,transparent_0_8px)] before:absolute before:top-0 before:left-0 before:h-full before:w-px after:content-[''] after:[background:repeating-linear-gradient(0deg,var(--sand-5)_0_4px,transparent_0_8px)] after:absolute after:top-0 after:right-0 after:h-full after:w-px"
    ></div>

    <div class="pt-4 h-full flex flex-col">
      <!-- Header -->
      <div
        class="grow pb-4 bg-gradient-to-b from-sand-1 to-sand-2 flex justify-center items-center"
      >
        <img :src="icon" class="size-12" alt="" />
        <h1 class="text-primary font-bold text-2xl">{{ __('app_name') }}</h1>
      </div>

      <div class="flex flex-col isolate mt-10 max-w-screen-xl mx-auto px-16 xl:px-8 gap-8">
        <Link
          :href="route('streamer')"
          class="px-12 text-center py-3 font-semibold text-white rounded-lg gradient-primary hover-gradient-primary hover:brightness-110 transition duration-300 ease-in-out cursor-pointer transform hover:scale-105"
        >
          {{ __('stream') }}
        </Link>

        <div class="text-center border-b border-b-gray-300">{{ __('streamers') }}</div>
        <div class="flex flex-col">
          <Link
            v-for="(s, idx) in streamers"
            :key="s.id || idx"
            :href="route('streams', { params: { id: s.id } })"
            class="px-12 bg-primary-500 text-white py-3 font-semibold rounded-lg hover:brightness-110 transition duration-300 ease-in-out cursor-pointer transform hover:scale-105"
          >
            <div class="animate-pulse">{{ s.id }}</div>
          </Link>
        </div>
      </div>
    </div>
  </Scaffold>
</template>
