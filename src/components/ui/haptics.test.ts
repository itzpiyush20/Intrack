import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ value: false }))
const impact = vi.hoisted(() => vi.fn())
const notification = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value },
}))

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact, notification },
  ImpactStyle: { Light: 'LIGHT' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' },
}))

import { haptics } from './haptics'

beforeEach(() => {
  impact.mockReset()
  notification.mockReset()
})

describe('haptics', () => {
  it('does nothing on the web', async () => {
    native.value = false
    await haptics.tap()
    await haptics.success()
    await haptics.warning()
    expect(impact).not.toHaveBeenCalled()
    expect(notification).not.toHaveBeenCalled()
  })

  it('gives a light impact for a tap in the native app', async () => {
    native.value = true
    await haptics.tap()
    expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' })
  })

  it('uses success and warning notifications in the native app', async () => {
    native.value = true
    await haptics.success()
    await haptics.warning()
    expect(notification).toHaveBeenNthCalledWith(1, { type: 'SUCCESS' })
    expect(notification).toHaveBeenNthCalledWith(2, { type: 'WARNING' })
  })

  it('never lets a haptics failure break the action that triggered it', async () => {
    native.value = true
    impact.mockRejectedValueOnce(new Error('no vibrator'))
    await expect(haptics.tap()).resolves.toBeUndefined()
  })
})
