// ============================================
// AuthContext — Global auth state management
// Handles session tracking, login, signup,
// logout, password reset, and Google OAuth
// ============================================

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { User, Session } from '@supabase/supabase-js'
import { supabase, readStoredSession } from '@/services/supabase'
import { saveGoogleToken, clearGoogleToken, clearAllGoogleTokens, isGoogleConnected, purgeOldTokenKey, validateGoogleToken, saveGoogleRefreshTokenServerSide, migrateLegacyRefreshToken, disconnectGmail, tryRefreshGoogleToken } from '@/services/googleAuth'
import { Button } from '@/components/ui'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
}

interface AuthContextValue extends AuthState {
  profile: any
  hasGoogleToken: boolean
  refreshProfile: () => Promise<void>
  notifyGoogleTokenCleared: () => void
  disconnectGoogle: () => Promise<{ error: string | null }>
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signInWithGoogle: (redirectPath?: string, requestGmailScope?: boolean, forceConsent?: boolean) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: string | null }>
  isSubscriptionActive: boolean
  daysLeft: number
  updateSubscriptionStatus: (status: 'active' | 'trial', planType?: 'monthly' | 'annual', promoCode?: string) => Promise<boolean>
  authModalOpen: boolean
  authModalRedirect: string | null
  authModalTab: 'login' | 'signup'
  openAuthModal: (redirectPath?: string, tab?: 'login' | 'signup') => void
  closeAuthModal: () => void
  currencySymbol: string
  dailyScanTime: string
  updateDailyScanTime: (time: string) => Promise<boolean>
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface DeviceSession {
  id: string
  name: string
  lastActive: number
}

/**
 * Entitlement — the ONLY thing the paid-screen gate is allowed to read.
 *
 * `profile` is deliberately painted from localStorage first (see refreshProfile)
 * so a returning subscriber doesn't watch the header flicker through "Upgrade"
 * on every load. That cache used to feed isSubscriptionActive as well, and it is
 * a plain localStorage entry: setting dhanrakshak_sub_status_<uid> to "active"
 * and dhanrakshak_sub_expires_<uid> to a future date in DevTools walked straight
 * past ProtectedRoute onto every paid screen. Worse, the two fallback paths in
 * refreshProfile (database read errored / threw) rebuilt the WHOLE profile from
 * those keys, so an attacker could also just make the profile request fail.
 *
 * The split is: cache may PAINT, only the database may AUTHORISE.
 *
 *  - 'pending'      the profile row has not come back yet. The gate neither
 *                   grants nor denies; `loading` stays true and ProtectedRoute
 *                   keeps showing its spinner. This is the state that used to be
 *                   answered from cache, and it is why paying users never see a
 *                   flash of the paywall despite the gate being strict.
 *  - 'confirmed'    values copied out of the profiles row we just read. Only
 *                   this state can make isSubscriptionActive true.
 *  - 'unconfirmed'  the read failed. We stop loading (the app must not hang) but
 *                   we do NOT grant access: an unreachable database is not proof
 *                   of a subscription, and "make the request fail" must not be a
 *                   cheaper bypass than forging the cache. The cached profile is
 *                   still used for display, so such a user sees their real plan
 *                   name while being routed to /pricing.
 *
 * The Gmail scanner is unaffected either way — it re-reads entitlement from the
 * database itself before spending AI quota, so this was never a route to the
 * expensive work, only to the paid screens.
 */
type Entitlement =
  | { state: 'pending' }
  | { state: 'unconfirmed' }
  | { state: 'confirmed'; subscriptionStatus: string; expiresAt: string | null }

function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem('dhanrakshak_device_id')
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36)
      localStorage.setItem('dhanrakshak_device_id', id)
    }
    return id
  } catch (e) {
    return 'temp-device-' + Math.random().toString(36).substring(2)
  }
}

/**
 * Last known admin status for this account.
 *
 * Every fallback path in loadProfile rebuilds the profile from localStorage
 * when the database read is slow or fails — and something as ordinary as
 * minimising the window can trigger one. Those rebuilds used to omit is_admin
 * entirely, so it came back undefined, AdminRoute read that as "not an admin"
 * and redirected the user out of /admin mid-session.
 *
 * This is a display convenience only. Faking the cached value gains nothing:
 * every admin SQL function re-checks is_admin server-side and refuses.
 */
function readCachedIsAdmin(userId: string): boolean {
  try {
    return localStorage.getItem(`dhanrakshak_is_admin_${userId}`) === 'true'
  } catch {
    return false
  }
}

