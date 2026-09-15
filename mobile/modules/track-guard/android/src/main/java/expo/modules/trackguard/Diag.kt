package expo.modules.trackguard

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.app.job.JobScheduler
import android.app.usage.UsageStatsManager
import android.content.Context
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject

/**
 * Повний знімок того, що система й бібліотеки знають про запис треку.
 *
 * Навіщо. Місяць розборів «чому один день пише, а інший ні» впирався в те, що
 * все, про що ми вміли спитати, в живого й мертвого треку виглядало однаково.
 * 15.09.2026 причину знайшли статистикою: диспетчер фонових завдань expo
 * «забував» живий контекст JS. Сам він слідів не лишав, система — теж. Тут
 * зібрано все, що відповідає на це питання напряму, по ланцюжку від Android до
 * JS:
 *
 *   процес: коли піднявся і ЧОМУ вмирали попередні (ApplicationExitInfo);
 *   система: кошик, фонові обмеження, енергозбереження, геолокація, мережа;
 *   служба: чи тримає Android LocationTaskService і чи в передньому плані;
 *   expo-location: скільки координат прийшло від системи й скільки пішло далі;
 *   JobScheduler: чи не застрягла робота доставки;
 *   expo-task-manager: чи бачить диспетчер контекст JS, черга, хто знімав завдання.
 *
 * Кожен розділ загороджено окремо: упала одна проба — решта знімка лишається.
 * Знімок лише ЧИТАЄ: жодна частина не створює TaskService і не чіпає служби.
 */
object Diag {
  fun snapshot(context: Context): JSONObject {
    val out = JSONObject()
    put(out, "at") { System.currentTimeMillis() }
    put(out, "process") { process() }
    put(out, "exits") { exits(context) }
    put(out, "bucket") { standbyBucket(context) }
    put(out, "services") { JSONArray(ownServices(context)) }
    put(out, "restricted") { backgroundRestricted(context) }
    put(out, "power") { power(context) }
    put(out, "location") { location(context) }
    put(out, "network") { network(context) }
    put(out, "alarm") {
      JSONObject()
        .put("exact", AlarmScheduler.canBeExact(context))
        .put("lastFiredAt", AlarmScheduler.lastFiredAt(context))
        .put("armedFor", AlarmScheduler.armedFor(context))
    }
    put(out, "jobs") { jobs(context) }
    /**
     * Лічильники всередині бібліотек — рефлексією, бо track-guard від них не
     * залежить під час збирання. У збірці без патчів відповідь «немає в цій
     * збірці», а не падіння.
     */
    put(out, "taskService") {
      reflectJson("expo.modules.taskManager.BudvikTaskDiag", "snapshot", context)
    }
    put(out, "locationConsumer") {
      reflectJson("expo.modules.location.taskConsumers.LocationTaskConsumer", "budvikDiag", null)
    }
    put(out, "beacon") { NativeBeacon.status(context) }
    return out
  }

  private inline fun put(out: JSONObject, key: String, block: () -> Any?) {
    try {
      out.put(key, block() ?: JSONObject.NULL)
    } catch (e: Throwable) {
      runCatching { out.put(key, "помилка: ${e.message}") }
    }
  }

