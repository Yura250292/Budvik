package expo.modules.trackguard

import android.app.ActivityManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import expo.modules.backgroundtask.BackgroundTaskWork
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.TimeUnit

/**
 * Сторож треку, який працює БЕЗ мережі.
 *
 * Навіщо власний нативний код, коли є expo-background-task. Той ставить
 * WorkManager-обмеження `NetworkType.CONNECTED` намертво (див. його
 * BackgroundTaskScheduler.kt), а змінити його нічим: у BackgroundTaskOptions є
 * лише minimumInterval. Тобто єдиний системний будильник застосунку не
 * спрацьовує саме там, де він потрібен — у селі без зв'язку, де служба треку
 * найчастіше й гине.
 *
 * Це не теоретична вада: у Kotlin-трекері, який ця збірка замінює, обмеження
 * мережі не ставилося свідомо, і в його коді про це є прямий коментар —
 * «пульс без неї не полетить, але підняти вбиту службу треба й офлайн».
 * Перехід на Expo цю поведінку мовчки втратив, і маршрути почали рватися на
 * години.
 *
 * Робимо мінімальне втручання: ставимо ДРУГЕ періодичне завдання поверх
 * їхнього, з тим самим виконавцем `BackgroundTaskWork` і тими самими вхідними
 * даними, але без жодних обмежень. Свій воркер писати не треба — уся машинерія
 * підняття JS лишається за expo-background-task, ми міняємо тільки умову
 * запуску.
 *
 * Окреме ім'я роботи, а не перезапис їхньої: їхній планувальник далі керує
 * своєю (він скасовує й перестворює її при реєстрації завдань), і боротьба за
 * одне ім'я закінчилася б тим, що хтось із двох мовчки перемагає. Два запуски
 * замість одного нешкідливі — завдання JS ідемпотентне.
 */
class TrackGuardModule : Module() {
  companion object {
    private const val TAG = "TrackGuard"

    /** Своє ім'я — щоб не воювати з роботою expo-background-task. */
    private const val WORK_NAME = "budvik-track-guard-offline"

    /** Менше 15 хвилин WorkManager не дозволяє, хоч що передай. */
    private const val MIN_INTERVAL_MINUTES = 15L
  }

  override fun definition() = ModuleDefinition {
    Name("TrackGuard")

    /**
     * Ставить періодичний запуск фонових завдань без вимоги мережі.
     *
     * Повертає true, якщо роботу поставлено. false означає, що WorkManager
     * недоступний — застосунок у такому разі просто лишається з мережевим
     * сторожем expo-background-task.
     */
    Function("scheduleOfflineGuard") { intervalMinutes: Int ->
      val context = appContext.reactContext ?: return@Function false
      schedule(context, intervalMinutes.toLong().coerceAtLeast(MIN_INTERVAL_MINUTES))
    }

    Function("cancelOfflineGuard") {
      val context = appContext.reactContext ?: return@Function false
      runCatching { WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME) }
        .onFailure { Log.e(TAG, "не вдалося скасувати: ${it.message}") }
        .isSuccess
    }

    /**
     * Другий сторож — на будильнику, а не на WorkManager.
     *
     * Не заміна першому, а страховка від нього. WorkManager — це ПРОХАННЯ, і
     * оболонки Lenovo його відкладають на години: 08.09 планшет доповів рівно
     * одне пробудження сторожа за чотири години відкритої зміни. Будильник —
     * зобов'язання системи, і воно ще й дає коротке вікно, у якому Android
     * дозволяє підняти службу переднього плану з фону.
     */
    Function("scheduleExactGuard") { intervalMinutes: Int ->
      val context = appContext.reactContext ?: return@Function false
      AlarmScheduler.arm(context, intervalMinutes.toLong(), remember = true)
    }

    Function("cancelExactGuard") {
      val context = appContext.reactContext ?: return@Function false
      AlarmScheduler.cancel(context)
    }

