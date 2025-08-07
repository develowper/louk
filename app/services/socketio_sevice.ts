import { Server } from 'socket.io'
import server from '@adonisjs/core/services/server'

export default class SocketioService {
  public static wsio: Server

  public async init() {
    SocketioService.wsio = new Server(server.getNodeServer(), {})

    SocketioService.wsio.on('connection', (socket) => {
      console.log(`    ------        Connection connected: ${socket.id}`)
      socket.on('JoinRoom', (data) => {
        console.log(`    ------ Joined room: ${data.roomId}`)
        socket.join(`stream-${data.roomId}`)
        socket.emit('JoinedRoom', data)
        SocketioService.wsio
          .to(`stream-${data.roomId}`)
          .emit('UserJoined', `user ${socket.id} joined in stream-${data.roomId}`)
      })
      socket.on('Disconnect', () => {
        console.log(`    ------ Disconnected from stream-${socket.id}`)
        SocketioService.wsio
          .to(`stream-${data.roomId}`)
          .emit('UserDisconnected', `user ${socket.id} disconnected from stream-${data.roomId}`)
      })
    })
  }
}
