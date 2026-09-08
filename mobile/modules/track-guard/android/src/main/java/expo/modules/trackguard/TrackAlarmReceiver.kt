package expo.modules.trackguard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Спрацювання будильника: розбудити застосунок і поставити наступний.
 *
 * Порядок навмисний. Спершу позначка й наступний будильник, і лише потім
 * робота: якщо підйом JS упаде, ланцюжок усе одно триматиметься далі. Інакше
 * одна невдача назавжди обриває сторожа — рівно та вада, через яку трек і
 * помирав мовчки.
 */
class TrackAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != AlarmScheduler.ACTION_TICK) return
    Log.i("TrackGuard", "будильник спрацював")
    AlarmScheduler.markFired(context)
    AlarmScheduler.arm(context)
    AlarmScheduler.kickJs(context)
  }
}
