import type { ApplicationService } from '@adonisjs/core/types'
//import app from '@adonisjs/core/services/app'
import SocketioService from '#services/socketio_sevice'
import Helper from '#services/helper_service'
export default class SocketioProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton('mysocketio', async () => {
      return new SocketioService()
    })
  }

  async boot() {}

  async start() {}

  async ready() {
    const socket: SocketioService = await this.app.container.make('mysocketio')
    socket.init()
  }

  async shutdown() {}
}
