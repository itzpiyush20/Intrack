// ============================================
// Haptics
//
// A light physical tick on key actions in the native app — approve, save,
// delete. On the web every call is a no-op.
//
// Fire-and-forget: callers write `void haptics.success()` and carry on. A
// device without a vibration motor, or a plugin error, must never stop the
// save or approval the tick was decorating.
// ============================================

import { Capacitor } from '@capacitor/core'

type Kind = 'tap' | 'success' | 'warning'

async function fire(kind: Kind): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    // Imported on demand so the web bundle never loads the plugin.
    const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics')
    if (kind === 'tap') {
      await Haptics.impact({ style: ImpactStyle.Light })
    } else {
      await Haptics.notification({
        type: kind === 'success' ? NotificationType.Success : NotificationType.Warning,
      })
    }
  } catch {
    // Deliberately silent: see header.
  }
}

export const haptics = {
  tap: () => fire('tap'),
  success: () => fire('success'),
  warning: () => fire('warning'),
}