  private fun process(): JSONObject {
    val o = JSONObject().put("pid", Process.myPid())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      val ageMs = SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()
      o.put("startedAt", System.currentTimeMillis() - ageMs)
    }
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return o.put("importance", info.importance).put("trimLevel", info.lastTrimLevel)
  }

  /**
   * Чому вмирали попередні процеси — словами самої системи.
   *
   * Головна відповідь на «о 11:37 трек обірвався»: LOW_MEMORY (оболонка
   * звільняла пам'ять під інший застосунок), USER_REQUESTED (примусова
   * зупинка), CRASH/ANR (наша вада), FREEZER (система заморозила). Про власний
   * пакет Android відповідає без дозволу, з API 30.
   */
  private fun exits(context: Context): JSONArray {
    val arr = JSONArray()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return arr
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return arr
    for (e in am.getHistoricalProcessExitReasons(context.packageName, 0, 8)) {
      arr.put(
        JSONObject()
          .put("at", e.timestamp)
          .put("reason", reasonName(e.reason))
          .put("status", e.status)
          .put("importance", e.importance)
          .put("pss", e.pss)
          .put("desc", (e.description ?: "").take(120))
      )
    }
    return arr
  }

  private fun reasonName(code: Int): String = when (code) {
    ApplicationExitInfo.REASON_UNKNOWN -> "UNKNOWN"
    ApplicationExitInfo.REASON_EXIT_SELF -> "EXIT_SELF"
    ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
    ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY"
    ApplicationExitInfo.REASON_CRASH -> "CRASH"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
    ApplicationExitInfo.REASON_ANR -> "ANR"
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INIT_FAILURE"
    ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "PERMISSION_CHANGE"
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE"
    ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED"
    ApplicationExitInfo.REASON_USER_STOPPED -> "USER_STOPPED"
    ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "DEPENDENCY_DIED"
    ApplicationExitInfo.REASON_OTHER -> "OTHER"
    // Числами — константи з'явилися лише в API 33.
    14 -> "FREEZER"
    15 -> "PACKAGE_STATE_CHANGE"
    16 -> "PACKAGE_UPDATED"
    else -> "CODE_$code"
  }

  /**
   * Кошик застосунку словом. Про СЕБЕ питати можна без жодного дозволу —
   * PACKAGE_USAGE_STATS потрібен лише щоб питати про чужі застосунки.
   */
  fun standbyBucket(context: Context): String = runCatching {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return@runCatching "не питали"
    val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
      ?: return@runCatching "немає служби"
    when (val bucket = usm.appStandbyBucket) {
      UsageStatsManager.STANDBY_BUCKET_ACTIVE -> "ACTIVE"
      UsageStatsManager.STANDBY_BUCKET_WORKING_SET -> "WORKING_SET"
      UsageStatsManager.STANDBY_BUCKET_FREQUENT -> "FREQUENT"
      UsageStatsManager.STANDBY_BUCKET_RARE -> "RARE"
      // 45; константа є лише з API 30, тож числом — інакше стара збірка не злізе.
      45 -> "RESTRICTED"
      else -> "код $bucket"
    }
  }.getOrElse { "проба впала: ${it.message}" }

  /**
   * Власні служби, які система тримає ЗАРАЗ. Зірочка — у передньому плані.
   *
   * Імена короткі навмисно: рядок їде в пульс поруч із рештою діагностики й
   * читається очима, а повне ім'я класу з'їло б його цілком.
   */
  @Suppress("DEPRECATION")
  fun ownServices(context: Context): List<String> = runCatching {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      ?: return@runCatching emptyList()
    am.getRunningServices(Int.MAX_VALUE)
      .filter { it.service.packageName == context.packageName }
      .map { it.service.className.substringAfterLast('.') + if (it.foreground) "*" else "" }
  }.getOrElse { listOf("проба впала: ${it.message}") }

  /** «Обмежити фонову роботу» в налаштуваннях застосунку — окремо від батареї. */
  private fun backgroundRestricted(context: Context): Any {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return JSONObject.NULL
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return JSONObject.NULL
    return am.isBackgroundRestricted
  }

  private fun power(context: Context): JSONObject {
    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return JSONObject()
      .put("ignoringOptimizations", pm.isIgnoringBatteryOptimizations(context.packageName))
      .put("powerSave", pm.isPowerSaveMode)
      .put("idle", pm.isDeviceIdleMode)
      .put("interactive", pm.isInteractive)
  }

  private fun location(context: Context): JSONObject {
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val o = JSONObject()
      .put("gps", lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
      .put("network", lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) o.put("enabled", lm.isLocationEnabled)
    return o
  }

  /** Чи є мережа, яку система перевірила. Без неї черга точок росте, а не зникає. */
  private fun network(context: Context): JSONObject {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val active = cm.activeNetwork ?: return JSONObject().put("active", false)
    val caps = cm.getNetworkCapabilities(active)
    return JSONObject()
      .put("active", true)
      .put("internet", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true)
      .put("validated", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
      .put("wifi", caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true)
      .put("cellular", caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true)
  }

  /**
   * Роботи застосунку, які чекають у JobScheduler.
   *
   * Координати від expo-location ідуть до JS через роботу TaskJobService. Якщо
   * тут висить робота локації з сотнею координат усередині — система не
   * запускає доставку, і це не наша логіка, а планувальник.
   */
  private fun jobs(context: Context): JSONArray {
    val js = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
    val arr = JSONArray()
    for (job in js.allPendingJobs) {
      val extras = job.extras
      arr.put(
        JSONObject()
          .put("id", job.id)
          .put("service", job.service.className.substringAfterLast('.'))
          .put("task", extras.getString("taskName") ?: JSONObject.NULL)
          .put("data", extras.getInt("dataSize", 0))
      )
    }
    return arr
  }

  private fun reflectJson(className: String, method: String, context: Context?): Any {
    val cls = try {
      Class.forName(className)
    } catch (e: ClassNotFoundException) {
      return "немає в цій збірці"
    }
    val raw = if (context != null) {
      cls.getMethod(method, Context::class.java).invoke(null, context)
    } else {
      cls.getMethod(method).invoke(null)
    }
    return JSONObject(raw as String)
  }
}
