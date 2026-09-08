package expo.modules.trackguard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Планшет увімкнули або оновили застосунок — сторож мусить ожити сам.
 *
 * Дозвіл RECEIVE_BOOT_COMPLETED стояв у маніфесті з самого початку, а приймача
 * під ним не було — тобто після перезавантаження не прокидався ніхто. Android
 * доставку координат після ребуту не відновлює, і день починався порожнім,
 * поки людина не відкриє застосунок руками. Те саме після встановлення нової
 * збірки: система зупиняє все фонове до першого запуску.
 *
 * Самого запису тут не піднімаємо: службу переднього плану з приймача
 * завантаження підняти не можна, та й вирішувати, чи ПОТРІБЕН зараз запис,
 * має JS — він знає про роль і відкриту зміну. Наше завдання вужче: поставити
 * будильник, а далі ланцюжок зробить усе сам.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      "android.intent.action.QUICKBOOT_POWERON" -> {
        Log.i("TrackGuard", "після ${intent.action} ставимо будильник")
        AlarmScheduler.arm(context)
        AlarmScheduler.kickJs(context)
      }
    }
  }
}
