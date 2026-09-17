// ============================================
// useCoarsePointer
//
// True when the primary pointer is a finger (`(pointer: coarse)`), kept live
// if that changes (a tablet docking a keyboard and trackpad, say). Used to
// offer swipe gestures only where swiping is the native idiom: with a mouse,
// dragging inside a card is how text gets selected.
// ============================================

import { useSyncExternalStore } from 'react'

const QUERY = '(pointer: coarse)'

function media(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(QUERY)
}

function subscribe(onChange: () => void) {
  const list = media()
  if (!list) return () => {}
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

const getSnapshot = () => media()?.matches ?? false
const getServerSnapshot = () => false

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
