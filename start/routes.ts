/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import { getPeer } from '#services/mediasoup_service'

router.on('/').renderInertia('home').as('home')
router.on('/stream/:id').renderInertia('stream')

router
  .get('streamer', async ({ inertia, request }) => {
    return inertia.render('streamer', {})
  })
  .as('streamer')
router.get('streams/:id', async ({ inertia, request }) => {
  return inertia.render('viewer', {
    streamer: getPeer(request.param('id')),
  })
})
