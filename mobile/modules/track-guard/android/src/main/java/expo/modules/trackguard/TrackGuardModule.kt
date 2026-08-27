package expo.modules.trackguard

import android.content.Context
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
  }

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