function getDeviceName(): string {
  const ua = navigator.userAgent
  let browser = 'Unknown Browser'
  let os = 'Unknown OS'

  if (/chrome|crios/i.test(ua) && !/edge|edg/i.test(ua) && !/opr/i.test(ua)) browser = 'Chrome'
  else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = 'Safari'
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox'
  else if (/edge|edg/i.test(ua)) browser = 'Edge'
  else if (/opr/i.test(ua)) browser = 'Opera'

  if (/windows/i.test(ua)) os = 'Windows'
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS'
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/linux/i.test(ua)) os = 'Linux'

  return `${browser} on ${os}`
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
  })

  const [deviceCheckRequired, setDeviceCheckRequired] = useState(false)
  const [activeSessions, setActiveSessions] = useState<DeviceSession[]>([])
  const [selectedDevices, setSelectedDevices] = useState<string[]>([])
  const [sessionModalError, setSessionModalError] = useState<string | null>(null)
  const [profile, setProfile] = useState<any>(null)
  const [entitlement, setEntitlement] = useState<Entitlement>({ state: 'pending' })
  // Which account the entitlement above belongs to. state.user is a fresh object
  // on every token refresh, so we cannot reset entitlement on every identity
  // change of that object without flashing the spinner hourly — but we MUST
  // reset it when the actual account changes, or the previous user's confirmed
  // entitlement would briefly authorise the next one.
  const entitlementUserIdRef = useRef<string | null>(null)

  const currencySymbol = '₹'

  const [dailyScanTime, setDailyScanTimeState] = useState<string>('06:00')

  useEffect(() => {
    if (state.user) {
      try {
        const stored = localStorage.getItem(`dhanrakshak_daily_scan_time_${state.user.id}`)
        setDailyScanTimeState(stored || '06:00')
      } catch {
        setDailyScanTimeState('06:00')
      }
    }
  }, [state.user])

  /**
   * Per-device, and deliberately so.
   *
   * This used to also write profiles.daily_scan_time, which failed on EVERY
   * save with `42703: column does not exist` — the column is declared in
   * schema.sql but no migration ever delivered it to production, the same drift
   * that hit razorpay_subscription_id and is_admin. The failure was swallowed
   * into a console warning, so the write appeared to work and never did.
   *
   * The column was not added, because the preference is client-side by nature:
   * it decides whether DashboardPage and PendingPage run a catch-up sync when
   * the app is OPENED. The server-side cron scans on one fixed schedule for
   * everyone and has never read this value. Storing it server-side would imply
   * a per-user schedule the backend does not implement.
   */
  const updateDailyScanTime = useCallback(async (time: string) => {
    if (!state.user) return false
    try {
      setDailyScanTimeState(time)
      localStorage.setItem(`dhanrakshak_daily_scan_time_${state.user.id}`, time)
      return true
    } catch (e) {
      console.error('Failed to save daily scan time:', e)
      return false
    }
  }, [state.user])

  // hasGoogleToken is a proper useState — not a computed value from localStorage.
  // It is SET explicitly when a token arrives (onAuthStateChange) or is cleared
  // (sign-out, expiry detection). This guarantees React re-renders whenever the
  // connection status changes, including after the user clears an expired token.
  const [hasGoogleToken, setHasGoogleToken] = useState<boolean>(() => isGoogleConnected())

  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authModalRedirect, setAuthModalRedirect] = useState<string | null>(null)
  const [authModalTab, setAuthModalTab] = useState<'login' | 'signup'>('login')

  const openAuthModal = useCallback((redirectPath?: string, tab?: 'login' | 'signup') => {
    setAuthModalRedirect(redirectPath || null)
    setAuthModalTab(tab || 'login')
    setAuthModalOpen(true)
  }, [])

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false)
    setAuthModalRedirect(null)
  }, [])

  // Call this from anywhere to reactively update the "disconnected" UI
  // when a token is cleared due to expiry or error.
  const notifyGoogleTokenCleared = useCallback(() => {
    clearGoogleToken()
    setHasGoogleToken(false)
  }, [])

  // Full Gmail disconnect: revokes the grant at Google and deletes the
  // server-side refresh token, so the daily sync cron stops reading this
  // inbox. Distinct from notifyGoogleTokenCleared, which only drops the
  // short-lived access token when it expires.
  const disconnectGoogle = useCallback(async (): Promise<{ error: string | null }> => {
    const jwt = state.session?.access_token
    if (!jwt) return { error: 'You must be signed in to disconnect Gmail.' }
    const { error } = await disconnectGmail(jwt)
    setHasGoogleToken(false)
    return { error }
  }, [state.session?.access_token])

  const refreshProfile = async () => {
    if (!state.user) {
      setProfile(null)
      setEntitlement({ state: 'pending' })
      return
    }

    // Immediately unblock the loading guard with a minimal profile so the app
    // never hangs on first-time users who have no localStorage cache yet.
    setProfile((prev: any) => prev ?? {
      id: state.user!.id,
      email: state.user!.email,
      subscription_status: 'trial',
      subscription_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      subscription_plan_type: 'trial',
      daily_scan_time: '06:00',
      is_admin: readCachedIsAdmin(state.user!.id),
    })

    // 1. Immediately load cached settings and subscription from localStorage to prevent flashes.
    //    Display only — this block writes `profile`, never `entitlement`. See the
    //    Entitlement type for why the two were separated.
    try {
      const cachedStatus = localStorage.getItem(`dhanrakshak_sub_status_${state.user.id}`)
      const cachedExpires = localStorage.getItem(`dhanrakshak_sub_expires_${state.user.id}`)
      const cachedPlan = localStorage.getItem(`dhanrakshak_sub_plan_${state.user.id}`)
      const cachedScanTime = localStorage.getItem(`dhanrakshak_daily_scan_time_${state.user.id}`) || '06:00'

      if (cachedStatus) {
        let subStatus = cachedStatus
        if (cachedExpires && (cachedStatus === 'active' || cachedStatus === 'trial')) {
          const expiresTime = new Date(cachedExpires).getTime()
          if (expiresTime <= Date.now()) {
            subStatus = 'expired'
          }
        }
        setProfile({
          id: state.user.id,
          email: state.user.email,
          subscription_status: subStatus,
          subscription_expires_at: cachedExpires || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          subscription_plan_type: cachedPlan || 'trial',
          daily_scan_time: cachedScanTime,
          is_admin: readCachedIsAdmin(state.user.id)
        })
      }

      if (cachedScanTime) {
        setDailyScanTimeState(cachedScanTime)
      }
    } catch (e) {
      console.warn('Failed to load cached profile:', e)
    }

    // 2. Fetch fresh data from Supabase
    try {
      // A queued plan (a renewal or a downgrade the customer already paid for)
      // starts on the date the previous one ended. This turns it on when they
      // next open the app. It MUST run before the SELECT below: the expiry
      // check further down would otherwise see the finished plan, mark the
      // account expired, and route a paying customer to /pricing.
      //
      // A no-op returning false on virtually every load — one cheap round trip
      // to avoid a nightly job and the lag that comes with it. A failure here
      // is not fatal: the profile read still happens and the plan activates on
      // the next load.
      try {
        await supabase.rpc('activate_pending_plan')
      } catch (e) {
        console.warn('Pending plan activation failed; will retry next load:', e)
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', state.user.id)
        .single()
      
      const localStatus = localStorage.getItem(`dhanrakshak_sub_status_${state.user.id}`)
      const localExpires = localStorage.getItem(`dhanrakshak_sub_expires_${state.user.id}`)
      const localPlan = localStorage.getItem(`dhanrakshak_sub_plan_${state.user.id}`)

      if (!error && data) {
        const createdAtTime = data.created_at ? new Date(data.created_at).getTime() : Date.now()
        const safeCreatedAtTime = isNaN(createdAtTime) ? Date.now() : createdAtTime
        
        // Prioritize database subscription status as the single source of truth
        const isSubscribed = data.subscription_status === 'active'
        let subStatus = data.subscription_status || 'trial'
        const subExpires = data.subscription_expires_at || new Date(safeCreatedAtTime + 7 * 24 * 60 * 60 * 1000).toISOString()
        const subPlan = data.subscription_plan_type || (isSubscribed ? 'monthly' : 'trial')

        // Check if expired
        const expiresTime = new Date(subExpires).getTime()
        if ((subStatus === 'active' || subStatus === 'trial') && expiresTime <= Date.now()) {
          subStatus = 'expired'
          // Write back to Supabase asynchronously
          supabase
            .from('profiles')
            .update({ subscription_status: 'expired', updated_at: new Date().toISOString() })
            .eq('id', state.user.id)
            .then(({ error: expiryError }) => {
              if (expiryError) console.warn('Failed to update expired subscription in database:', expiryError.message)
              else console.log('Successfully auto-expired subscription in database.')
            })
        }

        // Cache subscription details back to localStorage
        localStorage.setItem(`dhanrakshak_sub_status_${state.user.id}`, subStatus)
        if (subExpires) localStorage.setItem(`dhanrakshak_sub_expires_${state.user.id}`, subExpires)
        localStorage.setItem(`dhanrakshak_sub_plan_${state.user.id}`, subPlan)
        // Cached so the fallback paths below can restore it. Without this a
        // transient profile read rebuilds the profile without is_admin, which
        // reads as "not an admin" and ejects the user from /admin.
        localStorage.setItem(`dhanrakshak_is_admin_${state.user.id}`, String(data.is_admin === true))

        setProfile({
          ...data,
          subscription_status: subStatus,
          subscription_expires_at: subExpires,
          subscription_plan_type: subPlan
        })

        // The gate's authority, set from the row we just read and from nothing
        // else. subStatus already accounts for an elapsed expiry date above, so
        // a stale "active" row cannot be laundered into access here either.
        setEntitlement({
          state: 'confirmed',
          subscriptionStatus: subStatus,
          expiresAt: subExpires || null,
        })

        // Catch-up sync time is a per-device preference — see updateDailyScanTime
        // for why it is not persisted server-side. This used to try writing the
        // local value back to profiles.daily_scan_time on every profile load,
        // against a column that does not exist in production, so it fired a
        // failed request and a console warning on every single page load.
        const localScanTimePref = localStorage.getItem(`dhanrakshak_daily_scan_time_${state.user.id}`)
        if (localScanTimePref) {
          setDailyScanTimeState(localScanTimePref)
        }
      } else {
        // The profile row could not be read. We still rebuild a profile from the
        // cache so the UI has something to draw and the app does not hang, but
        // the entitlement stays unconfirmed: this branch used to be the softest
        // way past the paywall, because anything that broke the request — an RLS
        // change, a blocked host, DevTools request blocking — promoted the
        // forged cache to gospel.
        setEntitlement({ state: 'unconfirmed' })
        let subStatus = localStatus || 'trial'
        let subPlan = 'trial'
        if (localStatus === 'active') {
          subPlan = localPlan || ''
          if (!subPlan && localExpires) {
            const expiresTime = new Date(localExpires).getTime()
            const diffDays = Math.ceil((expiresTime - Date.now()) / (1000 * 60 * 60 * 24))
            subPlan = diffDays > 35 ? 'annual' : 'monthly'
          }
        }
        if (localExpires && (subStatus === 'active' || subStatus === 'trial')) {
          const expiresTime = new Date(localExpires).getTime()
          if (expiresTime <= Date.now()) {
            subStatus = 'expired'
          }
        }
        setProfile({
          id: state.user.id,
          email: state.user.email,
          subscription_status: subStatus,
          subscription_expires_at: localExpires || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          subscription_plan_type: subPlan,
          daily_scan_time: localStorage.getItem(`dhanrakshak_daily_scan_time_${state.user.id}`) || '06:00',
          is_admin: readCachedIsAdmin(state.user.id)
        })
      }
    } catch (e) {
      console.error('Error fetching profile in AuthContext:', e)
      // Same reasoning as the error branch above: cache may repaint the UI, it
      // may not authorise anything. A thrown request is not evidence of payment.
      setEntitlement({ state: 'unconfirmed' })
      // Fallback profile to prevent app from hanging
      const localStatus = localStorage.getItem(`dhanrakshak_sub_status_${state.user.id}`)
      const localExpires = localStorage.getItem(`dhanrakshak_sub_expires_${state.user.id}`)
      const localPlan = localStorage.getItem(`dhanrakshak_sub_plan_${state.user.id}`)
      let subStatus = localStatus || 'trial'
      let subPlan = 'trial'
      if (localStatus === 'active') {
        subPlan = localPlan || ''
        if (!subPlan && localExpires) {
          const expiresTime = new Date(localExpires).getTime()
          const diffDays = Math.ceil((expiresTime - Date.now()) / (1000 * 60 * 60 * 24))
          subPlan = diffDays > 35 ? 'annual' : 'monthly'
        }
      }
      if (localExpires && (subStatus === 'active' || subStatus === 'trial')) {
        const expiresTime = new Date(localExpires).getTime()
        if (expiresTime <= Date.now()) {
          subStatus = 'expired'
        }
      }
      setProfile({
        id: state.user.id,
        email: state.user.email,
        subscription_status: subStatus,
        subscription_expires_at: localExpires || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        subscription_plan_type: subPlan,
        daily_scan_time: localStorage.getItem(`dhanrakshak_daily_scan_time_${state.user.id}`) || '06:00',
        is_admin: readCachedIsAdmin(state.user.id)
      })
    }
  }

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    })
    return { error: error?.message ?? null }
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  const signInWithGoogle = async (redirectPath = '/dashboard', requestGmailScope = false, forceConsent = false) => {
    const oAuthOptions: any = {
      redirectTo: `${window.location.origin}${redirectPath}`,
    }

    if (requestGmailScope) {
      oAuthOptions.scopes = 'https://www.googleapis.com/auth/gmail.readonly'
      oAuthOptions.queryParams = {
        access_type: 'offline',
        prompt: forceConsent ? 'consent' : 'select_account',
      }
      localStorage.setItem('dhanrakshak_requesting_gmail_scope', 'true')
    } else {
      oAuthOptions.queryParams = {
        prompt: 'select_account',
      }
      localStorage.removeItem('dhanrakshak_requesting_gmail_scope')
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: oAuthOptions,
    })
    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.error('Error during supabase signOut:', err)
    } finally {
      setState({ user: null, session: null, loading: false })
      setHasGoogleToken(false)
      clearAllGoogleTokens()
      // Clear all Supabase session keys from localStorage
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('sb-') || key.includes('supabase') || key.includes('oauth')) {
          localStorage.removeItem(key)
        }
      }
      window.location.href = '/'
    }
  }

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { error: error?.message ?? null }
  }

  useEffect(() => {
    // Drop the previous account's confirmed entitlement the moment the account
    // itself changes, synchronously — refreshProfile only re-resolves it after
    // an awaited round trip, and in that window the gate would otherwise still
    // be answering with the signed-out user's subscription. Keyed on the id, not
    // the user object, because a token refresh hands us a new object for the
    // same account and must not send the whole app back to the spinner.
    const currentUserId = state.user?.id ?? null
    if (entitlementUserIdRef.current !== currentUserId) {
      entitlementUserIdRef.current = currentUserId
      setEntitlement({ state: 'pending' })
    }
    refreshProfile()
  }, [state.user])

  // Watchdog for the entitlement resolve.
  //
  // 'pending' now holds the whole app on ProtectedRoute's spinner, so a profile
  // read that never settles would be an indefinite hang — the same failure mode
  // the getSession() race above exists to prevent, and PostgREST calls do stall
  // behind a tab that was backgrounded for hours. After ten seconds we call the
  // question answered-but-unconfirmed: the user reaches the app instead of a
  // frozen spinner, on the unpaid side of the gate until a read succeeds.
  // Deliberately not a grant — a stalled request must never be worth more than
  // a completed one.
  useEffect(() => {
    if (!state.user || entitlement.state !== 'pending') return
    const timer = setTimeout(() => {
      setEntitlement(prev => (prev.state === 'pending' ? { state: 'unconfirmed' } : prev))
    }, 10000)
    return () => clearTimeout(timer)
  }, [state.user, entitlement.state])

  useEffect(() => {
    // Purge the old token key from previous app versions (no expiry tracking).
    // This runs once on mount and is a no-op if the key doesn't exist.
    purgeOldTokenKey()

    // Get initial session. supabase.auth.getSession() is gated behind the browser
    // Web Locks API, which can hang on tab re-focus after idle or under contention.
    // If it does not resolve quickly we fall back to the session persisted in
    // localStorage — NEVER to a null session — so a user with a valid stored
    // session is never falsely logged out and bounced to the landing page.
    const sessionPromise = supabase.auth.getSession()
    const timeoutPromise = new Promise<{ data: { session: Session | null } }>((resolve) =>
      setTimeout(() => resolve({ data: { session: readStoredSession() } }), 4000)
    )

    Promise.race([sessionPromise, timeoutPromise]).then(({ data: { session } }) => {
      // Clear loading immediately — token validation happens in the background
      // so a slow Gmail API call never blocks the app from rendering.
      setState({
        user: session?.user ?? null,
        session: session ?? null,
        loading: false,
      })

      // The refresh token goes straight to the server and is never written to
      // localStorage — it is a permanent Gmail credential.
      if (session?.provider_refresh_token && session.access_token) {
        saveGoogleRefreshTokenServerSide(session.access_token, session.provider_refresh_token)
      } else if (session?.access_token) {
        // Upgrade path: move any refresh token left in localStorage by an older
        // build to the server, then erase it. Keeps existing Gmail connections
        // working without forcing a re-authorisation.
        migrateLegacyRefreshToken(session.access_token)
      }

      if (session?.provider_token) {
        const providerToken = session.provider_token
        const isGmailFlow = localStorage.getItem('dhanrakshak_requesting_gmail_scope') === 'true'
        if (isGmailFlow) {
          saveGoogleToken(providerToken)
          setHasGoogleToken(true)
          localStorage.removeItem('dhanrakshak_requesting_gmail_scope')
        } else {
          // Fire-and-forget: doesn't block loading
          validateGoogleToken(providerToken).then((isValid) => {
            if (isValid) {
              saveGoogleToken(providerToken)
              setHasGoogleToken(true)
            } else {
              // Access token from Supabase session is expired — try silent refresh in background
              const refreshPromise = session.access_token
                ? tryRefreshGoogleToken(session.access_token)
                : Promise.resolve(null)
              refreshPromise.then((newToken) => setHasGoogleToken(!!newToken || isGoogleConnected()))
            }
          })
        }
      } else if (!isGoogleConnected() && session?.access_token) {
        // No access token in session at all — try silent refresh with stored refresh token in background
        tryRefreshGoogleToken(session.access_token).then((newToken) => {
          setHasGoogleToken(!!newToken)
        })
      } else {
        setHasGoogleToken(isGoogleConnected())
      }
    }).catch(() => {
      // getSession() rejected — fall back to the persisted session rather than
      // forcing a logout. Only treat as signed-out if storage is genuinely empty.
      const stored = readStoredSession()
      setState({ user: stored?.user ?? null, session: stored, loading: false })
    })

    // Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          setAuthModalOpen(false)
          if (window.location.pathname !== '/reset-password') {
            navigate('/reset-password')
          }
        }

        // Clear loading immediately — token validation runs in the background
        // so a slow Gmail API call never blocks/hangs the auth state update.
        setState({
          user: session?.user ?? null,
          session,
          loading: false,
        })

        // Server-side only — see the note on the matching block above.
        if (session?.provider_refresh_token && session.access_token) {
          saveGoogleRefreshTokenServerSide(session.access_token, session.provider_refresh_token)
        } else if (session?.access_token) {
          migrateLegacyRefreshToken(session.access_token)
        }

        if (session?.provider_token) {
          const providerToken = session.provider_token
          // Fresh token from OAuth callback — save ONLY if we explicitly initiated a Gmail scope flow
          const isGmailFlow = localStorage.getItem('dhanrakshak_requesting_gmail_scope') === 'true'
          if (isGmailFlow) {
            saveGoogleToken(providerToken)
            setHasGoogleToken(true)
            localStorage.removeItem('dhanrakshak_requesting_gmail_scope')
          } else {
            // Fire-and-forget: doesn't block the auth state update
            validateGoogleToken(providerToken).then((isValid) => {
              if (isValid) {
                saveGoogleToken(providerToken)
                setHasGoogleToken(true)
              } else {
                setHasGoogleToken(isGoogleConnected())
              }
            })
          }
        } else if (event === 'SIGNED_OUT') {
          clearAllGoogleTokens()
          setHasGoogleToken(false)
        } else {
          setHasGoogleToken(isGoogleConnected())
        }
        // Note: TOKEN_REFRESHED event does NOT re-issue the Google provider_token
        // so we don't clear hasGoogleToken on that event — the localStorage token
        // (with our 55-min expiry) handles the lifecycle correctly.

        if (event === 'SIGNED_IN' && session?.user) {
          // IMPORTANT: this callback is invoked while @supabase/auth-js holds its
          // internal Web Locks lock. Running another Supabase call synchronously
          // here can deadlock that lock and stall the very getSession() the app is
          // waiting on. Defer it to a fresh task so the lock is released first.
          const signedInUser = session.user
          setTimeout(() => {
            supabase.from('signin_logs').insert({
              user_id: signedInUser.id,
              email: signedInUser.email,
              device_name: getDeviceName(),
            }).then(({ error }) => {
              if (error) console.warn('signin_logs insert failed (non-critical):', error.message)
            })
          }, 0)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!state.user) {
      setDeviceCheckRequired(false)
      setActiveSessions([])
      return
    }

    /**
     * DETERRENT, NOT A SECURITY CONTROL. Read this before relying on it.
     *
     * The device list lives in Supabase auth user_metadata, which the signed-in
     * user is allowed to write themselves — that is the whole reason
     * supabase.auth.updateUser() can set it from the browser with no privileged
     * key. So anyone willing to open the console can call the same API, empty
     * user_sessions, and use as many devices as they like; clearing the
     * dhanrakshak_device_id localStorage key is enough to look like a brand-new
     * device as well. The blocking screen below stops honest account sharing,
     * which is what it is for, and nothing more.
     *
     * Making this enforceable needs state the user cannot write — a devices
     * table with an RLS policy that forbids client writes, or a serverless
     * endpoint that owns the list — and neither exists yet. Until one does, do
     * not treat "the app said 2 devices" as a fact about the account, and do not
     * build licensing or billing logic on top of this value.
     */
    const verifyDeviceSession = async () => {
      try {
        const deviceId = getOrCreateDeviceId()
        const metadata = state.user?.user_metadata || {}
        const rawSessions: unknown = metadata.user_sessions
        // Defensive parse: user_metadata is user-writable, so its shape is an
        // input, not a guarantee. A hand-edited value that is not an array of
        // {id,...} objects used to reach .filter()/.some() and throw inside an
        // un-awaited async function, i.e. an unhandled rejection that left
        // deviceCheckRequired stuck at its previous value.
        const sessions: DeviceSession[] = Array.isArray(rawSessions)
          ? rawSessions.filter((s): s is DeviceSession =>
              !!s && typeof s === 'object' && typeof (s as DeviceSession).id === 'string')
          : []

        // Filter out stale sessions (> 30 days)
        const now = Date.now()
        const thirtyDays = 30 * 24 * 60 * 60 * 1000
        const filtered = sessions.filter(s => now - (Number(s.lastActive) || 0) < thirtyDays)

        const isCurrentDeviceLogged = filtered.some(s => s.id === deviceId)

        if (isCurrentDeviceLogged) {
          // Only update lastActive timestamp in Supabase if the last active time is older than 5 minutes
          const currentSession = filtered.find(s => s.id === deviceId)
          const timeDiff = currentSession ? now - currentSession.lastActive : Infinity

          if (timeDiff > 5 * 60 * 1000) {
            const updated = filtered.map(s => s.id === deviceId ? { ...s, lastActive: now } : s)
            await supabase.auth.updateUser({ data: { user_sessions: updated } })
          }
          setDeviceCheckRequired(false)
        } else {
          if (filtered.length < 2) {
            // Add current device
            const updated = [...filtered, { id: deviceId, name: getDeviceName(), lastActive: now }]
            await supabase.auth.updateUser({ data: { user_sessions: updated } })
            setDeviceCheckRequired(false)
          } else {
            // Limit exceeded — show the device picker.
            setActiveSessions(filtered)
            setDeviceCheckRequired(true)
          }
        }
      } catch (e) {
        // Never let a failed metadata write lock a legitimate user out of their
        // own account. This ran un-awaited, so a rejection here (offline, auth
        // hiccup) was previously an unhandled promise rejection and the device
        // registration silently never happened.
        console.warn('Device session check failed (non-blocking):', e)
        setDeviceCheckRequired(false)
      }
    }

    verifyDeviceSession()
  }, [state.user])

  useEffect(() => {
    if (!state.user || deviceCheckRequired) return

    // Poll every 5 minutes to check if our device session was revoked (V2: reduced from 10s to prevent Supabase overuse)
    const interval = setInterval(async () => {
      try {
        const { data: { user: freshUser } } = await supabase.auth.getUser()
        if (freshUser) {
          const deviceId = getOrCreateDeviceId()
          const rawSessions: unknown = freshUser.user_metadata?.user_sessions
          const sessions: DeviceSession[] = Array.isArray(rawSessions)
            ? rawSessions.filter((s): s is DeviceSession =>
                !!s && typeof s === 'object' && typeof (s as DeviceSession).id === 'string')
            : []
          const isCurrentDeviceLogged = sessions.some(s => s.id === deviceId)

          // An EMPTY list is not a revocation. It means the metadata was never
          // written or was wiped — e.g. verifyDeviceSession's updateUser failed
          // offline, or another client reset it. Signing out on that condition
          // logged people out of a working session for a bookkeeping gap, and
          // since the list is user-writable it can never be authoritative
          // enough to justify that. Only an explicit list that exists and does
          // not contain us counts as "another device signed me out".
          if (sessions.length > 0 && !isCurrentDeviceLogged) {
            // Device session was revoked by another device — silently sign out
            // (the redirect to /login is the user feedback)
            signOut()
          }
        }
      } catch (e) {
        console.error('Error polling session status:', e)
      }
    }, 300000) // 5 minutes

    return () => clearInterval(interval)
  }, [state.user, deviceCheckRequired])



  const handleResolveSessions = async () => {
    if (selectedDevices.length === 0) {
      setSessionModalError('Please select at least one device to sign out.')
      return
    }

    setSessionModalError(null)
    try {
      const deviceId = getOrCreateDeviceId()
      const now = Date.now()

      // Remove the devices the user chose to sign out, and also drop any entry
      // for THIS device before re-adding it. Without that second filter a
      // re-run (the same device id already present from a partially applied
      // earlier attempt) produced two rows for one device, which then counted
      // twice against the limit of 2 and locked the user out of their own
      // remaining slot.
      const remaining = activeSessions.filter(
        s => !selectedDevices.includes(s.id) && s.id !== deviceId
      )
      const updated = [...remaining, { id: deviceId, name: getDeviceName(), lastActive: now }]

      const { data, error } = await supabase.auth.updateUser({ data: { user_sessions: updated } })
      if (error) throw error

      setDeviceCheckRequired(false)
      // Force state refresh
      setState(prev => ({
        ...prev,
        user: data.user
      }))
    } catch (e: any) {
      setSessionModalError('Failed to update sessions: ' + e.message)
    }
  }

  const handleToggleDeviceSelect = (id: string) => {
    setSelectedDevices(prev => 
      prev.includes(id) ? prev.filter(dId => dId !== id) : [...prev, id]
    )
  }

  // Formatting helper for relative active timestamp
  const formatRelativeTime = (time: number) => {
    const diff = Date.now() - time
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Active just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  if (deviceCheckRequired && state.user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-surface-0 px-4 py-8" role="main">
        <div className="w-full max-w-md bg-surface-1 border border-border-subtle rounded-3xl p-6 shadow-2xl backdrop-blur-2xl flex flex-col gap-6 animate-scale-up">
          <div className="text-center">
            <span className="text-4xl" aria-hidden="true">📱</span>
            {/* Copy is deliberately about tidying up your own devices, not about
                an enforced ceiling. The list this screen edits lives in
                user-writable metadata (see verifyDeviceSession), so promising
                that access "is limited to 2 devices" would be claiming a
                guarantee the client cannot make. */}
            <h1 className="text-xl font-bold text-white mt-4">Too Many Signed-In Devices</h1>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              Intrack keeps your account to <strong>2 devices</strong> at a time. To use this one, pick at least one device to sign out:
            </p>
          </div>

          <div className="space-y-2">
            {activeSessions.map((session) => {
              const isChecked = selectedDevices.includes(session.id)
              return (
                <div
                  key={session.id}
                  onClick={() => handleToggleDeviceSelect(session.id)}
                  className={`flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${
                    isChecked
                      ? 'border-brand-400 bg-brand-500/5 hover:bg-brand-500/10'
                      : 'border-border-subtle bg-surface-2/40 hover:bg-surface-2 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}} // Controlled by outer div click
                      className="rounded border-zinc-800 bg-surface-2 text-brand-500 focus:ring-brand-500/25 h-4 w-4 pointer-events-none"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-zinc-200">{session.name}</span>
                      <span className="text-xs text-zinc-500 mt-0.5">{formatRelativeTime(session.lastActive)}</span>
                    </div>
                  </div>
                  <span className="text-xs uppercase font-bold text-zinc-500 px-2 py-0.5 border border-border-subtle rounded-full">
                    Active
                  </span>
                </div>
              )
            })}
          </div>

          <div className="flex flex-col gap-2">
            {sessionModalError && (
              <div className="rounded-xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] px-3 py-2 text-xs text-[var(--status-danger-text)] text-center">
                ⚠️ {sessionModalError}
              </div>
            )}
            <Button
              onClick={handleResolveSessions}
              disabled={selectedDevices.length === 0}
              block
            >
              Sign Out Selected & Connect
            </Button>
            <Button
              variant="secondary"
              onClick={() => signOut()}
              block
            >
              Cancel & Log Out
            </Button>
          </div>
        </div>
      </main>
    )
  }

  /**
   * The paid-screen gate. Reads `entitlement`, never `profile` — `profile` is
   * the cache-painted display copy and editing one localStorage key used to be
   * enough to turn this true. Anything other than a database-confirmed row is
   * false here, and `loading` below keeps ProtectedRoute on its spinner for as
   * long as the answer is still 'pending', so "false while we don't know yet"
   * never reaches the user as a paywall.
   */
  const isSubscriptionActive = (() => {
    if (entitlement.state !== 'confirmed') return false
    const { subscriptionStatus, expiresAt } = entitlement
    if (subscriptionStatus === 'active') {
      // A lifetime/admin grant may legitimately carry no expiry date.
      if (!expiresAt) return true
      return new Date(expiresAt).getTime() > Date.now()
    }
    if (subscriptionStatus === 'trial') {
      // A trial without an end date is malformed data, not an unlimited trial.
      if (!expiresAt) return false
      return new Date(expiresAt).getTime() > Date.now()
    }
    return false
  })()

  const daysLeft = (() => {
    if (!profile || !profile.subscription_expires_at) return 0
    const expiresAt = new Date(profile.subscription_expires_at).getTime()
    const diff = expiresAt - Date.now()
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  })()

  const updateSubscriptionStatus = async (status: 'active' | 'trial', planType?: 'monthly' | 'annual', promoCode?: string) => {
    if (!state.user) return false
    try {
      const expiresAt = status === 'active'
        ? new Date(Date.now() + (planType === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

      const subPlanType = planType || (status === 'active' ? 'monthly' : 'trial')

      // Only write to Supabase profiles from client if we are in local development mode
      // In hosted environments, the serverless payment verification endpoint performs the DB write.
      const isDev = import.meta.env.DEV
      if (isDev) {
        const { error } = await supabase
          .from('profiles')
          .update({
            subscription_status: status,
            subscription_expires_at: expiresAt,
            subscription_plan_type: subPlanType,
            promo_code: promoCode || null
          })
          .eq('id', state.user.id)

        if (error) {
          console.warn('Supabase profile update with plan type/promo failed, retrying without these columns:', error.message)
          const { error: retryError } = await supabase
            .from('profiles')
            .update({
              subscription_status: status,
              subscription_expires_at: expiresAt
            })
            .eq('id', state.user.id)
          if (retryError) {
            console.warn('Supabase profile retry update failed:', retryError.message)
          }
        }
      }

      // Display cache only — this no longer unlocks anything by itself. The
      // refreshProfile() below re-reads the profiles row (written by the
      // serverless payment verification endpoint outside dev) and that read is
      // what actually confirms the entitlement.
      localStorage.setItem(`dhanrakshak_sub_status_${state.user.id}`, status)
      localStorage.setItem(`dhanrakshak_sub_expires_${state.user.id}`, expiresAt)
      localStorage.setItem(`dhanrakshak_sub_plan_${state.user.id}`, subPlanType)
      if (promoCode) {
        localStorage.setItem(`dhanrakshak_promo_code_${state.user.id}`, promoCode)
      }

      await refreshProfile()
      return true
    } catch (e) {
      console.error('Error updating subscription status:', e)
      return false
    }
  }

  // Signed-in users stay "loading" until the entitlement question has an answer
  // — confirmed or unconfirmed, either is an answer. Without this the gate would
  // read a 'pending' entitlement as "not subscribed" and bounce a paying user to
  // /pricing for the duration of the profile fetch, which is exactly the flash
  // the localStorage cache was introduced to avoid.
  const loading =
    state.loading ||
    (state.user !== null && (profile === null || entitlement.state === 'pending'))

  return (
    <AuthContext.Provider
      value={{
        ...state,
        loading,
        profile,
        hasGoogleToken,
        notifyGoogleTokenCleared,
        disconnectGoogle,
        refreshProfile,
        signUp,
        signIn,
        signInWithGoogle,
        signOut,
        resetPassword,
        isSubscriptionActive,
        daysLeft,
        updateSubscriptionStatus,
        authModalOpen,
        authModalRedirect,
        authModalTab,
        openAuthModal,
        closeAuthModal,
        currencySymbol,
        dailyScanTime,
        updateDailyScanTime
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

/** Hook to access auth state and methods */
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
