package expo.modules.trackguard

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.ExistingWorkPolicy
import androidx.work.WorkManager
import expo.modules.backgroundtask.BackgroundTaskWork

/**
 * Будильник, якого оболонка не може відкласти.
 *
 * Навіщо він понад WorkManager, який уже стоїть поруч. WorkManager — це
 * ПРОХАННЯ: система вільна відкласти роботу на години, і саме це роблять
 * оболонки Lenovo, на яких стоїть усе поле. Цифри не залишають місця для
 * сумніву: 08.09 планшет Джумаги повідомив, що сторож прокидався рівно один
 * раз — при підйомі процесу о 08:23, — і за наступні чотири години жодного
 * разу. Трек при цьому стояв, і підняти його не було кому.
 *
 * `setExactAndAllowWhileIdle` — інша річ: це зобов'язання системи, воно
 * пробиває Doze і не залежить від настрою оболонки. Ціна — дозвіл
 * USE_EXACT_ALARM, який у Play вимагав би обґрунтування; але робоча збірка в
 * Play не публікується, вона роздається файлом із сайту.
 *
 * Другий, менш очевидний зиск. Android 12+ забороняє піднімати службу
 * переднього плану з фону — і саме через це трек не оживає сам. Спрацювання
 * ТОЧНОГО будильника входить у перелік винятків: у короткому вікні після
 * нього запуск служби дозволений. Тобто це не лише «прокинутись вчасно», а
 * ще й єдина законна мить, коли вбитий запис можна підняти без людини.
 *
 * Будильник одноразовий за своєю природою, тож кожне спрацювання ставить
 * наступний — ланцюжок тримається сам, доки його не скасують.
 */
object AlarmScheduler {
  private const val TAG = "TrackGuard"

  /** Дія власного наміру: ім'я пакета в префіксі, щоб не перетнутися ні з ким. */
  const val ACTION_TICK = "ua.budvik.staff.TRACK_GUARD_TICK"

  private const val PREFS = "track-guard"
  private const val KEY_INTERVAL = "intervalMinutes"
  private const val KEY_LAST_FIRED = "lastFiredAt"
  private const val KEY_ARMED = "armedFor"

  /** Менше за це не ставимо: батарея дорожча за п'ять хвилин треку. */
  private const val MIN_MINUTES = 10L
  private const val DEFAULT_MINUTES = 15L

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun intent(context: Context): PendingIntent {
    val i = Intent(context, TrackAlarmReceiver::class.java).setAction(ACTION_TICK)
    /**
     * FLAG_IMMUTABLE обов'язковий з Android 12 — інакше система відхиляє
     * створення наміру взагалі. UPDATE_CURRENT, щоб перестановка будильника
     * не плодила другий екземпляр.
     */
    return PendingIntent.getBroadcast(
      context,
      0,
      i,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /** Чи дозволено ставити ТОЧНИЙ будильник саме зараз. */
  fun canBeExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return false
    return am.canScheduleExactAlarms()
  }

  /**
   * Поставити наступне спрацювання.
   *
   * `remember` = true при першій постановці з JS: інтервал треба пережити
   * перезавантаження, бо приймач BOOT_COMPLETED не має звідки його взяти.
   */
  fun arm(context: Context, minutes: Long = 0, remember: Boolean = false): Boolean = runCatching {
    val interval = when {
      minutes > 0 -> minutes.coerceAtLeast(MIN_MINUTES)
      else -> prefs(context).getLong(KEY_INTERVAL, DEFAULT_MINUTES)
    }
    if (remember) prefs(context).edit().putLong(KEY_INTERVAL, interval).apply()

    val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
      ?: return@runCatching false
    val at = System.currentTimeMillis() + interval * 60_000L

    /**
     * Точний, якщо дозволено; інакше — приблизний, але теж крізь Doze.
     *
     * Мовчазної відмови тут бути не має: `setExactAndAllowWhileIdle` без
     * дозволу кидає SecurityException, і сторож помер би саме там, де він
     * потрібен, не лишивши сліду.
     */
    if (canBeExact(context)) {
      am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent(context))
    } else {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent(context))
      Log.w(TAG, "точні будильники заборонені — ставимо приблизний")
    }
    prefs(context).edit().putLong(KEY_ARMED, at).apply()
    true
  }.getOrElse {
    Log.e(TAG, "не вдалося поставити будильник: ${it.message}")
    false
  }

  fun cancel(context: Context): Boolean = runCatching {
    val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
      ?: return@runCatching false
    am.cancel(intent(context))
    prefs(context).edit().remove(KEY_ARMED).apply()
    true
  }.getOrElse { false }

  /** Позначка «будильник справді спрацював» — головний доказ для розбору. */
  fun markFired(context: Context) {
    prefs(context).edit().putLong(KEY_LAST_FIRED, System.currentTimeMillis()).apply()
  }

  fun lastFiredAt(context: Context): Long = prefs(context).getLong(KEY_LAST_FIRED, 0L)
  fun armedFor(context: Context): Long = prefs(context).getLong(KEY_ARMED, 0L)

  /**
   * Розбудити JS тим самим шляхом, що й періодичний сторож.
   *
   * Свого виконавця не пишемо навмисно: уся машинерія підняття контексту JS і
   * пошуку зареєстрованих завдань лишається за expo-background-task, а ми
   * міняємо лише привід запуску. Одноразова робота без жодних обмежень —
   * мережі тут може не бути, і саме тоді сторож найпотрібніший.
   */
  fun kickJs(context: Context): Boolean = runCatching {
    val data = Data.Builder().putString("appScopeKey", context.packageName).build()
    val request = OneTimeWorkRequestBuilder<BackgroundTaskWork>().setInputData(data).build()
    WorkManager.getInstance(context).enqueueUniqueWork(
      "budvik-track-guard-tick",
      ExistingWorkPolicy.REPLACE,
      request
    )
    true
  }.getOrElse {
    Log.e(TAG, "не вдалося розбудити JS: ${it.message}")
    false
  }
}
