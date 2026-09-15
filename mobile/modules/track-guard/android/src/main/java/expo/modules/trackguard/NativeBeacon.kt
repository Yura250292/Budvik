package expo.modules.trackguard

import android.content.BroadcastReceiver
import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Нативний маяк: знімок стану йде на сервер БЕЗ участі JS.
 *
 * ЧОМУ НЕ ПУЛЬС. Пульс шле JS, а 15.09.2026 заморожений був саме JS: диспетчер
 * expo забув контекст, координати, сторож і пуші лягали в чергу без читача, і
 * від трьох планшетів годинами не приходило нічого. Тиша на сервері однаково
 * означала «вимкнений», «без мережі» і «заморожений» — розрізнити їх не було чим.
 * Будильник track-guard при цьому бив справно (у Кулика о 10:47), бо він
 * нативний. Тож знімок шлемо звідти.
 *
 * Адресу й токен кладе JS на кожному пульсі (`configureBeacon`): маяк сам
 * токена не має і без JS отримати його не може.
 *
 * Обмеження, свідомо: не частіше разу на 4 хвилини для будильника (два
 * будильники поспіль не дадуть нічого нового), тайм-аути по 4 секунди — приймач
 * трансляції не має права висіти, і `goAsync` дає йому лічені секунди.
 */
object NativeBeacon {
  private const val TAG = "TrackGuard"
  private const val PREFS = "track-guard-beacon"
  private const val MIN_GAP_MS = 4 * 60_000L
  private const val TIMEOUT_MS = 4_000

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun configure(context: Context, url: String, token: String, build: String): Boolean = runCatching {
    prefs(context).edit()
      .putString("url", url)
      .putString("token", token)
      .putString("build", build)
      .apply()
    true
  }.getOrDefault(false)

  fun status(context: Context): JSONObject {
    val p = prefs(context)
    return JSONObject()
      .put("configured", p.getString("url", null) != null && p.getString("token", null) != null)
      .put("lastAt", p.getLong("lastAt", 0L))
      .put("lastReason", p.getString("lastReason", "") ?: "")
      .put("lastResult", p.getString("lastResult", "") ?: "")
  }

  /** З приймача трансляції: мережа — у фоновому потоці, приймач тримаємо через goAsync. */
  fun sendAsync(receiver: BroadcastReceiver, context: Context, reason: String) {
    val pending = runCatching { receiver.goAsync() }.getOrNull()
    val app = context.applicationContext
    Thread {
      try {
        send(app, reason)
      } catch (e: Throwable) {
        Log.w(TAG, "маяк упав: ${e.message}")
      } finally {
        runCatching { pending?.finish() }
      }
    }.start()
  }

  /** Синхронно, у потоці того, хто кличе. Нічого не кидає назовні через sendAsync. */
  fun send(context: Context, reason: String) {
    val p = prefs(context)
    val url = p.getString("url", null) ?: return
    val token = p.getString("token", null) ?: return
    val now = System.currentTimeMillis()
    if (reason == "alarm" && now - p.getLong("lastAt", 0L) < MIN_GAP_MS) return

    val body = JSONObject()
      .put("reason", reason)
      .put("at", now)
      .put("build", p.getString("build", "") ?: "")
      .put("snapshot", Diag.snapshot(context))
      .toString()
      .toByteArray(Charsets.UTF_8)
    p.edit().putLong("lastAt", now).putString("lastReason", reason).apply()

    val result = runCatching {
      val conn = URL(url).openConnection() as HttpURLConnection
      try {
        conn.requestMethod = "POST"
        conn.connectTimeout = TIMEOUT_MS
        conn.readTimeout = TIMEOUT_MS
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Authorization", "Bearer $token")
        conn.setRequestProperty("x-budvik-app", "staff-native")
        conn.outputStream.use { it.write(body) }
        "HTTP ${conn.responseCode}"
      } finally {
        conn.disconnect()
      }
    }.getOrElse { "помилка: ${it.message}" }
    p.edit().putString("lastResult", result.take(120)).apply()
  }
}
