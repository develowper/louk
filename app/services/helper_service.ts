import fs from 'node:fs'
import { HttpContext } from '@adonisjs/core/http'
import { usePage } from '@inertiajs/vue3'
import app from '@adonisjs/core/services/app'
import { storage } from '#start/globals'
import env from '#start/env'
import i18nManager from '@adonisjs/i18n/services/main'

class Helper {
  static dir() {
    let $lang = usePage().props.language
    if ($lang == 'en') return 'ltr'
    else return 'rtl'
  }
  public static getFakeHttpCtx(): HttpContext {
    return (
      storage?.getStore() ?? ({ i18n: i18nManager?.locale(env.get('LOCALE', '')) } as HttpContext)
    )
  }
  public static __(key: string, data: any = {}, i18n = null) {
    const ctx = HttpContext.get()?.i18n ?? Helper.getFakeHttpCtx()?.i18n

    return ctx?.t(`messages.${key}`, data)
  }
  public static getLangFile(ctx: HttpContext | null) {
    let locale

    if (ctx?.i18n) locale = ctx.i18n.locale
    else locale = i18nManager?.defaultLocale
    const path = app.languageFilesPath(`${locale}/messages.json`)

    try {
      return JSON.parse(fs.readFileSync(path, 'utf8'))
    } catch (err) {
      return {}
    }
  }
}
export const {
  dir,

  getLangFile,
} = Helper
