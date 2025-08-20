<script setup lang="ts">
import Scaffold from '~/layouts/Scaffold.vue'
import { Head } from '@inertiajs/vue3'
import { __, useSocket } from '~/js/composables'
import { onBeforeUnmount, onMounted } from 'vue'
import {useMediasoup} from "~/js/mediasoup";

const socket = useSocket()
const mediasoupInit =async () => {
  const {device,msClient}= await useMediasoup()
}

const socketLeave = () => {
  if (socket) {
    // socket.off('connect')
  }
}
onMounted(() => {
  mediasoupInit()
})
onBeforeUnmount(() => {
  socketLeave()
})
</script>

<template>
  <Scaffold>
    <Head :title="__('streamer')" />
    <div id="local-control">
      <div id="join-control">
        <button id="join-button" onclick="Client.joinRoom()">
          join room
        </button>
        <span class="arrow"> &#x21E2; </span>
      </div>

      <div id="camera-control">
        <button id="send-camera" onclick="Client.sendCameraStreams()">
          send camera streams
        </button>
        <button id="stop-streams" onclick="Client.stopStreams()">
          stop streams
        </button>
        <span id="camera-info"></span>
        <button id="share-screen" onclick="Client.startScreenshare()">
          share screen
        </button>
        <div id="outgoing-cam-streams-ctrl">
          <div><input id="local-cam-checkbox" type="checkbox" checked
                      onchange="Client.changeCamPaused()"></input>
            <label id="local-cam-label">camera</label>
            <span id="camera-producer-stats" class="track-ctrl"></span>
          </div>
          <div><input id="local-mic-checkbox" type="checkbox" checked
                      onchange="Client.changeMicPaused()"></input>
            <label id="local-mic-label">mic</label></div>
          <div id="local-screen-pause-ctrl">
            <input id="local-screen-checkbox" type="checkbox" checked
                   onchange="Client.changeScreenPaused()"></input>
            <label id="local-screen-label">screen</label>
            <span id="screen-producer-stats" class="track-ctrl"></span>
          </div>
          <div id="local-screen-audio-pause-ctrl">
            <input id="local-screen-audio-checkbox" type="checkbox" checked
                   onchange="Client.changeScreenAudioPaused()"></input>
            <label id="local-screen-audio-label">screen audio</label>
            <span id="screen-audio-producer-stats" class="track-ctrl"></span>
          </div>
        </div>
      </div>

      <button id="leave-room" onclick="Client.leaveRoom()">
        leave room
      </button>

    </div>

    <div id="available-tracks">
    </div>

    <div id="remote-video">
    </div>

    <div id="remote-audio">
    </div>
  </Scaffold>
</template>

<style scoped></style>
