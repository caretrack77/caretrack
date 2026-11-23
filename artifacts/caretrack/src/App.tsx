import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, useLocation, useParams } from 'wouter';
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, Bell, CalendarDays, Check, Clock3, CircleHelp,
  ArrowLeftRight, ClipboardList, Download, Eye, EyeOff, FileText, KeyRound, UserPlus, HeartPulse, LayoutDashboard, LogOut, Mail, Menu, MessageSquare, Plus, Pill,
  Search, Send, ShieldCheck, Sparkles, Stethoscope, Users, Wifi, WifiOff, X, MessagesSquare, ChevronLeft, ChevronRight, RefreshCw, Trash2, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import {
  getGetAnalyticsQueryKey, getGetPatientQueryKey, getListAuditLogsQueryKey,
  getListDosesQueryKey, getListMedicationsQueryKey, getListNotificationsQueryKey,
  getListPatientInsightsQueryKey, getListReportSchedulesQueryKey, getListReportsQueryKey,
  getListPatientsQueryKey, getListUsersQueryKey, useCreateDemoDose, useCreateMedication, useCreatePatient,
  useCreateReportSchedule, useCreateUser, useDeleteMedication, useDeleteUser, useDeletePatient, useGeneratePatientInsight,
  useGenerateReport, useGetAnalytics, useGetCurrentUser, useGetPatient, useListAuditLogs,
  useListDoses, useListMedications, useListNotifications, useListPatientInsights, useListPatients,
  useListReportSchedules, useListReports, useListUsers, useLogin, useLogout, useMarkNotificationRead, useSimulateOverdueDoses,
  useUpdateDoseStatus, useUpdateMedication, useSendLoginOtp, useVerifyLoginOtp, useChangePassword, getGetCurrentUserQueryKey, useGetRiskModel, getGetRiskModelQueryKey, useTrainRiskModel, useListRiskPredictions, getListRiskPredictionsQueryKey, useGetPatientRisk, getGetPatientRiskQueryKey, useListLabResults, getListLabResultsQueryKey, useUploadLabResult, useReviewLabResult, useListAppointments, getListAppointmentsQueryKey, useCreateAppointment, useUpdateAppointment, useCreatePatientAccount, useGetDeliveryStatus, useSendDeliveryTest, useListCoverage, getListCoverageQueryKey, useCreateCoverage, useEndCoverage, useListProviders, useGetMedicationProgress, getGetMedicationProgressQueryKey, useListMessageThreads, getListMessageThreadsQueryKey, useListPatientMessages, getListPatientMessagesQueryKey, useSendPatientMessage, useMarkPatientMessagesRead,   useUpdatePatient, useUpdateReportSchedule, useUpdateUser, useListHealthMetrics, useCreateHealthMetric, useListHealthLogs, useCreateHealthLog, getListHealthMetricsQueryKey, getListHealthLogsQueryKey,
} from '@workspace/api-client-react';
import type { Analytics, Appointment, AuditLog, AuthUser, Coverage, LoginChallenge, OtpSendResult, Dose, Medication, Notification, Patient, Report, ReportSchedule, User, HealthMetric, HealthMetricInputMetricType, HealthLog, CalendarMessage, StaffMessage } from '@workspace/api-client-react';
import { useListMessageCalendar, getListMessageCalendarQueryKey, useListStaffThreads, getListStaffThreadsQueryKey, useListStaffMessages, getListStaffMessagesQueryKey, useSendStaffMessage, useMarkStaffMessagesRead } from '@workspace/api-client-react';
import { customFetch, OfflineError } from '@workspace/api-client-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { builtInServerUrl, clearNativeSession, getServerUrl, isNativeApp, normalizeServerUrl, openProtectedFile, saveServerUrl, streamServerEvents, testServer } from './native';
import { clearNativeNotifications, exactAlarmsAllowed, getNativePushStatus, notificationPermission, openExactAlarmSettings, previewNativeWellness, registerNativePushToken, requestNotificationPermission, showNativeAlert, syncNativeDoseReminders, syncNativeWellness, unregisterNativePushToken, type NativePushStatus } from './native-notifications';
import { clearSavedData, discardChange, getSyncSnapshot, keepMine, onSyncComplete, retryAll, subscribeSync, syncErrorOf, syncStateOf, unsyncedCount, type SyncState } from './offline';
import { clock12, dateTimeLabel, parseClockList, timeLabel } from './time-format';
import { initials, shortName } from './names';
import './index.css';
import { ChatWidget } from './components/ChatWidget';

// networkMode 'always': without it React Query pauses every query and save while the browser
// reports no network, so saved data would never show and offline saves would hang on "Saving…".
// Offline answers come from offline.ts (saved copies and the outbox).
const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, networkMode: 'always' }, mutations: { networkMode: 'always' } } });
// After waiting changes reach the server, reload every screen from the server.
onSyncComplete(() => { void client.invalidateQueries(); });
// Local calendar date (YYYY-MM-DD), not UTC, so "today" matches the user's clock.
const dateToday = () => new Date().toLocaleDateString('en-CA');
const dateTimeNow = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
};
/** The server's error message from a failed API call, or a fallback. */
const apiError = (err: unknown, fallback: string) => {
  const data = (err as { data?: { error?: unknown } } | null)?.data;
  return typeof data?.error === 'string' ? data.error : fallback;
};
/** The server refused this device for the account's role (patients: app only; doctors/admins: computer only). */
const isDeviceError = (err: unknown) => {
  const code = (err as { data?: { code?: unknown } } | null)?.data?.code;
  return code === 'MOBILE_APP_REQUIRED' || code === 'DESKTOP_REQUIRED';
};
const DEVICE_HINT = isNativeApp
  ? 'This app is for patients and caregivers. Doctors and administrators sign in on a computer at the CareTrack website.'
  : 'Patients and caregivers sign in with the CareTrack Android app. Doctors and administrators sign in here on a computer.';
/** Landing page for each role: patients start on their doses, everyone else on the overview. */
/** Removes cached pages and queued doses so the next person on this device sees nothing. */
const clearOfflineData = () => {
  navigator.serviceWorker?.controller?.postMessage('clear-cache');
  void clearSavedData();
  // Android app: forget the session token and cancel this user's scheduled reminders and tips.
  void clearNativeSession();
  void clearNativeNotifications();
};
/** Downloads a protected file. The browser uses the link itself; the Android app fetches it with its token. */
const nativeDownload = (path: string, name: string) => (e: { preventDefault: () => void }) => {
  if (!isNativeApp) return;
  e.preventDefault();
  openProtectedFile(path, name).catch((err: Error) => window.alert(err.message));
};
const homeFor = (role: string) => (role === 'patient' ? '/today' : '/dashboard');
const roleName = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);
const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, roles: ['admin', 'provider', 'caregiver'] },
  { href: '/today', label: 'Today’s doses', icon: ClipboardList, roles: ['patient', 'caregiver', 'provider'] },
  { href: '/patients', label: 'Patients', icon: Users, roles: ['admin', 'provider', 'caregiver'] },
  { href: '/medications', label: 'Medications', icon: Pill, roles: ['admin', 'provider', 'caregiver'] },
  { href: '/messages', label: 'Messages', icon: MessageSquare, roles: ['admin', 'provider', 'patient', 'caregiver'] },
  { href: '/team-messages', label: 'Team messages', icon: MessagesSquare, roles: ['admin', 'provider'] },
  { href: '/ai', label: 'AI risk prediction', icon: Sparkles, roles: ['admin', 'provider'] },
  { href: '/prescriptions', label: 'My prescriptions', icon: FileText, roles: ['patient', 'caregiver'] },
  { href: '/health', label: 'My health', icon: HeartPulse, roles: ['patient', 'caregiver'] },
  { href: '/appointments', label: 'Check-ups', icon: CalendarDays, roles: ['admin', 'provider', 'patient', 'caregiver'] },
  { href: '/analytics', label: 'Analytics', icon: BarChart3, roles: ['admin', 'provider'] },
  { href: '/reports', label: 'Reports', icon: FileText, roles: ['admin', 'provider', 'caregiver'] },
  { href: '/coverage', label: 'Doctor coverage', icon: ArrowLeftRight, roles: ['admin', 'provider'] },
  { href: '/admin/users', label: 'Team access', icon: ShieldCheck, roles: ['admin'] },
  { href: '/admin/audit', label: 'Audit activity', icon: Activity, roles: ['admin'] },
  { href: '/account', label: 'My account', icon: KeyRound, roles: ['admin', 'provider', 'patient', 'caregiver'] },
];

function App() {
  return <QueryClientProvider client={client}><Switch>
    <Route path="/login" component={LoginPage} />
    <Route><AuthenticatedApp /></Route>
  </Switch></QueryClientProvider>;
}

function LoginPage() {
  const [, setLocation] = useLocation();
  const login = useLogin(), sendOtp = useSendLoginOtp(), verifyOtp = useVerifyLoginOtp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // Step 2 of sign-in: one-time code by email or SMS.
  const [challenge, setChallenge] = useState<LoginChallenge|null>(null);
  const [sent, setSent] = useState<OtpSendResult|null>(null);
  const [code, setCode] = useState('');
  // Android app: ask for the server address first (or when the user taps "Change").
  const [editServer, setEditServer] = useState(false);
  const needsServer = isNativeApp && (editServer || !getServerUrl());
  const submit = (e: FormEvent) => {
    e.preventDefault(); setError('');
    login.mutate({ data: { email: email.trim(), password: password.trim() } }, { onSuccess: (r) => { if (r.otpRequired) { setChallenge(r); setSent(null); setCode(''); } else setLocation('/'); }, onError: (err) => setError(isDeviceError(err) ? apiError(err, DEVICE_HINT) : apiError(err, 'We couldn’t sign you in.') + ' Passwords are case-sensitive. Use the eye button to check what you typed.') });
  };
  const send = (channel: 'email'|'sms') => {
    if (!challenge?.challengeId) return; setError('');
    sendOtp.mutate({ data: { challengeId: challenge.challengeId, channel } }, { onSuccess: (r) => { setSent(r); setCode(''); }, onError: (err) => setError(apiError(err, 'We couldn’t send a code. Try again.')) });
  };
  const verify = (e: FormEvent) => {
    e.preventDefault(); if (!challenge?.challengeId) return; setError('');
    verifyOtp.mutate({ data: { challengeId: challenge.challengeId, code } }, { onSuccess: () => setLocation('/'), onError: (err) => setError(apiError(err, 'That code didn’t work. Try again.')) });
  };
  const restart = () => { setChallenge(null); setSent(null); setCode(''); setError(''); };
  const inputClass = 'h-12 w-full rounded-xl border border-input bg-white px-4 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10';
  const cardClass = 'space-y-5 rounded-3xl border border-[#dce9e9] bg-white p-6 shadow-[0_20px_50px_rgba(31,74,88,.08)] sm:p-8';
  return <div className="min-h-[100dvh] overflow-x-hidden bg-[#eef6f7] text-foreground flex flex-col lg:min-h-screen lg:flex-row">
    <section className="relative flex flex-col justify-between overflow-hidden bg-[#174353] px-6 py-6 text-white sm:min-h-[36vh] sm:px-7 sm:py-8 lg:min-h-[100dvh] lg:w-[48%] lg:px-14 lg:py-12">
      <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full border border-white/10" />
      <div className="absolute -right-4 top-20 h-72 w-72 rounded-full border border-white/10" />
      <div className="relative flex flex-wrap items-center gap-3">
        <img src="/whealth-logo.jpg" alt="Whealth" className="h-14 w-14 rounded-2xl bg-white object-contain p-1 shadow-lg sm:h-16 sm:w-16" />
        <div><div className="font-[Manrope] text-xl font-extrabold tracking-[-.04em] text-white sm:text-2xl">Whealth</div><div className="text-[10px] font-semibold tracking-[.16em] text-white/60">CARE, IN SYNC</div></div>
      </div>
      <div className="relative max-w-xl py-6 sm:py-12">
        <div className="mb-4 flex items-center gap-2 text-xs font-semibold tracking-[.16em] text-[#ffd13b] sm:mb-6 sm:text-sm"><span className="h-px w-8 bg-[#ffd13b]" /> MADE FOR EVERYDAY CARE</div>
        <h1 className="max-w-lg text-3xl font-bold leading-[1.1] tracking-[-.045em] sm:text-5xl lg:text-[58px]">A steadier rhythm for better care.</h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-white/70 sm:mt-6 sm:text-base sm:leading-7">Whealth keeps medication schedules clear for the people who give care and the people who receive it.</p>
        <div className="mt-12 hidden items-center gap-4 rounded-2xl border border-white/10 bg-white/[.06] p-4 backdrop-blur-sm sm:flex">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#6bd5c0]/15 text-[#77dfc9]"><HeartPulse size={22}/></div>
          <div><div className="text-sm font-semibold">The right dose. The right moment.</div><div className="mt-1 text-xs text-white/55">A shared view of the day, without the guesswork.</div></div>
        </div>
      </div>
      <div className="relative hidden items-center justify-between text-xs text-white/45 sm:flex"><span>Secure patient care platform</span><span>Designed for coordinated care</span></div>
    </section>
    <section className="flex flex-1 items-center justify-center px-5 py-8 sm:px-10 sm:py-12">
      <div className="w-full max-w-[420px] page-enter">
        {needsServer ? <ServerSetup inputClass={inputClass} cardClass={cardClass} onDone={()=>{setEditServer(false);setError('')}} onCancel={getServerUrl()?()=>setEditServer(false):undefined}/> : <>
        <div className="mb-6 sm:mb-9"><p className="text-xs font-bold uppercase tracking-[.16em] text-primary">Welcome back</p><h2 className="mt-3 text-2xl font-bold text-[#173d4a] sm:text-3xl">Sign in to Whealth</h2><p className="mt-2 text-sm text-muted-foreground">Sign in with the account provided by your administrator.</p><p data-testid="text-device-policy" className="mt-3 flex items-start gap-2 rounded-xl border border-[#d9e8e8] bg-white/70 px-3 py-2 text-xs leading-5 text-[#4f6f77]"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-[#25867c]"/>{isNativeApp?'For patients and caregivers. Doctors and administrators sign in on a computer at the CareTrack website.':'For doctors and administrators, on a desktop or laptop. Patients and caregivers use the CareTrack Android app.'}</p></div>
        {!challenge ? <form onSubmit={submit} className={`${cardClass} border-white/80 shadow-[0_24px_70px_rgba(31,74,88,.12)]`}>
          <label className="block"><span className="mb-2 block text-sm font-semibold">Email address</span><div className="relative"><EmailReferenceIcon/><input data-testid="input-email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} className={`${inputClass} pl-12`} placeholder="you@example.com"/></div></label>
          <label className="block"><span className="mb-2 block text-sm font-semibold">Password</span><PasswordInput testId="input-password" required value={password} onChange={setPassword} autoComplete="current-password" className={`${inputClass} pl-12`} placeholder="Enter your password" referenceLockIcon/></label>
          {error && <div data-testid="status-login-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          <button data-testid="button-login" disabled={login.isPending} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#17647a] font-semibold text-white shadow-sm transition hover:bg-[#125366] disabled:opacity-60">{login.isPending ? 'Checking…' : 'Continue'} <ArrowRight size={17}/></button>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs leading-5 text-muted-foreground"><ShieldCheck size={13}/> Protected with two-step verification</p>
        </form> : <div className={cardClass} data-testid="panel-otp">
          <div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#e4f4f0] text-[#25867c]"><ShieldCheck size={21}/></div><div><h3 className="font-bold text-[#173d4a]">Verify it’s you</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">For your security, we’ll send a 6-digit code. Choose where to receive it.</p></div></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {challenge.channels.includes('sms') && <button type="button" data-testid="button-otp-sms" onClick={()=>send('sms')} disabled={sendOtp.isPending} className={`rounded-xl border p-3 text-left transition disabled:opacity-60 ${sent?.channel==='sms'?'border-[#46b5a0] bg-[#eef9f6]':'border-[#dce8e8] hover:border-[#86c9c5]'}`}><span className="flex items-center gap-2 text-sm font-semibold text-[#285363]"><MessageSquare size={16}/> Text message</span><span className="mt-1 block text-[11px] text-muted-foreground">{challenge.maskedPhone}</span></button>}
            <button type="button" data-testid="button-otp-email" onClick={()=>send('email')} disabled={sendOtp.isPending} className={`rounded-xl border p-3 text-left transition disabled:opacity-60 ${sent?.channel==='email'?'border-[#46b5a0] bg-[#eef9f6]':'border-[#dce8e8] hover:border-[#86c9c5]'}`}><span className="flex items-center gap-2 text-sm font-semibold text-[#285363]"><Mail size={16}/> Gmail / email</span><span className="mt-1 block truncate text-[11px] text-muted-foreground">{challenge.maskedEmail}</span></button>
          </div>
          {sendOtp.isPending && <p className="text-xs text-[#5d8f86]" role="status">Sending your code…</p>}
          {sent && <div data-testid="status-otp-sent" role="status" className={`rounded-xl border p-3 text-xs leading-5 ${sent.delivered?'border-[#cfe7df] bg-[#eef8f4] text-[#37796b]':'border-[#f0dfb8] bg-[#fdf7ea] text-[#8a6a2a]'}`}><div className="flex items-center gap-1.5 font-semibold">{sent.delivered?<Wifi size={14}/>:<WifiOff size={14}/>}{sent.delivered?'Online':sent.offlineCode?'Demo account':'Offline mode'}</div><div className="mt-1">{sent.message}</div>{sent.offlineCode&&<div className="mt-2 text-center font-mono text-2xl font-bold tracking-[.4em] text-[#5f4a1c]" data-testid="text-offline-code">{sent.offlineCode}</div>}</div>}
          {sent && <form onSubmit={verify} className="space-y-4"><label className="block"><span className="mb-2 block text-sm font-semibold">6-digit code</span><input data-testid="input-otp" inputMode="numeric" autoComplete="one-time-code" autoFocus required pattern="\d{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} className={`${inputClass} text-center font-mono text-xl tracking-[.5em]`} placeholder="••••••"/></label>
            <button data-testid="button-verify-otp" disabled={verifyOtp.isPending||code.length!==6} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#17647a] font-semibold text-white shadow-sm transition hover:bg-[#125366] disabled:opacity-60">{verifyOtp.isPending ? 'Verifying…' : 'Verify and sign in'} <ArrowRight size={17}/></button>
            <p className="text-center text-[11px] text-muted-foreground">Code expires in {Math.round(sent.expiresInSeconds/60)} minutes. Didn’t get it? Choose an option above to resend.</p></form>}
          {error && <div data-testid="status-login-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          <button type="button" data-testid="button-otp-back" onClick={restart} className="flex items-center gap-1.5 text-xs font-semibold text-[#47737b] hover:text-primary"><ArrowLeft size={14}/> Use a different account</button>
        </div>}
        {isNativeApp&&<p className="mt-5 text-center text-[11px] text-muted-foreground" data-testid="text-server">Server: {new URL(getServerUrl()!).host} · <button type="button" data-testid="button-change-server" onClick={()=>{restart();setEditServer(true)}} className="font-semibold text-primary underline-offset-2 hover:underline">Change</button></p>}
        </>}
      </div>
    </section>
  </div>;
}

/** Android app only: which CareTrack server to use. Checked before it is saved; HTTPS only. */
function ServerSetup({inputClass,cardClass,onDone,onCancel}:{inputClass:string;cardClass:string;onDone:()=>void;onCancel?:()=>void}){
  const [value,setValue]=useState(getServerUrl()||builtInServerUrl()||''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const submit=async(e:FormEvent)=>{
    e.preventDefault();setError('');
    const url=normalizeServerUrl(value);
    if(!url){setError('Enter the secure (https://) address of your CareTrack server, for example caretrack.example.com.');return}
    setBusy(true);const problem=await testServer(url);setBusy(false);
    if(problem){setError(problem);return}
    // Restart the app on the new server so cached data and the offline worker match it.
    await saveServerUrl(url);client.clear();onDone();window.location.replace('/login');
  };
  return <form onSubmit={submit} className={cardClass} data-testid="panel-server-setup">
    <div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#e4f4f0] text-[#25867c]"><Wifi size={21}/></div><div><h3 className="font-bold text-[#173d4a]">Connect to your CareTrack server</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Enter the web address your care team uses for CareTrack. You only need to do this once.</p></div></div>
    <label className="block"><span className="mb-2 block text-sm font-semibold">Server address</span><input data-testid="input-server-url" type="text" inputMode="url" enterKeyHint="go" autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={value} onChange={e=>setValue(e.target.value)} className={inputClass} placeholder="caretrack.example.com"/></label>
    {error&&<div role="alert" data-testid="status-server-error" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    <button data-testid="button-save-server" disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#17647a] font-semibold text-white shadow-sm transition hover:bg-[#125366] disabled:opacity-60">{busy?'Checking connection…':'Connect'} <ArrowRight size={17}/></button>
    {onCancel&&<button type="button" onClick={onCancel} className="w-full text-center text-xs font-semibold text-[#47737b]">Cancel</button>}
    <p className="flex items-center justify-center gap-1.5 text-center text-xs leading-5 text-muted-foreground"><ShieldCheck size={13}/> Only secure (HTTPS) connections are allowed</p>
  </form>;
}

function Brand({light=false}:{light?:boolean}) {
  return <div className="flex items-center gap-2.5" data-testid="brand-caretrack"><div className={`grid h-9 w-9 place-items-center rounded-xl ${light?'bg-[#67d2bd]/15 text-[#75dfc8]':'bg-[#dff4f0] text-[#177b7c]'}`}><HeartPulse size={21} strokeWidth={2.2}/></div><span className={`font-[Manrope] text-[19px] font-extrabold tracking-[-.04em] ${light?'text-white':'text-[#184451]'}`}>caretrack<span className="text-[#44aa9f]">.</span></span></div>;
}

function AuthenticatedApp() {
  const [currentPath, setLocation] = useLocation();
  // Android app with no server chosen yet: skip the session check and go to the connect screen.
  const noServer = isNativeApp && !getServerUrl();
  const me = useGetCurrentUser({ query: { enabled: !noServer, queryKey: getGetCurrentUserQueryKey() } });
  // Only a real user object counts as signed in (never an HTML page or other unexpected reply).
  const user = me.data && typeof me.data === 'object' && 'id' in me.data ? me.data as AuthUser : undefined;
  // Protected APIs answer 403 until the password is changed and the privacy notice accepted.
  const ready = Boolean(user && !user.mustChangePassword && user.privacyConsentAccepted);
  const threads = useListMessageThreads({ query: { enabled: ready, queryKey: getListMessageThreadsQueryKey(), refetchInterval: 10_000 } });
  const unreadPatientMessages = (threads.data || []).reduce((n, t) => n + t.unreadCount, 0);
  // Admin–doctor messages have their own unread count and menu badge.
  const staffRole = user?.role === 'admin' || user?.role === 'provider';
  const staffThreads = useListStaffThreads({ query: { enabled: ready && staffRole, queryKey: getListStaffThreadsQueryKey(), refetchInterval: 15_000 } });
  const unreadStaff = (staffThreads.data || []).reduce((n, t) => n + t.unreadCount, 0);
  const unreadFor = (href: string) => (href === '/messages' ? unreadPatientMessages : href === '/team-messages' ? unreadStaff : 0);
  useRealtimeEvents(ready);
  useWarmOfflineData(ready ? user : undefined);
  const logout = useLogout();
  // Changes still waiting to upload stay on this device for this user and upload at their next sign-in.
  const signOut = () => {
    const waiting = unsyncedCount();
    if (waiting && !window.confirm(`${waiting} change${waiting === 1 ? ' is' : 's are'} saved on this device but not uploaded yet. They stay on this device and upload the next time you sign in. Sign out now?`)) return;
    const done = () => { client.clear(); clearOfflineData(); setLocation('/login'); };
    const performLogout = () => logout.mutate(undefined, { onSuccess: done, onError: (err) => {
      if (!(err instanceof OfflineError) || isNativeApp) { done(); return; }
      // The browser's sign-in cookie can only be ended by the server.
      window.alert('You’re offline. Signing out of the website needs an internet connection. Please try again when you’re connected.');
    } });
    if (isNativeApp) {
      void unregisterNativePushToken().catch((error: unknown) => console.error('Could not remove push registration before sign-out', error)).finally(performLogout);
    } else {
      performLogout();
    }
  };
  const [mobileNav,setMobileNav]=useState(false),[helpOpen,setHelpOpen]=useState(false);
  const doseAlerts=useDoseDueAlerts(user??({id:0,role:'admin'} as AuthUser),ready);
  // Android back button closes the menu first (see native.ts).
  useEffect(()=>{const close=()=>setMobileNav(false);window.addEventListener('caretrack-close-nav',close);return()=>window.removeEventListener('caretrack-close-nav',close)},[]);
  // Refresh server-backed queries when the Android app returns from the background.
  useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible')void client.invalidateQueries()};document.addEventListener('visibilitychange',refresh);window.addEventListener('focus',refresh);window.addEventListener('caretrack-app-resumed',refresh);window.addEventListener('caretrack-push-received',refresh);return()=>{document.removeEventListener('visibilitychange',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('caretrack-app-resumed',refresh);window.removeEventListener('caretrack-push-received',refresh)}},[]);
  useEffect(()=>{
    if(!isNativeApp||!ready)return;
    const register=()=>{void registerNativePushToken()};
    register();
    window.addEventListener('caretrack-app-resumed',register);
    window.addEventListener('online',register);
    return()=>{window.removeEventListener('caretrack-app-resumed',register);window.removeEventListener('online',register)};
  },[ready,user?.id]);
  if (noServer) return <LoginRedirect/>;
  if (me.isLoading) return <LoadingScreen/>;
  if (me.isError || !user) return <LoginRedirect/>;
  if (user.mustChangePassword) return <FirstLoginPasswordScreen user={user} onSignOut={()=>signOut()}/>;
  if (!user.privacyConsentAccepted) return <PrivacyConsentScreen user={user} onSignOut={()=>signOut()}/>;
  const pathTitle = currentPath;
  const home = homeFor(user.role);
  if (pathTitle === '/' || (pathTitle === '/dashboard' && home !== '/dashboard')) return <Redirect to={home}/>;
  return <div className="min-h-[100dvh] bg-[#f2f7f7] text-[#203c46]">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col bg-[#174353] px-4 py-6 text-white lg:flex">
      <div className="px-3"><Brand light/></div>
      <div className="mx-3 mt-8 rounded-2xl border border-white/10 bg-white/[.06] p-3"><div className="flex items-center gap-3"><Avatar name={user.name}/><div className="min-w-0"><div className="truncate text-sm font-semibold" data-testid="text-user-name">{user.name}</div><div className="mt-0.5 text-xs capitalize text-white/55" data-testid="text-user-role">{roleName(user.role)} workspace</div></div></div></div>
      <div className="mb-3 mt-8 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-white/40">Workspace</div>
      <nav aria-label="Main" className="sidebar-scroll -mx-2 min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {navItems.filter(n=>n.roles.includes(user.role)).map(({href,label:navLabel,icon:Icon})=>{const label=href==='/messages'&&user.role==='patient'?'Message my doctor':navLabel;return <Link key={href} href={href} data-testid={`link-nav-${href.slice(1).replace('/','-')}`} aria-current={pathTitle===href||pathTitle.startsWith(`${href}/`)?'page':undefined} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium transition ${pathTitle===href||pathTitle.startsWith(`${href}/`)?'bg-[#236275] text-white shadow-inner':'text-white/65 hover:bg-white/[.06] hover:text-white'}`}><Icon size={18} strokeWidth={1.8}/>{label}{href==='/today'&&<span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#74d9c5]"/>}{unreadFor(href)>0&&<span data-testid={href==='/messages'?'status-unread-messages':'status-unread-team-messages'} className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-[#74d9c5] px-1.5 text-[10px] font-bold text-[#123f4d]">{unreadFor(href)}</span>}</Link>})}
      </nav>
      <div className="mt-3 shrink-0 rounded-2xl border border-white/10 bg-[#103747] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#86ded0]"><ShieldCheck size={15}/> Private demo space</div><p className="mt-2 text-[11px] leading-5 text-white/50">Only your assigned care team can see this information.</p></div>
      <button data-testid="button-logout" onClick={()=>signOut()} className="mt-4 flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/65 hover:bg-white/[.06] hover:text-white"><LogOut size={17}/> Sign out</button>
    </aside>
    {mobileNav&&<div data-mobile-nav-open className="fixed inset-0 z-50 bg-[#102e39]/45 lg:hidden" onClick={()=>setMobileNav(false)}><div className="sidebar-scroll flex h-full w-[280px] flex-col overflow-y-auto bg-[#174353] p-5 text-white" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between"><Brand light/><button data-testid="button-close-navigation" aria-label="Close menu" onClick={()=>setMobileNav(false)} className="rounded-lg p-2"><X size={18}/></button></div><nav className="mt-8 space-y-1">{navItems.filter(n=>n.roles.includes(user.role)).map(({href,label,icon:Icon})=><Link key={href} href={href} onClick={()=>setMobileNav(false)} data-testid={`mobile-link-${href.slice(1).replace('/','-')}`} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/75 hover:bg-white/10"><Icon size={18}/>{label}{unreadFor(href)>0&&<span className="ml-auto rounded-full bg-[#74d9c5] px-1.5 text-[10px] font-bold text-[#123f4d]">{unreadFor(href)}</span>}</Link>)}</nav><button data-testid="button-logout-mobile" onClick={()=>signOut()} className="mt-8 flex items-center gap-3 px-3 py-3 text-sm text-white/70"><LogOut size={17}/>Sign out</button></div></div>}
    <div className="lg:pl-[252px]">
      <header className="app-header sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-[#dfebeb] bg-[#f7fbfb]/95 px-4 backdrop-blur sm:px-8">
        <button data-testid="button-open-navigation" aria-label="Open menu" onClick={()=>setMobileNav(true)} className="rounded-lg p-2 text-[#42616c] lg:hidden"><Menu size={21}/></button>
        <div className="hidden text-sm text-[#67818a] sm:block">Care, made clearer <span className="mx-2 text-[#a5b7bb]">/</span><span className="font-semibold text-[#254a57]">{navItems.find(x=>x.href===pathTitle)?.label||'Patient details'}</span></div>
        {/* Today's date and the connection status are information only (no border or hover, so
            they don't look like buttons). The bell, help and profile picture are buttons. */}
        <div className="ml-auto flex items-center gap-2 sm:gap-3"><div data-testid="text-today-date" className="hidden cursor-default select-none items-center gap-1.5 px-1 text-xs font-medium text-[#67818a] md:flex"><CalendarDays size={14} aria-hidden="true"/>{new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</div><SyncChip/><button data-testid="button-refresh-data" aria-label="Refresh CareTrack data" title="Refresh data" onClick={()=>void client.invalidateQueries()} className="grid h-9 w-9 place-items-center rounded-full border border-[#dce8e9] bg-white text-[#587680] transition hover:bg-[#f0f7f7]"><RefreshCw size={15}/></button><NotificationBell user={user} readOnly={user.role==='caregiver'}/><button data-testid="button-help" aria-label="Help" title="Help" onClick={()=>setHelpOpen(true)} className="grid h-9 w-9 place-items-center rounded-full border border-[#dce8e9] bg-white text-[#587680] transition hover:bg-[#f0f7f7]"><CircleHelp size={17}/></button><Link href="/account" data-testid="link-profile" aria-label={`My account (${user.name})`} title="My account" className="rounded-full ring-offset-2 transition hover:ring-2 hover:ring-[#9fcfc9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#17647a]"><Avatar name={user.name} small/></Link></div>
      </header>
      <SyncBanner/>
      <WellnessNotifications user={user}/>
      <DueDoseAlert due={doseAlerts.due} onDismiss={doseAlerts.dismiss} role={user.role}/>
      {helpOpen&&<HelpDialog user={user} onClose={()=>setHelpOpen(false)}/>}
      <main className={`mx-auto max-w-[1450px] px-4 py-6 sm:px-8 sm:py-8 ${user.role==='patient'||user.role==='caregiver'?'pb-24 sm:pb-24':''}`}>
        <Switch>
          <Route path="/dashboard"><RoleGate user={user} allowed={['admin','provider','caregiver']}><Dashboard user={user}/></RoleGate></Route>
          <Route path="/today"><TodayPage user={user}/></Route>
          <Route path="/patients"><RoleGate user={user} allowed={['admin','provider','caregiver']}><PatientsPage user={user}/></RoleGate></Route>
          <Route path="/patients/:id"><RoleGate user={user} allowed={['admin','provider','caregiver']}><PatientDetailPage user={user}/></RoleGate></Route>
          <Route path="/medications"><RoleGate user={user} allowed={['admin','provider','caregiver']}><MedicationsPage user={user}/></RoleGate></Route>
          <Route path="/coverage"><RoleGate user={user} allowed={['admin','provider']}><CoveragePage user={user}/></RoleGate></Route>
          <Route path="/account"><AccountPage user={user}/></Route>
          <Route path="/ai"><RoleGate user={user} allowed={['admin','provider']}><AiInsightsPage/></RoleGate></Route>
          <Route path="/prescriptions"><RoleGate user={user} allowed={['patient','caregiver']}><PrescriptionsPage user={user}/></RoleGate></Route>
          <Route path="/health"><RoleGate user={user} allowed={['patient','caregiver']}><MyHealthPage user={user}/></RoleGate></Route>
          <Route path="/appointments"><AppointmentsPage user={user}/></Route>
          <Route path="/messages"><MessagesPage user={user}/></Route>
          <Route path="/team-messages"><RoleGate user={user} allowed={['admin','provider']}><TeamMessagesPage user={user}/></RoleGate></Route>
          <Route path="/analytics"><RoleGate user={user} allowed={['admin','provider']}><AnalyticsPage/></RoleGate></Route>
          <Route path="/reports"><RoleGate user={user} allowed={['admin','provider','caregiver']}><ReportsPage user={user}/></RoleGate></Route>
          <Route path="/admin/users"><RoleGate user={user} allowed={['admin']}><UsersPage user={user}/></RoleGate></Route>
          <Route path="/admin/audit"><RoleGate user={user} allowed={['admin']}><AuditPage/></RoleGate></Route>
          <Route component={NotFound}/>
        </Switch>
      </main>
      <footer className="px-4 pb-8 text-center text-[11px] leading-5 text-[#90a5aa] sm:px-8"><span className="block">CareTrack is a capstone demonstration. All people and care schedules are fictional.</span><span className="block">AI suggestions support, not replace, clinical judgment.</span></footer>
      {['patient','caretaker','caregiver'].includes(user.role)&&<ChatWidget role={user.role}/>}
    </div>
  </div>;
}

/** SSE is the primary live update channel; existing React Query polling remains a fallback. */
function useRealtimeEvents(enabled: boolean) {
  const qc = useQueryClient();
  const refreshFrom = (raw: string) => {
    let data: {patientId?:number} = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { /* non-message SSE keepalive */ }
    qc.invalidateQueries({ queryKey: getListMessageThreadsQueryKey() });
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    qc.invalidateQueries({ queryKey: ['coverage-transfers'] });
    // Admin–doctor messages and the Messages calendar refresh on the same events.
    qc.invalidateQueries({ queryKey: getListStaffThreadsQueryKey() });
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/api/staff-messages/') || String(q.queryKey[0]).startsWith('/api/messages/calendar') });
    if (data.patientId) {
      qc.invalidateQueries({ queryKey: getListPatientMessagesQueryKey(data.patientId) });
      qc.invalidateQueries({ queryKey: getListPatientsQueryKey() });
    }
  };
  // Android app: EventSource can't send the session token, so the stream is read with fetch.
  // It reconnects after a drop or when the connection returns; polling still covers the gaps.
  useEffect(() => {
    if (!enabled || !isNativeApp) return;
    const controller = new AbortController();
    let retry = 0;
    const connect = async () => {
      while (!controller.signal.aborted) {
        try { await streamServerEvents((type, data) => { if (type === 'message' || type === 'notification') { retry = 0; refreshFrom(data); } }, controller.signal); } catch { /* offline or server restart */ }
        if (controller.signal.aborted) return;
        retry = Math.min(retry + 1, 6);
        await new Promise((resolve) => setTimeout(resolve, 2 ** retry * 1000));
      }
    };
    void connect();
    return () => controller.abort();
  }, [enabled]);
  useEffect(() => {
    if (!enabled || isNativeApp || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events');
    const refresh = (event: Event) => refreshFrom((event as MessageEvent<string>).data);
    source.addEventListener('message', refresh);
    source.addEventListener('notification', refresh);
    source.onerror = () => { source.close(); };
    return () => source.close();
  }, [enabled, qc]);
}

// Navigates after render (calling setLocation during render triggers a React warning).
function LoginRedirect(){return <Redirect to="/login"/>}
function RoleGate({user,allowed,children}:{user:AuthUser;allowed:string[];children:ReactNode}){return allowed.includes(user.role)?<>{children}</>:<AccessDenied/>}
function LoadingScreen(){return <div className="grid min-h-[100dvh] place-items-center bg-[#f2f7f7]"><div className="w-full max-w-md space-y-4 p-8" data-testid="status-loading"><div className="h-12 w-40 animate-pulse rounded-xl bg-[#dce9e9]"/><div className="h-32 animate-pulse rounded-2xl bg-white"/><div className="h-24 animate-pulse rounded-2xl bg-white"/></div></div>}
function Avatar({name,small=false}:{name:string;small?:boolean}){return <div data-testid="img-avatar" className={`grid shrink-0 place-items-center rounded-full bg-[#d9efeb] font-bold text-[#23716f] ${small?'h-9 w-9 text-xs':'h-10 w-10 text-sm'}`}>{initials(name)}</div>}

function PageHeading({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:ReactNode}){return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 text-[11px] font-bold uppercase tracking-[.17em] text-[#3d9290]">{eyebrow}</div><h1 className="text-[28px] font-extrabold leading-tight tracking-[-.045em] text-[#1c424f] sm:text-[34px]" data-testid="heading-page">{title}</h1><p className="mt-2 max-w-xl text-sm leading-6 text-[#708990]" data-testid="text-page-description">{description}</p></div>{action}</div>}
function Card({children,className='',testId}:{children:ReactNode;className?:string;testId?:string}){return <section data-testid={testId} className={`care-shadow rounded-2xl border border-[#e0ebeb] bg-white ${className}`}>{children}</section>}
function EmptyState({title,body,icon:Icon=ClipboardList}:{title:string;body:string;icon?:typeof ClipboardList}){return <div className="grid place-items-center px-5 py-12 text-center" data-testid="state-empty"><div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#e8f5f2] text-[#358f88]"><Icon size={22}/></div><p className="font-semibold text-[#31535e]">{title}</p><p className="mt-1 max-w-sm text-sm leading-6 text-[#83989e]">{body}</p></div>}
function ErrorState({retry}:{retry:()=>void}){return <div className="m-5 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4" data-testid="status-error"><div><div className="text-sm font-semibold text-red-900">We couldn’t load this information</div><div className="mt-1 text-xs text-red-700">Check your connection and try again.</div></div><button data-testid="button-retry" onClick={retry} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800">Try again</button></div>}
function StatusPill({status}:{status:string}){const styles:Record<string,string>={taken:'bg-[#e5f5ee] text-[#28745a]',scheduled:'bg-[#e9f2f6] text-[#366a7d]',missed:'bg-[#fff0eb] text-[#ad5b45]',skipped:'bg-[#f1f1f0] text-[#687a7c]',active:'bg-[#e5f5ee] text-[#28745a]',inactive:'bg-[#f2f3f3] text-[#778589]'};return <span data-testid={`status-pill-${status}`} className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${styles[status]||styles.scheduled}`}>{status}</span>}

function NotificationBell({user,readOnly}:{user:AuthUser;readOnly:boolean}){
  const query=useListNotifications({query:{queryKey:getListNotificationsQueryKey(),refetchInterval:30_000}}),mark=useMarkNotificationRead(),qc=useQueryClient(),[open,setOpen]=useState(false);
  const notifications=query.data||[],unread=notifications.filter(n=>!n.read).length;
  useNotificationAlerts(notifications,user);
  const [,go]=useLocation();
  const [shown,setShown]=useState(10),[settings,setSettings]=useState(false);
  // Close with Escape, and when the Android back button closes the menu.
  useEffect(()=>{if(!open)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};const close=()=>setOpen(false);window.addEventListener('keydown',key);window.addEventListener('caretrack-close-nav',close);return()=>{window.removeEventListener('keydown',key);window.removeEventListener('caretrack-close-nav',close)}},[open]);
  const refresh=()=>qc.invalidateQueries({queryKey:getListNotificationsQueryKey()});
  const read=(item:Notification)=>{if(item.kind==='reminder'||item.kind==='overdue'){setOpen(false);go('/today')}else if(item.kind==='coverage'){setOpen(false);go('/coverage')}else if((item.kind==='ai-risk'||item.kind==='risk'||item.kind==='lab')&&item.patientId&&user.role!=='patient'&&user.role!=='caregiver'){setOpen(false);go(`/patients/${item.patientId}`)}else if(item.kind==='lab'){setOpen(false);go('/today')}else if(item.kind==='appointment'){setOpen(false);go('/appointments')}else if(item.kind==='prescription'){setOpen(false);go('/prescriptions')}else if(item.kind==='message'){setOpen(false);go(item.patientId?`/messages?patient=${item.patientId}`:'/messages')}else if(item.kind==='staff-message'){setOpen(false);go('/team-messages')}if(item.read||readOnly)return;mark.mutate({id:item.id},{onSuccess:refresh})};
  const markAll=()=>{const ids=notifications.filter(n=>!n.read).map(n=>n.id);void Promise.all(ids.map(id=>mark.mutateAsync({id}).catch(()=>null))).then(refresh)};
  const KIND:Record<string,{label:string;icon:typeof Bell;tone:string}>={
    reminder:{label:'Dose due',icon:Pill,tone:'bg-[#fbf1df] text-[#99702f]'},
    overdue:{label:'Missed dose',icon:Clock3,tone:'bg-[#fff0eb] text-[#ad5b45]'},
    message:{label:'Message',icon:MessageSquare,tone:'bg-[#e9f2f6] text-[#366a7d]'},
    'staff-message':{label:'Team message',icon:MessagesSquare,tone:'bg-[#eef0fa] text-[#4a5a9a]'},
    appointment:{label:'Check-up',icon:CalendarDays,tone:'bg-[#e9f2f6] text-[#366a7d]'},
    prescription:{label:'Prescription',icon:FileText,tone:'bg-[#e5f5ee] text-[#28745a]'},
    lab:{label:'Lab result',icon:FileText,tone:'bg-[#e5f5ee] text-[#28745a]'},
    'ai-risk':{label:'Risk alert',icon:Activity,tone:'bg-[#fff0eb] text-[#ad5b45]'},
    risk:{label:'Adherence alert',icon:Activity,tone:'bg-[#fff0eb] text-[#ad5b45]'},
    coverage:{label:'Patient transfer',icon:ArrowLeftRight,tone:'bg-[#e9f2f6] text-[#366a7d]'},
  };
  const when=(value:string)=>{const d=new Date(value);return d.toLocaleDateString('en-CA')===dateToday()?`Today, ${timeLabel(value)}`:dateTimeLabel(value)};
  return <div className="relative">
    <button data-testid="button-open-notifications" aria-label={`Notifications${unread?`, ${unread} unread`:''}`} aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(!open)} className="relative grid h-9 w-9 place-items-center rounded-full border border-[#dce8e9] bg-white text-[#587680] transition hover:bg-[#f0f7f7]"><Bell size={16}/>{unread>0&&<span data-testid="status-unread-notifications" className="absolute -right-1 -top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-[#d9755e] px-1 text-[9px] font-bold text-white">{unread>9?'9+':unread}</span>}</button>
    {/* Rendered on <body>: the header's blur effect would otherwise trap the panel inside it. */}
    {open&&createPortal(<>
      {/* Tap outside to close. On phones it also dims the page so the panel reads clearly. */}
      <div data-testid="backdrop-notifications" aria-hidden="true" onClick={()=>setOpen(false)} className="fixed inset-0 z-50 bg-[#102e39]/25 sm:bg-transparent"/>
      {/* Phones: a full-width sheet under the header (it used to hang off the left edge).
          Larger screens: a dropdown under the bell. Its height always fits the screen, so in
          landscape the list scrolls inside the panel and the page stays usable. */}
      <div data-testid="panel-notifications" role="dialog" aria-label="Notifications" className="notif-panel fixed inset-x-3 top-[76px] z-[55] flex max-h-[calc(100dvh-92px)] flex-col overflow-hidden rounded-2xl border border-[#dce8e8] bg-white shadow-[0_18px_45px_rgba(22,62,76,.18)] sm:inset-x-auto sm:right-6 sm:top-[62px] sm:w-[390px] sm:max-h-[min(560px,calc(100dvh-80px))] lg:right-8">
        <div className="notif-head flex shrink-0 items-center justify-between gap-2 border-b border-[#edf2f2] px-4 py-3"><div className="min-w-0"><div className="text-sm font-bold text-[#254954]">Notifications</div><div className="text-[11px] text-[#81969b]">{unread?`${unread} unread`:'You’re all caught up'}</div></div><div className="flex items-center gap-1">{unread>0&&!readOnly&&<button data-testid="button-mark-all-read" onClick={markAll} disabled={mark.isPending} className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-[#287d80] hover:bg-[#eef8f6] disabled:opacity-50">Mark all read</button>}<button data-testid="button-notification-settings" aria-expanded={settings} onClick={()=>setSettings(!settings)} className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold hover:bg-[#f2f7f7] ${settings?'bg-[#eef8f6] text-[#287d80]':'text-[#5d7f86]'}`}>Sound &amp; alerts</button><button data-testid="button-close-notifications" aria-label="Close notifications" onClick={()=>setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-[#789096] hover:bg-[#f2f7f7]"><X size={17}/></button></div></div>
        {settings&&<div className="shrink-0"><SoundSettings user={user}/></div>}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{query.isLoading?<div data-testid="status-notifications-loading" className="space-y-2 p-4"><div className="h-12 animate-pulse rounded-xl bg-[#eff5f5]"/><div className="h-12 animate-pulse rounded-xl bg-[#eff5f5]"/></div>:query.isError?<div data-testid="status-notifications-error" className="p-4 text-xs text-[#a55348]">Notifications couldn’t be loaded. <button data-testid="button-retry-notifications" onClick={()=>query.refetch()} className="font-semibold underline">Try again</button></div>:notifications.length===0?<div data-testid="state-notifications-empty" className="p-6 text-center"><div className="text-sm font-semibold text-[#45636c]">Nothing new</div><div className="mt-1 text-xs text-[#8aa0a4]">{user.role==='patient'?'Dose reminders and updates from your care team will appear here.':'Updates from your care team will appear here.'}</div></div>:<div className="divide-y divide-[#edf2f2]">{notifications.slice(0,shown).map(n=>{const k=KIND[n.kind]||{label:'Update',icon:Bell,tone:'bg-[#eef5f5] text-[#54747a]'};const Icon=k.icon;return <button key={n.id} data-testid={`notification-item-${n.id}`} onClick={()=>read(n)} className={`notif-item block w-full px-4 py-3 text-left transition hover:bg-[#f6faf9] ${n.read?'':'bg-[#f1f8f6]'}`}><div className="flex items-start gap-3"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${k.tone}`}><Icon size={15}/></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className={`text-[10px] font-bold uppercase tracking-wider ${k.tone.split(' ')[1]}`}>{k.label}</span>{!n.read&&<span className="h-1.5 w-1.5 rounded-full bg-[#42ad99]" aria-label="Unread"/>}<span className="ml-auto text-[10px] text-[#8fa2a6]">{when(n.createdAt)}</span></span><span className="mt-0.5 block break-words text-[13px] font-bold leading-5 text-[#355661]" data-testid={`text-notification-title-${n.id}`}>{n.title}</span><span className="mt-0.5 block whitespace-pre-line break-words text-xs leading-5 text-[#5f7a80]" data-testid={`text-notification-message-${n.id}`}>{n.message}</span></span></div></button>})}
          {notifications.length>shown&&<button data-testid="button-more-notifications" onClick={()=>setShown(shown+15)} className="block w-full px-4 py-3 text-center text-xs font-semibold text-[#287d80] hover:bg-[#f6faf9]">Show older notifications ({notifications.length-shown})</button>}</div>}</div>
      </div>
    </>,document.body)}
  </div>;
}


/**
 * Administrator Dashboard: Comprehensive command center with full CRUD for Doctors and Patients,
 * account provisioning, and system-wide adherence monitoring.
 */
function AdminDashboard({ user }: { user: AuthUser }) {
  const usersQuery = useListUsers({ query: { enabled: user.role === 'admin', queryKey: getListUsersQueryKey() } });
  const patientsQuery = useListPatients();
  const dosesQuery = useListDoses({ date: dateToday() });
  const medsQuery = useListMedications();
  const deleteUserMutation = useDeleteUser();
  const updateUserMutation = useUpdateUser();
  const deletePatientMutation = useDeletePatient();
  const updatePatientMutation = useUpdatePatient();
  const createDemo = useCreateDemoDose();
  const simulate = useSimulateOverdueDoses();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<'doctors' | 'patients' | 'overview'>('doctors');
  const [demoFeedback, setDemoFeedback] = useState('');

  // Modals state
  const [doctorModalOpen, setDoctorModalOpen] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState<User | null>(null);
  const [patientModalOpen, setPatientModalOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountTargetPatient, setAccountTargetPatient] = useState<Patient | null>(null);

  // Search & filter state
  const [doctorSearch, setDoctorSearch] = useState('');
  const [doctorFilter, setDoctorFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [patientSearch, setPatientSearch] = useState('');
  const [patientFilter, setPatientFilter] = useState<'all' | 'active' | 'inactive' | 'no-account' | 'has-account'>('all');

  const allUsers = usersQuery.data || [];
  const doctors = allUsers.filter((u) => u.role === 'provider');
  const patients = patientsQuery.data || [];
  const doses = dosesQuery.data || [];
  const meds = medsQuery.data || [];

  const activeDoctors = doctors.filter((d) => d.active);
  const activePatients = patients.filter((p) => p.active);
  const patientsWithAccount = patients.filter((p) => p.userId);
  const patientsWithoutAccount = patients.filter((p) => !p.userId);

  const completedDoses = doses.filter((d) => d.status === 'taken').length;
  const totalDoses = doses.length;
  const adherencePercent = totalDoses ? Math.round((completedDoses / totalDoses) * 100) : 0;

  // Filtered doctors
  const filteredDoctors = doctors.filter((doc) => {
    const matchesSearch = `${doc.name} ${doc.email} ${doc.phone || ''}`.toLowerCase().includes(doctorSearch.toLowerCase());
    const matchesFilter =
      doctorFilter === 'all' ? true : doctorFilter === 'active' ? doc.active : !doc.active;
    return matchesSearch && matchesFilter;
  });

  // Filtered patients
  const filteredPatients = patients.filter((pat) => {
    const matchesSearch = `${pat.name} ${pat.email || ''} ${pat.phone || ''} ${pat.conditions?.join(' ') || ''} ${pat.assignedProviderName || ''}`
      .toLowerCase()
      .includes(patientSearch.toLowerCase());
    const matchesFilter =
      patientFilter === 'all'
        ? true
        : patientFilter === 'active'
        ? pat.active
        : patientFilter === 'inactive'
        ? !pat.active
        : patientFilter === 'no-account'
        ? !pat.userId
        : !!pat.userId;
    return matchesSearch && matchesFilter;
  });

  const getDoctorAssignedCount = (docId: number) =>
    patients.filter((p) => p.assignedProviderId === docId).length;

  const handleDeleteDoctor = (doc: User) => {
    if (!window.confirm(`Are you sure you want to permanently delete Dr. ${doc.name}? Assigned patients will need to be reassigned.`)) return;
    deleteUserMutation.mutate(
      { id: doc.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          qc.invalidateQueries({ queryKey: getListPatientsQueryKey() });
        },
      }
    );
  };

  const handleToggleDoctorStatus = (doc: User) => {
    updateUserMutation.mutate(
      { id: doc.id, data: { active: !doc.active } },
      {
        onSuccess: () => qc.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      }
    );
  };

  const handleDeletePatient = (pat: Patient) => {
    if (!window.confirm(`Are you sure you want to permanently delete patient ${pat.name}? This will remove all associated medication records.`)) return;
    deletePatientMutation.mutate(
      { id: pat.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPatientsQueryKey() });
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        },
      }
    );
  };

  const handleTogglePatientStatus = (pat: Patient) => {
    updatePatientMutation.mutate(
      { id: pat.id, data: { active: !pat.active } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListPatientsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPatientQueryKey(pat.id) });
        },
      }
    );
  };

  const refreshDemo = () => {
    qc.invalidateQueries({ queryKey: getListDosesQueryKey() });
    qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetAnalyticsQueryKey() });
  };

  const addDemo = () => {
    const p = activePatients.find((x) => x.userId) || activePatients[0];
    const m = (medsQuery.data || []).find((x) => x.patientId === p?.id && x.active);
    if (!p || !m) {
      setDemoFeedback('Add an active medication to a patient first.');
      return;
    }
    createDemo.mutate(
      { data: { patientId: p.id, medicationId: m.id } },
      {
        onSuccess: () => {
          refreshDemo();
          setDemoFeedback(`${m.name} for ${p.name} is now due. A reminder was sent.`);
        },
        onError: () => setDemoFeedback('Could not create a demo dose.'),
      }
    );
  };

  const simulateNow = () =>
    simulate.mutate(undefined, {
      onSuccess: (r) => {
        refreshDemo();
        setDemoFeedback(
          r.missedCount
            ? `Simulated 2 hours passing: ${r.missedCount} overdue dose${r.missedCount === 1 ? ' was' : 's were'} marked missed.`
            : 'No doses are currently due. Add a demo dose first, then simulate time.'
        );
      },
      onError: () => setDemoFeedback('Could not run the simulation.'),
    });

  const loading = usersQuery.isLoading || patientsQuery.isLoading;

  return (
    <div className="page-enter">
      <PageHeading
        eyebrow="Administrator Command Center"
        title={`Admin Dashboard · ${shortName(user.name)}`}
        description="Full CRUD management for doctors and patients, account provisioning, and system adherence overview."
        action={
          <div className="flex flex-wrap gap-2">
            <button
              data-testid="button-admin-add-doctor"
              onClick={() => { setEditingDoctor(null); setDoctorModalOpen(true); }}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#17647a] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#125366]"
            >
              <Stethoscope size={16} /> Add doctor
            </button>
            <button
              data-testid="button-admin-add-patient"
              onClick={() => { setEditingPatient(null); setPatientModalOpen(true); }}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#c8e2df] bg-white px-4 text-sm font-semibold text-[#247b79] hover:bg-[#eef9f6]"
            >
              <Plus size={16} /> Add patient
            </button>
            <button
              data-testid="button-admin-add-patient-account"
              onClick={() => { setAccountTargetPatient(null); setAccountModalOpen(true); }}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#c8e2df] bg-white px-4 text-sm font-semibold text-[#247b79] hover:bg-[#eef9f6]"
            >
              <KeyRound size={16} /> Add patient account
            </button>
          </div>
        }
      />

      {demoFeedback && (
        <div data-testid="status-demo-feedback" role="status" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-[#cfe7df] bg-[#eef8f4] px-4 py-3 text-sm text-[#37796b]">
          <span>{demoFeedback}</span>
          <button aria-label="Dismiss" onClick={() => setDemoFeedback('')} className="text-[#5d8f86]">
            <X size={15} />
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonGrid />
      ) : (
        <>
          {/* KPI Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Doctors on staff"
              value={`${doctors.length}`}
              detail={`${activeDoctors.length} active · ${doctors.length - activeDoctors.length} inactive`}
              icon={Stethoscope}
              accent="teal"
            />
            <Metric
              label="Patient directory"
              value={`${patients.length}`}
              detail={`${activePatients.length} active profiles`}
              icon={Users}
              accent="blue"
            />
            <Metric
              label="Patient logins"
              value={`${patientsWithAccount.length} / ${patients.length}`}
              detail={`${patientsWithoutAccount.length} missing mobile logins`}
              icon={KeyRound}
              accent="gold"
              progress={patients.length ? Math.round((patientsWithAccount.length / patients.length) * 100) : 0}
            />
            <Metric
              label="Today’s adherence"
              value={totalDoses ? `${adherencePercent}%` : '—'}
              detail={`${completedDoses} of ${totalDoses} doses logged`}
              icon={Activity}
              accent="teal"
              progress={adherencePercent}
            />
          </div>

          {/* Tab Navigation */}
          <div className="mt-7 flex flex-wrap items-center gap-2 border-b border-[#eaf0f0] pb-3" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === 'doctors'}
              data-testid="tab-admin-doctors"
              onClick={() => setActiveTab('doctors')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
                activeTab === 'doctors'
                  ? 'bg-[#17647a] text-white shadow-sm'
                  : 'bg-white text-[#52737c] hover:bg-[#f0f6f6]'
              }`}
            >
              <Stethoscope size={16} /> Doctor Management (CRUD)
              <span className={`rounded-full px-2 py-0.5 text-xs ${activeTab === 'doctors' ? 'bg-white/20 text-white' : 'bg-[#eef5f5] text-[#54747a]'}`}>
                {doctors.length}
              </span>
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'patients'}
              data-testid="tab-admin-patients"
              onClick={() => setActiveTab('patients')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
                activeTab === 'patients'
                  ? 'bg-[#17647a] text-white shadow-sm'
                  : 'bg-white text-[#52737c] hover:bg-[#f0f6f6]'
              }`}
            >
              <Users size={16} /> Patient Management (CRUD)
              <span className={`rounded-full px-2 py-0.5 text-xs ${activeTab === 'patients' ? 'bg-white/20 text-white' : 'bg-[#eef5f5] text-[#54747a]'}`}>
                {patients.length}
              </span>
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'overview'}
              data-testid="tab-admin-overview"
              onClick={() => setActiveTab('overview')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
                activeTab === 'overview'
                  ? 'bg-[#17647a] text-white shadow-sm'
                  : 'bg-white text-[#52737c] hover:bg-[#f0f6f6]'
              }`}
            >
              <LayoutDashboard size={16} /> Overview &amp; Doses
            </button>
          </div>

          {/* TAB 1: DOCTORS CRUD */}
          {activeTab === 'doctors' && (
            <Card className="mt-5">
              <div className="flex flex-col gap-4 border-b border-[#eaf0f0] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <h2 className="text-lg font-bold text-[#254954]">Doctors Directory &amp; Access</h2>
                  <p className="mt-1 text-xs text-[#81969b]">Create, update, deactivate, or delete doctors on your medical staff.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex h-10 items-center gap-2 rounded-xl border border-[#dce8e8] bg-[#fbfdfd] px-3 sm:w-64">
                    <Search size={15} className="text-[#81969b]" />
                    <input
                      data-testid="input-search-doctors"
                      value={doctorSearch}
                      onChange={(e) => setDoctorSearch(e.target.value)}
                      placeholder="Search doctors…"
                      className="w-full bg-transparent text-sm outline-none placeholder:text-[#a3b3b6]"
                    />
                  </label>
                  <button
                    data-testid="button-crud-add-doctor"
                    onClick={() => { setEditingDoctor(null); setDoctorModalOpen(true); }}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#17647a] px-3.5 text-xs font-semibold text-white hover:bg-[#125366]"
                  >
                    <Plus size={15} /> Add doctor
                  </button>
                </div>
              </div>

              {/* Filter Pills */}
              <div className="flex flex-wrap gap-2 border-b border-[#edf2f2] px-5 py-3 sm:px-6">
                {(['all', 'active', 'inactive'] as const).map((mode) => (
                  <button
                    key={mode}
                    data-testid={`filter-doctor-${mode}`}
                    onClick={() => setDoctorFilter(mode)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
                      doctorFilter === mode
                        ? 'border-[#17647a] bg-[#17647a] text-white'
                        : 'border-[#dce8e8] bg-white text-[#55737a] hover:bg-[#f6f9f9]'
                    }`}
                  >
                    {mode} ({mode === 'all' ? doctors.length : mode === 'active' ? activeDoctors.length : doctors.length - activeDoctors.length})
                  </button>
                ))}
              </div>

              {/* Doctors List */}
              {filteredDoctors.length === 0 ? (
                <EmptyState
                  title={doctorSearch ? 'No doctors match your search' : 'No doctors registered yet'}
                  body={doctorSearch ? 'Try adjusting your search criteria.' : 'Click "Add doctor" above to onboard your first medical provider.'}
                  icon={Stethoscope}
                />
              ) : (
                <div className="divide-y divide-[#edf2f2]">
                  {filteredDoctors.map((doc) => {
                    const assignedCount = getDoctorAssignedCount(doc.id);
                    return (
                      <div
                        key={doc.id}
                        data-testid={`row-admin-doctor-${doc.id}`}
                        className="flex flex-col gap-3 p-5 transition hover:bg-[#fbfdfd] sm:flex-row sm:items-center sm:justify-between sm:px-6"
                      >
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <Avatar name={doc.name} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-bold text-[#31535e]">{doc.name}</span>
                              <StatusPill status={doc.active ? 'active' : 'inactive'} />
                              {doc.phoneVerified && (
                                <span className="rounded-full bg-[#e5f5ee] px-2 py-0.5 text-[10px] font-semibold text-[#28745a]">
                                  SMS Verified
                                </span>
                              )}
                              {doc.mustChangePassword && (
                                <span className="rounded-full bg-[#fbf1df] px-2 py-0.5 text-[10px] font-semibold text-[#99702f]">
                                  Temp password
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#81969b]">
                              <span>{doc.email}</span>
                              {doc.phone && <span>· {doc.phone}</span>}
                              <span>· Joined {new Date(doc.createdAt).toLocaleDateString()}</span>
                            </div>
                            <div className="mt-2">
                              <span className="inline-flex items-center gap-1 rounded-md bg-[#eef7f9] px-2 py-1 text-xs font-semibold text-[#1c6476]">
                                <Users size={12} /> {assignedCount} assigned {assignedCount === 1 ? 'patient' : 'patients'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                          <button
                            data-testid={`button-edit-doctor-${doc.id}`}
                            onClick={() => { setEditingDoctor(doc); setDoctorModalOpen(true); }}
                            className="rounded-lg border border-[#dce8e8] px-3 py-1.5 text-xs font-semibold text-[#52737c] hover:bg-[#f5f9f9]"
                          >
                            Edit
                          </button>
                          <button
                            data-testid={`button-toggle-doctor-${doc.id}`}
                            disabled={updateUserMutation.isPending}
                            onClick={() => handleToggleDoctorStatus(doc)}
                            className="rounded-lg border border-[#dce8e8] px-3 py-1.5 text-xs font-semibold text-[#52737c] hover:bg-[#f5f9f9]"
                          >
                            {doc.active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            data-testid={`button-delete-doctor-${doc.id}`}
                            disabled={deleteUserMutation.isPending}
                            onClick={() => handleDeleteDoctor(doc)}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* TAB 2: PATIENTS CRUD */}
          {activeTab === 'patients' && (
            <Card className="mt-5">
              <div className="flex flex-col gap-4 border-b border-[#eaf0f0] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <h2 className="text-lg font-bold text-[#254954]">Patients Directory &amp; Accounts</h2>
                  <p className="mt-1 text-xs text-[#81969b]">Create, edit, toggle, or delete patient profiles and provision their mobile logins.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex h-10 items-center gap-2 rounded-xl border border-[#dce8e8] bg-[#fbfdfd] px-3 sm:w-64">
                    <Search size={15} className="text-[#81969b]" />
                    <input
                      data-testid="input-search-admin-patients"
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      placeholder="Search patients or conditions…"
                      className="w-full bg-transparent text-sm outline-none placeholder:text-[#a3b3b6]"
                    />
                  </label>
                  <button
                    data-testid="button-crud-add-patient"
                    onClick={() => { setEditingPatient(null); setPatientModalOpen(true); }}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#17647a] px-3.5 text-xs font-semibold text-white hover:bg-[#125366]"
                  >
                    <Plus size={15} /> Add patient
                  </button>
                  <button
                    data-testid="button-crud-add-patient-account"
                    onClick={() => { setAccountTargetPatient(null); setAccountModalOpen(true); }}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#c8e2df] bg-white px-3.5 text-xs font-semibold text-[#247b79] hover:bg-[#eef9f6]"
                  >
                    <KeyRound size={15} /> Add login
                  </button>
                </div>
              </div>

              {/* Filter Pills */}
              <div className="flex flex-wrap gap-2 border-b border-[#edf2f2] px-5 py-3 sm:px-6">
                {[
                  { id: 'all', label: `All (${patients.length})` },
                  { id: 'active', label: `Active (${activePatients.length})` },
                  { id: 'inactive', label: `Inactive (${patients.length - activePatients.length})` },
                  { id: 'no-account', label: `Needs Login (${patientsWithoutAccount.length})` },
                  { id: 'has-account', label: `Login Active (${patientsWithAccount.length})` },
                ].map((item) => (
                  <button
                    key={item.id}
                    data-testid={`filter-patient-${item.id}`}
                    onClick={() => setPatientFilter(item.id as typeof patientFilter)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      patientFilter === item.id
                        ? 'border-[#17647a] bg-[#17647a] text-white'
                        : 'border-[#dce8e8] bg-white text-[#55737a] hover:bg-[#f6f9f9]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Patients List */}
              {filteredPatients.length === 0 ? (
                <EmptyState
                  title={patientSearch ? 'No patients match your search' : 'No patients found'}
                  body={patientSearch ? 'Try a different search keyword.' : 'Click "Add patient" above to create the first patient profile.'}
                  icon={Users}
                />
              ) : (
                <div className="divide-y divide-[#edf2f2]">
                  {filteredPatients.map((pat) => (
                    <div
                      key={pat.id}
                      data-testid={`row-admin-patient-${pat.id}`}
                      className="flex flex-col gap-3 p-5 transition hover:bg-[#fbfdfd] sm:flex-row sm:items-center sm:justify-between sm:px-6"
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <Avatar name={pat.name} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/patients/${pat.id}`}
                              data-testid={`link-admin-patient-${pat.id}`}
                              className="truncate text-sm font-bold text-[#31535e] hover:text-[#17647a] hover:underline"
                            >
                              {pat.name}
                            </Link>
                            <StatusPill status={pat.active ? 'active' : 'inactive'} />
                            {pat.userId ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#e5f5ee] px-2 py-0.5 text-[11px] font-semibold text-[#28745a]">
                                <KeyRound size={11} /> Login Active ({pat.email})
                              </span>
                            ) : (
                              <button
                                data-testid={`button-create-account-admin-${pat.id}`}
                                onClick={() => { setAccountTargetPatient(pat); setAccountModalOpen(true); }}
                                className="inline-flex items-center gap-1 rounded-full bg-[#fbf1df] px-2.5 py-0.5 text-[11px] font-bold text-[#99702f] hover:bg-[#f4e6ca]"
                              >
                                <KeyRound size={11} /> + Create login
                              </button>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#81969b]">
                            <span>{pat.age} yrs · {pat.sex.replace('_', ' ')}</span>
                            {pat.phone && <span>· {pat.phone}</span>}
                            <span>· Doctor: <b className="text-[#456872]">{pat.assignedProviderName || 'Unassigned'}</b></span>
                          </div>
                          <div className="mt-1.5 text-xs text-[#738d94]">
                            {pat.conditions?.length ? pat.conditions.join(' · ') : 'No conditions listed'}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <Link
                          href={`/patients/${pat.id}`}
                          className="rounded-lg border border-[#dce8e8] px-3 py-1.5 text-xs font-semibold text-[#287d80] hover:bg-[#eef8f6]"
                        >
                          View
                        </Link>
                        <button
                          data-testid={`button-edit-patient-admin-${pat.id}`}
                          onClick={() => { setEditingPatient(pat); setPatientModalOpen(true); }}
                          className="rounded-lg border border-[#dce8e8] px-3 py-1.5 text-xs font-semibold text-[#52737c] hover:bg-[#f5f9f9]"
                        >
                          Edit
                        </button>
                        <button
                          data-testid={`button-toggle-patient-admin-${pat.id}`}
                          disabled={updatePatientMutation.isPending}
                          onClick={() => handleTogglePatientStatus(pat)}
                          className="rounded-lg border border-[#dce8e8] px-3 py-1.5 text-xs font-semibold text-[#52737c] hover:bg-[#f5f9f9]"
                        >
                          {pat.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          data-testid={`button-delete-patient-admin-${pat.id}`}
                          disabled={deletePatientMutation.isPending}
                          onClick={() => handleDeletePatient(pat)}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* TAB 3: OVERVIEW & DOSES */}
          {activeTab === 'overview' && (
            <div className="mt-5 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#cfe7df] bg-[#eef8f4] p-4 text-sm text-[#37796b]">
                <div>
                  <div className="font-bold text-[#23584e]">Adherence Simulation Tools</div>
                  <div className="text-xs text-[#52877c]">Simulate due doses or fast-forward 2 hours to test alerts and notifications.</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    data-testid="button-demo-dose"
                    onClick={addDemo}
                    disabled={createDemo.isPending || activePatients.length === 0}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#c8e2df] bg-white px-3 text-xs font-semibold text-[#247b79] hover:bg-[#f2faf7] disabled:opacity-50"
                  >
                    <Plus size={14} /> Mark a dose due now
                  </button>
                  <button
                    data-testid="button-simulate-time"
                    onClick={simulateNow}
                    disabled={simulate.isPending}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white hover:bg-[#125366] disabled:opacity-50"
                  >
                    <Clock3 size={14} /> Simulate 2 hours
                  </button>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-[1.35fr_.85fr]">
                <Card>
                  <div className="flex items-center justify-between border-b border-[#eaf0f0] px-5 py-4 sm:px-6">
                    <div>
                      <h2 className="font-bold text-[#254954]">Today’s scheduled doses</h2>
                      <p className="mt-1 text-xs text-[#80969c]">All patient doses scheduled across the clinic today</p>
                    </div>
                    <Link href="/today" className="flex items-center gap-1 text-xs font-semibold text-[#287f83] hover:underline">
                      View all <ArrowRight size={14} />
                    </Link>
                  </div>
                  {doses.length === 0 ? (
                    <EmptyState title="No doses today" body="There are no scheduled doses for today across any patients." />
                  ) : (
                    <div className="divide-y divide-[#edf2f2]">
                      {doses.slice(0, 6).map((d) => (
                        <DoseRow
                          key={d.id}
                          dose={d}
                          patientName={patients.find((p) => p.id === d.patientId)?.name}
                          compact
                          readOnly
                          role={user.role}
                        />
                      ))}
                    </div>
                  )}
                </Card>

                <Card>
                  <div className="flex items-center justify-between border-b border-[#eaf0f0] px-5 py-4 sm:px-6">
                    <div>
                      <h2 className="font-bold text-[#254954]">Recent Patients</h2>
                      <p className="mt-1 text-xs text-[#80969c]">Active care profiles</p>
                    </div>
                    <Link href="/patients" className="grid h-8 w-8 place-items-center rounded-lg text-[#60818b] hover:bg-[#f1f7f7]">
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                  {activePatients.length === 0 ? (
                    <EmptyState title="No active patients" body="Create a patient profile to get started." icon={Users} />
                  ) : (
                    <div className="divide-y divide-[#edf2f2]">
                      {activePatients.slice(0, 5).map((p) => (
                        <Link
                          href={`/patients/${p.id}`}
                          key={p.id}
                          className="flex items-center gap-3 px-5 py-4 transition hover:bg-[#f8fbfb] sm:px-6"
                        >
                          <Avatar name={p.name} small />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-[#31535e]">{p.name}</div>
                            <div className="mt-1 truncate text-xs text-[#81969b]">
                              {p.age} yrs · Dr. {p.assignedProviderName || 'Unassigned'}
                            </div>
                          </div>
                          <ArrowRight size={15} className="text-[#9aafb2]" />
                        </Link>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}
        </>
      )}

      {/* MODALS */}
      {doctorModalOpen && (
        <UserModal
          user={editingDoctor}
          defaultRole="provider"
          lockRole={true}
          title={editingDoctor ? 'Edit Doctor' : 'Add Doctor'}
          onClose={() => setDoctorModalOpen(false)}
        />
      )}

      {patientModalOpen && (
        <PatientModal
          patient={editingPatient}
          onClose={() => setPatientModalOpen(false)}
        />
      )}

      {accountModalOpen && (
        <CreatePatientAccountModal
          initialPatient={accountTargetPatient}
          user={user}
          onClose={() => setAccountModalOpen(false)}
        />
      )}
    </div>
  );
}

function Dashboard({user}:{user:AuthUser}){
  if (user.role === 'admin') {
    return <AdminDashboard user={user} />;
  }
  const patients=useListPatients(), doses=useListDoses({date:dateToday()}), meds=useListMedications(), createDemo=useCreateDemoDose(), simulate=useSimulateOverdueDoses();
  const qc=useQueryClient(),[demoFeedback,setDemoFeedback]=useState('');
  const [patientModalOpen, setPatientModalOpen]=useState(false);
  const [accountModalOpen, setAccountModalOpen]=useState(false);
  const [accountTargetPatient, setAccountTargetPatient]=useState<Patient|null>(null);
  const doseList=doses.data||[], patientList=(patients.data||[]).filter(p=>p.active);
  const completed=doseList.filter(d=>d.status==='taken').length, total=doseList.length, percent=total?Math.round(completed/total*100):0;
  const canDemo=user.role==='provider';
  const refreshDemo=()=>{qc.invalidateQueries({queryKey:getListDosesQueryKey()});qc.invalidateQueries({queryKey:getListNotificationsQueryKey()});qc.invalidateQueries({queryKey:getGetAnalyticsQueryKey()})};
  // The linked demo patient (Alex Morgan) makes reminders visible on the patient and caregiver accounts.
  const addDemo=()=>{const p=patientList.find(x=>x.userId)||patientList[0],m=(meds.data||[]).find(x=>x.patientId===p?.id&&x.active);if(!p||!m){setDemoFeedback('Add an active medication to a patient first.');return}createDemo.mutate({data:{patientId:p.id,medicationId:m.id}},{onSuccess:()=>{refreshDemo();setDemoFeedback(`${m.name} for ${p.name} is now due. A reminder was sent to the patient and caregiver.`)},onError:()=>setDemoFeedback('Could not create a demo dose.')})};
  const simulateNow=()=>simulate.mutate(undefined,{onSuccess:r=>{refreshDemo();setDemoFeedback(r.missedCount?`Simulated 2 hours passing: ${r.missedCount} overdue dose${r.missedCount===1?' was':'s were'} marked missed and alerts were sent.`:'No doses are currently due. Add a demo dose first, then simulate time.')},onError:()=>setDemoFeedback('Could not run the simulation.')});
  const loading=patients.isLoading||doses.isLoading;
  return <div className="page-enter">
    <PageHeading eyebrow="Your care at a glance" title={`Good ${new Date().getHours()<12?'morning':new Date().getHours()<18?'afternoon':'evening'}, ${shortName(user.name)}`} description="Here’s how today is taking shape across your care team." action={<div className="flex flex-wrap gap-2">
      {user.role==='provider'&&<button data-testid="button-doctor-add-patient" onClick={()=>setPatientModalOpen(true)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#c8e2df] bg-white px-4 text-sm font-semibold text-[#247b79] transition hover:bg-[#eef9f6]"><Plus size={16}/> Add patient</button>}
      {user.role==='provider'&&<button data-testid="button-doctor-add-account" onClick={()=>{setAccountTargetPatient(null);setAccountModalOpen(true)}} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#17647a] px-4 text-sm font-semibold text-white transition hover:bg-[#125366]"><KeyRound size={16}/> Add patient account</button>}
      {canDemo&&<button data-testid="button-demo-dose" title="Creates a dose that is due right now" onClick={addDemo} disabled={createDemo.isPending||patientList.length===0} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#c8e2df] bg-white px-4 text-sm font-semibold text-[#247b79] transition hover:bg-[#eef9f6] disabled:opacity-50"><Plus size={16}/>{createDemo.isPending?'Adding dose…':'Mark a dose due now'}</button>}
      {canDemo&&<button data-testid="button-simulate-time" title="Moves due doses past the 2-hour grace period" onClick={simulateNow} disabled={simulate.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#c8e2df] bg-white px-4 text-sm font-semibold text-[#247b79] transition hover:bg-[#eef9f6] disabled:opacity-50"><Clock3 size={16}/>{simulate.isPending?'Simulating…':'Simulate 2 hours'}</button>}
    </div>}/>
    <CoverageBanner user={user}/>
    {demoFeedback&&<div data-testid="status-demo-feedback" role="status" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-[#cfe7df] bg-[#eef8f4] px-4 py-3 text-sm text-[#37796b]"><span>{demoFeedback}</span><button aria-label="Dismiss" onClick={()=>setDemoFeedback('')} className="text-[#5d8f86]"><X size={15}/></button></div>}
    {loading?<SkeletonGrid/>:patients.isError||doses.isError?<ErrorState retry={()=>{patients.refetch();doses.refetch()}}/>:<>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Today’s adherence" value={total?`${percent}%`:'—'} detail={`${completed} of ${total} doses logged`} icon={Activity} accent="teal" progress={percent}/>
        <Metric label="Assigned patients" value={`${patientList.length}`} detail="Active patient profiles" icon={Users} accent="blue"/>
        <Metric label="Active schedules" value={`${(meds.data||[]).filter(m=>m.active).length}`} detail="Medication plans in progress" icon={Pill} accent="gold"/>
      </div>
      <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr_.85fr]">
        <Card><div className="flex items-center justify-between border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><h2 className="font-bold text-[#254954]">Today’s schedule</h2><p className="mt-1 text-xs text-[#80969c]">A shared view of doses due today</p></div><Link href="/today" data-testid="link-view-today" className="flex items-center gap-1 text-xs font-semibold text-[#287f83] hover:underline">View all <ArrowRight size={14}/></Link></div>
           {doseList.length===0?<EmptyState title="A clear start to the day" body="There are no doses scheduled for today yet. Active medication schedules will appear here."/>:<div className="divide-y divide-[#edf2f2]">{doseList.slice(0,6).map(d=><DoseRow key={d.id} dose={d} patientName={patientList.find(p=>p.id===d.patientId)?.name} compact readOnly={user.role!=='patient'} role={user.role}/>)}</div>}
        </Card>
        <Card><div className="flex items-center justify-between border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><h2 className="font-bold text-[#254954]">Assigned patients</h2><p className="mt-1 text-xs text-[#80969c]">Your active care relationships</p></div><Link href="/patients" data-testid="link-view-patients" className="grid h-8 w-8 place-items-center rounded-lg text-[#60818b] hover:bg-[#f1f7f7]"><ArrowRight size={16}/></Link></div>
          {!patientList.length?<EmptyState title="No patients assigned yet" body="New patient profiles assigned to your care will appear here." icon={Users}/>:<div className="divide-y divide-[#edf2f2]">{patientList.slice(0,6).map(p=><div key={p.id} data-testid={`row-dashboard-patient-${p.id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-[#f8fbfb] sm:px-6"><Link href={`/patients/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3"><Avatar name={p.name} small/><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-[#31535e] hover:text-[#17647a]">{p.name}</div><div className="mt-0.5 truncate text-xs text-[#81969b]">{p.age} years · {p.conditions?.[0]||'Care plan in progress'}</div></div></Link><div className="flex items-center gap-2">{p.userId?<span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-[#e5f5ee] px-2 py-0.5 text-[10px] font-semibold text-[#28745a]"><KeyRound size={10}/> Account active</span>:user.role==='provider'?<button data-testid={`button-doctor-create-account-${p.id}`} onClick={(e)=>{e.preventDefault();setAccountTargetPatient(p);setAccountModalOpen(true)}} className="inline-flex items-center gap-1 rounded-lg bg-[#e8f3f5] px-2.5 py-1 text-xs font-semibold text-[#17647a] hover:bg-[#d8eef3]"><UserPlus size={12}/> Add login</button>:null}<Link href={`/patients/${p.id}`} className="text-[#9aafb2] hover:text-[#17647a]"><ArrowRight size={15}/></Link></div></div>)}</div>}
          {user.role==='provider'&&patientList.some(p=>!p.userId)&&<div className="flex items-center justify-between border-t border-[#edf2f2] bg-[#fcfdfd] px-5 py-3 text-xs sm:px-6"><span className="text-[#648087]">Some patients don’t have a sign-in yet.</span><button data-testid="button-prompt-add-patient-account" onClick={()=>{setAccountTargetPatient(null);setAccountModalOpen(true)}} className="font-semibold text-[#17647a] hover:underline flex items-center gap-1"><KeyRound size={12}/> Create login</button></div>}
        </Card>
      </div>
      <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[#d9eae8] bg-[#eaf6f3] px-5 py-4"><div className="mt-0.5 text-[#388b81]"><HeartPulse size={18}/></div><div><p className="text-sm font-semibold text-[#315f60]">A gentle reminder</p><p className="mt-1 text-xs leading-5 text-[#698b89]">Medication tracking is here to support a conversation—not replace one. Reach out to your care team with questions.</p></div></div>
    </>}
    {patientModalOpen&&<PatientModal patient={null} onClose={()=>setPatientModalOpen(false)}/>}
    {accountModalOpen&&<CreatePatientAccountModal initialPatient={accountTargetPatient} user={user} onClose={()=>setAccountModalOpen(false)}/>}
  </div>
}
function Metric({label,value,detail,icon:Icon,accent,progress}:{label:string;value:string;detail:string;icon:typeof Activity;accent:string;progress?:number}){const color=accent==='teal'?'bg-[#e4f4f0] text-[#25867c]':accent==='blue'?'bg-[#e7f0f6] text-[#3c7790]':'bg-[#fbf1df] text-[#a77b36]';return <Card className="relative overflow-hidden p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold text-[#789098]">{label}</p><p className="mt-3 text-[32px] font-extrabold leading-none tracking-[-.05em] text-[#214754]" data-testid={`metric-${label.toLowerCase().replaceAll(' ','-')}`}>{value}</p><p className="mt-2 text-xs text-[#879ba0]">{detail}</p></div><div className={`grid h-10 w-10 place-items-center rounded-xl ${color}`}><Icon size={19}/></div></div>{progress!==undefined&&<div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#edf3f2]"><div className="h-full rounded-full bg-[#46b5a0] transition-all" style={{width:`${progress}%`}}/></div>}</Card>}
function SkeletonGrid(){return <div className="space-y-5" data-testid="status-loading"><div className="grid gap-4 sm:grid-cols-3">{[1,2,3].map(n=><div key={n} className="h-32 animate-pulse rounded-2xl bg-white"/> )}</div><div className="h-80 animate-pulse rounded-2xl bg-white"/></div>}

/** Patients can log or correct a dose until 24 hours after it was due, and up to 2 hours early. */
const DOSE_CORRECTION_WINDOW_MS=24*60*60*1000, DOSE_EARLY_WINDOW_MS=2*60*60*1000;
function DoseRow({dose,patientName,compact=false,readOnly:readOnlyProp=false,role}:{dose:Dose;patientName?:string;compact?:boolean;readOnly?:boolean;role?:string}){
  const update=useUpdateDoseStatus(), qc=useQueryClient();
  // Only the patient logs their own doses; the server enforces the same rule.
  const readOnly=readOnlyProp||role!=='patient';
  const [flash,setFlash]=useState('');
  // Without a connection the change is saved on this device and uploaded later (offline.ts).
  const change=(status:'taken'|'missed'|'skipped'|'scheduled')=>update.mutate({id:dose.id,data:{status}},{onSuccess:(d)=>{qc.invalidateQueries({queryKey:getListDosesQueryKey()});qc.invalidateQueries({queryKey:getGetAnalyticsQueryKey()});qc.invalidateQueries({predicate:q=>String(q.queryKey[0]).includes('medication-progress')});const local=!!syncStateOf(d);setFlash(local?'Saved on this device. It will upload automatically when you’re back online.':status==='taken'?`Marked as taken at ${timeLabel(d.takenTime||new Date().toISOString())}`:status==='scheduled'?'Undone. This dose is waiting for you again.':`Marked as ${status}.`);setTimeout(()=>setFlash(''),local?6000:4000)}});
  const due=new Date(dose.scheduledTime).getTime()<=Date.now();
  const offset=Date.now()-new Date(dose.scheduledTime).getTime();
  const tooOld=role==='patient'&&offset>DOSE_CORRECTION_WINDOW_MS;
  const tooEarly=role==='patient'&&offset<-DOSE_EARLY_WINDOW_MS;
  const locked=readOnly||tooOld||tooEarly;
  // Taken more than 2 hours after the scheduled time.
  const takenLate=dose.status==='taken'&&!!dose.takenTime&&new Date(dose.takenTime).getTime()-new Date(dose.scheduledTime).getTime()>DOSE_EARLY_WINDOW_MS;
  const busy=update.isPending;
  const small='rounded-xl border border-[#e2ebeb] px-3.5 py-2.5 text-xs font-semibold text-[#71868c] transition hover:bg-[#f6f9f9] disabled:opacity-50';
  return <div data-testid={`row-dose-${dose.id}`} className={`px-5 py-4 ${compact?'sm:px-6':''} ${dose.status==='scheduled'&&due&&!readOnly?'bg-[#fffaf0]':''}`}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${dose.status==='taken'?'bg-[#e7f5ef] text-[#35896c]':dose.status==='missed'?'bg-[#fff0eb] text-[#ad5b45]':'bg-[#eaf3f5] text-[#4a8494]'}`}>{dose.status==='taken'?<Check size={20}/>:<Pill size={19}/>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold text-[#31535e]" data-testid={`text-dose-medication-${dose.id}`}>{dose.medicationName}</span><StatusPill status={dose.status}/><SyncBadge record={dose}/>{dose.status==='scheduled'&&due&&<span className="rounded-full bg-[#fbf1df] px-2 py-0.5 text-[10px] font-bold text-[#99702f]">DUE NOW</span>}</div><div className="mt-1 flex flex-wrap gap-x-3 text-xs text-[#81959a]"><span>{dose.dosage}</span>{patientName&&<span>{patientName}</span>}<span className="inline-flex items-center gap-1"><Clock3 size={12}/>Scheduled {timeLabel(dose.scheduledTime)}</span>{dose.loggedBy&&dose.status!=='scheduled'&&<span data-testid={`text-dose-logged-by-${dose.id}`} className="text-[#91a4a8]">by {dose.loggedBy}</span>}{dose.status==='taken'&&dose.takenTime&&<span className="font-semibold text-[#35896c]" data-testid={`text-dose-taken-at-${dose.id}`}>✓ Taken at {timeLabel(dose.takenTime)}</span>}{takenLate&&<span className="rounded-full bg-[#fbf1df] px-2 py-0.5 text-[10px] font-bold text-[#99702f]" title="Confirmed more than 2 hours after the scheduled time">TAKEN LATE</span>}</div></div></div>
      {!locked&&dose.status==='scheduled'&&<div className="flex flex-wrap items-center gap-2 sm:pl-0">
        <button data-testid={`button-dose-taken-${dose.id}`} disabled={busy} onClick={()=>change('taken')} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#2f9a7f] px-5 text-sm font-bold text-white shadow-sm transition hover:bg-[#27846c] disabled:opacity-50 sm:flex-none"><Check size={18}/>{busy?'Saving…':'I’ve taken it'}</button>
        <button data-testid={`button-dose-skipped-${dose.id}`} disabled={busy} onClick={()=>change('skipped')} className={small}>Skip</button>
        <button data-testid={`button-dose-missed-${dose.id}`} disabled={busy} onClick={()=>change('missed')} className={small}>Missed</button>
      </div>}
      {!locked&&dose.status==='missed'&&<div className="flex flex-wrap items-center gap-2"><button data-testid={`button-dose-late-${dose.id}`} disabled={busy} onClick={()=>change('taken')} className="inline-flex h-11 items-center gap-2 rounded-xl border-2 border-[#2f9a7f] px-4 text-sm font-bold text-[#2f9a7f] transition hover:bg-[#eef9f6] disabled:opacity-50"><Check size={16}/>I took it late</button></div>}
      {!locked&&(dose.status==='taken'||dose.status==='skipped')&&<button data-testid={`button-dose-undo-${dose.id}`} disabled={busy} onClick={()=>change('scheduled')} className="self-start text-xs font-semibold text-[#71868c] underline-offset-2 hover:underline disabled:opacity-50 sm:self-center">Undo</button>}
    </div>
    {!readOnly&&tooOld&&dose.status!=='taken'&&<div data-testid={`status-dose-locked-${dose.id}`} className="mt-2 flex items-center gap-1.5 text-[11px] text-[#8ba0a4]"><ShieldCheck size={12}/>Locked — more than 24 hours old. Ask your care team to correct it.</div>}
    {!readOnly&&tooEarly&&<div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#8ba0a4]"><Clock3 size={12}/>You can log this dose from {timeLabel(new Date(new Date(dose.scheduledTime).getTime()-DOSE_EARLY_WINDOW_MS).toISOString())}.</div>}
    {(syncStateOf(dose)==='conflict'||syncStateOf(dose)==='rejected')&&<div data-testid={`status-dose-sync-${dose.id}`} className="mt-2 text-xs text-[#ad5b45]">{syncErrorOf(dose)}</div>}
    {flash&&<div role="status" data-testid={`status-dose-${dose.id}`} className="mt-2 text-xs font-semibold text-[#2f8a74]">{flash}</div>}
    {update.isError&&<div role="alert" className="mt-2 text-xs text-red-700">{apiError(update.error,'Could not save. Check your connection and try again.')}</div>}
  </div>;
}

function TodayPage({user}:{user:AuthUser}){
  const [selectedDate,setSelectedDate]=useState(dateToday());
  const doses=useListDoses({date:selectedDate});
  const patients=useListPatients();
  const filtered=(doses.data||[]).filter(d=>user.role!=='patient'||(patients.data||[]).some(p=>p.id===d.patientId));
  const [filter,setFilter]=useState('all');
  const shown=filtered.filter(d=>filter==='all'||d.status===filter);
  const counts={all:filtered.length,scheduled:filtered.filter(d=>d.status==='scheduled').length,taken:filtered.filter(d=>d.status==='taken').length};
  // Today's reminders (sound, banner, phone alarms) run app-wide in useDoseDueAlerts. A future
  // day picked here only adds that day's phone alarms on Android.
  useEffect(() => {
    if (isNativeApp && doses.data && selectedDate !== dateToday()) void syncNativeDoseReminders(doses.data);
  }, [doses.data, selectedDate]);
  const viewOnly=user.role!=='patient';
  return <div className="page-enter">
    <PageHeading eyebrow="Daily routine" title="Today’s doses" description="A clear, reassuring view of what’s planned and what’s already been logged." action={<label className="flex h-10 items-center gap-2 rounded-xl border border-[#dbe7e7] bg-white px-3 text-sm text-[#58747d]"><CalendarDays size={16}/><input data-testid="input-dose-date" type="date" min={dateToday()} value={selectedDate} onChange={e=>{if(e.target.value>=dateToday())setSelectedDate(e.target.value)}} className="w-[125px] bg-transparent text-xs outline-none"/></label>}/>
    {(user.role==='patient'||user.role==='caregiver')&&<PatientAdherenceStats patientId={(patients.data||[])[0]?.id}/>}
    {(user.role==='patient'||user.role==='caregiver')&&(patients.data||[])[0]&&<MyCarePlan patientId={(patients.data||[])[0].id}/>}
    {(user.role==='patient'||user.role==='caregiver')&&(patients.data||[])[0]&&<div className="mb-5"><MedicationProgressPanel patientId={(patients.data||[])[0].id} canAdd={false} patientFacing={user.role==='patient'}/></div>}
    <Card className="mb-5 overflow-hidden"><div className="flex flex-col gap-4 bg-gradient-to-r from-[#eaf6f3] to-[#f4f9f9] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7"><div><div className="text-xs font-bold uppercase tracking-[.14em] text-[#478d88]">{selectedDate===dateToday()?'Your day, at a glance':'Selected day'}</div><h2 className="mt-1 text-xl font-bold text-[#274e58]">{filtered.filter(d=>d.status==='taken').length} of {filtered.length} doses logged</h2><p className="mt-1 text-xs text-[#789397]">{viewOnly?'View only. The patient marks each dose as taken, taken late or missed.':'Every small step counts. You can update a dose whenever you’re ready.'}</p></div><div className="flex h-14 w-14 items-center justify-center rounded-full border-[5px] border-[#c7e9df] bg-white text-sm font-extrabold text-[#378c7d]">{filtered.length?Math.round(filtered.filter(d=>d.status==='taken').length/filtered.length*100):0}%</div></div></Card>
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><h2 className="font-bold text-[#254954]">Dose list</h2><p className="mt-1 text-xs text-[#81969b]">{filtered.length} scheduled item{filtered.length===1?'':'s'}</p></div><div className="flex gap-1 rounded-xl bg-[#f1f6f6] p-1">{[['all','All',counts.all],['scheduled','To do',counts.scheduled],['taken','Logged',counts.taken]].map(([id,label,count])=><button key={id} data-testid={`button-dose-filter-${id}`} onClick={()=>setFilter(String(id))} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${filter===id?'bg-white text-[#285d69] shadow-sm':'text-[#81969b] hover:text-[#365963]'}`}>{label} <span className="ml-1 text-[10px] opacity-65">{count}</span></button>)}</div></div>
      {doses.isLoading?<div className="space-y-3 p-5" data-testid="status-loading">{[1,2,3].map(x=><div key={x} className="h-16 animate-pulse rounded-xl bg-[#f2f6f6]"/>)}</div>:doses.isError?<ErrorState retry={()=>doses.refetch()}/>:shown.length===0?<EmptyState title={filter==='all'?'No doses on this day':'Nothing in this view'} body={filter==='all'?'When a medication schedule is active, its planned doses will be shown here.':'Try another view to see more of the day.'}/>:<div className="divide-y divide-[#edf2f2]">{shown.map(d=><DoseRow key={d.id} dose={d} patientName={(patients.data||[]).find(p=>p.id===d.patientId)?.name} readOnly={user.role!=='patient'} role={user.role}/>)}</div>}
    </Card>
    {(user.role==='patient'||user.role==='caregiver')&&(patients.data||[])[0]&&<div className="mt-5"><SideEffectsPanel patientId={(patients.data||[])[0].id} patientFacing={user.role==='patient'}/></div>}
    {(user.role==='patient'||user.role==='caregiver')&&(patients.data||[])[0]&&<div className="mt-5"><LabResultsPanel patientId={(patients.data||[])[0].id} canUpload={user.role==='patient'} canReview={false}/></div>}
    {user.role==='patient'&&<div className="mt-5"><PatientInsightPanel patient={(patients.data||[]).find(p=>p.userId===user.id)} patientFacing canGenerate/></div>}
    <div className="mt-5 rounded-2xl border border-[#dceae8] bg-[#eef7f5] p-4 text-xs leading-5 text-[#668783]"><span className="font-semibold text-[#386c69]">Need help with a dose?</span> It’s okay if a dose was missed or your routine changed. Log what happened and contact your care team if you have questions.{user.role==='patient'&&<Link href="/messages" data-testid="link-message-doctor" className="mt-3 flex w-fit items-center gap-2 rounded-xl bg-[#17647a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#125366]"><MessageSquare size={16}/> Message my doctor</Link>}</div>
    <p className="mt-4 text-center text-[11px] leading-5 text-[#839a9e]">Closed-app dose alarms depend on your browser, phone settings and whether this page is installed as an app.</p>
  </div>;
}

function PatientAdherenceStats({patientId}:{patientId?:number}){
  const params={from:daysAgo(29),to:dateToday(),...(patientId?{patientId}:{})};
  const analytics=useGetAnalytics(params,{query:{enabled:Boolean(patientId),queryKey:getGetAnalyticsQueryKey(params)}});
  const data=analytics.data as Analytics|undefined;
  if(!patientId)return null;
  if(analytics.isLoading)return <div data-testid="status-loading" className="mb-5 grid gap-4 sm:grid-cols-3">{[1,2,3].map(i=><div key={i} className="h-28 animate-pulse rounded-2xl bg-white"/>)}</div>;
  if(analytics.isError||!data)return null;
  // Streak = consecutive fully-adherent days, counting back from yesterday (today counts once complete).
  const trend=[...data.trend].map(p=>({date:String(p.date).slice(0,10),rate:p.adherenceRate}));
  const today=dateToday();
  let streak=0;
  for(const point of trend.slice().reverse()){if(point.date===today&&point.rate<100)continue;if(point.rate<100)break;streak+=1}
  const week=Array.from({length:7},(_,i)=>{const date=daysAgo(6-i);const point=trend.find(p=>p.date===date);return{date,label:new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{weekday:'short'}),rate:point?.rate}});
  const weekly=[3,2,1,0].map(w=>{const pts=trend.filter(p=>p.date>daysAgo(w*7+7)&&p.date<=daysAgo(w*7));return pts.length?Math.round(pts.reduce((s,p)=>s+p.rate,0)/pts.length):null});
  return <div className="mb-5 grid gap-4 lg:grid-cols-[.8fr_.8fr_1.4fr]" data-testid="panel-patient-stats">
    <Metric label="30-day adherence" value={`${Math.round(data.adherenceRate)}%`} detail={data.adherenceRate>=80?'Right on track':data.adherenceRate>=50?'Room to grow':'Let’s build the habit together'} icon={Activity} accent="teal" progress={data.adherenceRate}/>
    <Metric label="Current streak" value={`${streak} day${streak===1?'':'s'}`} detail="Days with every dose taken" icon={HeartPulse} accent="gold"/>
    <Card className="p-5 sm:p-6"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-[#789098]">This week</p><p className="text-[11px] text-[#91a4a8]">Last 4 weeks: {weekly.map((w,i)=><span key={i} className="ml-1 font-semibold text-[#4a7078]">{w===null?'—':`${w}%`}</span>)}</p></div><div className="mt-4 flex h-20 items-end gap-2">{week.map(d=><div key={d.date} className="flex flex-1 flex-col items-center gap-1.5" title={d.rate===undefined?`${d.date}: no doses`:`${d.date}: ${d.rate}%`}><div className="flex h-14 w-full items-end overflow-hidden rounded-md bg-[#f0f5f5]"><div className="w-full rounded-md" style={{height:`${d.rate===undefined?0:Math.max(6,d.rate)}%`,background:d.rate===undefined?'transparent':riskColor(d.rate)}}/></div><span className="text-[10px] text-[#8da1a5]">{d.label}</span></div>)}</div></Card>
  </div>;
}

function PatientInsightPanel({patient,patientFacing,canGenerate}:{patient?:Patient;patientFacing:boolean;canGenerate:boolean}){
  const id=patient?.id||0;
  const insights=useListPatientInsights(id,{query:{enabled:id>0,queryKey:getListPatientInsightsQueryKey(id)}});
  const generate=useGeneratePatientInsight(),qc=useQueryClient(),[feedback,setFeedback]=useState('');
  const list=(insights.data||[]).slice().sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  const newest=list[0];
  const run=()=>{if(!id)return;setFeedback('');generate.mutate({id},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListPatientInsightsQueryKey(id)});setFeedback('A fresh adherence insight is ready.')},onError:()=>setFeedback('We couldn’t prepare an insight just now. Please try again later.')})};
  const levelCopy:Record<string,string>={green:'Your routine looks steady',yellow:'A pattern to keep an eye on',red:'A little extra support may help'};
  const levelStyle:Record<string,string>={green:'bg-[#e6f4ed] text-[#34785d]',yellow:'bg-[#fbf1df] text-[#99702f]',red:'bg-[#fbebe7] text-[#a75848]'};
  return <Card className="overflow-hidden" testId="panel-patient-insight">
    <div className="flex flex-col justify-between gap-3 border-b border-[#eaf0f0] px-5 py-4 sm:flex-row sm:items-center sm:px-6"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#458d89]"><HeartPulse size={13}/> Adherence insight</div><h2 className="mt-1 font-bold text-[#254954]">{patientFacing?'A little perspective on your routine':'Care team insight'}</h2></div>{canGenerate&&patient&&<button data-testid="button-generate-patient-insight" onClick={run} disabled={generate.isPending} className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-lg border border-[#cce3df] bg-[#f4faf8] px-3 text-xs font-semibold text-[#307c78] transition hover:bg-[#eaf6f2] disabled:opacity-50 sm:self-center"><Activity size={14}/>{generate.isPending?'Preparing…':newest?'Refresh insight':'Generate insight'}</button>}</div>
    <div className="p-5 sm:px-6">
      {!patient?<div data-testid="state-insight-unlinked" className="rounded-xl bg-[#f4f8f8] p-4 text-sm leading-6 text-[#71888e]">{patientFacing?'Your care profile is still being connected. Your medication schedule will appear here once it is ready.':'This profile is not linked to a patient account yet.'}</div>:insights.isLoading?<div data-testid="status-insight-loading" className="space-y-3"><div className="h-5 w-1/3 animate-pulse rounded bg-[#edf3f3]"/><div className="h-16 animate-pulse rounded-xl bg-[#f2f6f6]"/></div>:insights.isError?<ErrorState retry={()=>insights.refetch()}/>:newest?<div data-testid={`card-insight-${newest.id}`} className="rounded-2xl bg-[#f4f9f8] p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><span data-testid={`status-insight-risk-${newest.id}`} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${levelStyle[newest.riskLevel]||levelStyle.yellow}`}>{levelCopy[newest.riskLevel]||'Adherence check-in'}</span><span className="text-[10px] text-[#91a4a8]">Updated {new Date(newest.createdAt).toLocaleDateString()}</span></div><p data-testid={`text-insight-summary-${newest.id}`} className="mt-3 text-sm leading-6 text-[#47646c]">{newest.summary}</p>{newest.recommendations.length>0&&<div className="mt-4"><div className="text-[10px] font-bold uppercase tracking-wider text-[#7c9699]">{patientFacing?'Ideas you might try':'Possible next steps'}</div><ul className="mt-2 space-y-2">{newest.recommendations.map((item,i)=><li key={`${newest.id}-${i}`} data-testid={`text-insight-recommendation-${newest.id}-${i}`} className="flex gap-2 text-xs leading-5 text-[#59777b]"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#55aa9b]"/>{item}</li>)}</ul></div>}</div>:<div data-testid="state-insight-empty" className="rounded-xl bg-[#f4f8f8] p-4 text-sm leading-6 text-[#71888e]">{patientFacing?'No insight is available yet. You can request one when you’re ready.':'No saved insight yet. Generate one to help guide a supportive care conversation.'}</div>}
      {feedback&&<p data-testid="status-insight-feedback" role={feedback.startsWith('We couldn')?'alert':'status'} className={`mt-3 text-xs ${feedback.startsWith('We couldn')?'text-red-700':'text-[#448279]'}`}>{feedback}</p>}
      <p className="mt-4 text-[11px] font-medium leading-5 text-[#879b9f]">AI suggestions support, not replace, clinical judgment.</p>
    </div>
  </Card>;
}

const RISK_STYLE:Record<string,{label:string;dot:string;pill:string}>={
  green:{label:'On track',dot:'bg-[#4bb19d]',pill:'bg-[#e6f4ed] text-[#34785d]'},
  yellow:{label:'Needs attention',dot:'bg-[#d6ad5b]',pill:'bg-[#fbf1df] text-[#99702f]'},
  red:{label:'Critical',dot:'bg-[#cf7865]',pill:'bg-[#fbebe7] text-[#a75848]'},
  none:{label:'No data yet',dot:'bg-[#b8c6c8]',pill:'bg-[#f0f4f4] text-[#6f8589]'},
};
function RiskBadge({level,suffix}:{level:string;suffix?:string}){const s=RISK_STYLE[level]||RISK_STYLE.none;return <span data-testid={`badge-risk-${level}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.pill}`}><span className={`h-2 w-2 rounded-full ${s.dot}`}/>{s.label}{suffix?` · ${suffix}`:''}</span>}

/** Course progress per medication: day X of N plus a segmented dose bar with a traffic-light indicator. */
function MedicationProgressPanel({patientId,canAdd,patientFacing=false}:{patientId:number;canAdd:boolean;patientFacing?:boolean}){
  const progress=useGetMedicationProgress(patientId,{query:{enabled:patientId>0,queryKey:getGetMedicationProgressQueryKey(patientId),refetchInterval:60_000}});
  const patients=useListPatients({query:{enabled:canAdd,queryKey:getListPatientsQueryKey()}});
  const [adding,setAdding]=useState(false);
  const list=(progress.data||[]).filter(m=>m.status!=='inactive');
  const order:Record<string,number>={active:0,upcoming:1,completed:2};
  list.sort((a,b)=>(order[a.status]??3)-(order[b.status]??3));
  const unchecked=list.reduce((n,m)=>n+m.pendingCount,0);
  return <Card testId="panel-medication-progress">
    <div className="flex flex-col justify-between gap-3 border-b border-[#eaf0f0] px-5 py-4 sm:flex-row sm:items-center sm:px-6"><div><h2 className="font-bold text-[#254954]">{patientFacing?'My medication progress':'Medication progress'}</h2><p className="mt-1 text-xs text-[#81969b]">Course progress and dose check-ins for each medication</p></div>{canAdd&&<button data-testid="button-add-course" onClick={()=>setAdding(true)} className="inline-flex h-9 items-center gap-2 self-start rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white hover:bg-[#125366] sm:self-center"><Plus size={14}/> Add new course</button>}</div>
    {unchecked>0&&<div data-testid="status-unchecked-doses" role="alert" className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-[#f0dfb8] bg-[#fdf7ea] px-3 py-2.5 text-xs leading-5 text-[#8a6a2a] sm:mx-6"><Bell size={14} className="mt-0.5 shrink-0"/><span><b>{unchecked} dose{unchecked===1?' is':'s are'} due but not checked yet.</b> {patientFacing?'Mark them on Today’s doses. Unchecked doses turn red (missed) after 2 hours.':'The patient has been reminded. Unchecked doses are marked missed after 2 hours.'}</span></div>}
    {progress.isLoading?<ListSkeleton/>:progress.isError?<ErrorState retry={()=>progress.refetch()}/>:list.length===0?<EmptyState title="No medication courses yet" body={canAdd?'Add a course to start tracking progress for this patient.':'Your care team hasn’t added a medication yet.'} icon={Pill}/>:<div className="divide-y divide-[#edf2f2]">{list.map(m=>{
      const logged=m.takenCount+m.missedCount+m.skippedCount;
      const total=Math.max(m.plannedDoses??0,logged+m.pendingCount+m.upcomingCount,1);
      const seg=(n:number)=>`${(n/total)*100}%`;
      const dayPct=m.totalDays?Math.min(100,Math.round(m.dayNumber/m.totalDays*100)):null;
      return <div key={m.medicationId} data-testid={`row-progress-${m.medicationId}`} className="px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-[#31535e]">{m.name}</span><span className="text-xs text-[#81969b]">{m.dosage}</span><span className="ml-auto"><RiskBadge level={m.riskLevel} suffix={logged?`${m.adherenceRate}%`:undefined}/></span></div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[#8ba0a4]"><span className="font-semibold capitalize text-[#5c7a81]">{m.status==='upcoming'?`Starts ${m.startDate}`:m.status==='completed'?'Course completed':m.totalDays?`Day ${m.dayNumber} of ${m.totalDays}`:`Ongoing · day ${m.dayNumber}`}</span><span>{m.startDate}{m.endDate?` → ${m.endDate}`:' → no end date'}</span>{dayPct!==null&&<span>{dayPct}% of course</span>}</div>
        <div className="mt-2.5 flex h-3 overflow-hidden rounded-full bg-[#edf3f2]" role="img" aria-label={`${m.takenCount} taken, ${m.skippedCount} skipped, ${m.missedCount} missed, ${m.pendingCount} not checked, out of ${total} doses`}>
          <div className="bg-[#4bb19d]" style={{width:seg(m.takenCount)}} title={`${m.takenCount} taken`}/>
          <div className="bg-[#a9b8ba]" style={{width:seg(m.skippedCount)}} title={`${m.skippedCount} skipped`}/>
          <div className="bg-[#cf7865]" style={{width:seg(m.missedCount)}} title={`${m.missedCount} missed`}/>
          <div className="animate-pulse bg-[#e3b456]" style={{width:seg(m.pendingCount)}} title={`${m.pendingCount} due, not checked`}/>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#6f878d]"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#4bb19d]"/>{m.takenCount} taken</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#cf7865]"/>{m.missedCount} missed</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#a9b8ba]"/>{m.skippedCount} skipped</span>{m.pendingCount>0&&<span className="inline-flex items-center gap-1 font-semibold text-[#9a7428]"><span className="h-2 w-2 rounded-full bg-[#e3b456]"/>{m.pendingCount} not checked</span>}<span className="ml-auto">{m.plannedDoses?`${m.takenCount} of ${m.plannedDoses} doses`:`${m.upcomingCount} more today`}</span></div>
      </div>})}</div>}
    <div className="border-t border-[#edf2f2] px-5 py-3 text-[10px] leading-4 text-[#91a4a8] sm:px-6">Indicator: <b className="text-[#34785d]">green</b> ≥80% taken · <b className="text-[#99702f]">yellow</b> 50–79% or a dose waiting to be checked · <b className="text-[#a75848]">red</b> below 50%.</div>
    {adding&&<MedicationModal medication={null} patients={patients.data||[]} defaultPatientId={patientId} onClose={()=>setAdding(false)}/>}
  </Card>;
}

/** Side effects to watch for, per active medication, as entered by the prescribing doctor. */
function SideEffectsPanel({patientId,patientFacing}:{patientId:number;patientFacing:boolean}){
  const meds=useListMedications({patientId},{query:{queryKey:getListMedicationsQueryKey({patientId})}});
  const list=(meds.data||[]).filter(m=>m.active&&(!m.endDate||m.endDate>=dateToday()));
  return <Card testId="panel-side-effects">
    <div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">{patientFacing?'My medicines: side effects to watch for':'Side effects to watch for'}</h2><p className="mt-1 text-xs text-[#81969b]">Written by the doctor who prescribed each medicine</p></div>
    {meds.isLoading?<ListSkeleton/>:meds.isError?<ErrorState retry={()=>meds.refetch()}/>:list.length===0?<EmptyState title="No active medicines" body="Medicines your doctor prescribes will appear here." icon={Pill}/>:<ul className="divide-y divide-[#edf2f2]">{list.map(m=><li key={m.id} data-testid={`row-side-effects-${m.id}`} className="px-5 py-3.5 sm:px-6"><div className="flex flex-wrap items-baseline gap-x-2"><span className="text-sm font-bold text-[#31535e]">{m.name}</span><span className="text-xs text-[#81969b]">{m.dosage}</span></div>{m.sideEffects?<p className="mt-1 whitespace-pre-line text-xs leading-5 text-[#5c5130]">{m.sideEffects}</p>:<p className="mt-1 text-xs text-[#91a4a8]">No side effects recorded by your doctor yet. Ask your doctor or pharmacist what to watch for.</p>}</li>)}</ul>}
    <div className="border-t border-[#edf2f2] px-5 py-3 text-[11px] leading-5 text-[#8a989b] sm:px-6">{patientFacing?<>Feeling unwell after a medicine? Note it in <Link href="/health" className="font-semibold text-[#287d80] underline-offset-2 hover:underline">My health</Link> or <Link href="/messages" className="font-semibold text-[#287d80] underline-offset-2 hover:underline">message your doctor</Link>. For severe reactions, call your local emergency number.</>:'For severe reactions, call your local emergency number.'}</div>
  </Card>;
}

/** Doctor–patient messaging. Patients see their own thread; care team members pick a patient. */
/** "YYYY-MM-DD" for a local date. */
const isoDay=(d:Date)=>d.toLocaleDateString('en-CA');
/**
 * Month calendar. Days with activity show a count; today is outlined and the selected day
 * is filled. Used by the Messages page.
 */
function MonthCalendar({month,selected,counts,onSelect,onMonth,loading=false}:{month:Date;selected:string;counts:Record<string,number>;onSelect:(day:string)=>void;onMonth:(m:Date)=>void;loading?:boolean}){
  const first=new Date(month.getFullYear(),month.getMonth(),1);
  const start=new Date(first);start.setDate(1-first.getDay());
  const days=Array.from({length:42},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return d});
  const weeks=days[35].getMonth()!==month.getMonth()?days.slice(0,35):days;
  const today=dateToday();
  const shift=(n:number)=>onMonth(new Date(month.getFullYear(),month.getMonth()+n,1));
  return <div data-testid="calendar-messages" className="p-4">
    <div className="mb-3 flex items-center justify-between"><button type="button" aria-label="Previous month" onClick={()=>shift(-1)} className="grid h-9 w-9 place-items-center rounded-lg text-[#587680] hover:bg-[#f0f7f7]"><ChevronLeft size={18}/></button><div className="text-sm font-bold text-[#254954]" aria-live="polite">{month.toLocaleDateString('en-US',{month:'long',year:'numeric'})}{loading&&<span className="ml-2 text-[11px] font-normal text-[#8ba0a4]">loading…</span>}</div><button type="button" aria-label="Next month" onClick={()=>shift(1)} className="grid h-9 w-9 place-items-center rounded-lg text-[#587680] hover:bg-[#f0f7f7]"><ChevronRight size={18}/></button></div>
    <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wider text-[#8ba0a4]">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div key={d} className="py-1">{d}</div>)}</div>
    <div className="grid grid-cols-7 gap-1" role="grid">{weeks.map(d=>{const key=isoDay(d),n=counts[key]||0,inMonth=d.getMonth()===month.getMonth(),isSel=key===selected,isToday=key===today;
      return <button type="button" key={key} data-testid={`calendar-day-${key}`} onClick={()=>onSelect(key)} aria-pressed={isSel} aria-label={`${d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}${n?`, ${n} message${n===1?'':'s'}`:', no messages'}`} className={`relative flex aspect-square min-h-10 flex-col items-center justify-center rounded-xl text-sm transition ${isSel?'bg-[#17647a] font-bold text-white':isToday?'border-2 border-[#9fcfc9] font-bold text-[#17647a]':inMonth?'text-[#31535e] hover:bg-[#f0f7f7]':'text-[#b8c6c8] hover:bg-[#f6f9f9]'}`}>{d.getDate()}{n>0&&<span className={`mt-0.5 min-w-[18px] rounded-full px-1 text-[9px] font-bold leading-4 ${isSel?'bg-white/25 text-white':'bg-[#e4f4f0] text-[#25867c]'}`}>{n}</span>}</button>})}</div>
    <div className="mt-3 flex items-center justify-between text-[11px] text-[#8ba0a4]"><span>Numbers show messages that day</span><button type="button" onClick={()=>{onMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1));onSelect(today)}} className="font-semibold text-[#287d80] hover:underline">Today</button></div>
  </div>;
}

/** Doctor–patient messaging, organized by calendar: pick a day to see that day's messages; open a conversation to reply. */
function MessagesPage({user}:{user:AuthUser}){
  const threads=useListMessageThreads({query:{queryKey:getListMessageThreadsQueryKey(),refetchInterval:5_000}});
  const initial=Number(new URLSearchParams(window.location.search).get('patient'))||0;
  const isPatient=user.role==='patient';
  const [selected,setSelected]=useState(initial);
  // Patients start in their conversation; the care team starts on today's messages.
  const [view,setView]=useState<'day'|'thread'>(initial||isPatient?'thread':'day');
  const [day,setDay]=useState(dateToday());
  const [month,setMonth]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1)});
  const [search,setSearch]=useState('');
  const range={from:isoDay(new Date(month.getFullYear(),month.getMonth(),1-new Date(month.getFullYear(),month.getMonth(),1).getDay())),to:isoDay(new Date(month.getFullYear(),month.getMonth()+1,13))};
  const calendar=useListMessageCalendar(range,{query:{queryKey:getListMessageCalendarQueryKey(range),refetchInterval:30_000}});
  const counts:Record<string,number>={};
  for(const m of calendar.data||[]){const k=isoDay(new Date(m.createdAt));counts[k]=(counts[k]||0)+1}
  const list=(threads.data||[]).filter(t=>t.patientName.toLowerCase().includes(search.toLowerCase()));
  const activeId=isPatient?(threads.data?.[0]?.patientId||0):selected;
  const active=(threads.data||[]).find(t=>t.patientId===activeId);
  const open=(patientId:number)=>{setSelected(patientId);setView('thread')};
  const pickDay=(d:string)=>{setDay(d);setView('day');const dt=new Date(`${d}T12:00:00`);if(dt.getMonth()!==month.getMonth()||dt.getFullYear()!==month.getFullYear())setMonth(new Date(dt.getFullYear(),dt.getMonth(),1))};
  const dayMessages=(calendar.data||[]).filter(m=>isoDay(new Date(m.createdAt))===day&&m.patientName.toLowerCase().includes(isPatient?'':search.toLowerCase()));
  const showThread=view==='thread'&&!!activeId&&!!active;
  return <div className="page-enter">
    <PageHeading eyebrow="Care conversations" title="Messages" description={isPatient?'Message your care team about your medications and how you’re feeling. Pick a day on the calendar to look back at past messages.':user.role==='caregiver'?'Follow conversations between your linked patient and their care team, day by day.':'Secure conversations with the patients in your care. Pick a day to see who wrote, or open a conversation to reply.'}/>
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <div className={`space-y-5 ${showThread?'hidden lg:block':''}`}>
        <Card><MonthCalendar month={month} selected={view==='day'?day:''} counts={counts} onSelect={pickDay} onMonth={setMonth} loading={calendar.isFetching&&!calendar.data}/></Card>
        {!isPatient&&<Card className="overflow-hidden"><div className="border-b border-[#eaf0f0] p-4"><h2 className="mb-2 text-sm font-bold text-[#254954]">Conversations</h2><label className="flex h-10 items-center gap-2 rounded-xl border border-[#dce8e8] bg-[#fbfdfd] px-3"><Search size={15} className="text-[#81969b]"/><input data-testid="input-search-threads" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search patients…" className="w-full bg-transparent text-sm outline-none"/></label></div>
          {threads.isLoading?<ListSkeleton/>:threads.isError?<ErrorState retry={()=>threads.refetch()}/>:list.length===0?<EmptyState title="No conversations" body="Patients in your care will appear here." icon={MessageSquare}/>:<div className="max-h-[360px] divide-y divide-[#edf2f2] overflow-y-auto">{list.map(t=><button key={t.patientId} data-testid={`thread-${t.patientId}`} onClick={()=>open(t.patientId)} className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[#f6faf9] ${showThread&&activeId===t.patientId?'bg-[#eef8f6]':''}`}><Avatar name={t.patientName} small/><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-[#31535e]">{t.patientName}</span>{t.lastMessageAt&&<span className="shrink-0 text-[10px] text-[#96a8ac]">{new Date(t.lastMessageAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>}</div><div className="mt-0.5 flex items-center gap-2"><span className={`truncate text-xs ${t.unreadCount?'font-semibold text-[#31535e]':'text-[#81969b]'}`}>{t.lastMessage?`${shortName(t.lastSenderName||'')}: ${t.lastMessage}`:'No messages yet'}</span>{t.unreadCount>0&&<span className="ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#17647a] px-1.5 text-[10px] font-bold text-white">{t.unreadCount}</span>}</div></div></button>)}</div>}
        </Card>}
      </div>
      <Card className="flex min-h-[520px] flex-col overflow-hidden">
        {showThread?<Conversation key={activeId} user={user} patientId={activeId} patientName={active!.patientName} onBack={()=>setView('day')} backLabel="Back to calendar"/>
          :<DayAgenda user={user} day={day} messages={dayMessages} loading={calendar.isLoading} error={calendar.isError} retry={()=>calendar.refetch()} onOpen={open} onBackToThread={isPatient&&active?()=>setView('thread'):undefined}/>}
      </Card>
    </div>
    <p className="mt-4 text-xs leading-5 text-[#859a9e]">For emergencies, call your local emergency number. Messages are not monitored around the clock.</p>
  </div>;
}

/** One day's messages, grouped by patient conversation, with a button to open each conversation. */
function DayAgenda({user,day,messages,loading,error,retry,onOpen,onBackToThread}:{user:AuthUser;day:string;messages:CalendarMessage[];loading:boolean;error:boolean;retry:()=>void;onOpen:(patientId:number)=>void;onBackToThread?:()=>void}){
  const groups=new Map<number,CalendarMessage[]>();
  for(const m of messages)groups.set(m.patientId,[...(groups.get(m.patientId)||[]),m]);
  const label=new Date(`${day}T12:00:00`).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><div className="text-[10px] font-bold uppercase tracking-[.15em] text-[#458d89]">{day===dateToday()?'Today':'Selected day'}</div><h2 className="mt-0.5 font-bold text-[#254954]" data-testid="text-agenda-day">{label}</h2><p className="mt-0.5 text-xs text-[#81969b]">{messages.length?`${messages.length} message${messages.length===1?'':'s'} in ${groups.size} conversation${groups.size===1?'':'s'}`:'No messages on this day'}</p></div>{onBackToThread&&<button type="button" data-testid="button-back-conversation" onClick={onBackToThread} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white hover:bg-[#125366]"><MessageSquare size={14}/> Write a message</button>}</div>
    <div className="flex-1 overflow-y-auto bg-[#f7fbfb] p-4 sm:p-5" data-testid="list-agenda">
      {loading?<ListSkeleton/>:error?<ErrorState retry={retry}/>:groups.size===0?<EmptyState title="Nothing on this day" body={user.role==='patient'?'Choose another day, or write to your care team.':'Choose a day with a number on the calendar, or open a conversation on the left.'} icon={CalendarDays}/>:<div className="space-y-4">{[...groups.entries()].map(([pid,items])=><section key={pid} data-testid={`agenda-thread-${pid}`} className="overflow-hidden rounded-2xl border border-[#e3eded] bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-[#eef3f3] px-4 py-3"><div className="flex min-w-0 items-center gap-2.5"><Avatar name={items[0].patientName} small/><div className="min-w-0"><div className="truncate text-sm font-bold text-[#31535e]">{user.role==='patient'?'My care team':items[0].patientName}</div><div className="text-[11px] text-[#81969b]">{items.length} message{items.length===1?'':'s'}</div></div></div><button type="button" data-testid={`button-open-thread-${pid}`} onClick={()=>onOpen(pid)} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-[#c8e2df] px-3 text-xs font-semibold text-[#247b79] hover:bg-[#eef9f6]">{user.role==='caregiver'?'Open':'Open & reply'} <ArrowRight size={13}/></button></div>
        <ol className="divide-y divide-[#f0f4f4]">{items.map(m=><li key={m.id} className="flex gap-3 px-4 py-2.5"><span className="w-16 shrink-0 pt-0.5 text-[11px] font-semibold text-[#6c858b]">{timeLabel(m.createdAt)}</span><div className="min-w-0 flex-1"><div className="text-xs font-bold text-[#31535e]">{m.senderId===user.id?'You':m.senderName} <span className="font-normal text-[#91a4a8]">· {m.senderRole==='provider'?'Doctor':roleLabel(m.senderRole)}</span></div><p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-5 text-[#47646c]">{m.body}</p></div></li>)}</ol>
      </section>)}</div>}
    </div>
  </>;
}
// ---- Team messages: private admin–doctor conversations, separate from patient messaging ----
const STAFF_TOPICS=['System','Patient','Medication','Clinic operations'] as const;
/** A message may start with "[Topic] ": shown as a tag instead of text. */
const splitTopic=(body:string)=>{const m=/^\[(System|Patient|Medication|Clinic operations)\]\s*/.exec(body);return m?{topic:m[1],text:body.slice(m[0].length)}:{topic:null,text:body}};
function TeamMessagesPage({user}:{user:AuthUser}){
  const threads=useListStaffThreads({query:{queryKey:getListStaffThreadsQueryKey(),refetchInterval:10_000}});
  const initial=Number(new URLSearchParams(window.location.search).get('user'))||0;
  const [selected,setSelected]=useState(initial),[search,setSearch]=useState('');
  const others=user.role==='admin'?'doctors':'administrators';
  const list=(threads.data||[]).filter(t=>t.name.toLowerCase().includes(search.toLowerCase()));
  const active=(threads.data||[]).find(t=>t.userId===selected);
  return <div className="page-enter">
    <PageHeading eyebrow="Internal" title="Team messages" description={`Private conversations between administrators and doctors about system issues, patients, medications and clinic operations. Patients and caregivers can’t see these messages.`}/>
    <Card className="overflow-hidden"><div className="grid min-h-[560px] lg:grid-cols-[320px_1fr]">
      <div className={`border-[#eaf0f0] lg:border-r ${active?'hidden lg:block':''}`}>
        <div className="border-b border-[#eaf0f0] p-4"><h2 className="mb-2 text-sm font-bold capitalize text-[#254954]">{others}</h2><label className="flex h-10 items-center gap-2 rounded-xl border border-[#dce8e8] bg-[#fbfdfd] px-3"><Search size={15} className="text-[#81969b]"/><input data-testid="input-search-staff" value={search} onChange={e=>setSearch(e.target.value)} placeholder={`Search ${others}…`} className="w-full bg-transparent text-sm outline-none"/></label></div>
        {threads.isLoading?<ListSkeleton/>:threads.isError?<ErrorState retry={()=>threads.refetch()}/>:list.length===0?<EmptyState title={`No ${others} yet`} body={user.role==='admin'?'Add a doctor in Team access to start a conversation.':'No administrator accounts are active.'} icon={Users}/>:<div className="max-h-[520px] divide-y divide-[#edf2f2] overflow-y-auto">{list.map(t=><button key={t.userId} data-testid={`staff-thread-${t.userId}`} onClick={()=>setSelected(t.userId)} className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[#f6faf9] ${selected===t.userId?'bg-[#eef8f6]':''}`}><Avatar name={t.name} small/><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-[#31535e]">{t.name}</span>{t.lastMessageAt&&<span className="shrink-0 text-[10px] text-[#96a8ac]">{new Date(t.lastMessageAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>}</div><div className="text-[10px] font-bold uppercase tracking-wider text-[#8ba0a4]">{roleLabel(t.role)}</div><div className="mt-0.5 flex items-center gap-2"><span className={`truncate text-xs ${t.unreadCount?'font-semibold text-[#31535e]':'text-[#81969b]'}`}>{t.lastMessage?`${t.lastFromMe?'You: ':''}${splitTopic(t.lastMessage).text}`:'No messages yet'}</span>{t.unreadCount>0&&<span data-testid={`status-staff-unread-${t.userId}`} className="ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#17647a] px-1.5 text-[10px] font-bold text-white">{t.unreadCount}</span>}</div></div></button>)}</div>}
      </div>
      <div className={`flex flex-col ${active?'':'hidden lg:flex'}`}>{active?<StaffConversation key={active.userId} user={user} other={active} onBack={()=>setSelected(0)}/>:<div className="grid flex-1 place-items-center"><EmptyState title="Select a colleague" body={`Choose one of the ${others} on the left to read or send messages.`} icon={MessagesSquare}/></div>}</div>
    </div></Card>
  </div>;
}
function StaffConversation({user,other,onBack}:{user:AuthUser;other:{userId:number;name:string;role:string};onBack:()=>void}){
  const messages=useListStaffMessages(other.userId,{query:{queryKey:getListStaffMessagesQueryKey(other.userId),refetchInterval:4_000,refetchIntervalInBackground:false}});
  const send=useSendStaffMessage(),markRead=useMarkStaffMessagesRead(),qc=useQueryClient();
  const [text,setText]=useState(''),[topic,setTopic]=useState(''),[error,setError]=useState('');
  const [pending,setPending]=useState<{key:number;body:string;failed:boolean}[]>([]);
  const scroller=useRef<HTMLDivElement>(null);
  const list=messages.data||[];
  const lastId=list[list.length-1]?.id;
  useEffect(()=>{markRead.mutate({userId:other.userId},{onSuccess:()=>qc.invalidateQueries({queryKey:getListStaffThreadsQueryKey()})})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[other.userId,lastId]);
  useEffect(()=>{const el=scroller.current;if(el)el.scrollTop=el.scrollHeight},[lastId,pending.length]);
  const deliver=(key:number,body:string)=>send.mutate({userId:other.userId,data:{body}},{onSuccess:(msg)=>{qc.setQueryData(getListStaffMessagesQueryKey(other.userId),(old:StaffMessage[]|undefined)=>old?.some(m=>m.id===msg.id)?old:[...(old||[]),msg]);setPending(p=>p.filter(x=>x.key!==key));qc.invalidateQueries({queryKey:getListStaffThreadsQueryKey()})},onError:(err)=>{setPending(p=>p.map(x=>x.key===key?{...x,failed:true}:x));setError(apiError(err,'Message not sent. Tap it to retry.'))}});
  const submit=(e:FormEvent)=>{e.preventDefault();const t=text.trim();if(!t)return;const body=(topic?`[${topic}] `:'')+t;setError('');const key=Date.now();setPending(p=>[...p,{key,body,failed:false}]);setText('');deliver(key,body)};
  const lastMine=[...list].reverse().find(m=>m.senderId===user.id);
  let lastDay='';
  const bubble=(body:string)=>{const {topic:tag,text:t}=splitTopic(body);return <>{tag&&<span className="mb-1 inline-block rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">{tag}</span>}<div className="whitespace-pre-wrap break-words">{t}</div></>};
  return <>
    <div className="flex items-center gap-3 border-b border-[#eaf0f0] px-4 py-3 sm:px-5"><button data-testid="button-back-staff" onClick={onBack} aria-label="Back to colleagues" className="rounded-lg p-1.5 text-[#587680] hover:bg-[#f1f7f7] lg:hidden"><ArrowLeft size={18}/></button><Avatar name={other.name} small/><div className="min-w-0"><div className="truncate text-sm font-bold text-[#254954]" data-testid="text-staff-conversation-title">{other.name}</div><div className="text-[11px] text-[#81969b]">{roleLabel(other.role)} · internal, not visible to patients</div></div></div>
    <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto bg-[#f7fbfb] px-4 py-5 sm:px-6" style={{maxHeight:460,minHeight:320}} data-testid="list-staff-messages">
      {messages.isLoading?<ListSkeleton/>:messages.isError?<ErrorState retry={()=>messages.refetch()}/>:list.length===0&&pending.length===0?<EmptyState title="No messages yet" body={`Start the conversation with ${shortName(other.name)} below.`} icon={MessagesSquare}/>:list.map(m=>{const mine=m.senderId===user.id;const d=new Date(m.createdAt).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});const showDay=d!==lastDay;lastDay=d;return <div key={m.id}>{showDay&&<div className="my-2 text-center text-[10px] font-semibold uppercase tracking-wider text-[#9aadb1]">{d}</div>}<div data-testid={`staff-message-${m.id}`} className={`flex ${mine?'justify-end':'justify-start'}`}><div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm ${mine?'rounded-br-md bg-[#17647a] text-white':'rounded-bl-md border border-[#e3eded] bg-white text-[#31535e]'}`}>{!mine&&<div className="mb-0.5 text-[11px] font-bold text-[#2f8a84]">{m.senderName} <span className="font-normal text-[#91a4a8]">· {roleLabel(m.senderRole)}</span></div>}{bubble(m.body)}<div className={`mt-1 text-right text-[10px] ${mine?'text-white/60':'text-[#9aadb1]'}`}>{timeLabel(m.createdAt)}{mine&&m.id===lastMine?.id&&<span data-testid="status-staff-read"> · {m.readAt?'Read':'Sent'}</span>}</div></div></div></div>})}
      {pending.map(p=><div key={p.key} className="flex justify-end"><button type="button" disabled={!p.failed} onClick={()=>{setError('');setPending(x=>x.map(y=>y.key===p.key?{...y,failed:false}:y));deliver(p.key,p.body)}} className={`max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-left text-sm leading-6 shadow-sm ${p.failed?'border border-red-200 bg-red-50 text-red-800':'bg-[#17647a]/80 text-white'}`}>{bubble(p.body)}<div className={`mt-1 text-right text-[10px] ${p.failed?'text-red-600':'text-white/60'}`}>{p.failed?'Not sent · tap to retry':'Sending…'}</div></button></div>)}
    </div>
    <form onSubmit={submit} className="border-t border-[#eaf0f0] p-3 sm:p-4"><div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Topic (optional)"><span className="text-[11px] font-semibold text-[#6c858b]">Topic:</span>{STAFF_TOPICS.map(t=><button type="button" key={t} aria-pressed={topic===t} onClick={()=>setTopic(topic===t?'':t)} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${topic===t?'border-[#17647a] bg-[#17647a] text-white':'border-[#dce8e8] text-[#55737a] hover:border-[#9fcfc9]'}`}>{t}</button>)}</div>
      <div className="flex items-end gap-2"><textarea data-testid="input-staff-message" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit(e)}}} rows={1} maxLength={1980} placeholder={`Write to ${shortName(other.name)}…`} className="max-h-32 min-h-11 flex-1 resize-y rounded-xl border border-input bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"/><button data-testid="button-send-staff-message" disabled={!text.trim()} aria-label="Send message" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#17647a] text-white transition hover:bg-[#125366] disabled:opacity-50"><Send size={18}/></button></div>{error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}<p className="mt-1.5 text-[10px] text-[#9aadb1]">Press Enter to send, Shift+Enter for a new line. Encrypted and visible only to the two of you.</p></form>
  </>;
}

function Conversation({user,patientId,patientName,onBack,backLabel='Back to conversations'}:{user:AuthUser;patientId:number;patientName:string;onBack?:()=>void;backLabel?:string}){
  // Refresh every 3 seconds while the conversation is open, so replies appear almost instantly.
  const messages=useListPatientMessages(patientId,{query:{queryKey:getListPatientMessagesQueryKey(patientId),refetchInterval:3_000,refetchIntervalInBackground:false}});
  const send=useSendPatientMessage(),markRead=useMarkPatientMessagesRead(),qc=useQueryClient();
  const patients=useListPatients({query:{enabled:user.role==='patient',queryKey:getListPatientsQueryKey()}});
  const me=user.role==='patient'?(patients.data||[]).find(p=>p.id===patientId):undefined;
  const doctorName=me?.coveringProviderName||me?.assignedProviderName;
  const [text,setText]=useState(''),[error,setError]=useState('');
  // Messages shown immediately while they are being sent.
  const [pending,setPending]=useState<{key:number;body:string;failed:boolean}[]>([]);
  const scroller=useRef<HTMLDivElement>(null);
  const canSend=user.role!=='caregiver';
  const list=messages.data||[];
  const lastId=list[list.length-1]?.id;
  useEffect(()=>{markRead.mutate({id:patientId},{onSuccess:()=>qc.invalidateQueries({queryKey:getListMessageThreadsQueryKey()})})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[patientId,lastId]);
  useEffect(()=>{const el=scroller.current;if(el)el.scrollTop=el.scrollHeight},[lastId,pending.length]);
  const deliver=(key:number,body:string)=>send.mutate({id:patientId,data:{body}},{onSuccess:(msg)=>{qc.setQueryData(getListPatientMessagesQueryKey(patientId),(old:typeof list|undefined)=>old?.some(m=>m.id===msg.id)?old:[...(old||[]),msg]);setPending(p=>p.filter(x=>x.key!==key));qc.invalidateQueries({queryKey:getListMessageThreadsQueryKey()})},onError:(err)=>{setPending(p=>p.map(x=>x.key===key?{...x,failed:true}:x));setError(apiError(err,'Message not sent. Tap it to retry.'))}});
  const submit=(e:FormEvent)=>{e.preventDefault();const body=text.trim();if(!body)return;setError('');const key=Date.now();setPending(p=>[...p,{key,body,failed:false}]);setText('');deliver(key,body)};
  const retry=(key:number,body:string)=>{setError('');setPending(p=>p.map(x=>x.key===key?{...x,failed:false}:x));deliver(key,body)};
  let lastDay='';
  return <>
    <div className="flex items-center gap-3 border-b border-[#eaf0f0] px-4 py-3 sm:px-5">{onBack&&<button data-testid="button-back-threads" onClick={onBack} aria-label={backLabel} title={backLabel} className="rounded-lg p-1.5 text-[#587680] hover:bg-[#f1f7f7]"><ArrowLeft size={18}/></button>}<Avatar name={user.role==='patient'?(doctorName||'Care Team'):patientName} small/><div className="min-w-0"><div className="truncate text-sm font-bold text-[#254954]" data-testid="text-conversation-title">{user.role==='patient'?(doctorName||'My care team'):patientName}</div><div className="flex items-center gap-1.5 text-[11px] text-[#81969b]"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4bb19d] opacity-60"/><span className="relative inline-flex h-2 w-2 rounded-full bg-[#4bb19d]"/></span>{user.role==='patient'?(me?.coveringProviderName?`Covering for ${me.assignedProviderName} · live chat`:'Your doctor · live chat'):'Patient · live chat'}</div></div>{user.role!=='patient'&&<Link href={`/patients/${patientId}`} className="ml-auto rounded-lg border border-[#dce8e8] px-2.5 py-1.5 text-[11px] font-semibold text-[#397d7e] hover:bg-[#f3f9f8]">View profile</Link>}</div>
    <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto bg-[#f7fbfb] px-4 py-5 sm:px-6" style={{maxHeight:440,minHeight:320}} data-testid="list-messages">
      {messages.isLoading?<ListSkeleton/>:messages.isError?<ErrorState retry={()=>messages.refetch()}/>:list.length===0&&pending.length===0?<EmptyState title="No messages yet" body={canSend?'Start the conversation below.':'Messages between the patient and care team will appear here.'} icon={MessageSquare}/>:list.map(m=>{const mine=m.senderId===user.id;const day=new Date(m.createdAt).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});const showDay=day!==lastDay;lastDay=day;return <div key={m.id}>{showDay&&<div className="my-2 text-center text-[10px] font-semibold uppercase tracking-wider text-[#9aadb1]">{day}</div>}<div data-testid={`message-${m.id}`} className={`flex ${mine?'justify-end':'justify-start'}`}><div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm ${mine?'rounded-br-md bg-[#17647a] text-white':'rounded-bl-md border border-[#e3eded] bg-white text-[#31535e]'}`}>{!mine&&<div className="mb-0.5 text-[11px] font-bold text-[#2f8a84]">{m.senderName} <span className="font-normal text-[#91a4a8]">· {m.senderRole==='provider'?'Doctor':roleLabel(m.senderRole)}</span></div>}<div className="whitespace-pre-wrap break-words">{m.body}</div><div className={`mt-1 text-right text-[10px] ${mine?'text-white/60':'text-[#9aadb1]'}`}>{timeLabel(m.createdAt)}{syncStateOf(m)&&<span data-testid="status-sync-record" data-sync={syncStateOf(m)}> · {syncStateOf(m)==='rejected'?`Not sent: ${syncErrorOf(m)||'refused by the server'}`:'Saved on this device · sends automatically'}</span>}</div></div></div></div>})}
      {pending.map(p=><div key={p.key} className="flex justify-end"><button type="button" disabled={!p.failed} onClick={()=>retry(p.key,p.body)} className={`max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-left text-sm leading-6 shadow-sm ${p.failed?'border border-red-200 bg-red-50 text-red-800':'bg-[#17647a]/80 text-white'}`}><div className="whitespace-pre-wrap break-words">{p.body}</div><div className={`mt-1 text-right text-[10px] ${p.failed?'text-red-600':'text-white/60'}`}>{p.failed?'Not sent · tap to retry':'Sending…'}</div></button></div>)}
    </div>
    {canSend?<form onSubmit={submit} className="border-t border-[#eaf0f0] p-3 sm:p-4"><div className="flex items-end gap-2"><textarea data-testid="input-message" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit(e)}}} rows={1} maxLength={2000} placeholder={user.role==='patient'?`Write to ${doctorName||'your doctor'}…`:`Write to ${shortName(patientName)}…`} className="max-h-32 min-h-11 flex-1 resize-y rounded-xl border border-input bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"/><button data-testid="button-send-message" disabled={!text.trim()} aria-label="Send message" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#17647a] text-white transition hover:bg-[#125366] disabled:opacity-50"><Send size={18}/></button></div>{error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}<p className="mt-1.5 text-[10px] text-[#9aadb1]">Press Enter to send, Shift+Enter for a new line.</p></form>:<div className="border-t border-[#eaf0f0] px-4 py-3 text-xs text-[#81969b]">Caregiver accounts can read this conversation but not send messages.</div>}
  </>;
}

/** Password field with a show/hide toggle. */
function EmailReferenceIcon(){
  return <svg aria-hidden="true" viewBox="0 0 40 28" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-7 -translate-y-1/2 text-[#252222]">
    <rect x="2" y="2" width="36" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="2.2"/>
    <path d="m3.5 4 14.8 12.1a2.8 2.8 0 0 0 3.4 0L36.5 4M3.5 24l11-11M36.5 24l-11-11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}
function PasswordReferenceIcon(){
  return <svg aria-hidden="true" viewBox="0 0 512 512" className="pointer-events-none absolute left-3.5 top-1/2 h-[19px] w-[19px] -translate-y-1/2 text-[#111]">
    <path fill="currentColor" d="M148 192v-32c0-64.1 51.9-116 116-116s116 51.9 116 116v32h-43v-32c0-40.3-32.7-73-73-73s-73 32.7-73 73v32h-43Z"/>
    <rect x="81" y="191" width="350" height="280" rx="50" fill="currentColor"/>
    <circle cx="256" cy="301" r="44" fill="white"/>
    <rect x="235" y="326" width="42" height="82" rx="21" fill="white"/>
  </svg>;
}
function PasswordInput({value,onChange,name,id,placeholder,required=false,minLength,autoComplete,className='',testId,referenceLockIcon=false}:{value?:string;onChange?:(v:string)=>void;name?:string;id?:string;placeholder?:string;required?:boolean;minLength?:number;autoComplete?:string;className?:string;testId?:string;referenceLockIcon?:boolean}){
  const [shown,setShown]=useState(false);
  return <div className="relative">{referenceLockIcon&&<PasswordReferenceIcon/>}<input id={id} name={name} data-testid={testId} type={shown?'text':'password'} required={required} minLength={minLength} autoComplete={autoComplete} value={onChange?value:undefined} defaultValue={onChange?undefined:value} onChange={onChange?e=>onChange(e.target.value):undefined} placeholder={placeholder} className={`${className} pr-11`}/><button type="button" onClick={()=>setShown(!shown)} aria-label={shown?'Hide password':'Show password'} aria-pressed={shown} data-testid={testId?`${testId}-toggle`:undefined} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[#7b9399] hover:text-[#17647a]">{shown?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>;
}
const passwordChecks=(p:string)=>[{ok:p.length>=8,label:'At least 8 characters'},{ok:/[A-Za-z]/.test(p)&&/\d/.test(p),label:'Letters and numbers'},{ok:/[^A-Za-z0-9]/.test(p)||p.length>=12,label:'A symbol or 12+ characters (recommended)'}];

/** Change-password form, used on the account page and for the required first-login change. */
function ChangePasswordForm({onDone,firstLogin=false}:{onDone?:()=>void;firstLogin?:boolean}){
  const change=useChangePassword(),qc=useQueryClient();
  const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[error,setError]=useState(''),[done,setDone]=useState(false);
  const checks=passwordChecks(next),valid=checks[0].ok&&checks[1].ok&&next===confirm;
  const submit=(e:FormEvent)=>{e.preventDefault();setError('');setDone(false);if(next!==confirm){setError('The new passwords don’t match.');return}
    change.mutate({data:{currentPassword:current,newPassword:next}},{onSuccess:()=>{setCurrent('');setNext('');setConfirm('');setDone(true);qc.invalidateQueries({queryKey:getGetCurrentUserQueryKey()});onDone?.()},onError:(err)=>setError(apiError(err,'Could not change your password. Try again.'))})};
  const input='mt-1.5 h-11 w-full rounded-xl border border-input bg-white px-3.5 text-sm font-normal outline-none focus:border-primary focus:ring-4 focus:ring-primary/10';
  return <form onSubmit={submit} className="space-y-4" data-testid="form-change-password">
    <label className="block text-xs font-semibold text-[#526f77]">{firstLogin?'Temporary password (from your administrator)':'Current password'}<PasswordInput testId="input-current-password" value={current} onChange={setCurrent} required autoComplete="current-password" className={input}/></label>
    <label className="block text-xs font-semibold text-[#526f77]">New password<PasswordInput testId="input-new-password" value={next} onChange={setNext} required minLength={8} autoComplete="new-password" className={input}/></label>
    {next&&<ul className="space-y-1 text-[11px]">{checks.map(c=><li key={c.label} className={`flex items-center gap-1.5 ${c.ok?'text-[#34785d]':'text-[#8ba0a4]'}`}>{c.ok?<Check size={13}/>:<span className="grid h-[13px] w-[13px] place-items-center"><span className="h-1.5 w-1.5 rounded-full bg-current"/></span>}{c.label}</li>)}</ul>}
    <label className="block text-xs font-semibold text-[#526f77]">Confirm new password<PasswordInput testId="input-confirm-password" value={confirm} onChange={setConfirm} required autoComplete="new-password" className={input}/></label>
    {confirm&&next!==confirm&&<p className="text-[11px] text-[#a75848]">The passwords don’t match yet.</p>}
    {error&&<div role="alert" data-testid="status-password-error" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}
    {done&&!firstLogin&&<div role="status" data-testid="status-password-changed" className="rounded-xl border border-[#cfe7df] bg-[#eef8f4] p-3 text-xs text-[#37796b]">Password updated. Other devices have been signed out.</div>}
    <button data-testid="button-change-password" disabled={change.isPending||!valid||!current} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#17647a] text-sm font-semibold text-white hover:bg-[#125366] disabled:opacity-50"><KeyRound size={16}/>{change.isPending?'Saving…':firstLogin?'Set my password and continue':'Update password'}</button>
  </form>;
}

/** Shown instead of the app until a user with a temporary password chooses their own. */
function FirstLoginPasswordScreen({user,onSignOut}:{user:AuthUser;onSignOut:()=>void}){
  return <div className="grid min-h-[100dvh] place-items-center bg-[#eef6f7] px-5 py-10"><div className="w-full max-w-[440px] page-enter">
    <div className="mb-6 flex justify-center"><Brand/></div>
    <div className="rounded-3xl border border-[#dce9e9] bg-white p-6 shadow-[0_20px_50px_rgba(31,74,88,.08)] sm:p-8">
      <div className="mb-5 flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#fbf1df] text-[#a77b36]"><KeyRound size={21}/></div><div><h1 className="text-lg font-bold text-[#173d4a]">Welcome, {shortName(user.name)}! Create your password</h1><p className="mt-1 text-xs leading-5 text-muted-foreground">Your account was set up with a temporary password. For security, choose a private password only you know before continuing.</p></div></div>
      <ChangePasswordForm firstLogin/>
    </div>
    <button data-testid="button-first-login-signout" onClick={onSignOut} className="mx-auto mt-4 flex items-center gap-1.5 text-xs font-semibold text-[#47737b] hover:text-primary"><LogOut size={14}/> Sign out</button>
  </div></div>;
}

function PrivacyConsentScreen({user,onSignOut}:{user:AuthUser;onSignOut:()=>void}) {
  const qc = useQueryClient();
  const [accepting,setAccepting] = useState(false);
  const [error,setError] = useState("");
  const accept = async () => {
    setAccepting(true);
    setError("");
    try {
      // Through the shared API client, so the Android app's server address and token are used too.
      await customFetch("/api/auth/privacy-consent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: "2026-11" }),
      });
      await qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
    } catch (e) {
      setError(apiError(e, "Could not save consent."));
      setAccepting(false);
    }
  };
  return <div className="grid min-h-[100dvh] place-items-center bg-[#eef6f7] px-5 py-10">
    <div className="w-full max-w-[520px] rounded-3xl border border-[#dce9e9] bg-white p-6 shadow-[0_20px_50px_rgba(31,74,88,.08)] sm:p-8">
      <div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#dff4f0] text-[#177b7c]"><ShieldCheck size={22}/></div><div><h1 className="text-xl font-bold text-[#173d4a]">Privacy notice</h1><p className="mt-1 text-sm text-muted-foreground">Before using CareTrack, please review how your account is protected.</p></div></div>
      <div className="mt-5 space-y-3 rounded-2xl bg-[#f4f9f8] p-4 text-sm leading-6 text-[#536f76]">
        <p>CareTrack stores account details, care records, messages, medication schedules, and health information needed to provide your care services.</p>
        <p>Access is limited by your role and assigned care relationships. Authorized staff may audit activity. Sensitive health files and messages are encrypted at rest.</p>
        <p>I understand that AI features only receive the limited, de-identified information described in CareTrack’s data processing controls. I consent to CareTrack processing my information for these care and safety features.</p>
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-xs text-red-800">{error}</p>}
      <button data-testid="button-accept-privacy" disabled={accepting} onClick={accept} className="mt-5 h-12 w-full rounded-xl bg-[#17647a] text-sm font-semibold text-white disabled:opacity-60">{accepting ? "Saving…" : "I accept the privacy notice"}</button>
      <button data-testid="button-privacy-signout" onClick={onSignOut} className="mx-auto mt-4 flex items-center gap-1.5 text-xs font-semibold text-[#47737b]"><LogOut size={14}/> Sign out</button>
    </div>
  </div>;
}

function AccountPage({user}:{user:AuthUser}) {
  return <div className="page-enter"><PageHeading eyebrow="Security" title="My account" description="Review your sign-in details and change your password."/>
    <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
      <Card className="p-5 sm:p-6"><div className="flex items-center gap-3"><Avatar name={user.name}/><div className="min-w-0"><div className="truncate font-bold text-[#254954]">{user.name}</div><div className="truncate text-xs text-[#81969b]">{user.email}</div></div></div><div className="mt-5 grid grid-cols-2 gap-3"><Info label="Role" value={roleLabel(user.role)}/><Info label="Status" value={user.active?'Active':'Inactive'}/><div className="col-span-2"><Info label="Mobile number (SMS codes)" value={user.phoneVerified?'Verified by SMS code':'Not verified yet: it is verified the first time you sign in with a text-message code'}/></div></div><div className="mt-5 rounded-xl bg-[#f4f9f8] p-3 text-xs leading-5 text-[#5f7d83]"><b className="text-[#37685f]">Sign-in protection:</b> each login asks for your password and a one-time code sent to your Gmail or phone.</div></Card>
      <Card className="p-5 sm:p-6"><h2 className="font-bold text-[#254954]">Change password</h2><p className="mb-5 mt-1 text-xs text-[#81969b]">Changing your password signs you out on every other device.</p><ChangePasswordForm/></Card>
    </div>
  </div>;
}
/** The header's help button: what this role can do, where to find it, and a sound check. */
function HelpDialog({user,onClose}:{user:AuthUser;onClose:()=>void}){
  const [tested,setTested]=useState('');
  const tips:Record<string,[string,string,string][]>={
    patient:[['/today','Today’s doses','When a dose is due you hear a chime and see a reminder. Tap “I’ve taken it”, “I took it late” or “Missed”.'],['/prescriptions','My prescriptions','Your medicines, how to take them, side effects to watch for, and files from your doctor.'],['/health','My health','Record blood pressure, sugar and how you feel. Works without internet.'],['/messages','Message my doctor','Ask your care team a question.']],
    caregiver:[['/today','Today’s doses','See your patient’s doses and reminders. Only the patient marks doses as taken.'],['/prescriptions','Prescriptions','Medicines, side effects to watch for, and prescription files.'],['/messages','Messages','Read the conversation between your patient and their doctor.']],
    provider:[['/patients','Patients','Open a patient: tabs group their overview, personal details, medication schedule and history, adherence and reports.'],['/team-messages','Team messages','Private messages with administrators about the system, patients, medications or clinic operations.'],['/medications','Medications','A table of every schedule. Click a patient’s name to open their profile. Times use 12-hour form, e.g. 8:00 AM.'],['/today','Today’s doses','View-only: patients log their own doses.'],['/ai','AI risk prediction','Which patients may need extra support this week.']],
    admin:[['/admin/users','Team access','Add doctors, patients and caregivers.'],['/team-messages','Team messages','Private messages with doctors about the system, patients, medications or clinic operations.'],['/patients','Patients','Patient profiles and care records.'],['/admin/audit','Audit activity','Who changed what, and when.']],
  };
  const test=()=>setTested(playChime({force:true})?'If you heard a chime, sound is working. If not, check your phone’s volume and silent mode.':'This device can’t play sounds from the browser.');
  return <Modal title="Help" subtitle={`Quick guide for your ${roleLabel(user.role).toLowerCase()} account`} onClose={onClose}>
    <div className="space-y-4" data-testid="panel-help">
      <ul className="space-y-2">{(tips[user.role]||[]).map(([href,label,body])=><li key={href}><Link href={href} onClick={onClose} className="block rounded-xl border border-[#e3eded] p-3 transition hover:border-[#9fcfc9] hover:bg-[#f6faf9]"><div className="flex items-center justify-between text-sm font-bold text-[#31535e]">{label}<ArrowRight size={14} className="text-[#8aa0a4]"/></div><p className="mt-1 text-xs leading-5 text-[#71888e]">{body}</p></Link></li>)}</ul>
      <div className="rounded-xl bg-[#f4f9f8] p-3 text-xs leading-5 text-[#5f7d83]"><div className="font-semibold text-[#37685f]">Reminders and sound</div>Open the bell, then <b>Sound &amp; alerts</b>, to turn the sound on or off and allow pop-up notifications. On Android, CareTrack also uses the phone’s own notification sound.<div className="mt-2"><button type="button" data-testid="button-help-test-sound" onClick={test} className="h-9 rounded-lg border border-[#c8e2df] bg-white px-3 text-xs font-semibold text-[#247b79] hover:bg-[#eef9f6]">▶ Test notification sound</button></div>{tested&&<p role="status" className="mt-2 text-[#37796b]">{tested}</p>}</div>
      <p className="text-[11px] leading-5 text-[#8ba0a4]">For emergencies, call your local emergency number. CareTrack messages are not monitored around the clock.</p>
      <div className="flex justify-end"><button type="button" onClick={onClose} className="h-10 rounded-lg bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366]">Close</button></div>
    </div>
  </Modal>;
}
const roleLabel=(role:string)=>({admin:'Administrator',provider:'Doctor',patient:'Patient',caregiver:'Caregiver'} as Record<string,string>)[role]||role;
/** Random temporary password: 10 characters with letters and digits, no look-alike characters. */
/** Readable temporary password like "mint-4827-rosa": lowercase, no look-alike characters, easy to type on a phone. */
function generateTempPassword(){const words=['mint','rosa','tala','luna','sky','sun','rain','leaf','bay','gold','jade','reef','pine','wave','star','moon','dawn','mango','kiwi','palm'];const rand=(n:number)=>crypto.getRandomValues(new Uint32Array(1))[0]%n;const digits=Array.from({length:4},()=>'23456789'[rand(8)]).join('');return `${words[rand(words.length)]}-${digits}-${words[rand(words.length)]}`}

/** Admin tool: shows whether Gmail/SMS are configured and sends a test message. */
function DeliveryPanel(){
  const status=useGetDeliveryStatus(),test=useSendDeliveryTest();
  const [channel,setChannel]=useState<'email'|'sms'>('email'),[to,setTo]=useState(''),[result,setResult]=useState<{delivered:boolean;message:string}|null>(null);
  const s=status.data;
  const row=(label:string,ok:boolean,detail:string)=><div className="flex items-center gap-3 rounded-xl bg-[#f6faf9] px-3 py-2.5"><span className={`grid h-7 w-7 place-items-center rounded-lg ${ok?'bg-[#e4f4f0] text-[#25867c]':'bg-[#f2f3f3] text-[#8a989b]'}`}>{ok?<Wifi size={14}/>:<WifiOff size={14}/>}</span><div className="min-w-0 flex-1"><div className="text-xs font-semibold text-[#3b5c65]">{label}</div><div className="truncate text-[11px] text-[#81969b]">{detail}</div></div><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ok?'bg-[#e6f4ed] text-[#34785d]':'bg-[#f0f4f4] text-[#6f8589]'}`}>{ok?'Online':'Not set up'}</span></div>;
  const send=(e:FormEvent)=>{e.preventDefault();setResult(null);test.mutate({data:{channel,to}},{onSuccess:setResult,onError:(err)=>setResult({delivered:false,message:apiError(err,'Test failed.')})})};
  return <Card className="mt-5 p-5 sm:p-6" testId="panel-delivery"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e5f2f5] text-[#3c7c8d]"><Send size={18}/></div><div><h2 className="font-bold text-[#254954]">Login code delivery (Gmail &amp; SMS)</h2><p className="mt-1 text-xs leading-5 text-[#81969b]">Real codes are sent when these are set up in the server’s <code>.env</code> file. Otherwise codes are shown on screen (offline mode).</p></div></div>
    {status.isLoading?<ListSkeleton/>:status.isError||!s?<ErrorState retry={()=>status.refetch()}/>:<div className="mt-4 grid gap-2 sm:grid-cols-2">{row('Gmail',s.emailConfigured,s.emailSender||'GMAIL_USER and GMAIL_APP_PASSWORD not set')}{row('SMS',s.smsConfigured,s.smsProvider?`Provider: ${s.smsProvider}`:'SMS_PROVIDER not set')}<div className="text-[11px] text-[#81969b] sm:col-span-2">Two-step login: <b>{s.otpEnabled?'on':'off'}</b> · Offline fallback (show code on screen): <b>{s.offlineFallback?'on':'off'}</b></div></div>}
    <form onSubmit={send} className="mt-4 flex flex-col gap-2 sm:flex-row"><select data-testid="select-test-channel" value={channel} onChange={e=>{setChannel(e.target.value as 'email'|'sms');setTo('')}} className="h-10 rounded-lg border border-input bg-white px-3 text-sm"><option value="email">Test Gmail</option><option value="sms">Test SMS</option></select><input data-testid="input-test-recipient" required value={to} onChange={e=>setTo(e.target.value)} type={channel==='email'?'email':'tel'} placeholder={channel==='email'?'you@gmail.com':'09XXXXXXXXX'} className="h-10 flex-1 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-primary"/><button data-testid="button-send-test" disabled={test.isPending} className="h-10 rounded-lg bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366] disabled:opacity-50">{test.isPending?'Sending…':'Send test'}</button></form>
    {result&&<div role="status" data-testid="status-delivery-test" className={`mt-3 rounded-xl border p-3 text-xs ${result.delivered?'border-[#cfe7df] bg-[#eef8f4] text-[#37796b]':'border-[#f0dfb8] bg-[#fdf7ea] text-[#8a6a2a]'}`}>{result.message}</div>}
  </Card>;
}

/** Doctor coverage: hand an absent doctor's patients to a colleague for a date range. */
function CoveragePage({user}:{user:AuthUser}){
  const coverage=useListCoverage(),providers=useListProviders(),create=useCreateCoverage(),qc=useQueryClient();
  const isAdmin=user.role==='admin';
  const [absent,setAbsent]=useState(isAdmin?'':String(user.id)),[covering,setCovering]=useState(''),[start,setStart]=useState(dateToday()),[end,setEnd]=useState(daysAgo(-2)),[reason,setReason]=useState(''),[feedback,setFeedback]=useState<{ok:boolean;text:string}|null>(null);
  const list=coverage.data||[];
  const refresh=()=>{qc.invalidateQueries({queryKey:getListCoverageQueryKey()});qc.invalidateQueries({queryKey:getListPatientsQueryKey()});qc.invalidateQueries({queryKey:getListNotificationsQueryKey()})};
  const submit=(e:FormEvent)=>{e.preventDefault();setFeedback(null);create.mutate({data:{absentProviderId:Number(absent),coveringProviderId:Number(covering),startDate:start,endDate:end||null,reason:reason||null}},{onSuccess:c=>{refresh();setReason('');setFeedback({ok:true,text:`${c.coveringProviderName} will handle ${c.absentProviderName}’s ${c.patientCount} patient${c.patientCount===1?'':'s'}${c.status==='active'?' starting today':` from ${c.startDate}`}.`})},onError:err=>setFeedback({ok:false,text:apiError(err,'Could not arrange coverage.')})})};
  const field='mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal text-[#355661]';
  const doctors=providers.data||[];
  return <div className="page-enter"><PageHeading eyebrow="Care continuity" title="Doctor coverage" description="When a doctor is absent, another doctor temporarily handles their patients, alerts and messages. Nothing is lost. Patients return automatically when the coverage ends."/>
    <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
      <div className="space-y-5">
        <Card className="p-5 sm:p-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f4f0] text-[#388b7f]"><ArrowLeftRight size={18}/></div><div><h2 className="font-bold text-[#254954]">{isAdmin?'Arrange coverage':'I will be absent'}</h2><p className="mt-1 text-xs leading-5 text-[#81969b]">{isAdmin?'Choose who is away and who will handle their patients.':'Choose a colleague to look after your patients while you’re away.'}</p></div></div>
          <form onSubmit={submit} className="mt-5 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[11px] font-semibold text-[#6c858b]">Absent doctor<select data-testid="select-absent-doctor" required value={absent} onChange={e=>setAbsent(e.target.value)} disabled={!isAdmin} className={field}><option value="" disabled>Select doctor</option>{doctors.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <label className="text-[11px] font-semibold text-[#6c858b]">Covering doctor<select data-testid="select-covering-doctor" required value={covering} onChange={e=>setCovering(e.target.value)} className={field}><option value="" disabled>Select doctor</option>{doctors.filter(d=>String(d.id)!==absent).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <label className="text-[11px] font-semibold text-[#6c858b]">From<input data-testid="input-coverage-start" type="date" min={dateToday()} required value={start} onChange={e=>{if(e.target.value>=dateToday())setStart(e.target.value)}} className={field}/></label>
              <label className="text-[11px] font-semibold text-[#6c858b]">Until (leave blank if unknown)<input data-testid="input-coverage-end" type="date" min={start} value={end} onChange={e=>setEnd(e.target.value)} className={field}/></label>
            </div>
            <label className="block text-[11px] font-semibold text-[#6c858b]">Reason (optional)<input data-testid="input-coverage-reason" value={reason} maxLength={200} onChange={e=>setReason(e.target.value)} placeholder="e.g. Sick leave, conference" className={field}/></label>
            <button data-testid="button-create-coverage" disabled={create.isPending||!absent||!covering} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366] disabled:opacity-50"><ArrowLeftRight size={15}/>{create.isPending?'Saving…':'Hand over patients'}</button>
            {feedback&&<div role="status" data-testid="status-coverage-feedback" className={`rounded-xl border p-3 text-xs ${feedback.ok?'border-[#cfe7df] bg-[#eef8f4] text-[#37796b]':'border-red-200 bg-red-50 text-red-800'}`}>{feedback.text}</div>}
          </form>
        </Card>
        {user.role==='provider'&&<PatientTransferPanel user={user} doctors={doctors}/>}
      </div>
      <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Coverage schedule</h2><p className="mt-1 text-xs text-[#81969b]">Current, upcoming and past handovers</p></div>
        {coverage.isLoading?<ListSkeleton/>:coverage.isError?<ErrorState retry={()=>coverage.refetch()}/>:list.length===0?<EmptyState title="No coverage arranged" body="Handovers you create will appear here." icon={ArrowLeftRight}/>:<div className="divide-y divide-[#edf2f2]">{list.map(c=><CoverageRow key={c.id} coverage={c} onChange={refresh}/>)}</div>}
      </Card>
    </div>
  </div>;
}
type PatientTransferRequest={
  id:number;patientId:number;patientName:string;fromProviderId:number;fromProviderName:string;
  toProviderId:number;toProviderName:string;reason:string|null;status:'pending'|'accepted'|'declined';
  createdAt:string;respondedAt:string|null;
};
function PatientTransferPanel({user,doctors}:{user:AuthUser;doctors:{id:number;name:string;email:string}[]}){
  const requests=useQuery({queryKey:['coverage-transfers'],queryFn:()=>customFetch<PatientTransferRequest[]>('/api/coverage/transfers')});
  const patients=useListPatients(),qc=useQueryClient();
  const [patientId,setPatientId]=useState(''),[toProviderId,setToProviderId]=useState(''),[reason,setReason]=useState('');
  const [feedback,setFeedback]=useState<{ok:boolean;text:string}|null>(null);
  const field='mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal text-[#355661]';
  const refresh=()=>{void qc.invalidateQueries({queryKey:['coverage-transfers']});void qc.invalidateQueries({queryKey:getListPatientsQueryKey()});void qc.invalidateQueries({queryKey:getListNotificationsQueryKey()})};
  const create=useMutation({
    mutationFn:(input:{patientId:number;toProviderId:number;reason:string|null})=>customFetch<PatientTransferRequest>('/api/coverage/transfers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),
    onSuccess:()=>{refresh();setPatientId('');setToProviderId('');setReason('');setFeedback({ok:true,text:'Transfer request sent. The receiving doctor has been notified and must accept before the assignment changes.'})},
    onError:error=>setFeedback({ok:false,text:apiError(error,'Could not send this transfer request.')}),
  });
  const respond=useMutation({
    mutationFn:(input:{id:number;decision:'accept'|'decline'})=>customFetch<PatientTransferRequest>(`/api/coverage/transfers/${input.id}/respond`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision:input.decision})}),
    onSuccess:(_request,input)=>{refresh();setFeedback({ok:true,text:input.decision==='accept'?'Transfer accepted. The patient is now assigned to you.':'Transfer declined. The patient remains with the requesting doctor.'})},
    onError:error=>setFeedback({ok:false,text:apiError(error,'Could not respond to this transfer request.')}),
  });
  const eligiblePatients=(patients.data||[]).filter(p=>p.assignedProviderId===user.id);
  const visibleRequests=requests.data||[];
  return <Card className="overflow-hidden">
    <div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Permanent patient transfers</h2><p className="mt-1 text-xs leading-5 text-[#81969b]">Request a transfer to another doctor. Their assignment changes only after they accept.</p></div>
    <form onSubmit={e=>{e.preventDefault();setFeedback(null);create.mutate({patientId:Number(patientId),toProviderId:Number(toProviderId),reason:reason.trim()||null})}} className="space-y-3 border-b border-[#eaf0f0] p-5 sm:px-6">
      <label className="block text-[11px] font-semibold text-[#6c858b]">Patient<select data-testid="select-transfer-patient" required value={patientId} onChange={e=>setPatientId(e.target.value)} className={field}><option value="">Select a patient</option>{eligiblePatients.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block text-[11px] font-semibold text-[#6c858b]">Receiving doctor<select data-testid="select-transfer-doctor" required value={toProviderId} onChange={e=>setToProviderId(e.target.value)} className={field}><option value="">Select a doctor</option>{doctors.filter(d=>d.id!==user.id).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label className="block text-[11px] font-semibold text-[#6c858b]">Reason (optional)<input data-testid="input-transfer-reason" maxLength={200} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Add context for the receiving doctor" className={field}/></label>
      <button data-testid="button-request-transfer" disabled={create.isPending||!patientId||!toProviderId} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366] disabled:opacity-50"><Send size={15}/>{create.isPending?'Sending…':'Request transfer'}</button>
      {feedback&&<div role="status" data-testid="status-transfer-feedback" className={`rounded-xl border p-3 text-xs ${feedback.ok?'border-[#cfe7df] bg-[#eef8f4] text-[#37796b]':'border-red-200 bg-red-50 text-red-800'}`}>{feedback.text}</div>}
    </form>
    <div className="border-b border-[#eaf0f0] px-5 py-3 sm:px-6"><h3 className="text-sm font-bold text-[#31535e]">Transfer requests</h3></div>
    {requests.isLoading?<div className="p-5"><ListSkeleton/></div>:requests.isError?<ErrorState retry={()=>requests.refetch()}/>:visibleRequests.length===0?<EmptyState title="No transfer requests" body="Requests you send or receive will appear here." icon={ArrowLeftRight}/>:<div className="divide-y divide-[#edf2f2]">{visibleRequests.map(request=>{
      const incoming=request.toProviderId===user.id;
      const statusStyle=request.status==='pending'?'bg-[#fff3dd] text-[#946b26]':request.status==='accepted'?'bg-[#e6f4ed] text-[#34785d]':'bg-[#f2f3f3] text-[#778589]';
      return <div key={request.id} data-testid={`row-transfer-${request.id}`} className="space-y-3 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-sm text-[#31535e]">{request.patientName}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusStyle}`}>{request.status}</span></div>
        <p className="text-xs leading-5 text-[#81969b]">{incoming?`${request.fromProviderName} requested transfer to you`:`Transfer requested for ${request.toProviderName}`}{request.reason?` · ${request.reason}`:''}</p>
        {incoming&&request.status==='pending'&&<div className="flex gap-2"><button data-testid={`button-accept-transfer-${request.id}`} disabled={respond.isPending} onClick={()=>respond.mutate({id:request.id,decision:'accept'})} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#28745a] px-3 text-xs font-semibold text-white disabled:opacity-50"><Check size={14}/>Accept</button><button data-testid={`button-decline-transfer-${request.id}`} disabled={respond.isPending} onClick={()=>respond.mutate({id:request.id,decision:'decline'})} className="h-9 rounded-lg border border-[#dce8e8] px-3 text-xs font-semibold text-[#587780] disabled:opacity-50">Decline</button></div>}
      </div>;
    })}</div>}
  </Card>;
}
function CoverageRow({coverage:c,onChange}:{coverage:Coverage;onChange:()=>void}){
  const end=useEndCoverage();
  const style=c.status==='active'?'bg-[#e6f4ed] text-[#34785d]':c.status==='upcoming'?'bg-[#e9f2f6] text-[#366a7d]':'bg-[#f2f3f3] text-[#778589]';
  return <div data-testid={`row-coverage-${c.id}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold text-[#31535e]">{c.absentProviderName}</span><ArrowRight size={14} className="text-[#9aafb2]"/><span className="font-semibold text-[#31535e]">{c.coveringProviderName}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${style}`}>{c.status}</span></div><div className="mt-1 text-xs text-[#81969b]">{c.startDate} → {c.endDate||'until ended'} · {c.patientCount} patient{c.patientCount===1?'':'s'}{c.reason?` · ${c.reason}`:''}</div></div>{c.status!=='ended'&&<button data-testid={`button-end-coverage-${c.id}`} disabled={end.isPending} onClick={()=>{if(window.confirm(`End coverage? ${c.absentProviderName}’s patients will return to them.`))end.mutate({id:c.id},{onSuccess:onChange})}} className="self-start rounded-lg border border-[#dce8e8] px-3 py-2 text-xs font-semibold text-[#587780] hover:bg-[#f5f9f9] sm:self-center">{c.status==='upcoming'?'Cancel':'End now'}</button>}</div>;
}
/** Banner on the dashboard when the signed-in doctor is covering, or being covered. */
function CoverageBanner({user}:{user:AuthUser}){
  const coverage=useListCoverage({query:{enabled:user.role==='provider',queryKey:getListCoverageQueryKey()}});
  const active=(coverage.data||[]).filter(c=>c.status==='active');
  if(!active.length)return null;
  return <div className="mb-5 space-y-2">{active.map(c=><div key={c.id} data-testid={`banner-coverage-${c.id}`} className="flex items-start gap-3 rounded-2xl border border-[#cfe0ea] bg-[#eef5fa] px-4 py-3 text-sm text-[#2f5d72]"><ArrowLeftRight size={18} className="mt-0.5 shrink-0"/><div className="flex-1">{c.coveringProviderId===user.id?<><b>You’re covering for {c.absentProviderName}</b> until {c.endDate||'further notice'}. Their {c.patientCount} patients are in your list, marked “Covering”.</>:<><b>{c.coveringProviderName} is covering your patients</b> until {c.endDate||'further notice'}.</>}</div><Link href="/coverage" className="shrink-0 text-xs font-semibold underline">Manage</Link></div>)}</div>;
}


/** Standalone modal that allows doctors and admins to easily provision a patient login account. */
function CreatePatientAccountModal({
  initialPatient,
  user,
  onClose,
}: {
  initialPatient?: Patient | null;
  user: AuthUser;
  onClose: () => void;
}) {
  const patientsQuery = useListPatients();
  const createAccount = useCreatePatientAccount();
  const qc = useQueryClient();

  const patients = patientsQuery.data || [];
  const candidatePatients = user.role === 'admin'
    ? patients
    : patients.filter((p) => !p.assignedProviderId || p.assignedProviderId === user.id);

  const [selectedPatientId, setSelectedPatientId] = useState<number>(
    initialPatient?.id || candidatePatients.find((p) => !p.userId)?.id || candidatePatients[0]?.id || 0
  );

  const currentPatient = candidatePatients.find((p) => p.id === selectedPatientId) || initialPatient;

  const [email, setEmail] = useState(currentPatient?.email || '');
  const [phone, setPhone] = useState(currentPatient?.phone || '');
  const [password, setPassword] = useState(generateTempPassword());
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ email: string; password: string; name: string } | null>(null);

  const handleSelectPatient = (id: number) => {
    setSelectedPatientId(id);
    const p = candidatePatients.find((x) => x.id === id);
    if (p) {
      setEmail(p.email || '');
      setPhone(p.phone || '');
      setError('');
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId) {
      setError('Please select a patient.');
      return;
    }
    setError('');
    createAccount.mutate(
      {
        id: selectedPatientId,
        data: { email: email.trim().toLowerCase(), password, phone: phone.trim() || null },
      },
      {
        onSuccess: (r) => {
          setCreated({ email: r.email, password, name: currentPatient?.name || 'Patient' });
          qc.invalidateQueries({ queryKey: getListPatientsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPatientQueryKey(selectedPatientId) });
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        },
        onError: (err) => setError(apiError(err, 'Could not create the patient account.')),
      }
    );
  };

  if (created) {
    return (
      <Modal title="Patient login created" subtitle="Share these sign-in details with the patient." onClose={onClose}>
        <div className="space-y-4" data-testid="panel-patient-account-created">
          <div className="rounded-xl border border-[#cfe7df] bg-[#eef8f4] p-4 text-sm text-[#37796b]">
            <div className="font-semibold">{created.name}</div>
            <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <span className="text-[#5d8f86]">Email</span>
              <span className="font-mono">{created.email}</span>
              <span className="text-[#5d8f86]">Temporary password</span>
              <span className="font-mono font-bold" data-testid="text-temp-password">{created.password}</span>
            </div>
          </div>
          <p className="text-xs leading-5 text-[#71888e]">
            The patient can sign into the CareTrack Android app with this email and temporary password. They will be prompted to set their permanent password and verify their phone number.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(`CareTrack Login:\nEmail: ${created.email}\nTemporary password: ${created.password}`)}
              className="h-10 rounded-lg border border-[#dce8e8] px-4 text-sm font-semibold text-[#52737c] hover:bg-[#f5f9f9]"
            >
              Copy details
            </button>
            <button
              type="button"
              data-testid="button-done-patient-account"
              onClick={onClose}
              className="h-10 rounded-lg bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366]"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={initialPatient ? `Create login for ${initialPatient.name}` : "Add patient account"}
      subtitle="Give a patient their own mobile sign-in to log doses and message you."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        {!initialPatient && (
          <label className="block text-xs font-semibold text-[#526f77]">
            Select patient
            <select
              data-testid="select-patient-for-account"
              value={selectedPatientId}
              onChange={(e) => handleSelectPatient(Number(e.target.value))}
              className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal text-[#31515c]"
            >
              {candidatePatients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.userId ? '✓ (Already has login)' : '⚠ (Needs login)'}
                </option>
              ))}
            </select>
            {currentPatient?.userId && (
              <span className="mt-1 block text-xs text-amber-600">
                This patient already has an active account ({currentPatient.email}). You can reset their password in Team Access instead.
              </span>
            )}
          </label>
        )}

        <label className="block text-xs font-semibold text-[#526f77]">
          Patient email address (for login & verification)
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="patient@gmail.com"
            className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal text-[#31515c] outline-none focus:border-primary"
            data-testid="input-patient-account-email"
          />
        </label>

        <label className="block text-xs font-semibold text-[#526f77]">
          Mobile number (for SMS login codes)
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="09XXXXXXXXX"
            className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal text-[#31515c] outline-none focus:border-primary"
            data-testid="input-patient-account-phone"
          />
        </label>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#526f77]">Temporary password</span>
            <button
              type="button"
              data-testid="button-generate-patient-password"
              onClick={() => setPassword(generateTempPassword())}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#287d80] hover:underline"
            >
              <KeyRound size={12} /> Generate new
            </button>
          </div>
          <PasswordInput
            testId="input-patient-account-password"
            value={password}
            onChange={setPassword}
            required
            minLength={8}
            className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal outline-none focus:border-primary"
          />
          <p className="mt-1 text-[11px] text-[#8ba0a4]">
            The patient will use this to sign in the first time and will choose their own password.
          </p>
        </div>

        {error && (
          <div role="alert" data-testid="status-patient-account-error" className="text-xs text-red-700">
            {error}
          </div>
        )}

        <ModalActions onClose={onClose} busy={createAccount.isPending} submitLabel="Create patient account" />
      </form>
    </Modal>
  );
}

/** Lets the care team give a patient their own sign-in, linked to this profile. */
function PatientLoginCard({patient}:{patient:Patient}){
  const create=useCreatePatientAccount(),qc=useQueryClient();
  const [open,setOpen]=useState(false),[email,setEmail]=useState(patient.email||''),[phone,setPhone]=useState(patient.phone||''),[password,setPassword]=useState(generateTempPassword()),[error,setError]=useState(''),[done,setDone]=useState<{email:string;password:string}|null>(null);
  const submit=(e:FormEvent)=>{e.preventDefault();setError('');create.mutate({id:patient.id,data:{email,password,phone:phone||null}},{onSuccess:r=>{setDone({email:r.email,password});qc.invalidateQueries({queryKey:getGetPatientQueryKey(patient.id)});qc.invalidateQueries({queryKey:getListPatientsQueryKey()})},onError:err=>setError(apiError(err,'Could not create the login.'))})};
  const field='mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal outline-none focus:border-primary';
  return <Card className="p-5" testId="card-patient-login"><div className="flex items-start gap-3"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${patient.userId?'bg-[#e4f4f0] text-[#25867c]':'bg-[#fbf1df] text-[#a77b36]'}`}><KeyRound size={18}/></div><div className="min-w-0 flex-1"><h2 className="font-bold text-[#254954]">Patient login</h2>{patient.userId?<p className="mt-1 text-xs leading-5 text-[#81969b]">This patient can sign in{patient.email?<> with <b className="text-[#4a6a72]">{patient.email}</b></>:''} to log doses, see their progress and message their doctor.</p>:<p className="mt-1 text-xs leading-5 text-[#81969b]">This patient can’t sign in yet. Create a login so they can log doses and message you from their phone.</p>}</div></div>
    {!patient.userId&&!open&&<button data-testid="button-create-patient-login" onClick={()=>setOpen(true)} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white hover:bg-[#125366]"><UserPlus size={14}/> Create patient login</button>}
    {open&&!done&&<form onSubmit={submit} className="mt-4 space-y-3">
      <label className="block text-xs font-semibold text-[#526f77]">Email (their Gmail, for login codes)<input data-testid="input-patient-login-email" type="email" required value={email} onChange={e=>setEmail(e.target.value)} className={field} placeholder="patient@gmail.com"/></label>
      <label className="block text-xs font-semibold text-[#526f77]">Mobile number (for SMS codes)<input data-testid="input-patient-login-phone" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} className={field} placeholder="09XXXXXXXXX"/></label>
      <div><div className="flex items-center justify-between"><span className="text-xs font-semibold text-[#526f77]">Temporary password</span><button type="button" onClick={()=>setPassword(generateTempPassword())} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#287d80] hover:underline"><KeyRound size={12}/> Generate</button></div><PasswordInput testId="input-patient-login-password" value={password} onChange={setPassword} required minLength={8} autoComplete="new-password" className={field}/></div>
      {error&&<div role="alert" className="text-xs text-red-700">{error}</div>}
      <div className="flex justify-end gap-2"><button type="button" onClick={()=>setOpen(false)} className="h-9 rounded-lg px-3 text-xs font-semibold text-[#6b8389] hover:bg-[#f3f7f7]">Cancel</button><button data-testid="button-save-patient-login" disabled={create.isPending} className="h-9 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white hover:bg-[#125366] disabled:opacity-60">{create.isPending?'Creating…':'Create login'}</button></div>
    </form>}
    {done&&<div className="mt-4 space-y-2" data-testid="panel-patient-login-created"><div className="rounded-xl border border-[#cfe7df] bg-[#eef8f4] p-3 text-xs text-[#37796b]"><div className="font-semibold">Login created. Give these details to {shortName(patient.name)}:</div><div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1"><span>Email</span><span className="font-mono">{done.email}</span><span>Temporary password</span><span className="font-mono font-bold">{done.password}</span></div></div><p className="text-[11px] leading-5 text-[#8ba0a4]">They sign in, enter the code sent to their Gmail or phone, then create their own password.</p><button type="button" onClick={()=>navigator.clipboard?.writeText(`CareTrack login\nEmail: ${done.email}\nTemporary password: ${done.password}`)} className="h-9 rounded-lg border border-[#dce8e8] px-3 text-xs font-semibold text-[#52737c] hover:bg-[#f5f9f9]">Copy details</button></div>}
  </Card>;
}

// ---- Notification sound: gentle, rate-limited, respects mute and quiet hours ----
const SOUND_KEY='caretrack-sound', QUIET_KEY='caretrack-quiet-hours';
const readPref=(key:string,fallback:string)=>{try{return localStorage.getItem(key)??fallback}catch{return fallback}};
const writePref=(key:string,value:string)=>{try{localStorage.setItem(key,value)}catch{/* private mode */}};
let lastChime=0;
// Browsers and the Android WebView only allow sound after the person has tapped the page, and a
// sound context created later (from a timer) starts muted. So one shared context is created and
// "unlocked" on the first tap or key press, and every later chime reuses it.
type WebkitWindow=Window&{webkitAudioContext?:typeof AudioContext};
let audioCtx:AudioContext|null=null;
const audioContext=()=>{
  if(audioCtx)return audioCtx;
  const Ctx=window.AudioContext||(window as WebkitWindow).webkitAudioContext;
  if(!Ctx)return null;
  try{audioCtx=new Ctx()}catch{audioCtx=null}
  return audioCtx;
};
const unlockAudio=()=>{
  const ctx=audioContext();
  if(!ctx)return;
  if(ctx.state==='suspended')void ctx.resume().catch(()=>{/* still blocked */});
  try{const src=ctx.createBufferSource();src.buffer=ctx.createBuffer(1,1,22050);src.connect(ctx.destination);src.start(0)}catch{/* older browsers */}
  if(ctx.state==='running')['pointerdown','keydown','touchend'].forEach(ev=>window.removeEventListener(ev,unlockAudio));
};
if(typeof window!=='undefined')['pointerdown','keydown','touchend'].forEach(ev=>window.addEventListener(ev,unlockAudio,{passive:true}));
const inQuietHours=()=>{const hour=new Date().getHours();return readPref(QUIET_KEY,'on')==='on'&&(hour>=22||hour<7)};
/**
 * A clear three-tone chime (about a second). Plays at most once a minute so several alerts
 * arriving together make one sound. Medication reminders ignore quiet hours (a 10 PM dose
 * still needs its reminder); other alerts stay silent from 10 PM to 7 AM. Returns whether it played.
 */
function playChime({kind='alert',force=false}:{kind?:'dose'|'alert';force?:boolean}={}){
  if(!force){
    if(readPref(SOUND_KEY,'on')!=='on')return false;
    if(kind!=='dose'&&inQuietHours())return false;
    if(Date.now()-lastChime<60_000)return false;
  }
  const ctx=audioContext();
  if(!ctx)return false;
  lastChime=Date.now();
  const play=()=>{try{const t0=ctx.currentTime+0.02;[[784,0],[988,0.22],[1319,0.44]].forEach(([freq,at])=>{const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(0.0001,t0+at);gain.gain.exponentialRampToValueAtTime(0.32,t0+at+0.02);gain.gain.exponentialRampToValueAtTime(0.0001,t0+at+0.42);osc.connect(gain).connect(ctx.destination);osc.start(t0+at);osc.stop(t0+at+0.45)})}catch{/* audio unavailable */}};
  if(ctx.state==='suspended')void ctx.resume().then(play).catch(()=>{/* blocked until the next tap */});else play();
  try{navigator.vibrate?.([180,90,180])}catch{/* no vibration */}
  return true;
}
/** Remembers which alerts already made a sound, per user, so a reload or a second tab never repeats them. */
const ALERTED_KEY='caretrack-alerted';
const readAlerted=(userId:number):string[]=>{try{const v=JSON.parse(localStorage.getItem(`${ALERTED_KEY}-${userId}`)||'[]');return Array.isArray(v)?v:[]}catch{return []}};
const markAlerted=(userId:number,keys:string[])=>{if(!keys.length)return;try{localStorage.setItem(`${ALERTED_KEY}-${userId}`,JSON.stringify([...readAlerted(userId),...keys].slice(-300)))}catch{/* storage unavailable */}};
/** Android app with notifications allowed: the phone's own dose alarm makes the sound. */
let nativeDoseAlarms=false;
const ALERT_KINDS=['reminder','overdue','message','staff-message','ai-risk','appointment','risk','lab','prescription','coverage'];
const FRESH_MS=10*60_000;
/** Plays a sound and shows a system notification when new important notifications arrive. */
function useNotificationAlerts(notifications:Notification[],user:AuthUser){
  const seen=useRef<number|null>(null);
  useEffect(()=>{
    if(!notifications.length&&seen.current===null)return;
    const newest=notifications.reduce((m,n)=>Math.max(m,n.id),0);
    const first=seen.current===null;
    const already=new Set(readAlerted(user.id));
    // On first load only alerts from the last few minutes count (e.g. the app was opened right
    // as a dose reminder arrived); older unread ones stay quiet.
    const fresh=notifications.filter(n=>!n.read&&ALERT_KINDS.includes(n.kind)&&!already.has(`n${n.id}`)&&(first?Date.now()-new Date(n.createdAt).getTime()<FRESH_MS:n.id>seen.current!));
    seen.current=Math.max(seen.current??0,newest);
    if(!fresh.length)return;
    markAlerted(user.id,fresh.map(n=>`n${n.id}`));
    // Patients and caregivers already hear dose reminders from useDoseDueAlerts; don't chime twice.
    const sounding=fresh.filter(n=>!(n.kind==='reminder'&&(user.role==='patient'||user.role==='caregiver')));
    if(!sounding.length)return;
    const dose=sounding.some(n=>n.kind==='reminder'||n.kind==='overdue');
    if(isNativeApp){
      const nativeAlerts=sounding.filter(n=>n.kind==='message'||n.kind==='staff-message'||n.kind==='overdue'||n.kind==='coverage');
      const otherAlerts=sounding.filter(n=>!nativeAlerts.includes(n));
      for(const n of nativeAlerts){
        const isDose=n.kind==='overdue';
        const quiet=readPref(SOUND_KEY,'on')!=='on'||(!isDose&&inQuietHours());
        const url=isDose?'/today':n.kind==='coverage'?'/coverage':n.kind==='staff-message'?'/team-messages':n.patientId?`/messages?patient=${n.patientId}`:'/messages';
        void showNativeAlert({id:n.id,title:n.title,body:n.message,url,dose:isDose,silent:quiet})
          .then(ok=>{if(!ok)playChime({kind:isDose?'dose':'alert'})})
          .catch(()=>playChime({kind:isDose?'dose':'alert'}));
      }
      if(otherAlerts.length)playChime({kind:dose?'dose':'alert'});
      return;
    }
    const played=nativeDoseAlarms&&dose?false:playChime({kind:dose?'dose':'alert'});
    if(played&&document.hidden&&!isNativeApp&&'Notification' in window&&Notification.permission==='granted'){const n=sounding[0];try{new window.Notification(`CareTrack: ${n.title}`,{body:n.message,tag:`caretrack-${n.id}`,icon:'/icon-192.png'})}catch{/* unsupported */}}
  },[notifications,user.id,user.role]);
}

type DueDose={id:number;medicationName:string;dosage:string;scheduledTime:string;patientName?:string};
/**
 * App-wide dose reminders for patients and caregivers, on every page: when a dose becomes due
 * it chimes once, shows a dismissible banner and (website, tab in the background) a system
 * notification. It also keeps the Android phone alarms and the website's offline reminders
 * in step with today's doses. Each dose alerts only once, even across reloads.
 */
function useDoseDueAlerts(user:AuthUser,enabled:boolean){
  const watch=enabled&&(user.role==='patient'||user.role==='caregiver');
  const params={date:dateToday()};
  const doses=useListDoses(params,{query:{enabled:watch,queryKey:getListDosesQueryKey(params),refetchInterval:60_000}});
  const patients=useListPatients({query:{enabled:watch,queryKey:getListPatientsQueryKey()}});
  const [due,setDue]=useState<DueDose[]>([]);
  const [dismissed,setDismissed]=useState<number[]>([]);
  const list=doses.data;
  // Phone alarms (Android) and the service worker's reminders (website) for today's doses.
  useEffect(()=>{
    if(!watch||!list)return;
    if(isNativeApp){latestDoses=list;window.dispatchEvent(new Event('caretrack-doses'));void syncNativeDoseReminders(list);void notificationPermission().then(p=>{nativeDoseAlarms=p==='granted'});return}
    postToWorker({type:'cache-dose-schedule',doses:list});
  },[watch,list]);
  useEffect(()=>{
    if(!watch||!list)return;
    const check=()=>{
      const now=Date.now();
      const nameOf=(id:number)=>user.role==='caregiver'?(patients.data||[]).find(p=>p.id===id)?.name:undefined;
      // Due now: scheduled, at or past its time, and still inside the 2-hour window to log it.
      const current=list.filter(d=>d.status==='scheduled'&&new Date(d.scheduledTime).getTime()<=now&&now-new Date(d.scheduledTime).getTime()<2*60*60*1000);
      const next=current.map(d=>({id:d.id,medicationName:d.medicationName,dosage:d.dosage,scheduledTime:d.scheduledTime,patientName:nameOf(d.patientId)}));
      setDue(prev=>prev.length===next.length&&prev.every((p,i)=>p.id===next[i].id&&p.patientName===next[i].patientName)?prev:next);
      const already=new Set(readAlerted(user.id));
      const fresh=current.filter(d=>!already.has(`d${d.id}`));
      if(!fresh.length)return;
      markAlerted(user.id,fresh.map(d=>`d${d.id}`));
      // Only doses that became due in the last few minutes make a sound; older ones just show.
      const ringing=fresh.filter(d=>now-new Date(d.scheduledTime).getTime()<FRESH_MS);
      if(!ringing.length)return;
      if(!(isNativeApp&&nativeDoseAlarms))playChime({kind:'dose'});
      if(!isNativeApp&&document.hidden&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
        const d=ringing[0];
        // Same tag as the service worker's reminder, so the phone shows one notification, not two.
        navigator.serviceWorker?.ready.then(r=>r.showNotification(`CareTrack dose reminder: ${d.medicationName}`,{body:`${d.dosage||'Dose'} is due now (${timeLabel(d.scheduledTime)}).`,tag:`dose-${d.id}`,icon:'/icon-192.png',badge:'/icon-192.png',silent:false,requireInteraction:true,data:{url:'/today',doseId:d.id}} as NotificationOptions)).catch(()=>{/* no service worker */});
      }
    };
    check();
    const timer=window.setInterval(check,15_000);
    const onVisible=()=>{if(!document.hidden)check()};
    document.addEventListener('visibilitychange',onVisible);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible)};
  },[watch,list,patients.data,user.id,user.role]);
  return {due:due.filter(d=>!dismissed.includes(d.id)),dismiss:(id:number)=>setDismissed(x=>[...x,id])};
}

/** Banner for doses that are due now. Compact, dismissible, and placed under the header so it never hides buttons. */
function DueDoseAlert({due,onDismiss,role}:{due:DueDose[];onDismiss:(id:number)=>void;role:string}){
  const [location]=useLocation();
  // On Today's doses the due dose is already highlighted in the list, so no banner covers the page.
  if(!due.length||location==='/today')return null;
  const first=due[0],more=due.length-1;
  return <div data-testid="alert-dose-due" role="alert" aria-live="assertive" className="dose-alert fixed inset-x-3 top-[76px] z-40 mx-auto max-w-md rounded-2xl border border-[#f0dfb8] bg-[#fffaf0] shadow-[0_12px_30px_rgba(22,62,76,.16)] sm:left-auto sm:right-6 sm:mx-0 sm:w-[380px] lg:right-8">
    <div className="dose-alert-body flex items-start gap-3 p-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#fbf1df] text-[#99702f]"><Bell size={17}/></div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#99702f]">Dose due now{more>0?` · ${more} more`:''}</div>
        <div className="mt-0.5 break-words text-sm font-bold text-[#3d3a26]" data-testid="text-dose-due-name">{first.medicationName} <span className="font-semibold text-[#7a6a40]">{first.dosage}</span></div>
        <div className="text-xs text-[#7a6a40]">Scheduled {timeLabel(first.scheduledTime)}{first.patientName?` · ${first.patientName}`:''}</div>
        {<Link href="/today" onClick={()=>onDismiss(first.id)} data-testid="link-dose-due-open" className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white hover:bg-[#125366]">{role==='patient'?'Log this dose':'View today’s doses'} <ArrowRight size={13}/></Link>}
      </div>
      <button data-testid="button-dismiss-dose-due" aria-label="Dismiss reminder" onClick={()=>due.forEach(d=>onDismiss(d.id))} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#99702f] hover:bg-[#fbf1df]"><X size={17}/></button>
    </div>
  </div>;
}
function SoundSettings({user}:{user:AuthUser}){
  const [sound,setSound]=useState(readPref(SOUND_KEY,'on')),[quiet,setQuiet]=useState(readPref(QUIET_KEY,'on')),[perm,setPerm]=useState<string>(isNativeApp?'loading':typeof Notification!=='undefined'?Notification.permission:'denied');
  const [pushStatus,setPushStatus]=useState<NativePushStatus>(getNativePushStatus);
  const [wellness,setWellness]=useState(readWellness(user.role)),[exact,setExact]=useState(true);
  useEffect(()=>{if(!isNativeApp)return;const updatePushStatus=()=>setPushStatus(getNativePushStatus());void notificationPermission().then(p=>setPerm(p==='prompt'?'default':p));void exactAlarmsAllowed().then(setExact);window.addEventListener('caretrack-push-status',updatePushStatus);return()=>window.removeEventListener('caretrack-push-status',updatePushStatus)},[]);
  const allow=()=>isNativeApp
    ?requestNotificationPermission().then(p=>{setPerm(p==='prompt'?'default':p);if(p==='granted'){syncWellnessConfig(user);if(latestDoses.length)void syncNativeDoseReminders(latestDoses)}})
    :Notification.requestPermission().then(p=>{setPerm(p);if(p==='granted')void registerWellnessSync()});
  const cycleWellness=()=>{const next:WellnessFrequency=wellness==='normal'?'low':wellness==='low'?'off':'normal';setWellness(next);writePref(WELLNESS_KEY,next);syncWellnessConfig(user);if(next!=='off'&&perm==='default')void allow()};
  return <div className="flex flex-wrap items-center gap-2 border-b border-[#edf2f2] bg-[#f8fbfb] px-4 py-2 text-[11px]">
    <button data-testid="button-toggle-sound" onClick={()=>{const v=sound==='on'?'off':'on';setSound(v);writePref(SOUND_KEY,v);if(v==='on')playChime({force:true})}} className={`rounded-full border px-2.5 py-1 font-semibold ${sound==='on'?'border-[#9fcfc9] text-[#2f8a74]':'border-[#dce8e8] text-[#8a989b]'}`}>{sound==='on'?'🔔 Sound on':'🔕 Sound off'}</button>
    {sound==='on'&&<button data-testid="button-test-sound" onClick={()=>playChime({force:true})} className="rounded-full border border-[#dce8e8] px-2.5 py-1 font-semibold text-[#397d7e]">▶ Test sound</button>}
    <button data-testid="button-toggle-quiet" title="Messages and other alerts stay silent from 10 PM to 7 AM. Medication reminders always sound." onClick={()=>{const v=quiet==='on'?'off':'on';setQuiet(v);writePref(QUIET_KEY,v)}} className={`rounded-full border px-2.5 py-1 font-semibold ${quiet==='on'?'border-[#9fcfc9] text-[#2f8a74]':'border-[#dce8e8] text-[#8a989b]'}`}>Quiet 10 PM–7 AM (except doses): {quiet}</button>
    <button data-testid="button-toggle-wellness" title="Hydration reminders, health tips, motivation and quotes between 8 AM and 9 PM. Works offline." onClick={cycleWellness} className={`rounded-full border px-2.5 py-1 font-semibold ${wellness!=='off'?'border-[#9fcfc9] text-[#2f8a74]':'border-[#dce8e8] text-[#8a989b]'}`}>🌱 Wellness tips: {wellness==='off'?'off':wellness==='low'?'2/day':'4/day'}</button>
    {wellness!=='off'&&perm==='granted'&&<button data-testid="button-preview-wellness" onClick={()=>isNativeApp?void previewNativeWellness(user.name,latestDoses):postToWorker({type:'wellness-preview'})} className="rounded-full border border-[#dce8e8] px-2.5 py-1 font-semibold text-[#397d7e]">Send a tip now</button>}
    {perm==='default'&&<button data-testid="button-allow-notifications" onClick={allow} className="rounded-full border border-[#dce8e8] px-2.5 py-1 font-semibold text-[#397d7e]">{isNativeApp?'Allow notifications':'Allow pop-up alerts'}</button>}
    {isNativeApp&&perm==='granted'&&pushStatus==='server-unconfigured'&&<span role="status" className="text-[#a56a48]">Background message alerts need Firebase credentials on the CareTrack server.</span>}
    {isNativeApp&&perm==='granted'&&pushStatus==='android-unconfigured'&&<span role="status" className="text-[#a56a48]">Background message alerts need Firebase Android configuration in this build.</span>}
    {isNativeApp&&perm==='granted'&&pushStatus==='error'&&<span role="status" className="text-[#a56a48]">Background message alerts couldn’t register. Check the Firebase Android app setup and server credentials.</span>}
    {isNativeApp&&pushStatus==='registering'&&<span role="status" className="text-[#67818a]">Enabling background message alerts…</span>}
    {isNativeApp&&perm==='granted'&&!exact&&<button data-testid="button-exact-alarms" onClick={()=>void openExactAlarmSettings().then(exactAlarmsAllowed).then(setExact)} className="rounded-full border border-[#f0dfb8] px-2.5 py-1 font-semibold text-[#8a6a2a]">Allow exact reminder times</button>}
    {perm==='denied'&&<span data-testid="text-wellness-blocked" className="text-[#a56a48]">{isNativeApp?'Notifications are turned off for CareTrack in Android Settings › Apps › CareTrack › Notifications.':wellness!=='off'?'Pop-up alerts are blocked in your browser settings, so tips can’t be shown.':''}</span>}
  </div>;
}

// ---- Wellness tips: local notifications scheduled by the service worker, so they work offline ----
const WELLNESS_KEY='caretrack-wellness';
type WellnessFrequency='off'|'low'|'normal';
/** On by default for patients; care staff can turn it on for themselves. */
const readWellness=(role:string):WellnessFrequency=>{const fallback=role==='patient'?'normal':'off',v=readPref(WELLNESS_KEY,fallback);return (v==='off'||v==='low'||v==='normal'?v:fallback)};
const postToWorker=(message:unknown)=>{navigator.serviceWorker?.ready.then(r=>r.active?.postMessage(message)).catch(()=>{/* no service worker */})};
/** Today's doses as last loaded (Android app), for dose alarms and personalized tips. */
let latestDoses:Dose[]=[];
function syncWellnessConfig(user:AuthUser){
  const frequency=readWellness(user.role);
  // Android app: tips are scheduled as phone alarms. Browser: the service worker schedules them.
  if(isNativeApp){void syncNativeWellness({frequency,name:user.name,doses:latestDoses});return}
  postToWorker({type:'wellness-config',config:{enabled:frequency!=='off',frequency,name:user.name}});
}
type PeriodicSyncRegistration=ServiceWorkerRegistration&{periodicSync?:{register:(tag:string,options:{minInterval:number})=>Promise<void>}};
/** Lets Chrome wake the installed app now and then to deliver tips while it's closed (where supported). */
async function registerWellnessSync(){
  try{
    const reg=await navigator.serviceWorker?.ready as PeriodicSyncRegistration|undefined;
    if(!reg?.periodicSync)return;
    const status=await navigator.permissions.query({name:'periodic-background-sync' as PermissionName});
    if(status.state==='granted')await reg.periodicSync.register('caretrack-wellness',{minInterval:2*60*60*1000});
  }catch{/* not supported in this browser */}
}
/** Sends wellness settings to the service worker and checks for due tips while the app is open. */
function WellnessNotifications({user}:{user:AuthUser}){
  // Android app: ask for notification permission once after sign-in, then keep the phone's
  // scheduled tips up to date whenever today's doses change or the app comes back to the front.
  useEffect(()=>{
    if(!isNativeApp)return;
    let timer=0;
    const resync=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>syncWellnessConfig(user),1500)};
    void (async()=>{
      if((await notificationPermission())==='prompt'&&readPref('caretrack-asked-notifications','')!=='yes'){writePref('caretrack-asked-notifications','yes');await requestNotificationPermission()}
      syncWellnessConfig(user);
    })();
    const onVisible=()=>{if(!document.hidden)resync()};
    window.addEventListener('caretrack-doses',resync);document.addEventListener('visibilitychange',onVisible);
    return()=>{window.clearTimeout(timer);window.removeEventListener('caretrack-doses',resync);document.removeEventListener('visibilitychange',onVisible)};
  },[user.id,user.name,user.role]);
  useEffect(()=>{
    if(isNativeApp)return;
    syncWellnessConfig(user);
    void registerWellnessSync();
    const tick=()=>postToWorker({type:'wellness-tick'});
    const onVisible=()=>{if(!document.hidden)tick()};
    const timer=window.setInterval(tick,60_000);
    document.addEventListener('visibilitychange',onVisible);
    window.addEventListener('online',tick);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('online',tick)};
  },[user.id,user.name,user.role]);
  return null;
}

// ---- Offline mode: connection and sync status (the saving and syncing itself is in offline.ts) ----
const useSync=()=>useSyncExternalStore(subscribeSync,getSyncSnapshot);
const clock=(t:number)=>dateTimeLabel(t);
const SYNC_LOOK:Record<SyncState,[string,string]>={
  pending:['Pending sync','bg-[#eef5fa] text-[#2f5d72]'],
  syncing:['Syncing…','bg-[#eef5fa] text-[#2f5d72]'],
  retrying:['Sync failed · retrying','bg-[#fdf3dd] text-[#7a5a1c]'],
  blocked:['Sign in to sync','bg-[#fdf3dd] text-[#7a5a1c]'],
  conflict:['Not synced · newer change kept','bg-[#fff0eb] text-[#ad5b45]'],
  rejected:['Not saved by server','bg-[#fff0eb] text-[#ad5b45]'],
};
/** Marker on a record that is saved on this device but not (yet) on the server. */
function SyncBadge({record}:{record:unknown}){
  const online=useSync().online;
  const raw=syncStateOf(record);
  if(!raw)return null;
  // While the device is offline a failed attempt is simply waiting for the connection.
  const state=!online&&raw==='retrying'?'pending':raw;
  const [label,cls]=SYNC_LOOK[state];
  return <span data-testid="status-sync-record" data-sync={state} title={syncErrorOf(record)||'Saved on this device. It uploads automatically when there is a connection.'} className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>{label}</span>;
}
/** Header chip: Online / Offline / Syncing / N pending / Needs attention. */
function SyncChip(){
  const s=useSync();
  const waiting=s.waiting+s.blocked;
  const label=!s.online?'Offline':s.syncing?'Syncing':s.attention.length?'Needs attention':waiting?`${waiting} pending`:'Online';
  const dot=!s.online?'bg-[#d9a23f]':s.attention.length?'bg-[#d9755e]':waiting||s.syncing?'bg-[#5b9bd5]':'bg-[#4cb7a3]';
  const title=!s.online?'No connection to CareTrack. Supported changes are saved on this device.':waiting?`${waiting} change${waiting===1?'':'s'} saved on this device, waiting to upload.`:'Connected. Everything is saved to CareTrack.';
  // A status label, not a button: plain text with a coloured dot (details are in the banner below the header).
  return <div data-testid="status-connection" role="status" aria-label={`Connection: ${label}`} data-online={s.online?'true':'false'} title={title} className="flex cursor-default select-none items-center gap-1.5 px-1 text-[11px] font-semibold text-[#57737c]"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot} ${s.syncing?'animate-pulse':''}`}/>{label}</div>;
}
/** Banner under the header: offline notice, upload progress, retries, and changes that need the user. */
function SyncBanner(){
  const s=useSync(),[open,setOpen]=useState(false),[now,setNow]=useState(Date.now());
  useEffect(()=>{if(!s.nextRetryAt)return;const t=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(t)},[s.nextRetryAt]);
  const n=(count:number)=>`${count} change${count===1?'':'s'}`;
  let tone:'offline'|'info'|'done'='info',text='';
  if(!s.online){tone='offline';text=`You’re offline. ${s.showingSavedAt?`Showing information saved on this device (last updated ${clock(s.showingSavedAt)}). It may not include the latest updates.`:'Showing information saved on this device.'} ${s.waiting?`${n(s.waiting)} saved on this device will upload automatically when you’re back online.`:'Dose updates, health readings, symptom notes and messages you enter are saved on this device and upload automatically.'}`}
  else if(s.syncing)text=`Uploading ${n(s.waiting)} saved on this device…`;
  else if(s.blocked){tone='offline';text=`Sign in again to upload ${n(s.blocked)} saved on this device.`}
  else if(s.retrying){tone='offline';text=`${n(s.retrying)} couldn’t upload yet. Retrying automatically${s.nextRetryAt?` in ${Math.max(1,Math.ceil((s.nextRetryAt-now)/1000))}s`:''}.`}
  else if(s.waiting)text=`${n(s.waiting)} waiting to upload…`;
  else if(s.justSynced){tone='done';text=`Back online. ${n(s.justSynced)} saved to CareTrack.`}
  if(!text&&!s.attention.length)return null;
  const colors={offline:'bg-[#fdf3dd] text-[#7a5a1c]',info:'bg-[#eef5fa] text-[#2f5d72]',done:'bg-[#e6f4ed] text-[#2f7a5d]'}[tone];
  return <div data-testid="banner-offline" data-tone={tone} role="status" className={`app-below-header sticky top-[68px] z-20 text-xs font-semibold ${colors}`}>
    {text&&<div className="flex items-center gap-2 px-4 py-2 sm:px-8">{s.online?<Wifi size={14} className="shrink-0"/>:<WifiOff size={14} className="shrink-0"/>}<span data-testid="text-sync-status" className="flex-1">{text}</span>{s.online&&(s.retrying>0||s.blocked>0)&&<button data-testid="button-sync-retry" onClick={()=>void retryAll()} className="shrink-0 rounded-lg border border-[#e6d3a8] bg-white/70 px-2.5 py-1 font-semibold">Retry now</button>}</div>}
    {s.attention.length>0&&<div className="border-t border-[#f3d4c9] bg-[#fff4f0] px-4 py-2 text-[#9a4b39] sm:px-8">
      <button data-testid="button-sync-review" onClick={()=>setOpen(!open)} className="flex w-full items-center gap-2 text-left"><CircleHelp size={14} className="shrink-0"/><span className="flex-1">{n(s.attention.length)} couldn’t be saved to CareTrack and need{s.attention.length===1?'s':''} your attention.</span><span className="underline">{open?'Hide':'Review'}</span></button>
      {open&&<ul className="mt-2 space-y-2 pb-1" data-testid="list-sync-attention">{s.attention.map(e=><li key={e.id} className="rounded-xl border border-[#f0cfc4] bg-white p-3 font-normal text-[#6b4a42]">
        <div className="font-semibold text-[#8a3f2f]">{e.label} <span className="font-normal text-[#a07a70]">· made {clock(new Date(e.capturedAt).getTime())}</span></div>
        <div className="mt-1">{e.lastError}</div>
        <div className="mt-2 flex flex-wrap gap-2">{e.state==='conflict'&&<button data-testid={`button-keep-mine-${e.id}`} onClick={()=>void keepMine(e.id)} className="rounded-lg bg-[#17647a] px-3 py-1.5 text-xs font-semibold text-white">Use my change instead</button>}<button data-testid={`button-discard-${e.id}`} onClick={()=>{if(e.state==='conflict'||window.confirm('Remove this change from this device? It was not saved to CareTrack.'))void discardChange(e.id)}} className="rounded-lg border border-[#e6c9c0] px-3 py-1.5 text-xs font-semibold">{e.state==='conflict'?'Keep the newer change':'Remove from this device'}</button></div>
      </li>)}</ul>}
    </div>}
  </div>;
}
/** After sign-in, downloads the main screens' data so they also open offline before being visited. */
function useWarmOfflineData(user?:AuthUser){
  useEffect(()=>{
    if(!user)return;
    let cancelled=false;
    const run=async()=>{
      if(!navigator.onLine)return;
      for(const path of ['/api/patients','/api/medications','/api/appointments','/api/notifications','/api/messages/threads',`/api/doses?date=${dateToday()}`]){if(cancelled)return;await customFetch(path).catch(()=>null)}
      if(user.role!=='patient'&&user.role!=='caregiver')return;
      const patients=await customFetch<Patient[]>('/api/patients').catch(()=>null);
      for(const p of (Array.isArray(patients)?patients:[]).slice(0,3))for(const path of [`/api/patients/${p.id}/health-metrics`,`/api/patients/${p.id}/health-logs`,`/api/patients/${p.id}/messages`,`/api/patients/${p.id}/medication-progress`]){if(cancelled)return;await customFetch(path).catch(()=>null)}
    };
    const online=()=>{void run()};
    void run();
    window.addEventListener('online',online);
    return()=>{cancelled=true;window.removeEventListener('online',online)};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[user?.id,user?.role]);
}

const RISK_COLORS:Record<string,string>={low:'#4bb19d',moderate:'#d6ad5b',high:'#cf7865'};
const RISK_PILL:Record<string,string>={low:'bg-[#e6f4ed] text-[#34785d]',moderate:'bg-[#fbf1df] text-[#99702f]',high:'bg-[#fbebe7] text-[#a75848]'};
function RiskLevelPill({level,score}:{level:string;score?:number}){return <span data-testid={`pill-ai-risk-${level}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${RISK_PILL[level]||RISK_PILL.low}`}><span className="h-2 w-2 rounded-full" style={{background:RISK_COLORS[level]}}/>{level} risk{score!==undefined?` · ${score}`:''}</span>}

/** How the AI works, the model's evaluation, and every patient's predicted risk. */
function AiInsightsPage(){
  const model=useGetRiskModel(),predictions=useListRiskPredictions(),train=useTrainRiskModel(),qc=useQueryClient();
  const [message,setMessage]=useState('');
  const m=model.data?.model;
  const retrain=()=>{setMessage('');train.mutate(undefined,{onSuccess:r=>{setMessage(r.message);qc.invalidateQueries({queryKey:getGetRiskModelQueryKey()});qc.invalidateQueries({queryKey:getListRiskPredictionsQueryKey()})},onError:err=>setMessage(apiError(err,'Training failed.'))})};
  const steps=[
    ['1','Collect','Dose logs: scheduled time, taken time, status (taken, missed, skipped, late).'],
    // The count comes from the model itself (15 today), so this text can't fall out of date.
    ['2','Extract features',`${model.data?.parameters?.length||15} parameters from each patient’s last 14 days, such as adherence, trend, missed streak, time-of-day misses, lateness, regimen complexity, age, conditions, and health readings (blood pressure, blood sugar).`],
    ['3','Train','Random Forest: 60 decision trees, each trained on a bootstrap sample and a random subset of features, splitting on Gini impurity.'],
    ['4','Predict','Each tree votes. The averaged probabilities give low / moderate / high risk of poor adherence in the next 7 days.'],
    ['5','Explain & act','Top risk factors, care-team recommendations, patient tasks, and alerts when a patient becomes high-risk.'],
  ];
  return <div className="page-enter">
    <PageHeading eyebrow="Artificial intelligence" title="AI risk prediction" description="A Random Forest model predicts which patients are likely to have poor medication adherence in the next 7 days, so the care team can act early." action={<button data-testid="button-retrain-model" onClick={retrain} disabled={train.isPending} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366] disabled:opacity-50"><Activity size={16}/>{train.isPending?'Training…':'Retrain model now'}</button>}/>
    {message&&<div role="status" data-testid="status-train" className="mb-5 rounded-xl border border-[#cfe7df] bg-[#eef8f4] px-4 py-3 text-sm text-[#37796b]">{message}</div>}
    <Card className="mb-5 p-5 sm:p-6"><h2 className="font-bold text-[#254954]">How the AI works</h2><div className="mt-4 grid gap-3 md:grid-cols-5">{steps.map(([n,title,body],i)=><div key={n} className="relative rounded-2xl border border-[#e3eded] bg-[#f8fbfb] p-4"><div className="grid h-7 w-7 place-items-center rounded-full bg-[#17647a] text-xs font-bold text-white">{n}</div><div className="mt-2 text-sm font-bold text-[#31535e]">{title}</div><p className="mt-1 text-[11px] leading-5 text-[#71888e]">{body}</p>{i<steps.length-1&&<ArrowRight size={16} className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-[#9fbcbf] md:block"/>}</div>)}</div></Card>
    {model.isLoading?<AnalyticsSkeleton/>:!m?<Card><EmptyState title="The model hasn’t been trained yet" body="It trains automatically once there are at least 3 weeks of dose history. You can also press “Retrain model now”." icon={Activity}/></Card>:<>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Model accuracy" value={m.oobAccuracy!==null?`${(m.oobAccuracy*100).toFixed(1)}%`:'—'} detail="Out-of-bag estimate on unseen samples" icon={ShieldCheck} accent="teal" progress={m.oobAccuracy!==null?m.oobAccuracy*100:undefined}/>
        <Metric label="Decision trees" value={`${m.trees}`} detail={`Max depth ${m.maxDepth}, Gini impurity`} icon={Activity} accent="blue"/>
        <Metric label="Training samples" value={`${m.samples}`} detail={`${m.classLow} low · ${m.classModerate} moderate · ${m.classHigh} high`} icon={ClipboardList} accent="gold"/>
        <Metric label="Last trained" value={timeLabel(m.trainedAt)} detail={`${new Date(m.trainedAt).toLocaleDateString()} · retrains every 6 hours`} icon={Clock3} accent="blue"/>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Feature importance</h2><p className="mt-1 text-xs text-[#81969b]">How much each patient parameter influences the prediction (mean decrease in Gini impurity)</p></div>
          <div className="px-2 py-4 sm:px-4" style={{height:Math.max(260,m.featureImportance.length*30+30)}} data-testid="chart-feature-importance"><ResponsiveContainer width="100%" height="100%"><BarChart data={m.featureImportance.map(f=>({...f,pct:Math.round(f.importance*1000)/10}))} layout="vertical" margin={{top:0,right:30,left:8,bottom:0}}><CartesianGrid stroke="#edf3f2" horizontal={false}/><XAxis type="number" unit="%" tick={{fontSize:11,fill:'#8da1a5'}} tickLine={false} axisLine={false}/><YAxis type="category" dataKey="label" width={150} tick={{fontSize:11,fill:'#4c6b73'}} tickLine={false} axisLine={false}/><Tooltip {...chartTooltip} formatter={(v)=>[`${v}%`,'Importance']}/><Bar dataKey="pct" fill="#17647a" radius={[0,6,6,0]} barSize={16}/></BarChart></ResponsiveContainer></div>
        </Card>
        <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Predicted risk, next 7 days</h2><p className="mt-1 text-xs text-[#81969b]">Highest risk first. Open a patient to see why.</p></div>
          {predictions.isLoading?<ListSkeleton/>:!(predictions.data||[]).length?<EmptyState title="No predictions yet" body="Predictions appear after the model is trained." icon={Users}/>:<div className="max-h-[480px] divide-y divide-[#edf2f2] overflow-y-auto">{(predictions.data||[]).map(p=><Link key={p.patientId} href={`/patients/${p.patientId}`} data-testid={`row-prediction-${p.patientId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[#f8fbfb] sm:px-6"><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-[#31535e]">{p.patientName}</div><div className="mt-0.5 truncate text-[11px] text-[#81969b]">{p.factors[0]?.text||'No notable risk factors'}</div></div><div className="hidden w-28 sm:block"><div className="flex h-2 overflow-hidden rounded-full bg-[#edf3f2]"><div style={{width:`${p.probLow*100}%`,background:RISK_COLORS.low}}/><div style={{width:`${p.probModerate*100}%`,background:RISK_COLORS.moderate}}/><div style={{width:`${p.probHigh*100}%`,background:RISK_COLORS.high}}/></div></div><RiskLevelPill level={p.riskLevel} score={p.riskScore}/></Link>)}</div>}
        </Card>
      </div>
      <Card className="mt-5 p-5 sm:p-6"><h2 className="font-bold text-[#254954]">Model parameters (inputs)</h2><div className="mt-3 flex flex-wrap gap-2">{(model.data?.parameters||[]).map(p=><span key={p} className="rounded-full border border-[#dce8e8] bg-[#f8fbfb] px-3 py-1 text-xs text-[#4c6b73]">{p}</span>)}</div><p className="mt-3 text-[11px] leading-5 text-[#8ba0a4]">Window: last {model.data?.windowDays} days → prediction horizon: next {model.data?.horizonDays} days. Labels: low ≥80%, moderate 50–79%, high &lt;50% of doses taken.</p></Card>
    </>}
    <p className="mt-5 text-xs leading-5 text-[#859a9e]">AI predictions support, not replace, clinical judgment. They estimate adherence risk only and do not diagnose conditions.</p>
  </div>;
}

/** Per-patient prediction, explanation and recommendations (care-team view). */
function AiRiskCard({patientId}:{patientId:number}){
  const risk=useGetPatientRisk(patientId,{query:{queryKey:getGetPatientRiskQueryKey(patientId)}});
  const p=risk.data?.prediction;
  return <Card testId="card-ai-risk" className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#458d89]"><Activity size={13}/> AI risk prediction · Random Forest</div><h2 className="mt-1 font-bold text-[#254954]">Adherence risk, next 7 days</h2></div>{p&&<RiskLevelPill level={p.riskLevel} score={p.riskScore}/>}</div>
    {risk.isLoading?<ListSkeleton/>:!p?<EmptyState title="No prediction yet" body="This patient needs about 5 logged doses in the last 14 days before the model can predict." icon={Activity}/>:<div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-2">
      <div><div className="text-[10px] font-bold uppercase tracking-wider text-[#7c9699]">Probability</div>{([['low',p.probLow],['moderate',p.probModerate],['high',p.probHigh]] as const).map(([k,v])=><div key={k} className="mt-2"><div className="mb-1 flex justify-between text-xs"><span className="capitalize text-[#4c6b73]">{k}</span><span className="font-semibold text-[#31535e]">{Math.round(v*100)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-[#edf3f2]"><div className="h-full rounded-full" style={{width:`${v*100}%`,background:RISK_COLORS[k]}}/></div></div>)}
        <div className="mt-3 rounded-lg bg-[#edf6f5] px-3 py-2 text-xs font-semibold text-[#397d7e]">Prediction confidence: {Math.round(p.confidence*100)}%</div>
        {(risk.data?.history||[]).length>1&&<div className="mt-4"><div className="text-[10px] font-bold uppercase tracking-wider text-[#7c9699]">Risk score trend</div><div className="h-16"><ResponsiveContainer width="100%" height="100%"><LineChart data={risk.data!.history}><YAxis hide domain={[0,100]}/><Line type="monotone" dataKey="riskScore" stroke="#17647a" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div></div>}
      </div>
      <div><div className="text-[10px] font-bold uppercase tracking-wider text-[#7c9699]">Why (top factors)</div>{p.factors.length?<ul className="mt-2 space-y-2">{p.factors.map(f=><li key={f.feature} className="flex gap-2 text-xs leading-5 text-[#4c6b73]"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#cf7865]"/>{f.text}</li>)}</ul>:<p className="mt-2 text-xs text-[#71888e]">No factor stands out. Adherence looks stable.</p>}
        <div className="mt-4 text-[10px] font-bold uppercase tracking-wider text-[#7c9699]">Recommended actions</div><ul className="mt-2 space-y-2">{(risk.data?.careRecommendations||[]).map((r,i)=><li key={i} className="flex gap-2 text-xs leading-5 text-[#31535e]"><Check size={13} className="mt-0.5 shrink-0 text-[#2f9a7f]"/>{r}</li>)}</ul></div>
    </div>}
    <div className="border-t border-[#edf2f2] px-5 py-3 text-[10px] text-[#91a4a8] sm:px-6">AI suggestions support, not replace, clinical judgment.</div>
  </Card>;
}

/** Patient-facing care plan: tasks from the AI factors, health tips, and the next check-up. */
function MyCarePlan({patientId}:{patientId:number}){
  const risk=useGetPatientRisk(patientId,{query:{queryKey:getGetPatientRiskQueryKey(patientId)}});
  const appts=useListAppointments();
  const next=(appts.data||[]).find(a=>a.patientId===patientId&&a.status==='scheduled'&&new Date(a.scheduledAt).getTime()>Date.now());
  return <Card testId="card-care-plan" className="mb-5 overflow-hidden"><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-[#458d89]"><HeartPulse size={13}/> My care plan</div><h2 className="mt-1 font-bold text-[#254954]">Tasks and tips for this week</h2></div>
    <div className="grid gap-5 p-5 sm:p-6 md:grid-cols-3">
      <div><div className="text-[10px] font-bold uppercase tracking-wider text-[#7c9699]">My tasks</div><ul className="mt-2 space-y-2">{(risk.data?.patientTasks||['Keep following your schedule.']).map((t,i)=><li key={i} className="flex gap-2 text-xs leading-5 text-[#31535e]"><span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border border-[#9fcfc9]"/>{t}</li>)}</ul></div>
      <div><div className="text-[10px] font-bold uppercase tracking-wider text-[#7c9699]">Health tips</div><ul className="mt-2 space-y-2">{(risk.data?.healthTips||[]).map((t,i)=><li key={i} className="flex gap-2 text-xs leading-5 text-[#4c6b73]"><HeartPulse size={13} className="mt-0.5 shrink-0 text-[#2f9a7f]"/>{t}</li>)}</ul></div>
      <div><div className="text-[10px] font-bold uppercase tracking-wider text-[#7c9699]">Next check-up</div>{next?<div className="mt-2 rounded-xl bg-[#eef5fa] p-3 text-xs text-[#2f5d72]"><div className="font-bold">{dateTimeLabel(next.scheduledAt,{weekday:'short',month:'short',day:'numeric'})}</div><div className="mt-1">{next.reason}</div>{next.providerName&&<div className="mt-1 text-[#5d7f8f]">with {next.providerName}</div>}</div>:<p className="mt-2 text-xs text-[#81969b]">No check-up scheduled.</p>}</div>
    </div></Card>;
}

/** File types and size the server accepts for prescriptions and lab results (see routes/care.ts). */
const LAB_FILE_TYPES=['application/pdf','image/png','image/jpeg','image/webp'],LAB_FILE_MAX=5*1024*1024;
/** Lab result files: patients upload, doctors review. Files are encrypted on the server. */
function LabResultsPanel({patientId,canUpload,canReview,category='lab'}:{patientId:number;canUpload:boolean;canReview:boolean;category?:'lab'|'prescription'}){
  const rx=category==='prescription';
  const labs=useListLabResults(patientId,{query:{queryKey:getListLabResultsQueryKey(patientId)}});
  const upload=useUploadLabResult(),review=useReviewLabResult(),qc=useQueryClient();
  const [title,setTitle]=useState(''),[file,setFile]=useState<File|null>(null),[error,setError]=useState(''),[done,setDone]=useState(''),[comment,setComment]=useState<Record<number,string>>({}),[open,setOpen]=useState(false),[dragging,setDragging]=useState(false);
  const pickRef=useRef<HTMLInputElement>(null),cameraRef=useRef<HTMLInputElement>(null);
  const refresh=()=>qc.invalidateQueries({queryKey:getListLabResultsQueryKey(patientId)});
  // Same rules as the server: PDF, PNG, JPG or WebP, up to 5 MB.
  const choose=(f:File|null|undefined)=>{setError('');setDone('');if(!f){setFile(null);return}
    const type=f.type||(/\.pdf$/i.test(f.name)?'application/pdf':/\.png$/i.test(f.name)?'image/png':/\.jpe?g$/i.test(f.name)?'image/jpeg':/\.webp$/i.test(f.name)?'image/webp':'');
    if(!LAB_FILE_TYPES.includes(type)){setFile(null);setError('Choose a PDF or a photo (PNG, JPG or WebP).');return}
    if(f.size===0){setFile(null);setError('That file is empty.');return}
    if(f.size>LAB_FILE_MAX){setFile(null);setError(`That file is ${(f.size/1048576).toFixed(1)} MB. The limit is 5 MB.`);return}
    setFile(f);setOpen(true);if(!title)setTitle(f.name.replace(/\.[^.]+$/,'').slice(0,120))};
  const reset=()=>{setTitle('');setFile(null);setError('');setOpen(false);if(pickRef.current)pickRef.current.value='';if(cameraRef.current)cameraRef.current.value=''};
  const submit=(e:FormEvent)=>{e.preventDefault();setError('');if(!file){setError('Choose a file first.');return}
    const type=file.type||(/\.pdf$/i.test(file.name)?'application/pdf':'image/jpeg');
    const reader=new FileReader();reader.onerror=()=>setError('That file couldn’t be read. Try choosing it again.');reader.onload=()=>{const data=String(reader.result).split(',')[1]||'';upload.mutate({id:patientId,data:{title:(title.trim()||file.name).slice(0,120),fileName:file.name,mimeType:type,dataBase64:data,category}},{onSuccess:(r)=>{reset();setDone(`“${r.title}” was uploaded and the ${rx?'patient was':'patient and care team were'} notified.`);refresh()},onError:err=>setError(apiError(err,err instanceof OfflineError?'Uploading files needs an internet connection. Try again when you’re online.':'Upload failed. Try again.'))})};reader.readAsDataURL(file)};
  const list=(labs.data||[]).filter(l=>l.category===category);
  const label=rx?'Upload prescription':'Upload lab result';
  return <Card testId={rx?'panel-prescription-files':'panel-lab-results'}><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><h2 className="font-bold text-[#254954]">{rx?'Prescription files':'Lab results'}</h2><p className="mt-1 flex items-center gap-1 text-xs text-[#81969b]"><ShieldCheck size={12}/> Encrypted. Only the patient and their care team can open these files.</p></div>{canUpload&&!open&&<button type="button" data-testid={rx?'button-open-prescription-upload':'button-open-lab-upload'} onClick={()=>setOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white hover:bg-[#125366]"><Plus size={14}/> {label}</button>}</div>
    {/* Hidden pickers. "Choose file" opens the phone's file/photo chooser (no forced camera, so PDFs
        can be picked on Android); "Take photo" opens the camera directly. */}
    {canUpload&&<><input ref={pickRef} data-testid={rx?'input-prescription-file':'input-lab-file'} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={e=>choose(e.target.files?.[0])}/><input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={e=>choose(e.target.files?.[0])}/></>}
    {done&&<div role="status" data-testid="status-lab-uploaded" className="mx-5 mt-4 flex items-start justify-between gap-2 rounded-xl border border-[#cfe7df] bg-[#eef8f4] px-3 py-2 text-xs text-[#37796b] sm:mx-6"><span>{done}</span><button type="button" aria-label="Dismiss" onClick={()=>setDone('')}><X size={14}/></button></div>}
    {canUpload&&open&&<form onSubmit={submit} className="space-y-3 border-b border-[#eaf0f0] bg-[#f8fbfb] p-5 sm:px-6" data-testid={rx?'form-prescription-upload':'form-lab-upload'}>
      <button type="button" data-testid={rx?'dropzone-prescription':'dropzone-lab'} onClick={()=>pickRef.current?.click()} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);choose(e.dataTransfer.files?.[0])}} className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition ${dragging?'border-[#17647a] bg-[#eef8f6]':'border-[#c8dcdc] bg-white hover:border-[#86c9c5] hover:bg-[#f6fbfa]'}`}>
        <FileText size={22} className="text-[#3c7c8d]"/>
        {file?<><span className="max-w-full truncate text-sm font-semibold text-[#31535e]" data-testid="text-selected-file">{file.name}</span><span className="text-[11px] text-[#81969b]">{(file.size/1024).toFixed(0)} KB · tap to choose a different file</span></>:<><span className="text-sm font-semibold text-[#31535e]">Tap to choose a file</span><span className="text-[11px] text-[#81969b]">PDF, PNG, JPG or WebP · up to 5 MB{' · '}or drag it here</span></>}
      </button>
      <button type="button" onClick={()=>cameraRef.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#dce8e8] bg-white px-3 text-xs font-semibold text-[#397d7e] hover:bg-[#f3f9f8]">📷 Take a photo instead</button>
      <label className="block text-xs font-semibold text-[#526f77]">{rx?'Title':'What test is this?'}<input data-testid={rx?'input-prescription-title':'input-lab-title'} value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} placeholder={rx?'e.g. Prescription – Oct 28 check-up':'e.g. CBC, Fasting blood sugar'} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal"/></label>
      {error&&<p role="alert" data-testid="status-lab-upload-error" className="text-xs text-red-700">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={reset} className="h-9 rounded-lg px-3 text-xs font-semibold text-[#6b8389]">Cancel</button><button data-testid={rx?'button-upload-prescription':'button-upload-lab'} disabled={upload.isPending||!file} className="h-9 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white disabled:opacity-50">{upload.isPending?'Uploading…':'Upload'}</button></div>
    </form>}
    {canUpload&&!open&&error&&<p role="alert" className="mx-5 mt-3 text-xs text-red-700 sm:mx-6">{error}</p>}
    {labs.isLoading?<ListSkeleton/>:labs.isError?<ErrorState retry={()=>labs.refetch()}/>:list.length===0&&canUpload&&!open?<button type="button" data-testid={rx?'button-empty-prescription-upload':'button-empty-lab-upload'} onClick={()=>setOpen(true)} className="m-5 flex w-[calc(100%-2.5rem)] flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#c8dcdc] px-5 py-8 text-center transition hover:border-[#86c9c5] hover:bg-[#f6fbfa] sm:mx-6 sm:w-[calc(100%-3rem)]"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#e8f5f2] text-[#358f88]"><Plus size={20}/></span><span className="text-sm font-semibold text-[#31535e]">{label}</span><span className="max-w-sm text-xs leading-5 text-[#83989e]">{rx?'Add a scanned or photographed prescription for the patient to view and keep.':'Add a photo or PDF of a laboratory result for this patient’s record.'}</span></button>:list.length===0?<EmptyState title={rx?'No prescription files yet':'No lab results yet'} body={rx?(canUpload?'Upload a scanned or photographed prescription for the patient to view and keep.':'Prescriptions your doctor uploads will appear here.'):canUpload?'Upload a photo or PDF of a laboratory result for the care team to review.':'Lab results uploaded by the patient will appear here.'} icon={FileText}/>:<div className="divide-y divide-[#edf2f2]">{list.map(l=><div key={l.id} data-testid={`row-lab-${l.id}`} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#eaf3f5] text-[#477f8e]"><FileText size={16}/></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-[#31535e]">{l.title}</div><div className="text-[11px] text-[#81969b]">{l.fileName} · {(l.sizeBytes/1024).toFixed(0)} KB · {l.uploadedByName} · {new Date(l.createdAt).toLocaleDateString()}</div></div><a href={`/api/lab-results/${l.id}/file`} onClick={nativeDownload(`/api/lab-results/${l.id}/file`,l.fileName)} target="_blank" rel="noreferrer" data-testid={`link-lab-file-${l.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dce8e8] px-2.5 text-[11px] font-semibold text-[#52747c] hover:bg-[#f4f8f8]"><Download size={13}/>Open</a></div>
      {rx?null:l.reviewComment?<div className="mt-2 rounded-lg bg-[#eef8f4] px-3 py-2 text-xs text-[#37796b]"><b>{l.reviewedByName}:</b> {l.reviewComment}</div>:canReview?<form onSubmit={e=>{e.preventDefault();const c=(comment[l.id]||'').trim();if(c)review.mutate({id:l.id,data:{comment:c}},{onSuccess:refresh})}} className="mt-2 flex gap-2"><input data-testid={`input-lab-review-${l.id}`} value={comment[l.id]||''} onChange={e=>setComment({...comment,[l.id]:e.target.value})} placeholder="Add your review…" className="h-9 flex-1 rounded-lg border border-input px-3 text-xs"/><button disabled={review.isPending} className="h-9 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white">Save review</button></form>:<div className="mt-2 text-[11px] text-[#99702f]">Waiting for the doctor’s review</div>}</div>)}</div>}
  </Card>;
}

/** Follow-up check-ups. Care team schedules; patients and caregivers see theirs. */
function AppointmentsPanel({user,patientId}:{user:AuthUser;patientId?:number}){
  const appts=useListAppointments(),patients=useListPatients(),create=useCreateAppointment(),update=useUpdateAppointment(),qc=useQueryClient();
  const canManage=user.role==='admin'||user.role==='provider';
  const [pid,setPid]=useState(patientId?String(patientId):''),[when,setWhen]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState('');
  const list=(appts.data||[]).filter(a=>!patientId||a.patientId===patientId);
  const upcoming=list.filter(a=>a.status==='scheduled'),past=list.filter(a=>a.status!=='scheduled');
  const refresh=()=>qc.invalidateQueries({queryKey:getListAppointmentsQueryKey()});
  const submit=(e:FormEvent)=>{e.preventDefault();setError('');create.mutate({data:{patientId:Number(pid),scheduledAt:new Date(when).toISOString(),reason}},{onSuccess:()=>{setWhen('');setReason('');refresh()},onError:err=>setError(apiError(err,'Could not schedule.'))})};
  const row=(a:Appointment)=><div key={a.id} data-testid={`row-appointment-${a.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#eef5fa] text-[#366a7d]"><CalendarDays size={16}/></div><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-[#31535e]">{dateTimeLabel(a.scheduledAt,{weekday:'short',month:'short',day:'numeric'})}{!patientId&&<span className="font-normal text-[#81969b]"> · {a.patientName}</span>}</div><div className="truncate text-xs text-[#81969b]">{a.reason}{a.providerName?` · ${a.providerName}`:''}</div></div>{a.status!=='scheduled'?<StatusPill status={a.status==='completed'?'taken':'skipped'}/>:canManage&&<div className="flex gap-1.5"><button onClick={()=>update.mutate({id:a.id,data:{status:'completed'}},{onSuccess:refresh})} className="rounded-lg border border-[#dce8e8] px-2.5 py-1.5 text-[11px] font-semibold text-[#2f8a74] hover:bg-[#eef8f4]">Done</button><button onClick={()=>{if(window.confirm('Cancel this check-up?'))update.mutate({id:a.id,data:{status:'cancelled'}},{onSuccess:refresh})}} className="rounded-lg border border-[#dce8e8] px-2.5 py-1.5 text-[11px] font-semibold text-[#a75848] hover:bg-red-50">Cancel</button></div>}</div>;
  return <Card testId="panel-appointments"><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Follow-up check-ups</h2><p className="mt-1 text-xs text-[#81969b]">Reminders are sent a day before</p></div>
    {canManage&&<form onSubmit={submit} className="grid gap-2 border-b border-[#eaf0f0] bg-[#f8fbfb] p-4 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:px-6">{!patientId&&<select data-testid="select-appointment-patient" required value={pid} onChange={e=>setPid(e.target.value)} className="h-9 rounded-lg border border-input bg-white px-2 text-xs"><option value="" disabled>Patient</option>{(patients.data||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}<input data-testid="input-appointment-when" type="datetime-local" min={dateTimeNow()} required value={when} onChange={e=>{if(e.target.value>=dateTimeNow())setWhen(e.target.value)}} className="h-9 rounded-lg border border-input bg-white px-2 text-xs"/><input data-testid="input-appointment-reason" required maxLength={200} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason, e.g. BP follow-up" className={`h-9 rounded-lg border border-input bg-white px-2 text-xs ${patientId?'sm:col-span-2':''}`}/><button data-testid="button-create-appointment" disabled={create.isPending} className="h-9 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white disabled:opacity-50">Schedule</button>{error&&<p className="text-xs text-red-700 sm:col-span-4">{error}</p>}</form>}
    {appts.isLoading?<ListSkeleton/>:list.length===0?<EmptyState title="No check-ups" body={canManage?'Schedule a follow-up above.':'Your doctor will schedule your next check-up here.'} icon={CalendarDays}/>:<div className="divide-y divide-[#edf2f2]">{upcoming.map(row)}{past.slice(-5).reverse().map(row)}</div>}
  </Card>;
}
function AppointmentsPage({user}:{user:AuthUser}){return <div className="page-enter"><PageHeading eyebrow="Follow-up care" title="Check-ups" description="Upcoming and past follow-up check-ups. Patients get a reminder one day before."/><AppointmentsPanel user={user}/></div>}

const FREQ_TEXT=(m:Medication)=>m.frequency==='every_hours'?`every ${m.intervalHours||'?'} hours`:m.frequency==='specific_days'?`on ${(m.daysOfWeek||[]).map(d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}`:`${m.timesPerDay}× a day`;
/** A printable prescription built from the medications the doctor prescribed. */
function DigitalPrescription({patientId}:{patientId:number}){
  const meds=useListMedications({patientId},{query:{queryKey:getListMedicationsQueryKey({patientId})}});
  const patient=useGetPatient(patientId,{query:{queryKey:getGetPatientQueryKey(patientId)}});
  const p=patient.data as Patient|undefined;
  const today=dateToday();
  const list=(meds.data||[]).filter(m=>m.active&&(!m.endDate||m.endDate>=today));
  const ended=(meds.data||[]).filter(m=>!list.includes(m)).slice(0,5);
  const doctors=[...new Set(list.map(m=>m.prescribedByName).filter(Boolean))] as string[];
  return <Card testId="card-digital-prescription" className="print-area overflow-hidden">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-[#17647a] bg-[#f4f9f9] px-5 py-4 sm:px-6"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#17647a] font-serif text-2xl font-bold text-white">℞</div><div><div className="text-lg font-extrabold text-[#173d4a]">Prescription</div><div className="text-xs text-[#5f7d83]">CareTrack digital prescription · {new Date().toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})}</div></div></div><button data-testid="button-print-prescription" onClick={()=>window.print()} className="no-print inline-flex h-9 items-center gap-2 rounded-lg border border-[#c8e2df] bg-white px-3 text-xs font-semibold text-[#247b79] hover:bg-[#eef9f6]"><Download size={14}/> Print / save as PDF</button></div>
    {p&&<div className="grid gap-3 border-b border-[#eaf0f0] px-5 py-3 text-xs sm:grid-cols-4 sm:px-6"><Info label="Patient" value={p.name}/><Info label="Age / Sex" value={`${p.age} / ${p.sex.replace('_',' ')}`}/><Info label="Allergies" value={p.allergies?.join(', ')||'None recorded'}/><Info label="Doctor" value={doctors.join(', ')||p.assignedProviderName||'—'}/></div>}
    {meds.isLoading?<ListSkeleton/>:list.length===0?<EmptyState title="No active prescriptions" body="Medicines your doctor prescribes will appear here." icon={Pill}/>:<ol className="divide-y divide-[#edf2f2]">{list.map((m,i)=><li key={m.id} data-testid={`rx-item-${m.id}`} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-baseline gap-x-2"><span className="text-xs font-bold text-[#8ba0a4]">{i+1}.</span><span className="text-base font-bold text-[#173d4a]">{m.name}</span><span className="text-sm font-semibold text-[#31535e]">{m.dosage}</span><span className="text-xs text-[#81969b]">{m.form}</span></div>
      <div className="mt-1.5 pl-5 text-sm text-[#31535e]"><span className="font-semibold text-[#17647a]">Sig:</span> Take {m.dosage} {FREQ_TEXT(m)}{m.scheduleTimes?.length?` at ${m.scheduleTimes.map(clock12).join(', ')}`:''}{m.endDate?` for ${Math.round((new Date(m.endDate).getTime()-new Date(m.startDate).getTime())/86_400_000)+1} days`:''}.</div>
      {m.instructions&&<div className="mt-1 pl-5 text-xs italic text-[#5f7d83]">{m.instructions}</div>}
      {m.sideEffects&&<div data-testid={`rx-side-effects-${m.id}`} className="ml-5 mt-2 rounded-lg border border-[#f0dfb8] bg-[#fdf7ea] px-3 py-2 text-xs leading-5 text-[#7a5a1c]"><b>Side effects to watch for:</b> <span className="whitespace-pre-line">{m.sideEffects}</span></div>}
      <div className="mt-1 pl-5 text-[11px] text-[#91a4a8]">From {m.startDate}{m.endDate?` to ${m.endDate}`:' (ongoing)'}{m.prescribedByName?` · Prescribed by ${m.prescribedByName}`:''}</div></li>)}</ol>}
    {ended.length>0&&<div className="no-print border-t border-[#eaf0f0] px-5 py-3 text-[11px] text-[#91a4a8] sm:px-6">Past or stopped: {ended.map(m=>`${m.name} ${m.dosage}`).join(' · ')}</div>}
    <div className="border-t border-[#eaf0f0] px-5 py-3 text-[10px] leading-4 text-[#91a4a8] sm:px-6">Generated from the medication schedule entered by the care team. For a signed paper prescription, see the files your doctor uploaded.</div>
  </Card>;
}
function PrescriptionsPage({user}:{user:AuthUser}){
  const patients=useListPatients();
  const patient=(patients.data||[])[0];
  return <div className="page-enter"><PageHeading eyebrow="Your medicines" title="My prescriptions" description="Your current prescription and any prescription files uploaded by your doctor."/>
    {patients.isLoading?<DetailSkeleton/>:!patient?<Card><EmptyState title="No care profile linked" body="Ask your care team to link your account to your patient profile." icon={Pill}/></Card>:<div className="space-y-5"><DigitalPrescription patientId={patient.id}/><LabResultsPanel patientId={patient.id} canUpload={false} canReview={false} category="prescription"/></div>}
    {user.role==='caregiver'&&<p className="mt-4 text-xs text-[#859a9e]">You’re viewing the prescriptions of the patient linked to your caregiver account.</p>}
  </div>;
}

function PatientsPage({user}:{user:AuthUser}){
  const query=useListPatients(), delPatient=useDeletePatient(), qc=useQueryClient(), [search,setSearch]=useState(''), [open,setOpen]=useState(false), [editing,setEditing]=useState<Patient|null>(null);
  const [accountOpen,setAccountOpen]=useState(false), [accountPatient,setAccountPatient]=useState<Patient|null>(null);
  const [riskFilter,setRiskFilter]=useState('all');
  // Risk status per patient from the last 30 days of adherence.
  const riskParams={from:daysAgo(29),to:dateToday()};
  const risk=useGetAnalytics(riskParams,{query:{queryKey:getGetAnalyticsQueryKey(riskParams)}});
  const riskOf=(id:number)=>(risk.data as Analytics|undefined)?.riskPatients.find(r=>r.patientId===id);
  const levelOf=(id:number)=>riskOf(id)?.riskLevel||'none';
  const providerMode=user.role==='provider'||user.role==='admin';
  const matching=(query.data||[]).filter(p=>`${p.name} ${p.conditions?.join(' ')||''} ${p.assignedProviderName||''}`.toLowerCase().includes(search.toLowerCase()));
  const patients=matching.filter(p=>riskFilter==='all'||levelOf(p.id)===riskFilter);
  const riskChips:[string,string][]=[['all','All'],['red','Critical'],['yellow','Needs attention'],['green','Stable'],['none','No data']];
  const start=(p?:Patient)=>{setEditing(p||null);setOpen(true)};
  return <div className="page-enter">
    <PageHeading eyebrow="Care relationships" title="Patients" description="Keep patient details and care relationships in one clear place." action={providerMode?<button data-testid="button-add-patient" onClick={()=>start()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366]"><Plus size={16}/> Add patient</button>:undefined}/>
    <Card>
      <div className="flex flex-col gap-4 border-b border-[#eaf0f0] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><h2 className="font-bold text-[#254954]">Patient directory</h2><p className="mt-1 text-xs text-[#81969b]">{query.data?.length||0} profiles in your care</p></div><label className="flex h-10 w-full items-center gap-2 rounded-xl border border-[#dce8e8] bg-[#fbfdfd] px-3 sm:max-w-[300px]"><Search size={16} className="text-[#81969b]"/><input data-testid="input-search-patients" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search patients…" className="w-full bg-transparent text-sm outline-none placeholder:text-[#a3b3b6]"/></label></div>
      <div className="flex flex-wrap gap-2 border-b border-[#eaf0f0] px-5 py-3 sm:px-6" role="group" aria-label="Filter by status">{riskChips.map(([id,label])=>{const n=id==='all'?matching.length:matching.filter(p=>levelOf(p.id)===id).length;const dot=RISK_STYLE[id]?.dot;return <button key={id} data-testid={`button-risk-filter-${id}`} aria-pressed={riskFilter===id} onClick={()=>setRiskFilter(id)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${riskFilter===id?'border-[#17647a] bg-[#17647a] text-white':'border-[#dce8e8] bg-white text-[#55737a] hover:border-[#9fcfc9]'}`}>{dot&&<span className={`h-2 w-2 rounded-full ${dot}`}/>}{label}<span className="opacity-70">{n}</span></button>})}<span className="ml-auto self-center text-[11px] text-[#91a4a8]">Based on the last 30 days</span></div>
      {query.isLoading?<div className="space-y-3 p-5" data-testid="status-loading">{[1,2,3].map(x=><div key={x} className="h-20 animate-pulse rounded-xl bg-[#f2f6f6]"/>)}</div>:query.isError?<ErrorState retry={()=>query.refetch()}/>:patients.length===0?<EmptyState title={search||riskFilter!=='all'?'No matching patients':'Your directory is ready'} body={search||riskFilter!=='all'?'Try a different search or status filter.':'Patients assigned to your care team will appear here.'} icon={Users}/>:<div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">{patients.map(p=><div key={p.id} data-testid={`card-patient-${p.id}`} className="rounded-2xl border border-[#e3eded] bg-white p-4 transition hover:border-[#b7d9d6] hover:shadow-[0_8px_22px_rgba(31,74,88,.06)]"><div className="flex items-start gap-3"><Avatar name={p.name}/><div className="min-w-0 flex-1"><Link href={`/patients/${p.id}`} data-testid={`link-patient-${p.id}`} className="block truncate text-sm font-bold text-[#31535e] hover:text-[#19777d]">{p.name}</Link><div className="mt-1 text-xs text-[#81969b]">{p.age} years · {p.sex.replace('_',' ')}</div></div><StatusPill status={p.active?'active':'inactive'}/></div><div className="mt-3"><RiskBadge level={levelOf(p.id)} suffix={riskOf(p.id)?`${riskOf(p.id)!.adherenceRate}%`:undefined}/></div><div className="mt-3 min-h-10 text-xs leading-5 text-[#758d93]">{p.conditions?.length?p.conditions.slice(0,2).join(' · '):'No conditions listed'}</div><div className="mt-3 flex items-center justify-between border-t border-[#edf2f2] pt-3"><span className="min-w-0 truncate text-[11px] text-[#8ba0a4]">{p.assignedProviderName||'Doctor not assigned'}{p.coveringProviderName&&<span className="ml-1 rounded-full bg-[#e9f2f6] px-1.5 py-0.5 font-semibold text-[#366a7d]" title={`${p.assignedProviderName} is away`}>Covering: {p.coveringProviderName}</span>}</span><div className="flex flex-wrap items-center gap-1"><Link href={`/patients/${p.id}`} data-testid={`button-view-patient-${p.id}`} className="rounded-lg px-2 py-1 text-xs font-semibold text-[#287d80] hover:bg-[#eef8f6]">View profile</Link>{providerMode&&<>
          {!p.userId&&<button data-testid={`button-card-account-patient-${p.id}`} onClick={()=>{setAccountPatient(p);setAccountOpen(true)}} className="rounded-lg bg-[#e8f3f5] px-2 py-1 text-xs font-semibold text-[#17647a] hover:bg-[#d8eef3]">Add login</button>}
          <button data-testid={`button-edit-patient-${p.id}`} onClick={()=>start(p)} className="rounded-lg px-2 py-1 text-xs font-semibold text-[#728990] hover:bg-[#f3f7f7]">Edit</button>
          <button data-testid={`button-delete-patient-${p.id}`} onClick={()=>{if(!window.confirm(`Permanently delete ${p.name}? This will remove all medication records.`))return;delPatient.mutate({id:p.id},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListPatientsQueryKey()});qc.invalidateQueries({queryKey:getListUsersQueryKey()})}})}} className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">Delete</button>
        </>}</div></div></div>)}</div>}
    </Card>
    {open&&<PatientModal patient={editing} onClose={()=>setOpen(false)}/>}
    {accountOpen&&<CreatePatientAccountModal initialPatient={accountPatient} user={user} onClose={()=>setAccountOpen(false)}/>}
  </div>;
}

function PatientModal({patient,onClose}:{patient:Patient|null;onClose:()=>void}){
  const create=useCreatePatient(), update=useUpdatePatient(), createAccount=useCreatePatientAccount(), qc=useQueryClient(), providers=useListProviders();
  const [error,setError]=useState('');
  const [createLogin,setCreateLogin]=useState(false);
  const [tempPassword,setTempPassword]=useState(generateTempPassword());
  const [createdCredentials,setCreatedCredentials]=useState<{email:string;password:string;name:string}|null>(null);

  const submit=(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    const data={
      name:String(f.get('name')),
      age:Number(f.get('age')),
      sex:String(f.get('sex')) as 'female'|'male'|'other'|'not_specified',
      phone:String(f.get('phone')||''),
      conditions:String(f.get('conditions')||'').split(',').map(x=>x.trim()).filter(Boolean),
      allergies:String(f.get('allergies')||'').split(',').map(x=>x.trim()).filter(Boolean),
      notes:String(f.get('notes')||'')
    };
    const emailValue=String(f.get('email')||'').trim();
    const rawAssignedId=f.get('assignedProviderId');
    const assignedProviderIdValue=rawAssignedId?Number(rawAssignedId):undefined;

    if(patient){
      update.mutate({
        id:patient.id,
        data:{
          ...data,
          email:emailValue||null,
          assignedProviderId:assignedProviderIdValue
        }
      },{
        onSuccess:()=>{
          qc.invalidateQueries({queryKey:getListPatientsQueryKey()});
          qc.invalidateQueries({queryKey:getGetPatientQueryKey(patient.id)});
          onClose();
        },
        onError:()=>setError('Could not save patient details. Please try again.')
      });
    } else {
      create.mutate({
        data:{
          ...data,
          assignedProviderId:assignedProviderIdValue,
          ...(emailValue?{email:emailValue}:{})
        }
      },{
        onSuccess:(newPatient)=>{
          qc.invalidateQueries({queryKey:getListPatientsQueryKey()});
          if(createLogin && emailValue){
            createAccount.mutate({
              id:newPatient.id,
              data:{email:emailValue,password:tempPassword,phone:data.phone||null}
            },{
              onSuccess:(r)=>{
                qc.invalidateQueries({queryKey:getListPatientsQueryKey()});
                qc.invalidateQueries({queryKey:getListUsersQueryKey()});
                setCreatedCredentials({email:r.email,password:tempPassword,name:newPatient.name});
              },
              onError:(err)=>{
                setError(`Patient saved, but login could not be created: ${apiError(err,'Check email')}`);
              }
            });
          } else {
            onClose();
          }
        },
        onError:(err)=>setError(apiError(err,'Could not create this patient. Please try again.'))
      });
    }
  };

  const busy=create.isPending||update.isPending||createAccount.isPending;

  if(createdCredentials){
    return <Modal title="Patient & Account Created" subtitle="Share these mobile sign-in details with the patient." onClose={onClose}>
      <div className="space-y-4" data-testid="panel-patient-created-with-account">
        <div className="rounded-xl border border-[#cfe7df] bg-[#eef8f4] p-4 text-sm text-[#37796b]">
          <div className="font-semibold">{createdCredentials.name}</div>
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <span className="text-[#5d8f86]">Email</span>
            <span className="font-mono">{createdCredentials.email}</span>
            <span className="text-[#5d8f86]">Temporary password</span>
            <span className="font-mono font-bold" data-testid="text-temp-password">{createdCredentials.password}</span>
          </div>
        </div>
        <p className="text-xs leading-5 text-[#71888e]">The patient profile was created and their mobile login is ready. They can sign into CareTrack on Android and will set their own permanent password.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={()=>navigator.clipboard?.writeText(`Email: ${createdCredentials.email}\nTemporary password: ${createdCredentials.password}`)} className="h-10 rounded-lg border border-[#dce8e8] px-4 text-sm font-semibold text-[#52737c] hover:bg-[#f5f9f9]">Copy details</button>
          <button type="button" data-testid="button-done-patient-created" onClick={onClose} className="h-10 rounded-lg bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366]">Done</button>
        </div>
      </div>
    </Modal>;
  }

  return <Modal title={patient?'Edit patient profile':'Add a patient'} subtitle="A clear profile helps the care team stay in sync." onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Full name" name="name" required defaultValue={patient?.name}/><Field label="Age" name="age" type="number" required defaultValue={patient?.age||''}/></div>
    <div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs font-semibold text-[#526f77]">Sex<select name="sex" defaultValue={patient?.sex||'not_specified'} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal text-[#31515c]"><option value="not_specified">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label><Field label="Phone" name="phone" defaultValue={patient?.phone||''}/></div>
    <Field label="Email" name="email" type="email" required={createLogin} defaultValue={patient?.email||''}/>
    <label className="block text-xs font-semibold text-[#526f77]">Assigned doctor<select name="assignedProviderId" data-testid="select-assigned-doctor" defaultValue={patient?.assignedProviderId||''} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal text-[#31515c]"><option value="">{patient?'Leave unassigned':'Assign automatically'}</option>{(providers.data||[]).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>{!patient&&<span className="mt-1 block font-normal text-[#8ba0a4]">To request a permanent transfer later, use Doctor coverage.</span>}</label>
    <Field label="Conditions (comma separated)" name="conditions" defaultValue={patient?.conditions?.join(', ')||''}/><Field label="Allergies (comma separated)" name="allergies" defaultValue={patient?.allergies?.join(', ')||''}/><label className="block text-xs font-semibold text-[#526f77]">Care notes<textarea name="notes" defaultValue={patient?.notes||''} rows={3} className="mt-1.5 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm font-normal outline-none focus:border-primary"/></label>
    {!patient&&<div className="rounded-xl border border-[#dce8e8] bg-[#f9fcfa] p-3.5"><label className="flex items-center gap-2.5 text-xs font-bold text-[#2e525a] cursor-pointer"><input type="checkbox" data-testid="checkbox-create-patient-account" checked={createLogin} onChange={(e)=>setCreateLogin(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-[#17647a] focus:ring-[#17647a]"/> Create patient sign-in account now</label><p className="mt-1 text-[11px] text-[#789196] pl-6.5">Generates mobile login credentials immediately so the patient can log their doses.</p>{createLogin&&<div className="mt-3 space-y-3 pt-3 border-t border-[#e2eded]"><div><div className="flex items-center justify-between"><span className="text-xs font-semibold text-[#526f77]">Temporary password</span><button type="button" data-testid="button-generate-modal-password" onClick={()=>setTempPassword(generateTempPassword())} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#287d80] hover:underline"><KeyRound size={12}/> Generate</button></div><PasswordInput testId="input-modal-patient-password" value={tempPassword} onChange={setTempPassword} required minLength={8} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal outline-none focus:border-primary"/></div></div>}</div>}
    {error&&<div role="alert" data-testid="status-patient-form-error" className="text-xs text-red-700">{error}</div>}<ModalActions onClose={onClose} busy={busy} submitLabel={patient?'Save changes':'Add patient'}/>
  </form></Modal>;
}

const PATIENT_TABS=[
  {id:'overview',label:'Overview'},
  {id:'personal',label:'Personal information'},
  {id:'schedule',label:'Medication schedule'},
  {id:'history',label:'Medication history'},
  {id:'adherence',label:'Adherence records'},
  {id:'reports',label:'Reports & results'},
] as const;
type PatientTab=typeof PATIENT_TABS[number]['id'];
type PatientWithRecords=Patient&{medications:Medication[];recentDoses:Dose[]};
const isCurrentMed=(m:Medication)=>m.active&&(!m.endDate||m.endDate>=dateToday());

function PatientDetailPage({user}:{user:AuthUser}){
  const params=useParams<{id:string}>(), id=Number(params.id)||0;
  const query=useGetPatient(id,{query:{enabled:!!id,queryKey:getGetPatientQueryKey(id)}});
  const patient=query.data as PatientWithRecords|undefined;
  const [edit,setEdit]=useState(false);
  // The open tab is kept in the address (?tab=schedule), so links and the back button work.
  const fromUrl=()=>{const t=new URLSearchParams(window.location.search).get('tab');return (PATIENT_TABS.some(x=>x.id===t)?t:'overview') as PatientTab};
  const [tab,setTabState]=useState<PatientTab>(fromUrl);
  useEffect(()=>{const onPop=()=>setTabState(fromUrl());window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop)},[]);
  const setTab=(t:PatientTab)=>{setTabState(t);const url=new URL(window.location.href);if(t==='overview')url.searchParams.delete('tab');else url.searchParams.set('tab',t);window.history.replaceState(window.history.state,'',`${url.pathname}${url.search}`)};
  const canManage=user.role==='admin'||user.role==='provider';
  if(query.isLoading)return <DetailSkeleton/>;
  if(query.isError||!patient)return <div><Link href="/patients" data-testid="link-back-patients" className="mb-5 inline-flex items-center gap-2 text-sm text-[#47737b]"><ArrowLeft size={16}/> Patients</Link><Card><ErrorState retry={()=>query.refetch()}/></Card></div>;
  const current=(patient.medications||[]).filter(isCurrentMed);
  const chip='rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold';
  return <div className="page-enter"><Link href="/patients" data-testid="link-back-patients" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#47737b] hover:text-primary"><ArrowLeft size={16}/> Patient directory</Link>
    {/* Header: who this is, plus the facts needed on every tab (doctor, conditions, allergies). */}
    <div className="mb-4 rounded-3xl bg-[#174b5b] p-5 text-white sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/10 text-lg font-bold">{initials(patient.name)}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-extrabold tracking-tight" data-testid="text-patient-detail-name">{patient.name}</h1><span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#a6e5d9]">{patient.active?'Active':'Inactive'}</span></div><p className="mt-1 text-sm text-white/65">{patient.age} years · {patient.sex.replace('_',' ')}{patient.phone?` · ${patient.phone}`:''}</p></div></div>
        <div className="flex flex-wrap gap-2"><Link href={`/messages?patient=${patient.id}`} data-testid="button-message-patient" className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#174b5b] hover:bg-[#e8f4f2]"><MessageSquare size={16}/> Messages</Link>{canManage&&<button data-testid="button-edit-patient-detail" onClick={()=>setEdit(true)} className="h-10 rounded-xl border border-white/20 px-4 text-sm font-semibold hover:bg-white/10">Edit profile</button>}</div></div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4 text-white/85"><span className={chip}><Stethoscope size={12} className="mr-1 inline"/>{patient.assignedProviderName||'No doctor assigned'}{patient.coveringProviderName?` · covered by ${patient.coveringProviderName}`:''}</span><span className={chip}>Conditions: {patient.conditions?.join(', ')||'None listed'}</span><span data-testid="text-patient-allergies" className={`${chip} ${patient.allergies?.length?'bg-[#f6c9bd]/25 text-[#ffe3db]':''}`}>Allergies: {patient.allergies?.join(', ')||'None recorded'}</span><span className={chip}><Pill size={12} className="mr-1 inline"/>{current.length} active medication{current.length===1?'':'s'}</span></div>
    </div>
    {/* Tabs: scroll sideways on small screens instead of wrapping into several rows. */}
    <div role="tablist" aria-label="Patient profile sections" className="sidebar-scroll -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-[#dfebeb] px-4 sm:mx-0 sm:px-0">{PATIENT_TABS.map(t=><button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab===t.id} aria-controls={`panel-${t.id}`} data-testid={`tab-patient-${t.id}`} onClick={()=>setTab(t.id)} className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-3 text-sm font-semibold transition ${tab===t.id?'border-[#17647a] text-[#17647a]':'border-transparent text-[#6c858b] hover:text-[#31535e]'}`}>{t.label}{t.id==='schedule'&&current.length>0&&<span className="ml-1.5 rounded-full bg-[#e4f4f0] px-1.5 py-0.5 text-[10px] font-bold text-[#25867c]">{current.length}</span>}</button>)}</div>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} data-testid={`panel-patient-${tab}`}>
      {tab==='overview'&&<PatientOverviewTab user={user} patient={patient} onOpen={setTab}/>}
      {tab==='personal'&&<div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]"><div className="space-y-5"><PatientPersonalCard patient={patient}/>{canManage&&<PatientLoginCard key={patient.id} patient={patient}/>}</div><HealthMetricsPanel patientId={patient.id} canRecord={user.role==='admin'||user.role==='provider'||user.role==='patient'||user.role==='caregiver'}/></div>}
      {tab==='schedule'&&<PatientScheduleTab user={user} patient={patient}/>}
      {tab==='history'&&<PatientHistoryTab patient={patient}/>}
      {tab==='adherence'&&<div className="space-y-5"><PatientAdherenceStats patientId={patient.id}/><MedicationProgressPanel patientId={patient.id} canAdd={canManage}/><PatientInsightPanel patient={patient} patientFacing={false} canGenerate={canManage}/></div>}
      {tab==='reports'&&<div className="grid gap-5 xl:grid-cols-2"><PatientReportsCard user={user} patient={patient}/><LabResultsPanel patientId={patient.id} canUpload={canManage} canReview={canManage}/></div>}
    </div>
    {edit&&<PatientModal patient={patient} onClose={()=>setEdit(false)}/>}
  </div>;
}

/** Overview: the numbers and today's plan at a glance, with the medication schedule near the top. */
function PatientOverviewTab({user,patient,onOpen}:{user:AuthUser;patient:PatientWithRecords;onOpen:(t:PatientTab)=>void}){
  const params={date:dateToday(),patientId:patient.id};
  const doses=useListDoses(params,{query:{queryKey:getListDosesQueryKey(params)}});
  const range={from:daysAgo(29),to:dateToday(),patientId:patient.id};
  const analytics=useGetAnalytics(range,{query:{queryKey:getGetAnalyticsQueryKey(range)}});
  const appts=useListAppointments();
  const today=doses.data||[], taken=today.filter(d=>d.status==='taken').length;
  const rate=(analytics.data as Analytics|undefined)?.adherenceRate;
  const next=(appts.data||[]).filter(a=>a.patientId===patient.id&&a.status==='scheduled'&&new Date(a.scheduledAt).getTime()>Date.now()).sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt))[0];
  const current=(patient.medications||[]).filter(isCurrentMed);
  const tile='rounded-2xl border border-[#e0ebeb] bg-white p-4 care-shadow';
  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <button type="button" onClick={()=>onOpen('adherence')} className={`${tile} text-left transition hover:border-[#9fcfc9]`}><div className="text-xs font-semibold text-[#789098]">30-day adherence</div><div className="mt-2 text-2xl font-extrabold text-[#214754]">{rate===undefined?'—':`${Math.round(rate)}%`}</div>{rate!==undefined&&<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#edf3f2]"><div className="h-full rounded-full" style={{width:`${rate}%`,background:riskColor(rate)}}/></div>}</button>
      <button type="button" onClick={()=>onOpen('schedule')} className={`${tile} text-left transition hover:border-[#9fcfc9]`}><div className="text-xs font-semibold text-[#789098]">Active medications</div><div className="mt-2 text-2xl font-extrabold text-[#214754]">{current.length}</div><div className="mt-1 text-[11px] text-[#7d9297]">View schedule →</div></button>
      <div className={tile}><div className="text-xs font-semibold text-[#789098]">Today’s doses</div><div className="mt-2 text-2xl font-extrabold text-[#214754]">{doses.isLoading?'…':`${taken} / ${today.length}`}</div><div className="mt-1 text-[11px] text-[#7d9297]">taken so far</div></div>
      <div className={tile}><div className="text-xs font-semibold text-[#789098]">Next check-up</div><div className="mt-2 text-sm font-bold leading-5 text-[#214754]">{next?dateTimeLabel(next.scheduledAt,{weekday:'short',month:'short',day:'numeric'}):'None scheduled'}</div>{next&&<div className="mt-1 truncate text-[11px] text-[#7d9297]">{next.reason}</div>}</div>
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <Card><div className="flex items-center justify-between border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><h2 className="font-bold text-[#254954]">Today’s doses</h2><p className="mt-1 text-xs text-[#81969b]">View only. The patient logs each dose.</p></div></div>{doses.isLoading?<ListSkeleton/>:doses.isError?<ErrorState retry={()=>doses.refetch()}/>:today.length===0?<EmptyState title="No doses today" body="Active schedules will show today’s doses here."/>:<div className="divide-y divide-[#edf2f2]">{today.map(d=><DoseRow key={d.id} dose={d} compact readOnly role={user.role}/>)}</div>}</Card>
      <AiRiskCard patientId={patient.id}/>
    </div>
    <Card><div className="flex items-center justify-between gap-3 border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><h2 className="font-bold text-[#254954]">Medication schedule</h2><p className="mt-1 text-xs text-[#81969b]">Current medicines, doses and times</p></div><button type="button" data-testid="button-open-schedule-tab" onClick={()=>onOpen('schedule')} className="inline-flex items-center gap-1 text-xs font-semibold text-[#287f83] hover:underline">Full schedule <ArrowRight size={14}/></button></div>{current.length?<MedicationTable meds={current} patientName={()=>patient.name} editable={false} onEdit={()=>undefined} showPatient={false}/>:<EmptyState title="No active medications" body="Active medication schedules will appear here." icon={Pill}/>}</Card>
    <AppointmentsPanel user={user} patientId={patient.id}/>
  </div>;
}

/** Personal and contact details, care team, conditions, allergies and notes. */
function PatientPersonalCard({patient}:{patient:PatientWithRecords}){
  return <Card className="p-5 sm:p-6" testId="card-patient-personal"><h2 className="font-bold text-[#254954]">Personal information</h2>
    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4"><Info label="Full name" value={patient.name}/><Info label="Age / Sex" value={`${patient.age} / ${patient.sex.replace('_',' ')}`}/><Info label="Phone" value={patient.phone||'Not provided'}/><Info label="Email" value={patient.email||'Not provided'}/><Info label="Doctor" value={`${patient.assignedProviderName||'Not assigned'}${patient.coveringProviderName?` (away, covered by ${patient.coveringProviderName})`:''}`}/><Info label="Profile status" value={patient.active?'Active':'Inactive'}/></div>
    <div className="mt-5 grid gap-4 border-t border-[#edf2f2] pt-4 sm:grid-cols-2"><Info label="Conditions" value={patient.conditions?.join(', ')||'None listed'}/><Info label="Allergies" value={patient.allergies?.join(', ')||'None listed'}/>{patient.notes&&<div className="sm:col-span-2"><Info label="Care notes" value={patient.notes}/></div>}</div>
  </Card>;
}

/** Current medications (with edit for the care team), the printable prescription and prescription files. */
function PatientScheduleTab({user,patient}:{user:AuthUser;patient:PatientWithRecords}){
  const canManage=user.role==='admin'||user.role==='provider';
  const patients=useListPatients({query:{enabled:canManage,queryKey:getListPatientsQueryKey()}});
  const [editing,setEditing]=useState<Medication|null>(null),[open,setOpen]=useState(false);
  const current=(patient.medications||[]).filter(isCurrentMed);
  return <div className="space-y-5">
    <Card><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><h2 className="font-bold text-[#254954]">Current medications</h2><p className="mt-1 text-xs text-[#81969b]">{current.length} active schedule{current.length===1?'':'s'}</p></div>{canManage&&<button data-testid="button-add-patient-medication" onClick={()=>{setEditing(null);setOpen(true)}} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white hover:bg-[#125366]"><Plus size={14}/> Add medication</button>}</div>
      {current.length?<MedicationTable meds={current} patientName={()=>patient.name} editable={canManage} onEdit={m=>{setEditing(m);setOpen(true)}} showPatient={false}/>:<EmptyState title="No active medications" body={canManage?'Add a medication to start this patient’s schedule.':'Active medication schedules will appear here.'} icon={Pill}/>}
    </Card>
    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><DigitalPrescription patientId={patient.id}/><LabResultsPanel patientId={patient.id} category="prescription" canUpload={canManage} canReview={false}/></div>
    {open&&<MedicationModal medication={editing} patients={patients.data||[]} defaultPatientId={patient.id} onClose={()=>setOpen(false)}/>}
  </div>;
}

/** Stopped or finished medications, and the recent dose log. */
function PatientHistoryTab({patient}:{patient:PatientWithRecords}){
  const past=(patient.medications||[]).filter(m=>!isCurrentMed(m));
  const now=Date.now();
  const log=(patient.recentDoses||[]).filter(d=>new Date(d.scheduledTime).getTime()<=now||d.status!=='scheduled');
  const th='px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#6c858b]';
  return <div className="grid gap-5 xl:grid-cols-2">
    <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Past medications</h2><p className="mt-1 text-xs text-[#81969b]">Completed or stopped schedules</p></div>{past.length?<ul className="divide-y divide-[#edf2f2]">{past.map(m=><li key={m.id} data-testid={`row-past-medication-${m.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 sm:px-6"><div className="min-w-[140px] flex-1"><div className="font-bold text-[#31535e]">{m.name}</div><div className="text-xs text-[#7d9297]">{frequencyText(m)}{m.prescribedByName?` · ${m.prescribedByName}`:''}</div></div><div className="text-sm font-bold text-[#254954]">{doseText(m.dosage)}</div><div className="text-xs text-[#6c858b]">{m.startDate} → {m.endDate||'stopped'}</div><StatusPill status="inactive"/></li>)}</ul>:<EmptyState title="No past medications" body="Completed or stopped medications will be listed here." icon={Pill}/>}</Card>
    <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Dose log</h2><p className="mt-1 text-xs text-[#81969b]">The most recent logged and missed doses</p></div>{log.length?<div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-[#e6eeee] bg-[#f8fbfb]"><tr><th className={`${th} pl-5 sm:pl-6`}>When</th><th className={th}>Medication</th><th className={th}>Status</th></tr></thead><tbody className="divide-y divide-[#edf2f2]">{log.map(d=><tr key={d.id} data-testid={`row-patient-dose-${d.id}`}><td className="whitespace-nowrap py-3 pl-5 pr-4 text-[#3d5e67] sm:pl-6">{dateTimeLabel(d.scheduledTime)}</td><td className="px-4 py-3"><span className="font-semibold text-[#31535e]">{d.medicationName}</span> <span className="text-[#6c858b]">{doseText(d.dosage)}</span>{d.status==='taken'&&d.takenTime&&<div className="text-[11px] text-[#35896c]">Taken {timeLabel(d.takenTime)}</div>}</td><td className="px-4 py-3"><StatusPill status={d.status}/></td></tr>)}</tbody></table></div>:<EmptyState title="No dose history yet" body="Logged doses will show here as this schedule gets underway."/>}</Card>
  </div>;
}

/** This patient's generated reports, with a button to create one now. */
function PatientReportsCard({user,patient}:{user:AuthUser;patient:PatientWithRecords}){
  const reports=useListReports({query:{enabled:user.role!=='patient',queryKey:getListReportsQueryKey()}});
  const generate=useGenerateReport(),qc=useQueryClient();
  const [period,setPeriod]=useState<'weekly'|'monthly'>('weekly'),[feedback,setFeedback]=useState('');
  const canManage=user.role==='admin'||user.role==='provider';
  const list=(reports.data||[]).filter(r=>r.patientId===patient.id);
  const run=()=>{setFeedback('');generate.mutate({data:{period,patientId:patient.id}},{onSuccess:r=>{qc.invalidateQueries({queryKey:getListReportsQueryKey()});setFeedback(`Report ready for ${r.rangeStart} to ${r.rangeEnd}.`)},onError:()=>setFeedback('Report generation failed. Please try again.')})};
  return <Card testId="card-patient-reports"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><h2 className="font-bold text-[#254954]">Adherence reports</h2><p className="mt-1 text-xs text-[#81969b]">Weekly and monthly summaries for {shortName(patient.name)}</p></div>{canManage&&<div className="flex gap-2"><select data-testid="select-patient-report-period" value={period} onChange={e=>setPeriod(e.target.value as 'weekly'|'monthly')} className="h-9 rounded-lg border border-input bg-white px-2 text-xs"><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select><button data-testid="button-generate-patient-report" onClick={run} disabled={generate.isPending} className="h-9 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white hover:bg-[#125366] disabled:opacity-50">{generate.isPending?'Generating…':'Generate'}</button></div>}</div>
    {feedback&&<p role="status" className="mx-5 mt-3 text-xs text-[#37796b] sm:mx-6">{feedback}</p>}
    {reports.isLoading?<ListSkeleton/>:reports.isError?<ErrorState retry={()=>reports.refetch()}/>:list.length===0?<EmptyState title="No reports yet" body={canManage?'Generate a weekly or monthly summary above.':'Reports for this patient will appear here.'} icon={FileText}/>:<div className="divide-y divide-[#edf2f2]">{list.map(r=><ReportRow key={r.id} report={r}/>)}</div>}
  </Card>;
}
function HealthMetricsPanel({patientId,canRecord}:{patientId:number;canRecord:boolean}) {
  const qc=useQueryClient();
  const metrics=useListHealthMetrics(patientId,{query:{enabled:patientId>0}});
  const logs=useListHealthLogs(patientId,{query:{enabled:patientId>0}});
  const createMetric=useCreateHealthMetric();
  const createLog=useCreateHealthLog();
  const [metricType,setMetricType]=useState<HealthMetricInputMetricType>('blood_pressure');
  const [value,setValue]=useState('');
  const [secondary,setSecondary]=useState('');
  const [symptoms,setSymptoms]=useState('');
  const [note,setNote]=useState('');
  const [feedback,setFeedback]=useState<{ok:boolean;text:string}|null>(null);
  const rows=(metrics.data||[]) as HealthMetric[];
  const logRows=(logs.data||[]) as HealthLog[];
  const chartRows=[...rows].filter((row)=>row.metricType===metricType).reverse().slice(-14).map((row,index)=>({name:`${index+1}`,value:row.value}));
  const units:Record<string,string>={blood_pressure:'mmHg',blood_sugar:'mg/dL',weight:'kg',heart_rate:'bpm',temperature:'°C'};
  const saved=(result:unknown,what:string)=>setFeedback({ok:true,text:syncStateOf(result)?`${what} saved on this device. It will upload automatically when you’re back online.`:`${what} saved.`});
  const failed=(err:unknown)=>setFeedback({ok:false,text:apiError(err,'Couldn’t save. Check your connection and try again.')});
  const submit=(event:FormEvent)=>{event.preventDefault();setFeedback(null);const parsed=Number(value),second=Number(secondary);
    if(!Number.isFinite(parsed)||parsed<=0||(metricType==='blood_pressure'&&(!Number.isFinite(second)||second<=0))){setFeedback({ok:false,text:'Enter a valid number.'});return}
    createMetric.mutate({patientId,data:{metricType,value:parsed,secondaryValue:metricType==='blood_pressure'?second:undefined,unit:units[metricType]}},{onSuccess:(result)=>{setValue('');setSecondary('');saved(result,'Reading');qc.invalidateQueries({queryKey:getListHealthMetricsQueryKey(patientId)})},onError:failed});
  };
  const submitLog=(event:FormEvent)=>{event.preventDefault();setFeedback(null);const list=symptoms.split(',').map((x)=>x.trim()).filter(Boolean).slice(0,20);
    if(!list.length&&!note.trim()){setFeedback({ok:false,text:'Add at least one symptom or a note.'});return}
    createLog.mutate({patientId,data:{symptoms:list,...(note.trim()?{notes:note.trim()}:{})}},{onSuccess:(result)=>{setSymptoms('');setNote('');saved(result,'Symptom note');qc.invalidateQueries({queryKey:getListHealthLogsQueryKey(patientId)})},onError:failed});
  };
  const when=(value:string)=>dateTimeLabel(value);
  const inputClass='h-10 rounded-xl border border-[#dce7e7] bg-white px-3 text-sm';
  return <Card testId="panel-health"><div className="grid gap-5 p-5 lg:grid-cols-[1fr_280px] lg:p-6">
    <div><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-[#254954]">Health metrics</h2><p className="mt-1 text-xs text-[#81969b]">Home measurements and trend history</p></div>
      <select data-testid="select-metric-type" value={metricType} onChange={(event)=>setMetricType(event.target.value as HealthMetricInputMetricType)} className="h-10 rounded-xl border border-[#dce7e7] bg-white px-3 text-sm">{[['blood_pressure','Blood pressure'],['blood_sugar','Blood sugar'],['weight','Weight'],['heart_rate','Heart rate'],['temperature','Temperature']].map(([key,label])=> <option key={key} value={key}>{label}</option>)}</select></div>
      {metrics.isError&&<ErrorState retry={()=>metrics.refetch()}/>}
      <div className="mt-4 h-52">{chartRows.length?<ResponsiveContainer width="100%" height="100%"><LineChart data={chartRows}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name" tick={{fontSize:11}}/><YAxis tick={{fontSize:11}}/><Tooltip/><Line type="monotone" dataKey="value" stroke="#287d8e" strokeWidth={2.5} dot={{r:3}}/></LineChart></ResponsiveContainer>:<EmptyState title="No measurements yet" body="Recorded metrics will appear here."/>}</div>
      <div className="mt-3 space-y-2" data-testid="list-health-metrics">{rows.slice(0,5).map((row)=><div key={row.id} data-testid={`row-health-metric-${row.id}`} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ${row.outOfRange?'bg-[#fff0ed] text-[#b14b3d]':'bg-[#f5f9f8] text-[#3d5e67]'}`}><span className="flex items-center gap-2">{row.metricType.replaceAll('_',' ')}<span className="text-[11px] text-[#8aa0a4]">{when(row.recordedAt)}</span><SyncBadge record={row}/></span><strong>{row.value}{row.secondaryValue!=null?`/${row.secondaryValue}`:''} {row.unit}{row.outOfRange?' · Out of range':''}</strong></div>)}</div>
      <div className="mt-5"><h3 className="text-sm font-bold text-[#31535e]">Recent symptom notes</h3>
        {logRows.length===0?<p className="mt-2 text-xs text-[#8aa0a4]">No symptom notes yet.</p>:<div className="mt-2 space-y-2" data-testid="list-health-logs">{logRows.slice(0,5).map((log)=><div key={log.id} data-testid={`row-health-log-${log.id}`} className="rounded-xl bg-[#f5f9f8] px-3 py-2 text-sm text-[#3d5e67]"><div className="flex flex-wrap items-center gap-2"><strong>{log.symptoms.length?log.symptoms.join(', '):'Note'}</strong><span className="text-[11px] text-[#8aa0a4]">{when(log.recordedAt)}</span><SyncBadge record={log}/></div>{log.notes&&<div className="mt-1 text-xs text-[#5f7a82]">{log.notes}</div>}</div>)}</div>}
      </div>
    </div>
    {canRecord&&<div className="space-y-3">
      <form onSubmit={submit} className="rounded-2xl bg-[#f6faf9] p-4">
        <h3 className="text-sm font-bold text-[#31535e]">Record a reading</h3>
        {metricType==='blood_pressure'?<div className="mt-3 grid grid-cols-2 gap-2"><input data-testid="input-metric-value" value={value} onChange={(event)=>setValue(event.target.value)} required inputMode="numeric" placeholder="Systolic" className={inputClass}/><input data-testid="input-metric-secondary" value={secondary} onChange={(event)=>setSecondary(event.target.value)} required inputMode="numeric" placeholder="Diastolic" className={inputClass}/></div>:<input data-testid="input-metric-value" value={value} onChange={(event)=>setValue(event.target.value)} required inputMode="decimal" placeholder={units[metricType]} className={`mt-3 w-full ${inputClass}`}/>}
        <button data-testid="button-save-reading" type="submit" disabled={createMetric.isPending} className="mt-3 h-10 w-full rounded-xl bg-[#17647a] text-sm font-semibold text-white disabled:opacity-60">{createMetric.isPending?'Saving...':'Save reading'}</button>
      </form>
      <form onSubmit={submitLog} className="rounded-2xl bg-[#f6faf9] p-4">
        <h3 className="text-sm font-bold text-[#31535e]">How are you feeling?</h3>
        <input data-testid="input-symptoms" value={symptoms} onChange={(event)=>setSymptoms(event.target.value)} placeholder="Symptoms, e.g. fatigue, headache" maxLength={400} className={`mt-3 w-full ${inputClass}`}/>
        <textarea data-testid="input-symptom-note" value={note} onChange={(event)=>setNote(event.target.value)} placeholder="Note (optional)" maxLength={1000} rows={2} className="mt-2 w-full rounded-xl border border-[#dce7e7] bg-white px-3 py-2 text-sm"/>
        <button data-testid="button-save-symptoms" type="submit" disabled={createLog.isPending} className="mt-2 h-10 w-full rounded-xl border border-[#dce7e7] bg-white text-sm font-semibold text-[#47737b] disabled:opacity-60">{createLog.isPending?'Saving...':'Save symptom note'}</button>
      </form>
      {feedback&&<div role={feedback.ok?'status':'alert'} data-testid="status-health-feedback" className={`rounded-xl px-3 py-2 text-xs font-semibold ${feedback.ok?'bg-[#eef8f4] text-[#2f8a74]':'bg-red-50 text-red-700'}`}>{feedback.text}</div>}
    </div>}
  </div></Card>;
}
/** Health readings and symptom notes for patients and caregivers (works offline; see offline.ts). */
function MyHealthPage({user}:{user:AuthUser}){
  const patients=useListPatients();
  const patient=(patients.data||[])[0];
  return <div className="page-enter">
    <PageHeading eyebrow="Health observations" title={user.role==='patient'?'My health':`Health · ${patient?.name||'patient'}`} description="Record home measurements and how you’re feeling. Entries are saved on this device first, so this also works without internet."/>
    {patients.isLoading?<SkeletonGrid/>:patients.isError?<Card><ErrorState retry={()=>patients.refetch()}/></Card>:!patient?<Card><EmptyState title="No linked patient profile" body="Your account isn’t linked to a patient profile yet." icon={HeartPulse}/></Card>:<HealthMetricsPanel patientId={patient.id} canRecord/>}
  </div>;
}
function Info({label,value}:{label:string;value:string}){return <div><div className="text-[10px] font-bold uppercase tracking-wider text-[#8ba0a4]">{label}</div><div data-testid={`text-patient-${label.toLowerCase().replaceAll(' ','-')}`} className="mt-1 text-sm font-medium leading-5 text-[#3d5e67]">{value}</div></div>}
function DetailSkeleton(){return <div data-testid="status-loading" className="space-y-5"><div className="h-32 animate-pulse rounded-3xl bg-[#dfeceb]"/><div className="grid gap-5 sm:grid-cols-2"><div className="h-80 animate-pulse rounded-2xl bg-white"/><div className="h-80 animate-pulse rounded-2xl bg-white"/></div></div>}

function MedicationsPage({user}:{user:AuthUser}){
  const meds=useListMedications(), patients=useListPatients();
  const [search,setSearch]=useState(''),[open,setOpen]=useState(false),[editing,setEditing]=useState<Medication|null>(null);
  const [patientFilter,setPatientFilter]=useState('all');
  const authorized=user.role==='admin'||user.role==='provider';
  const list=(meds.data||[]).filter(m=>(patientFilter==='all'||m.patientId===Number(patientFilter))&&`${m.name} ${m.dosage} ${(patients.data||[]).find(p=>p.id===m.patientId)?.name||''}`.toLowerCase().includes(search.toLowerCase()));
  const patientName=(id:number)=>(patients.data||[]).find(p=>p.id===id)?.name||`Patient #${id}`;
  const start=(med?:Medication)=>{setEditing(med||null);setOpen(true)};
  return <div className="page-enter"><PageHeading eyebrow="Medication coordination" title="Medications" description="Schedules assigned to your patients, with the details that keep routines on track." action={authorized?<button data-testid="button-add-medication" onClick={()=>start()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366]"><Plus size={16}/> New schedule</button>:undefined}/>
    <Card><div className="flex flex-col gap-4 border-b border-[#eaf0f0] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><h2 className="font-bold text-[#254954]">Medication schedules</h2><p className="mt-1 text-xs text-[#81969b]">{list.length} schedule{list.length===1?'':'s'} shown</p></div><div className="flex flex-col gap-2 sm:flex-row"><label className="flex h-10 items-center gap-2 rounded-xl border border-[#dce8e8] bg-[#fbfdfd] px-3"><Search size={15} className="text-[#81969b]"/><input data-testid="input-search-medications" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search schedules…" className="w-full bg-transparent text-sm outline-none sm:w-40"/></label><select data-testid="select-filter-medication-patient" value={patientFilter} onChange={e=>setPatientFilter(e.target.value)} className="h-10 rounded-xl border border-[#dce8e8] bg-white px-3 text-xs text-[#55737a]"><option value="all">All patients</option>{(patients.data||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div></div>
      {meds.isLoading||patients.isLoading?<div className="space-y-3 p-5" data-testid="status-loading">{[1,2,3].map(x=><div key={x} className="h-20 animate-pulse rounded-xl bg-[#f2f6f6]"/>)}</div>:meds.isError||patients.isError?<ErrorState retry={()=>{meds.refetch();patients.refetch()}}/>:list.length===0?<EmptyState title={search?'No matching schedules':'No schedules yet'} body={search?'Try a different medication or patient name.':'Schedules added for your patients will appear here.'} icon={Pill}/>:<MedicationTable meds={list} patientName={patientName} editable={authorized} onEdit={start} linkPatients/>}
    </Card>{open&&<MedicationModal medication={editing} patients={patients.data||[]} onClose={()=>setOpen(false)}/>}
  </div>;
}
// ---- Medication table: every important detail in its own column (no small print) ----
/** "10mg" → "10 mg", "500 MG" → "500 mg"; other units unchanged. */
const doseText=(dosage:string)=>dosage.trim().replace(/(\d)\s*(mg|mcg|g|ml|iu)\b/gi,(_,n:string,u:string)=>`${n} ${u.toLowerCase()==='iu'?'IU':u.toLowerCase()}`);
const DAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
/** How often, in plain words: "Once daily", "Twice daily", "Every 8 hours", "Mon, Wed, Fri". */
const frequencyText=(m:Medication)=>m.frequency==='every_hours'?`Every ${m.intervalHours||'?'} hours`:m.frequency==='specific_days'?((m.daysOfWeek||[]).length?(m.daysOfWeek||[]).slice().sort().map(d=>DAY_NAMES[d]).join(', '):'Specific days'):m.timesPerDay===1?'Once daily':m.timesPerDay===2?'Twice daily':`${m.timesPerDay} times daily`;
/** The times a dose is due: "8:00 AM", or the first time for interval schedules. */
const scheduleTimesOf=(m:Medication)=>m.frequency==='every_hours'?(m.scheduleTimes?.[0]?[`From ${clock12(m.scheduleTimes[0])}`]:[]):(m.scheduleTimes||[]).map(clock12);
function MedicationStatus({med}:{med:Medication}){
  const today=dateToday();
  const ended=!!med.endDate&&med.endDate<today, upcoming=med.startDate>today;
  return <div><StatusPill status={!med.active||ended?'inactive':'active'}/>{med.active&&<div className="mt-1 text-[11px] text-[#7d9297]">{ended?`Ended ${med.endDate}`:upcoming?`Starts ${med.startDate}`:med.endDate?`Until ${med.endDate}`:'Ongoing'}</div>}</div>;
}
/** Edit / Deactivate / Delete for one medication (doctors and admins). */
function MedicationActions({med,onEdit}:{med:Medication;onEdit:()=>void}){
  const update=useUpdateMedication(), remove=useDeleteMedication(), qc=useQueryClient();
  const [message,setMessage]=useState('');
  const refresh=()=>{qc.invalidateQueries({queryKey:getListMedicationsQueryKey()});qc.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/patients/')})};
  const toggle=()=>{if(med.active&&!window.confirm(`Deactivate ${med.name}? Future doses will no longer be scheduled.`))return;update.mutate({id:med.id,data:{active:!med.active}},{onSuccess:()=>{refresh();setMessage(med.active?'Deactivated':'Activated')},onError:()=>setMessage('Could not update')})};
  const del=()=>{if(window.confirm(`Permanently delete ${med.name}?`))remove.mutate({id:med.id},{onSuccess:refresh,onError:()=>setMessage('Could not remove')})};
  return <div className="flex flex-wrap items-center justify-end gap-1.5">{message&&<span role="status" className="text-[11px] text-[#448279]">{message}</span>}<button data-testid={`button-edit-medication-${med.id}`} onClick={onEdit} className="h-9 rounded-lg border border-[#dce8e8] px-3 text-xs font-semibold text-[#52737c] hover:bg-[#f5f9f9]">Edit</button><button data-testid={`button-toggle-medication-${med.id}`} disabled={update.isPending} onClick={toggle} className="h-9 rounded-lg px-3 text-xs font-semibold text-[#71868c] hover:bg-[#f3f7f7] disabled:opacity-50">{med.active?'Deactivate':'Activate'}</button>{!med.active&&<button data-testid={`button-delete-medication-${med.id}`} disabled={remove.isPending} onClick={del} className="h-9 rounded-lg px-2 text-xs font-semibold text-[#a85a50] hover:bg-red-50">Delete</button>}</div>;
}
/**
 * Medication records as a table: Patient · Medication · Dosage · Frequency · Schedule · Status ·
 * Actions. The patient's name opens their profile. On phones each record becomes a card with
 * the same labelled fields, so nothing important is hidden in small print.
 */
function MedicationTable({meds,patientName,editable,onEdit,linkPatients=false,showPatient=true}:{meds:Medication[];patientName:(id:number)=>string;editable:boolean;onEdit:(m:Medication)=>void;linkPatients?:boolean;showPatient?:boolean}){
  const [sort,setSort]=useState<'patient'|'medication'>(showPatient?'patient':'medication');
  const rows=meds.slice().sort((a,b)=>sort==='patient'?patientName(a.patientId).localeCompare(patientName(b.patientId))||a.name.localeCompare(b.name):a.name.localeCompare(b.name)||patientName(a.patientId).localeCompare(patientName(b.patientId)));
  const who=(m:Medication)=>linkPatients?<Link href={`/patients/${m.patientId}`} data-testid={`link-medication-patient-${m.id}`} className="font-semibold text-[#17647a] underline-offset-2 hover:underline">{patientName(m.patientId)}</Link>:<span className="font-semibold text-[#31535e]">{patientName(m.patientId)}</span>;
  const sideEffects=(m:Medication)=>m.sideEffects&&<div data-testid={`text-medication-side-effects-${m.id}`} className="mt-1 text-xs leading-5 text-[#8a6a2a]"><b>Side effects:</b> {m.sideEffects}</div>;
  const times=(m:Medication)=>{const t=scheduleTimesOf(m);return t.length?<div className="flex flex-wrap gap-1">{t.map(x=><span key={x} className="whitespace-nowrap rounded-md bg-[#eef5f7] px-2 py-0.5 text-xs font-semibold text-[#2f5d6b]">{x}</span>)}</div>:<span className="text-xs text-[#91a4a8]">Not set</span>};
  const th='px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#6c858b]';
  const sortBtn=(key:'patient'|'medication',label:string)=><button type="button" onClick={()=>setSort(key)} aria-pressed={sort===key} className={`inline-flex items-center gap-1 uppercase tracking-wider ${sort===key?'text-[#17647a]':'hover:text-[#17647a]'}`}>{label}{sort===key&&<span aria-hidden="true">↓</span>}</button>;
  return <>
    <div className="hidden overflow-x-auto md:block"><table className="w-full border-collapse text-sm" data-testid="table-medications">
      <thead className="border-b border-[#e6eeee] bg-[#f8fbfb]"><tr>{showPatient&&<th className={`${th} pl-6`}>{sortBtn('patient','Patient')}</th>}<th className={`${th} ${showPatient?'':'pl-6'}`}>{showPatient?sortBtn('medication','Medication'):'Medication'}</th><th className={th}>Dosage</th><th className={th}>Frequency</th><th className={th}>Schedule</th><th className={th}>Status</th>{editable&&<th className={`${th} pr-6 text-right`}>Actions</th>}</tr></thead>
      <tbody className="divide-y divide-[#edf2f2]">{rows.map(m=><tr key={m.id} data-testid={`row-medication-${m.id}`} className="align-top transition hover:bg-[#fafcfc]">
        {showPatient&&<td className="py-3.5 pl-6 pr-4">{who(m)}</td>}
        <td className={`max-w-[280px] py-3.5 pr-4 ${showPatient?'pl-4':'pl-6'}`}><div className="font-bold text-[#254954]" data-testid={`text-medication-name-${m.id}`}>{m.name}</div><div className="text-xs text-[#7d9297]">{m.form||'Medication'}</div>{sideEffects(m)}</td>
        <td className="whitespace-nowrap px-4 py-3.5 text-[15px] font-bold text-[#254954]" data-testid={`text-medication-dosage-${m.id}`}>{doseText(m.dosage)}</td>
        <td className="whitespace-nowrap px-4 py-3.5 font-medium text-[#3d5e67]">{frequencyText(m)}</td>
        <td className="px-4 py-3.5">{times(m)}</td>
        <td className="px-4 py-3.5"><MedicationStatus med={m}/></td>
        {editable&&<td className="py-3 pl-4 pr-6"><MedicationActions med={m} onEdit={()=>onEdit(m)}/></td>}
      </tr>)}</tbody>
    </table></div>
    <ul className="divide-y divide-[#edf2f2] md:hidden" data-testid="list-medications-mobile">{rows.map(m=><li key={m.id} data-testid={`card-medication-${m.id}`} className="px-5 py-4">
      {showPatient&&<div className="mb-1 text-sm">{who(m)}</div>}
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-base font-bold text-[#254954]">{m.name}</div><div className="text-xs text-[#7d9297]">{m.form||'Medication'}</div></div><MedicationStatus med={m}/></div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5"><div><dt className="text-[10px] font-bold uppercase tracking-wider text-[#8ba0a4]">Dosage</dt><dd className="text-[15px] font-bold text-[#254954]">{doseText(m.dosage)}</dd></div><div><dt className="text-[10px] font-bold uppercase tracking-wider text-[#8ba0a4]">Frequency</dt><dd className="text-sm font-medium text-[#3d5e67]">{frequencyText(m)}</dd></div><div className="col-span-2"><dt className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#8ba0a4]">Schedule</dt><dd>{times(m)}</dd></div></dl>
      {sideEffects(m)}
      {editable&&<div className="mt-3"><MedicationActions med={m} onEdit={()=>onEdit(m)}/></div>}
    </li>)}</ul>
  </>;
}
/** End date from an explicit date, or from a course length counted from the start date. */
function courseEnd(start:string,end:string,days:number){if(end)return end;if(!days)return null;const d=new Date(`${start}T12:00:00`);d.setDate(d.getDate()+days-1);return d.toLocaleDateString('en-CA')}
function MedicationModal({medication,patients,defaultPatientId,onClose}:{medication:Medication|null;patients:Patient[];defaultPatientId?:number;onClose:()=>void}){
  const create=useCreateMedication(), update=useUpdateMedication(), qc=useQueryClient();
  const [error,setError]=useState('');
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setError('');const f=new FormData(e.currentTarget);const freq=String(f.get('frequency')) as 'daily'|'specific_days'|'every_hours';
    // Times are typed in 12-hour form ("8:00 AM, 8:00 PM"); they are stored as "08:00", "20:00".
    const {times,invalid}=parseClockList(String(f.get('scheduleTimes')||''));
    if(invalid.length){setError(`Check the scheduled time${invalid.length===1?'':'s'}: ${invalid.join(', ')}. Use a format like 8:00 AM or 8:30 PM.`);return}
    if(!times.length){setError('Add at least one scheduled time, for example 8:00 AM.');return}
    const sideEffects=String(f.get('sideEffects')||'').trim();
    const data={patientId:Number(f.get('patientId')),name:String(f.get('name')),dosage:String(f.get('dosage')),form:String(f.get('form')||''),frequency:freq,timesPerDay:Number(f.get('timesPerDay')||times.length||1),scheduleTimes:times,daysOfWeek:freq==='specific_days'?String(f.get('days')||'').split(',').map(Number).filter(n=>n>=0&&n<=6):[],intervalHours:freq==='every_hours'?Number(f.get('intervalHours')):null,startDate:String(f.get('startDate')||dateToday()),endDate:courseEnd(String(f.get('startDate')||dateToday()),String(f.get('endDate')||''),Number(f.get('courseDays')||0)),instructions:String(f.get('instructions')||'')};
    const done=()=>{qc.invalidateQueries({queryKey:getListMedicationsQueryKey()});qc.invalidateQueries({queryKey:getListDosesQueryKey()});qc.invalidateQueries({predicate:q=>String(q.queryKey[0]).includes('medication-progress')||String(q.queryKey[0]).startsWith('/api/patients/')});onClose()};
    if(medication){const {patientId,...patch}=data;void patientId;update.mutate({id:medication.id,data:{...patch,sideEffects:sideEffects||null}},{onSuccess:done,onError:()=>setError('Could not save this schedule. Check the details and try again.')})}
    else create.mutate({data:{...data,...(sideEffects?{sideEffects}:{})}},{onSuccess:done,onError:()=>setError('Could not create this schedule. Check the details and try again.')});
  };
  const busy=create.isPending||update.isPending;
  return <Modal title={medication?'Edit medication schedule':'Create medication schedule'} subtitle="Set a routine that’s clear for the patient and their care team." onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-semibold text-[#526f77]">Patient<select required name="patientId" defaultValue={medication?.patientId||defaultPatientId||''} disabled={!!medication} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal"><option value="" disabled>Select a patient</option>{patients.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Medication name" name="name" required defaultValue={medication?.name}/><Field label="Dosage" name="dosage" required defaultValue={medication?.dosage} placeholder="e.g. 10 mg"/></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Form" name="form" defaultValue={medication?.form} placeholder="Tablet, capsule…"/><label className="block text-xs font-semibold text-[#526f77]">Frequency<select name="frequency" defaultValue={medication?.frequency||'daily'} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal"><option value="daily">Daily</option><option value="specific_days">Specific days</option><option value="every_hours">Every few hours</option></select></label></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Scheduled times (12-hour, comma separated)" name="scheduleTimes" defaultValue={medication?.scheduleTimes?.length?medication.scheduleTimes.map(clock12).join(', '):'8:00 AM'} placeholder="8:00 AM, 8:00 PM"/><Field label="Times per day" name="timesPerDay" type="number" defaultValue={medication?.timesPerDay||1}/></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Days of week (0=Sun, comma separated)" name="days" defaultValue={medication?.daysOfWeek?.join(',')||''}/><Field label="Interval hours (if applicable)" name="intervalHours" type="number" defaultValue={medication?.intervalHours||''}/></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Start date" name="startDate" type="date" defaultValue={medication?.startDate||dateToday()} min={dateToday()}/><Field label="End date (optional)" name="endDate" type="date" defaultValue={medication?.endDate||''} min={dateToday()}/></div>
    {!medication&&<label className="block text-xs font-semibold text-[#526f77]">Course length<select name="courseDays" defaultValue="0" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal"><option value="0">Ongoing, or use the end date above</option>{[3,5,7,10,14,21,30].map(d=><option key={d} value={d}>{d} days</option>)}</select><span className="mt-1 block font-normal text-[#8ba0a4]">A fixed course shows a day-by-day progress bar.</span></label>}
    <label className="block text-xs font-semibold text-[#526f77]">Instructions<textarea name="instructions" defaultValue={medication?.instructions||''} rows={2} className="mt-1.5 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm font-normal outline-none focus:border-primary"/></label>
    <label className="block text-xs font-semibold text-[#526f77]">Side effects to watch for (optional)<textarea data-testid="input-sideEffects" name="sideEffects" defaultValue={medication?.sideEffects||''} rows={3} maxLength={2000} placeholder="Enter from the product information or your clinical judgment, e.g. what to watch for and when to call" className="mt-1.5 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm font-normal outline-none focus:border-primary"/><span className="mt-1 block font-normal text-[#8ba0a4]">Shown to the patient and care team with this medication. CareTrack never fills this in automatically.</span></label>
    {error&&<div role="alert" data-testid="status-medication-form-error" className="text-xs text-red-700">{error}</div>}<ModalActions onClose={onClose} busy={busy} submitLabel={medication?'Save schedule':'Create schedule'}/>
  </form></Modal>;
}

function UsersPage({user}:{user:AuthUser}){
  const query=useListUsers({query:{enabled:user.role==='admin',queryKey:getListUsersQueryKey()}}),[open,setOpen]=useState(false),[editing,setEditing]=useState<User|null>(null),[newRole,setNewRole]=useState('provider');
  if(user.role!=='admin')return <AccessDenied/>;
  return <div className="page-enter"><PageHeading eyebrow="Workspace access" title="Team access" description="Manage who can sign in and the role they use in this CareTrack demo." action={<div className="flex flex-wrap gap-2"><button data-testid="button-add-doctor" onClick={()=>{setEditing(null);setNewRole('provider');setOpen(true)}} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366]"><Stethoscope size={16}/> Add doctor</button><button data-testid="button-add-user" onClick={()=>{setEditing(null);setNewRole('patient');setOpen(true)}} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#c8e2df] bg-white px-4 text-sm font-semibold text-[#247b79] hover:bg-[#eef9f6]"><UserPlus size={16}/> Add other user</button></div>}/>
    <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">People with access</h2><p className="mt-1 text-xs text-[#81969b]">Role visibility is managed here; access is enforced by the service too.</p></div>
      {query.isLoading?<div data-testid="status-loading" className="space-y-3 p-5">{[1,2,3].map(x=><div key={x} className="h-16 animate-pulse rounded-xl bg-[#f2f6f6]"/>)}</div>:query.isError?<ErrorState retry={()=>query.refetch()}/>:!query.data?.length?<EmptyState title="No team members yet" body="Create the first demo user to share access with your care team." icon={Users}/>:<div className="divide-y divide-[#edf2f2]">{query.data.map(u=><UserRow key={u.id} user={u} onEdit={()=>{setEditing(u);setOpen(true)}}/>)}</div>}
    </Card>{open&&<UserModal user={editing} defaultRole={newRole} onClose={()=>setOpen(false)}/>}
    <DeliveryPanel/>
  </div>;
}
function UserRow({user,onEdit}:{user:User;onEdit:()=>void}){
  const update=useUpdateUser(),qc=useQueryClient();
  const toggle=()=>update.mutate({id:user.id,data:{active:!user.active}},{onSuccess:()=>qc.invalidateQueries({queryKey:getListUsersQueryKey()})});
  return <div data-testid={`row-user-${user.id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6"><Avatar name={user.name} small/><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-[#31535e]" data-testid={`text-user-${user.id}`}>{user.name}</div><div className="mt-1 truncate text-xs text-[#81969b]">{user.email}{user.phone?` · ${user.phone}`:''} · Joined {new Date(user.createdAt).toLocaleDateString()}</div></div><span className="rounded-full bg-[#eef5f5] px-2.5 py-1 text-[11px] font-semibold text-[#54747a]">{roleLabel(user.role)}</span>{user.phone&&<span data-testid={`status-phone-verified-${user.id}`} title={user.phoneVerified?'This number was confirmed with an SMS login code':'Not confirmed yet: confirmed the first time this user signs in with an SMS code'} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${user.phoneVerified?'bg-[#e5f5ee] text-[#28745a]':'bg-[#f2f3f3] text-[#778589]'}`}>{user.phoneVerified?'SMS verified':'SMS not verified'}</span>}{user.mustChangePassword&&<span title="Must set a new password at next sign-in" className="rounded-full bg-[#fbf1df] px-2.5 py-1 text-[11px] font-semibold text-[#99702f]">Temporary password</span>}<StatusPill status={user.active?'active':'inactive'}/><button data-testid={`button-edit-user-${user.id}`} onClick={onEdit} className="rounded-lg border border-[#dce8e8] px-3 py-2 text-xs font-semibold text-[#54737b] hover:bg-[#f5f9f9]">Edit</button><button data-testid={`button-toggle-user-${user.id}`} onClick={toggle} disabled={update.isPending} className="rounded-lg border border-[#dce8e8] px-3 py-2 text-xs font-semibold text-[#54737b] hover:bg-[#f5f9f9]">{user.active?'Deactivate':'Activate'}</button></div>;
}
function UserModal({user,defaultRole='provider',title,lockRole=false,onClose}:{user:User|null;defaultRole?:string;title?:string;lockRole?:boolean;onClose:()=>void}){
  const create=useCreateUser(),update=useUpdateUser(),qc=useQueryClient(),[error,setError]=useState('');
  const [tempPassword,setTempPassword]=useState(user?'':generateTempPassword()),[created,setCreated]=useState<{name:string;email:string;password:string;reset:boolean}|null>(null);
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const name=String(f.get('name')),email=String(f.get('email')),password=String(f.get('password')||''),phone=String(f.get('phone')||'').trim()||null;
    const success=()=>{qc.invalidateQueries({queryKey:getListUsersQueryKey()});if(password)setCreated({name,email,password,reset:!!user});else onClose()};
    if(user){update.mutate({id:user.id,data:{name,email,phone,...(password?{password}:{})}},{onSuccess:success,onError:()=>setError('Could not update this user. Check the details and try again.')})}
    else create.mutate({data:{name,email,password,phone,role:(lockRole ? defaultRole : String(f.get('role'))) as 'admin'|'provider'|'patient'|'caregiver'}},{onSuccess:success,onError:()=>setError('Could not create the user. Check the email and password requirements.')})
  };
  const busy=create.isPending||update.isPending;
  if(created)return <Modal title={created.reset?'Password reset':'Account created'} subtitle="Share these sign-in details privately." onClose={onClose}><div className="space-y-4" data-testid="panel-account-created"><div className="rounded-xl border border-[#cfe7df] bg-[#eef8f4] p-4 text-sm text-[#37796b]"><div className="font-semibold">{created.name}</div><div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><span className="text-[#5d8f86]">Email</span><span className="font-mono">{created.email}</span><span className="text-[#5d8f86]">Temporary password</span><span className="font-mono font-bold" data-testid="text-temp-password">{created.password}</span></div></div><p className="text-xs leading-5 text-[#71888e]">At first sign-in they’ll verify a code sent to their Gmail or phone, then must replace this temporary password with their own.</p><div className="flex justify-end gap-2"><button type="button" onClick={()=>navigator.clipboard?.writeText(`Email: ${created.email}\nTemporary password: ${created.password}`)} className="h-10 rounded-lg border border-[#dce8e8] px-4 text-sm font-semibold text-[#52737c] hover:bg-[#f5f9f9]">Copy details</button><button type="button" data-testid="button-done-created" onClick={onClose} className="h-10 rounded-lg bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366]">Done</button></div></div></Modal>;
  const modalTitle = title || (user ? (user.role === 'provider' ? 'Edit doctor' : 'Edit team member') : defaultRole === 'provider' ? 'Add a doctor' : 'Add a user');
  return <Modal title={modalTitle} subtitle={user?'Update account details. Role access is controlled by the administrator.':'Create a demo login and choose the right workspace role.'} onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="Full name" name="name" required defaultValue={user?.name}/><Field label="Email address" name="email" type="email" required defaultValue={user?.email}/><Field label="Mobile number (for SMS login codes)" name="phone" type="tel" defaultValue={user?.phone||''} placeholder="09XXXXXXXXX"/><div><div className="flex items-center justify-between"><span className="text-xs font-semibold text-[#526f77]">{user?'Reset password (leave blank to keep current)':'Temporary password'}</span><button type="button" data-testid="button-generate-password" onClick={()=>setTempPassword(generateTempPassword())} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#287d80] hover:underline"><KeyRound size={12}/> Generate</button></div><PasswordInput testId="input-user-password" name="password" value={tempPassword} onChange={setTempPassword} required={!user} minLength={8} autoComplete="new-password" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal outline-none focus:border-primary"/><p className="mt-1 text-[11px] text-[#8ba0a4]">They’ll be asked to create their own password the first time they sign in.</p></div>{!user&&!lockRole&&<label className="block text-xs font-semibold text-[#526f77]">Role<select name="role" defaultValue={defaultRole} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal">  <option value="provider">Doctor</option><option value="patient">Patient</option><option value="caregiver">Caregiver</option><option value="admin">Administrator</option></select></label>}{error&&<div data-testid="status-user-form-error" className="text-xs text-red-700">{error}</div>}<ModalActions onClose={onClose} busy={busy} submitLabel={user?'Save changes':'Create user'}/></form></Modal>;
}
function AccessDenied(){return <Card className="p-8"><EmptyState title="This page isn’t part of your account" body="Your role decides which pages you can open. Use the menu to go to your pages." icon={ShieldCheck}/><div className="flex justify-center"><Link href="/" className="inline-flex h-10 items-center rounded-xl bg-[#17647a] px-4 text-sm font-semibold text-white">Go to my home page</Link></div></Card>}

const riskColor=(rate:number)=>rate>=80?'#4bb19d':rate>=50?'#d6ad5b':'#cf7865';
const daysAgo=(n:number)=>{const d=new Date();d.setDate(d.getDate()-n);return d.toLocaleDateString('en-CA')};
const chartTooltip={contentStyle:{borderRadius:12,border:'1px solid #dce8e8',fontSize:12,boxShadow:'0 10px 30px rgba(22,62,76,.12)'}};
function AnalyticsPage(){
  const [from,setFrom]=useState(daysAgo(29)),[to,setTo]=useState(dateToday()),[patientId,setPatientId]=useState(''),[medicationId,setMedicationId]=useState('');
  const params={from,to,...(patientId?{patientId:Number(patientId)}:{}),...(medicationId?{medicationId:Number(medicationId)}:{})};
  const analytics=useGetAnalytics(params,{query:{queryKey:getGetAnalyticsQueryKey(params)}});
  const patients=useListPatients(),meds=useListMedications();
  const data=analytics.data as Analytics|undefined;
  const medOptions=(meds.data||[]).filter(m=>!patientId||m.patientId===Number(patientId));
  const patientName=(id:number)=>(patients.data||[]).find(p=>p.id===id)?.name;
  const statusData=data?[{name:'Taken',value:data.takenCount,color:'#4bb19d'},{name:'Missed',value:data.missedCount,color:'#cf7865'},{name:'Skipped',value:data.skippedCount,color:'#a9b8ba'}].filter(s=>s.value>0):[];
  const reset=()=>{setFrom(daysAgo(29));setTo(dateToday());setPatientId('');setMedicationId('')};
  const filterClass='mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm text-[#355661]';
  return <div className="page-enter">
    <PageHeading eyebrow="Patterns in care" title="Adherence analytics" description="Adherence rate = taken doses ÷ scheduled doses × 100. Filter by date range, patient and medication."/>
    <Card className="mb-5 p-4 sm:p-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr_1.3fr_auto] lg:items-end">
      <label className="text-[11px] font-semibold text-[#6c858b]">From<input data-testid="input-analytics-from" type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} className={filterClass}/></label>
      <label className="text-[11px] font-semibold text-[#6c858b]">To<input data-testid="input-analytics-to" type="date" value={to} min={from} max={dateToday()} onChange={e=>setTo(e.target.value)} className={filterClass}/></label>
      <label className="text-[11px] font-semibold text-[#6c858b]">Patient<select data-testid="select-analytics-patient" value={patientId} onChange={e=>{setPatientId(e.target.value);setMedicationId('')}} className={filterClass}><option value="">All patients</option>{(patients.data||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="text-[11px] font-semibold text-[#6c858b]">Medication<select data-testid="select-analytics-medication" value={medicationId} onChange={e=>setMedicationId(e.target.value)} className={filterClass}><option value="">All medications</option>{medOptions.map(m=><option key={m.id} value={m.id}>{m.name}{patientId?'':` · ${patientName(m.patientId)||''}`}</option>)}</select></label>
      <button data-testid="button-reset-analytics" onClick={reset} className="h-10 rounded-lg border border-[#dce8e8] px-4 text-xs font-semibold text-[#587780] hover:bg-[#f5f9f9]">Reset</button>
    </div></Card>
    {analytics.isLoading?<AnalyticsSkeleton/>:analytics.isError?<Card><ErrorState retry={()=>analytics.refetch()}/></Card>:!data||data.totalDoses===0?<Card><EmptyState title="No dose activity in this view" body="Try a wider date range or clear the filters. Metrics appear once doses are scheduled and logged." icon={BarChart3}/></Card>:<>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Adherence rate" value={`${Math.round(data.adherenceRate)}%`} detail={`${data.takenCount} of ${data.totalDoses} doses taken`} icon={Activity} accent="teal" progress={data.adherenceRate}/>
        <Metric label="Patients in view" value={`${data.totalPatients}`} detail="Visible care profiles" icon={Users} accent="blue"/>
        <Metric label="Missed doses" value={`${data.missedCount}`} detail={`${data.skippedCount} skipped in this period`} icon={Clock3} accent="gold"/>
        <Metric label="High-risk patients" value={`${data.highRiskPatients}`} detail="Adherence below 50%" icon={HeartPulse} accent="blue"/>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
        <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Adherence over time</h2><p className="mt-1 text-xs text-[#81969b]">Daily adherence rate with the 80% target line</p></div>
          <div className="h-72 px-2 py-4 sm:px-4" data-testid="chart-adherence-trend"><ResponsiveContainer width="100%" height="100%"><LineChart data={data.trend.map(p=>({...p,date:String(p.date).slice(5,10)}))} margin={{top:8,right:16,left:-12,bottom:0}}><CartesianGrid stroke="#edf3f2" vertical={false}/><XAxis dataKey="date" tick={{fontSize:11,fill:'#8da1a5'}} tickLine={false} axisLine={{stroke:'#e7eeee'}} minTickGap={16}/><YAxis domain={[0,100]} tick={{fontSize:11,fill:'#8da1a5'}} tickLine={false} axisLine={false} unit="%"/><Tooltip {...chartTooltip} formatter={(v)=>[`${v}%`,'Adherence']}/><ReferenceLine y={80} stroke="#4bb19d" strokeDasharray="4 4"/><ReferenceLine y={50} stroke="#cf7865" strokeDasharray="4 4"/><Line type="monotone" dataKey="adherenceRate" stroke="#17647a" strokeWidth={2.5} dot={false} activeDot={{r:4}}/></LineChart></ResponsiveContainer></div>
        </Card>
        <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Dose outcomes</h2><p className="mt-1 text-xs text-[#81969b]">Taken vs missed vs skipped</p></div>
          <div className="relative h-56" data-testid="chart-dose-outcomes"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={statusData} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" paddingAngle={2} stroke="none">{statusData.map(s=><Cell key={s.name} fill={s.color}/>)}</Pie><Tooltip {...chartTooltip}/></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="text-center"><div className="text-2xl font-extrabold text-[#214754]">{Math.round(data.adherenceRate)}%</div><div className="text-[10px] uppercase tracking-wider text-[#8da1a5]">taken</div></div></div></div>
          <div className="flex justify-center gap-4 pb-5 text-xs text-[#5c787f]">{statusData.map(s=><span key={s.name} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{background:s.color}}/>{s.name} {s.value}</span>)}</div>
        </Card>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Adherence by medication</h2><p className="mt-1 text-xs text-[#81969b]">Colored by risk flag: green ≥80%, yellow 50–79%, red &lt;50%</p></div>
          <div className="px-2 py-4 sm:px-4" style={{height:Math.max(180,data.byMedication.length*44+40)}} data-testid="chart-by-medication"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.byMedication} layout="vertical" margin={{top:0,right:24,left:8,bottom:0}}><CartesianGrid stroke="#edf3f2" horizontal={false}/><XAxis type="number" domain={[0,100]} unit="%" tick={{fontSize:11,fill:'#8da1a5'}} tickLine={false} axisLine={false}/><YAxis type="category" dataKey="medicationName" width={96} tick={{fontSize:11,fill:'#4c6b73'}} tickLine={false} axisLine={false}/><Tooltip {...chartTooltip} formatter={(v)=>[`${v}%`,'Adherence']}/><Bar dataKey="adherenceRate" radius={[0,6,6,0]} barSize={18}>{data.byMedication.map(m=><Cell key={m.medicationId} fill={riskColor(m.adherenceRate)}/>)}</Bar></BarChart></ResponsiveContainer></div>
        </Card>
        <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Missed doses by time of day</h2><p className="mt-1 text-xs text-[#81969b]">Where missed doses are clustering</p></div>
          <div className="h-64 px-2 py-4 sm:px-4" data-testid="chart-missed-by-time"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.byTimeOfDay} margin={{top:8,right:16,left:-12,bottom:0}}><CartesianGrid stroke="#edf3f2" vertical={false}/><XAxis dataKey="period" tick={{fontSize:11,fill:'#4c6b73'}} tickLine={false} axisLine={{stroke:'#e7eeee'}}/><YAxis allowDecimals={false} tick={{fontSize:11,fill:'#8da1a5'}} tickLine={false} axisLine={false}/><Tooltip {...chartTooltip}/><Legend wrapperStyle={{fontSize:12}}/><Bar name="Scheduled" dataKey="scheduledCount" fill="#cfe6ea" radius={[6,6,0,0]}/><Bar name="Missed" dataKey="missedCount" fill="#cf7865" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div>
        </Card>
      </div>
      <Card className="mt-5"><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Patient risk flags</h2><p className="mt-1 text-xs text-[#81969b]">Lowest adherence first. Use these signals to guide a supportive conversation.</p></div>{data.riskPatients.length===0?<EmptyState title="No patients in this view" body="No patients are highlighted by the available adherence data." icon={Users}/>:<div className="divide-y divide-[#edf2f2]">{data.riskPatients.map(p=><div key={p.patientId} data-testid={`row-risk-patient-${p.patientId}`} className="flex items-center gap-3 px-5 py-4 sm:px-6"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${p.riskLevel==='red'?'bg-[#fbebe7] text-[#a75848]':p.riskLevel==='yellow'?'bg-[#fbf1df] text-[#99702f]':'bg-[#e6f4ed] text-[#34785d]'}`}>{p.riskLevel}</span><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-[#355661]">{p.patientName}</div><div className="mt-1 text-xs text-[#879a9e]">{p.missedCount} missed doses</div></div><div className="hidden w-32 sm:block"><div className="h-1.5 overflow-hidden rounded-full bg-[#edf3f2]"><div className="h-full rounded-full" style={{width:`${p.adherenceRate}%`,background:riskColor(p.adherenceRate)}}/></div></div><span className="w-12 text-right text-sm font-bold text-[#4a7078]">{Math.round(p.adherenceRate)}%</span><Link href={`/patients/${p.patientId}`} data-testid={`link-risk-patient-${p.patientId}`} className="rounded-lg border border-[#dce8e8] px-2.5 py-1.5 text-[11px] font-semibold text-[#397d7e] hover:bg-[#f3f9f8]">Review</Link></div>)}</div>}</Card>
    </>}
    <p className="mt-5 text-xs leading-5 text-[#859a9e]">Adherence indicators are descriptive signals for care coordination, not a diagnosis. AI suggestions support, not replace, clinical judgment.</p>
  </div>;
}
function AnalyticsSkeleton(){return <div data-testid="status-loading" className="space-y-5"><div className="grid gap-4 sm:grid-cols-4">{[1,2,3,4].map(i=><div key={i} className="h-28 animate-pulse rounded-2xl bg-white"/>)}</div><div className="grid gap-5 sm:grid-cols-2"><div className="h-72 animate-pulse rounded-2xl bg-white"/><div className="h-72 animate-pulse rounded-2xl bg-white"/></div></div>}

function ReportsPage({user}:{user:AuthUser}){
  const reports=useListReports(),schedules=useListReportSchedules(),patients=useListPatients();
  const generate=useGenerateReport(),createSchedule=useCreateReportSchedule();
  const qc=useQueryClient(),canManage=user.role==='admin'||user.role==='provider';
  const [period,setPeriod]=useState<'weekly'|'monthly'>('weekly'),[patientId,setPatientId]=useState('all'),[schedulePeriod,setSchedulePeriod]=useState<'weekly'|'monthly'>('weekly'),[schedulePatient,setSchedulePatient]=useState('all'),[feedback,setFeedback]=useState('');
  const generateNow=()=>{setFeedback('');generate.mutate({data:{period,patientId:patientId==='all'?null:Number(patientId)}},{onSuccess:r=>{qc.invalidateQueries({queryKey:getListReportsQueryKey()});setFeedback(`Report generated for ${r.rangeStart} to ${r.rangeEnd}.`)},onError:()=>setFeedback('Report generation failed. Please try again.')})};
  const createScheduleNow=()=>{setFeedback('');createSchedule.mutate({data:{cadence:schedulePeriod,patientId:schedulePatient==='all'?null:Number(schedulePatient)}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListReportSchedulesQueryKey()});setFeedback('Report schedule created.')},onError:()=>setFeedback('Could not create this report schedule.')})};
  return <div className="page-enter">
    <PageHeading eyebrow="Care summaries" title="Reports" description="Generate practical adherence summaries, review past reports, and manage recurring schedules."/>
    {canManage&&<div className="mb-5 grid gap-5 xl:grid-cols-2">
      <Card className="p-5 sm:p-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#e5f2f5] text-[#3c7c8d]"><FileText size={19}/></div><div><h2 className="font-bold text-[#254954]">Generate a report</h2><p className="mt-1 text-xs leading-5 text-[#81969b]">Create a weekly or monthly summary for a patient or your full caseload.</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><label className="text-[11px] font-semibold text-[#6c858b]">Period<select data-testid="select-report-period" value={period} onChange={e=>setPeriod(e.target.value as 'weekly'|'monthly')} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm text-[#355661]"><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label className="text-[11px] font-semibold text-[#6c858b] sm:col-span-2">Scope<select data-testid="select-report-patient" value={patientId} onChange={e=>setPatientId(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm text-[#355661]"><option value="all">All patients in my care</option>{(patients.data||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><button data-testid="button-generate-report" onClick={generateNow} disabled={generate.isPending} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366] disabled:opacity-50">{generate.isPending?'Generating…':'Generate report'}<ArrowRight size={15}/></button></Card>
      <Card className="p-5 sm:p-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8f4f0] text-[#388b7f]"><CalendarDays size={19}/></div><div><h2 className="font-bold text-[#254954]">Recurring schedule</h2><p className="mt-1 text-xs leading-5 text-[#81969b]">Choose how often CareTrack prepares a summary.</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-[11px] font-semibold text-[#6c858b]">Cadence<select data-testid="select-schedule-cadence" value={schedulePeriod} onChange={e=>setSchedulePeriod(e.target.value as 'weekly'|'monthly')} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm text-[#355661]"><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label className="text-[11px] font-semibold text-[#6c858b]">Scope<select data-testid="select-schedule-patient" value={schedulePatient} onChange={e=>setSchedulePatient(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm text-[#355661]"><option value="all">All patients in my care</option>{(patients.data||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><button data-testid="button-create-report-schedule" onClick={createScheduleNow} disabled={createSchedule.isPending} className="mt-4 h-10 rounded-xl border border-[#bfded8] bg-[#f2faf7] px-4 text-sm font-semibold text-[#317e77] hover:bg-[#e7f5f0] disabled:opacity-50">{createSchedule.isPending?'Saving schedule…':'Create recurring schedule'}</button></Card>
    </div>}
    {feedback&&<div data-testid="status-report-feedback" role="status" className={`mb-5 rounded-xl border px-4 py-3 text-sm ${feedback.includes('failed')||feedback.includes('Could not')?'border-red-200 bg-red-50 text-red-800':'border-[#cfe7df] bg-[#eef8f4] text-[#37796b]'}`}>{feedback}</div>}
    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Report history</h2><p className="mt-1 text-xs text-[#81969b]">Previously generated care summaries</p></div>{reports.isLoading?<ListSkeleton/>:reports.isError?<ErrorState retry={()=>reports.refetch()}/>:!reports.data?.length?<EmptyState title="No reports yet" body={canManage?'Generated summaries will be saved here for quick access.':'Reports shared with your care team will appear here.'} icon={FileText}/>:<div className="divide-y divide-[#edf2f2]">{reports.data.map(r=><ReportRow key={r.id} report={r}/>)}</div>}</Card>
      <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Report schedules</h2><p className="mt-1 text-xs text-[#81969b]">Upcoming weekly and monthly summaries</p></div>{schedules.isLoading?<ListSkeleton/>:schedules.isError?<ErrorState retry={()=>schedules.refetch()}/>:!schedules.data?.length?<EmptyState title="No recurring reports" body={canManage?'Create a schedule to keep summaries coming at a regular cadence.':'There are no active report schedules to show.'} icon={CalendarDays}/>:<div className="divide-y divide-[#edf2f2]">{schedules.data.map(s=><ReportScheduleRow key={s.id} schedule={s} patients={patients.data||[]} canManage={canManage}/>)}</div>}</Card>
    </div>
    <p className="mt-5 text-xs leading-5 text-[#859a9e]">Reports summarize recorded dose activity for care coordination. They do not replace a clinical review.</p>
  </div>;
}
function ReportRow({report:r}:{report:Report}){
  const name=r.patientName||'Full care caseload';
  return <div data-testid={`row-report-${r.id}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eaf3f5] text-[#477f8e]"><FileText size={18}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold capitalize text-[#355661]" data-testid={`text-report-period-${r.id}`}>{r.period} report</span><span className="rounded-full bg-[#f0f5f5] px-2 py-0.5 text-[10px] text-[#71898e]">{name}</span></div><div className="mt-1 text-xs text-[#82979b]">{r.rangeStart} – {r.rangeEnd} · Created {new Date(r.createdAt).toLocaleDateString()}</div><p data-testid={`text-report-summary-${r.id}`} className="mt-1 line-clamp-2 text-xs leading-5 text-[#688188]">{r.summary}</p></div><div className="flex items-center gap-2 sm:flex-col sm:items-end"><span className="text-lg font-extrabold text-[#337d7a]" data-testid={`text-report-adherence-${r.id}`}>{Math.round(r.adherenceRate)}%</span><div className="flex gap-1.5"><a href={`/api/reports/${r.id}/pdf`} onClick={nativeDownload(`/api/reports/${r.id}/pdf`,`caretrack-report-${r.id}.pdf`)} download data-testid={`link-download-report-pdf-${r.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dce8e8] px-2.5 text-[11px] font-semibold text-[#52747c] hover:bg-[#f4f8f8]"><Download size={13}/>PDF</a><a href={`/api/reports/${r.id}/csv`} onClick={nativeDownload(`/api/reports/${r.id}/csv`,`caretrack-report-${r.id}.csv`)} download data-testid={`link-download-report-csv-${r.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dce8e8] px-2.5 text-[11px] font-semibold text-[#52747c] hover:bg-[#f4f8f8]"><Download size={13}/>CSV</a></div></div></div>;
}
function ReportScheduleRow({schedule:s,patients,canManage}:{schedule:ReportSchedule;patients:Patient[];canManage:boolean}){
  const update=useUpdateReportSchedule(),qc=useQueryClient();
  const p=s.patientId?patients.find(x=>x.id===s.patientId)?.name:'All patients';
  const toggle=()=>update.mutate({id:s.id,data:{active:!s.active}},{onSuccess:()=>qc.invalidateQueries({queryKey:getListReportSchedulesQueryKey()})});
  return <div data-testid={`row-report-schedule-${s.id}`} className="flex items-center gap-3 px-5 py-4 sm:px-6"><div className={`h-2.5 w-2.5 rounded-full ${s.active?'bg-[#54b59c]':'bg-[#a9b8ba]'}`}/><div className="min-w-0 flex-1"><div className="text-sm font-semibold capitalize text-[#355661]">{s.cadence} report · {p||`Patient ${s.patientId}`}</div><div className="mt-1 text-xs text-[#82979b]">{s.active?'Next run':'Paused'} · {new Date(s.nextRunAt).toLocaleDateString()}</div></div><StatusPill status={s.active?'active':'inactive'}/>{canManage&&<button data-testid={`button-toggle-report-schedule-${s.id}`} disabled={update.isPending} onClick={toggle} className="rounded-lg border border-[#dce8e8] px-3 py-2 text-xs font-semibold text-[#587780] hover:bg-[#f5f9f9]">{s.active?'Pause':'Resume'}</button>}</div>;
}
function ListSkeleton(){return <div data-testid="status-loading" className="space-y-3 p-5">{[1,2,3].map(i=><div key={i} className="h-16 animate-pulse rounded-xl bg-[#f1f6f6]"/>)}</div>}

function AuditPage(){
  const [limit,setLimit]=useState(50),[search,setSearch]=useState('');
  const query=useListAuditLogs({limit},{query:{queryKey:getListAuditLogsQueryKey({limit})}});
  const rows=(query.data||[]).filter(x=>`${x.userName||''} ${x.action} ${x.entityType} ${JSON.stringify(x.details)}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page-enter"><PageHeading eyebrow="Governance" title="Audit activity" description="A chronological record of important changes across this CareTrack workspace."/>
    <Card><div className="flex flex-col gap-3 border-b border-[#eaf0f0] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><h2 className="font-bold text-[#254954]">Recent events</h2><p className="mt-1 text-xs text-[#81969b]">Administrative view of account and care-plan activity</p></div><div className="flex gap-2"><label className="flex h-10 items-center gap-2 rounded-xl border border-[#dce8e8] px-3"><Search size={15} className="text-[#81969b]"/><input data-testid="input-search-audit" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter activity…" className="w-36 bg-transparent text-xs outline-none sm:w-48"/></label><select data-testid="select-audit-limit" value={limit} onChange={e=>setLimit(Number(e.target.value))} className="h-10 rounded-xl border border-[#dce8e8] bg-white px-3 text-xs text-[#55737a]"><option value={25}>25 events</option><option value={50}>50 events</option><option value={100}>100 events</option><option value={200}>200 events</option></select></div></div>
      {query.isLoading?<ListSkeleton/>:query.isError?<ErrorState retry={()=>query.refetch()}/>:rows.length===0?<EmptyState title={search?'No matching activity':'No activity recorded yet'} body={search?'Try a broader search term.':'When important workspace changes are recorded, they will appear here.'} icon={Activity}/>:<div className="divide-y divide-[#edf2f2]">{rows.map(log=><AuditRow key={log.id} log={log}/>)}</div>}
    </Card>
  </div>;
}
function AuditRow({log}:{log:AuditLog}){
  return <div data-testid={`row-audit-log-${log.id}`} className="flex items-start gap-3 px-5 py-4 sm:px-6"><div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#edf4f4] text-[#64868a]"><Activity size={16}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-[#355661]" data-testid={`text-audit-action-${log.id}`}>{log.action.replaceAll('_',' ')}</span><span className="rounded-full bg-[#f1f6f6] px-2 py-0.5 text-[10px] capitalize text-[#71898e]">{log.entityType}{log.entityId?` · #${log.entityId}`:''}</span></div><div className="mt-1 text-xs text-[#82979b]">{log.userName||'System'} · {dateTimeLabel(log.createdAt,{year:'numeric',month:'short',day:'numeric'})}</div>{Object.keys(log.details||{}).length>0&&<details className="mt-2"><summary data-testid={`button-audit-details-${log.id}`} className="cursor-pointer text-[11px] font-semibold text-[#42817f]">View event details</summary><pre data-testid={`text-audit-details-${log.id}`} className="mt-2 max-w-full overflow-x-auto rounded-lg bg-[#f5f8f8] p-3 text-[10px] leading-4 text-[#60797f]">{JSON.stringify(log.details,null,2)}</pre></details>}</div></div>;
}

function Field({label,name,type='text',required=false,defaultValue,placeholder,minLength,min}:{label:string;name:string;type?:string;required?:boolean;defaultValue?:string|number;placeholder?:string;minLength?:number;min?:string}){
  return <label className="block text-xs font-semibold text-[#526f77]">{label}<input data-testid={`input-${name}`} name={name} type={type} required={required} minLength={minLength} min={min} defaultValue={defaultValue} placeholder={placeholder} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal text-[#31515c] outline-none transition placeholder:text-[#a5b4b7] focus:border-primary focus:ring-2 focus:ring-primary/10"/></label>;
}
function Modal({title,subtitle,onClose,children}:{title:string;subtitle:string;onClose:()=>void;children:ReactNode}){
  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[#153944]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div role="dialog" aria-modal="true" className="max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-[560px] sm:rounded-3xl sm:p-7 page-enter"><div className="mb-5 flex items-start justify-between"><div><h2 className="text-xl font-extrabold text-[#254954]" data-testid="heading-modal">{title}</h2><p className="mt-1 text-xs leading-5 text-[#81969b]">{subtitle}</p></div><button type="button" data-testid="button-close-modal" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-[#6e858a] hover:bg-[#f0f6f6]"><X size={18}/></button></div>{children}</div></div>;
}
function ModalActions({onClose,busy,submitLabel}:{onClose:()=>void;busy:boolean;submitLabel:string}){return <div className="flex justify-end gap-2 border-t border-[#edf2f2] pt-4"><button type="button" data-testid="button-cancel-form" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-semibold text-[#6b8389] hover:bg-[#f3f7f7]">Cancel</button><button type="submit" data-testid="button-submit-form" disabled={busy} className="h-10 rounded-lg bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366] disabled:opacity-60">{busy?'Saving…':submitLabel}</button></div>}

function NotFound(){return <div className="mx-auto max-w-xl py-20 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#e3f2ef] text-[#388b81]"><Stethoscope size={24}/></div><h1 className="mt-5 text-2xl font-extrabold text-[#244954]">We can’t find that page</h1><p className="mt-2 text-sm text-[#81969b]">The page may have moved, or your role may not have access to it.</p><Link href="/" data-testid="link-return-dashboard" className="mt-6 inline-flex h-10 items-center rounded-xl bg-[#17647a] px-4 text-sm font-semibold text-white">Return to my home page</Link></div>}

export default App;