    /**
     * Чим закінчилася попередня спроба — щоб розбір не був здогадом.
     *
     * Саме цієї відповіді бракувало місяць: «сторож не прокидався» і «сторож
     * прокинувся й нічого не зміг» виглядали з сервера однаково. Тепер видно
     * окремо, чи будильник узагалі спрацював і чи він точний.
     */
    /**
     * Що САМА система думає про наш застосунок — двома числами, яких досі
     * не було звідки взяти.
     *
     * 11.09.2026 розбір уперся в глухий кут: два планшети однієї моделі з
     * однаковою прошивкою, однаковими дозволами й знятою оптимізацією
     * батареї. В одного точний будильник б'є кожні 15 хвилин цілодобово, у
     * другого — п'ять разів за три доби. Усе, що ми вміли спитати, в обох
     * відповідало однаково й бездоганно.
     *
     * `standbyBucket` — кошик, у який Android сам поклав застосунок. У
     * RESTRICTED система відкладає і будильники, і фонові завдання приблизно
     * до одного разу на добу — рівно та картина, яку ми бачимо. І головне:
     * зняття оптимізації батареї з цього кошика НЕ виводить, тому наші
     * перевірки й показували, що все гаразд.
     *
     * `services` — чи існує наша служба переднього плану НАСПРАВДІ. Прапорець
     * `hasStartedLocationUpdatesAsync` читає збережену позначку й після
     * підняття процесу з фону бреше (це вже коштувало нам дня 07.09). З
     * Android O `getRunningServices` віддає лише власні служби застосунку —
     * тобто дозволу не треба, а відповідь пряма: система або тримає нашу
     * службу, або ні.
     *
     * Обидва виклики загороджені: проба, яка сама впала, не має права
     * забирати з планшета пульс.
     */
    Function("systemProbe") {
      val context = appContext.reactContext
        ?: return@Function mapOf("available" to false)
      mapOf(
        "available" to true,
        "standbyBucket" to standbyBucket(context),
        "services" to ownServices(context)
      )
    }

    Function("exactGuardStatus") {
      val context = appContext.reactContext
        ?: return@Function mapOf("available" to false)
      mapOf(
        "available" to true,
        "exact" to AlarmScheduler.canBeExact(context),
        "lastFiredAt" to AlarmScheduler.lastFiredAt(context),
        "armedFor" to AlarmScheduler.armedFor(context)
      )
    }
  }

  /**
   * Кошик застосунку словом. Про СЕБЕ питати можна без жодного дозволу —
   * PACKAGE_USAGE_STATS потрібен лише щоб питати про чужі застосунки.
   */
  private fun standbyBucket(context: Context): String = runCatching {
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
  private fun ownServices(context: Context): List<String> = runCatching {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      ?: return@runCatching emptyList()
    am.getRunningServices(Int.MAX_VALUE)
      .filter { it.service.packageName == context.packageName }
      .map { it.service.className.substringAfterLast('.') + if (it.foreground) "*" else "" }
  }.getOrElse { listOf("проба впала: ${it.message}") }

  private fun schedule(context: Context, minutes: Long): Boolean = runCatching {
    /**
     * Ключ області — ім'я пакета, рівно як його бере сам expo-background-task
     * (BackgroundTaskModule.kt: `val appScopeKey = it.packageName`). Інше
     * значення означало б, що воркер підніметься й не знайде жодного завдання.
     */
    val data = Data.Builder()
      .putString("appScopeKey", context.packageName)
      .build()

    val request = PeriodicWorkRequestBuilder<BackgroundTaskWork>(minutes, TimeUnit.MINUTES)
      // Обмежень немає навмисно — саме в цьому вся суть модуля.
      .setInputData(data)
      .setBackoffCriteria(BackoffPolicy.LINEAR, 5, TimeUnit.MINUTES)
      .build()

    WorkManager.getInstance(context).enqueueUniquePeriodicWork(
      WORK_NAME,
      /**
       * UPDATE, а не KEEP: інакше робота, поставлена попередньою збіркою,
       * жила б вічно зі старим інтервалом, і нові правила до неї не доїхали б.
       * Ту саму граблю вже описано в Kotlin-трекері.
       */
      ExistingPeriodicWorkPolicy.UPDATE,
      request
    )
    Log.i(TAG, "офлайн-сторож поставлено, інтервал $minutes хв")
    true
  }.getOrElse {
    Log.e(TAG, "не вдалося поставити офлайн-сторожа: ${it.message}")
    false
  }
}
