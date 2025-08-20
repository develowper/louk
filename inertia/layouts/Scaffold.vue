<script setup lang="ts">
import App from '~/layouts/App.vue'
import { __, dir, useSocket } from '~/js/composables'
import favicon from '~/images/logo.png'
import { Head, Link, usePage } from '@inertiajs/vue3'
import { io } from 'socket.io-client'
import { onBeforeUnmount, onMounted, provide } from 'vue'
const socket = useSocket()
onMounted(() => {})
onBeforeUnmount(() => {
  socket.disconnect()
})
</script>

<template>
  <App>
    <header :dir="dir()"></header>
  </App>
  <main :dir="dir()" class="min-h-screen">
    <Head>
      <meta name="author" :content="__('app_name')" />
      <link rel="shortcut icon" type="image/x-icon" :href="favicon" />
      <slot name="header" />
    </Head>

    <slot />
  </main>
</template>

<style scoped></style>
