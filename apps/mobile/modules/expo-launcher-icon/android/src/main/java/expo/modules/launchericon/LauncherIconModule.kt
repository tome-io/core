package expo.modules.launchericon

import android.content.ComponentName
import android.content.pm.PackageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LauncherIconModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LauncherIcon")

    AsyncFunction("getIcon") {
      if (isEnabled(MONOCHROME_ALIAS)) MONOCHROME else FULL
    }

    AsyncFunction("setIcon") { icon: String ->
      if (icon != FULL && icon != MONOCHROME) {
        throw IllegalArgumentException("Unknown launcher icon: $icon")
      }
      setLauncherIcon(icon)
      icon
    }
  }

  private fun context() = appContext.reactContext
    ?: throw IllegalStateException("The Android application context is unavailable.")

  private fun component(alias: String): ComponentName {
    val context = context()
    return ComponentName(context.packageName, "${context.packageName}.$alias")
  }

  private fun isEnabled(alias: String): Boolean {
    return context().packageManager.getComponentEnabledSetting(component(alias)) ==
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED
  }

  private fun setLauncherIcon(icon: String) {
    val packageManager = context().packageManager
    val enable = if (icon == MONOCHROME) MONOCHROME_ALIAS else FULL_ALIAS
    val disable = if (icon == MONOCHROME) FULL_ALIAS else MONOCHROME_ALIAS

    // Enable the replacement first so the launcher never observes a package with no entry point.
    packageManager.setComponentEnabledSetting(
      component(enable),
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
      PackageManager.DONT_KILL_APP
    )
    packageManager.setComponentEnabledSetting(
      component(disable),
      PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
      PackageManager.DONT_KILL_APP
    )
  }

  private companion object {
    const val FULL = "full"
    const val MONOCHROME = "monochrome"
    const val FULL_ALIAS = "MainActivityTomeioFull"
    const val MONOCHROME_ALIAS = "MainActivityTomeioMonochrome"
  }
}
