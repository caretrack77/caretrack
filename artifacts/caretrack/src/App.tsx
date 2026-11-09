import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, useLocation, useParams } from 'wouter';
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, Bell, CalendarDays, Check, Clock3, CircleHelp,
  ArrowLeftRight, ClipboardList, Download, Eye, EyeOff, FileText, KeyRound, UserPlus, HeartPulse, LayoutDashboard, LogOut, Mail, Menu, MessageSquare, Plus, Pill,
  Search, Send, ShieldCheck, Sparkles, Stethoscope, Users, Wifi, WifiOff, X,
} from 'lucide-react';
import {
  getGetAnalyticsQueryKey, getGetPatientQueryKey, getListAuditLogsQueryKey,
  getListDosesQueryKey, getListMedicationsQueryKey, getListNotificationsQueryKey,
  getListPatientInsightsQueryKey, getListReportSchedulesQueryKey, getListReportsQueryKey,
  getListPatientsQueryKey, getListUsersQueryKey, useCreateDemoDose, useCreateMedication, useCreatePatient,
  useCreateReportSchedule, useCreateUser, useDeleteMedication, useGeneratePatientInsight,
  useGenerateReport, useGetAnalytics, useGetCurrentUser, useGetPatient, useListAuditLogs,
  useListDoses, useListMedications, useListNotifications, useListPatientInsights, useListPatients,
  useListReportSchedules, useListReports, useListUsers, useLogin, useLogout, useMarkNotificationRead, useSimulateOverdueDoses,
  useUpdateDoseStatus, useUpdateMedication, useSendLoginOtp, useVerifyLoginOtp, useChangePassword, getGetCurrentUserQueryKey, useGetRiskModel, getGetRiskModelQueryKey, useTrainRiskModel, useListRiskPredictions, getListRiskPredictionsQueryKey, useGetPatientRisk, getGetPatientRiskQueryKey, useListLabResults, getListLabResultsQueryKey, useUploadLabResult, useReviewLabResult, useListAppointments, getListAppointmentsQueryKey, useCreateAppointment, useUpdateAppointment, useAskAssistant, updateDoseStatus, useCreatePatientAccount, useGetDeliveryStatus, useSendDeliveryTest, useListCoverage, getListCoverageQueryKey, useCreateCoverage, useEndCoverage, useListProviders, useGetMedicationProgress, getGetMedicationProgressQueryKey, useListMessageThreads, getListMessageThreadsQueryKey, useListPatientMessages, getListPatientMessagesQueryKey, useSendPatientMessage, useMarkPatientMessagesRead,   useUpdatePatient, useUpdateReportSchedule, useUpdateUser, useListHealthMetrics, useCreateHealthMetric, useListHealthLogs, useCreateHealthLog, getListHealthMetricsQueryKey, getListHealthLogsQueryKey,
} from '@workspace/api-client-react';
import type { Analytics, Appointment, AuditLog, AuthUser, Coverage, LoginChallenge, OtpSendResult, Dose, Medication, Notification, Patient, Report, ReportSchedule, User, HealthMetric, HealthMetricInputMetricType, HealthLog } from '@workspace/api-client-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import './index.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } });
// Local calendar date (YYYY-MM-DD), not UTC, so "today" matches the user's clock.
const dateToday = () => new Date().toLocaleDateString('en-CA');
const dateTimeNow = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
};
const timeLabel = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
/** The server's error message from a failed API call, or a fallback. */
const apiError = (err: unknown, fallback: string) => {
  const data = (err as { data?: { error?: unknown } } | null)?.data;
  return typeof data?.error === 'string' ? data.error : fallback;
};
const initials = (name = '') => name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
/** Landing page for each role: patients start on their doses, everyone else on the overview. */
/** Removes cached pages and queued doses so the next person on this device sees nothing. */
const clearOfflineData = () => {
  navigator.serviceWorker?.controller?.postMessage('clear-cache');
  try { localStorage.removeItem('caretrack-offline-doses'); } catch { /* storage unavailable */ }
};
const homeFor = (role: string) => (role === 'patient' ? '/today' : '/dashboard');
const roleName = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);
const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, roles: ['admin', 'provider', 'caregiver'] },
  { href: '/today', label: 'Today’s doses', icon: ClipboardList, roles: ['patient', 'caregiver', 'provider'] },
  { href: '/patients', label: 'Patients', icon: Users, roles: ['admin', 'provider', 'caregiver'] },
  { href: '/medications', label: 'Medications', icon: Pill, roles: ['admin', 'provider', 'caregiver'] },
  { href: '/messages', label: 'Messages', icon: MessageSquare, roles: ['admin', 'provider', 'patient', 'caregiver'] },
  { href: '/ai', label: 'AI risk prediction', icon: Sparkles, roles: ['admin', 'provider'] },
  { href: '/prescriptions', label: 'My prescriptions', icon: FileText, roles: ['patient', 'caregiver'] },
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
  const submit = (e: FormEvent) => {
    e.preventDefault(); setError('');
    login.mutate({ data: { email: email.trim(), password: password.trim() } }, { onSuccess: (r) => { if (r.otpRequired) { setChallenge(r); setSent(null); setCode(''); } else setLocation('/'); }, onError: (err) => setError(apiError(err, 'We couldn’t sign you in.') + ' Passwords are case-sensitive. Use the eye button to check what you typed.') });
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
  return <div className="min-h-[100dvh] bg-[#eef6f7] text-foreground flex flex-col lg:flex-row">
    <section className="relative flex min-h-[36vh] flex-col justify-between overflow-hidden bg-[#174353] px-7 py-8 text-white lg:min-h-[100dvh] lg:w-[48%] lg:px-14 lg:py-12">
      <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full border border-white/10" />
      <div className="absolute -right-4 top-20 h-72 w-72 rounded-full border border-white/10" />
      <div className="relative flex items-center gap-3"><Brand light /><span className="rounded-full border border-white/20 px-3 py-1 text-[11px] tracking-wide text-white/70">CARE, IN SYNC</span></div>
      <div className="relative max-w-xl py-12">
        <div className="mb-6 flex items-center gap-2 text-sm font-semibold tracking-[.16em] text-[#73d8c4]"><span className="h-px w-8 bg-[#73d8c4]" /> MADE FOR EVERYDAY CARE</div>
        <h1 className="max-w-lg text-4xl font-bold leading-[1.1] tracking-[-.045em] sm:text-5xl lg:text-[58px]">A steadier rhythm for better care.</h1>
        <p className="mt-6 max-w-md text-base leading-7 text-white/70">CareTrack keeps medication schedules clear for the people who give care and the people who receive it.</p>
        <div className="mt-12 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[.06] p-4 backdrop-blur-sm">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#6bd5c0]/15 text-[#77dfc9]"><HeartPulse size={22}/></div>
          <div><div className="text-sm font-semibold">The right dose. The right moment.</div><div className="mt-1 text-xs text-white/55">A shared view of the day, without the guesswork.</div></div>
        </div>
      </div>
      <div className="relative flex items-center justify-between text-xs text-white/45"><span>Secure patient care platform</span><span>Designed for coordinated care</span></div>
    </section>
    <section className="flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
      <div className="w-full max-w-[420px] page-enter">
        <div className="mb-9"><p className="text-xs font-bold uppercase tracking-[.16em] text-primary">Welcome back</p><h2 className="mt-3 text-3xl font-bold text-[#173d4a]">Sign in to CareTrack</h2><p className="mt-2 text-sm text-muted-foreground">Sign in with the account provided by your administrator.</p></div>
        {!challenge ? <form onSubmit={submit} className={cardClass}>
          <label className="block"><span className="mb-2 block text-sm font-semibold">Email address</span><input data-testid="input-email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} className={inputClass} placeholder="you@example.com"/></label>
          <label className="block"><span className="mb-2 block text-sm font-semibold">Password</span><PasswordInput testId="input-password" required value={password} onChange={setPassword} autoComplete="current-password" className={inputClass} placeholder="Enter your password"/></label>
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
          {sent && <div data-testid="status-otp-sent" role="status" className={`rounded-xl border p-3 text-xs leading-5 ${sent.delivered?'border-[#cfe7df] bg-[#eef8f4] text-[#37796b]':'border-[#f0dfb8] bg-[#fdf7ea] text-[#8a6a2a]'}`}><div className="flex items-center gap-1.5 font-semibold">{sent.delivered?<Wifi size={14}/>:<WifiOff size={14}/>}{sent.delivered?'Online':'Offline mode'}</div><div className="mt-1">{sent.message}</div>{sent.offlineCode&&<div className="mt-2 text-center font-mono text-2xl font-bold tracking-[.4em] text-[#5f4a1c]" data-testid="text-offline-code">{sent.offlineCode}</div>}</div>}
          {sent && <form onSubmit={verify} className="space-y-4"><label className="block"><span className="mb-2 block text-sm font-semibold">6-digit code</span><input data-testid="input-otp" inputMode="numeric" autoComplete="one-time-code" autoFocus required pattern="\d{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} className={`${inputClass} text-center font-mono text-xl tracking-[.5em]`} placeholder="••••••"/></label>
            <button data-testid="button-verify-otp" disabled={verifyOtp.isPending||code.length!==6} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#17647a] font-semibold text-white shadow-sm transition hover:bg-[#125366] disabled:opacity-60">{verifyOtp.isPending ? 'Verifying…' : 'Verify and sign in'} <ArrowRight size={17}/></button>
            <p className="text-center text-[11px] text-muted-foreground">Code expires in {Math.round(sent.expiresInSeconds/60)} minutes. Didn’t get it? Choose an option above to resend.</p></form>}
          {error && <div data-testid="status-login-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          <button type="button" data-testid="button-otp-back" onClick={restart} className="flex items-center gap-1.5 text-xs font-semibold text-[#47737b] hover:text-primary"><ArrowLeft size={14}/> Use a different account</button>
        </div>}
      </div>
    </section>
  </div>;
}

function Brand({light=false}:{light?:boolean}) {
  return <div className="flex items-center gap-2.5" data-testid="brand-caretrack"><div className={`grid h-9 w-9 place-items-center rounded-xl ${light?'bg-[#67d2bd]/15 text-[#75dfc8]':'bg-[#dff4f0] text-[#177b7c]'}`}><HeartPulse size={21} strokeWidth={2.2}/></div><span className={`font-[Manrope] text-[19px] font-extrabold tracking-[-.04em] ${light?'text-white':'text-[#184451]'}`}>caretrack<span className="text-[#44aa9f]">.</span></span></div>;
}

function AuthenticatedApp() {
  const [currentPath, setLocation] = useLocation();
  const me = useGetCurrentUser();
  const user = me.data as AuthUser | undefined;
  const threads = useListMessageThreads({ query: { enabled: !!user && !user.mustChangePassword, queryKey: getListMessageThreadsQueryKey(), refetchInterval: 10_000 } });
  const unreadMessages = (threads.data || []).reduce((n, t) => n + t.unreadCount, 0);
  useRealtimeEvents(Boolean(user && !user.mustChangePassword));
  const logout = useLogout();
  const [mobileNav,setMobileNav]=useState(false);
  if (me.isLoading) return <LoadingScreen/>;
  if (me.isError || !user) return <LoginRedirect/>;
  if (user.mustChangePassword) return <FirstLoginPasswordScreen user={user} onSignOut={()=>logout.mutate(undefined,{onSuccess:()=>{client.clear();clearOfflineData();setLocation('/login')}})}/>;
  if (!user.privacyConsentAccepted) return <PrivacyConsentScreen user={user} onSignOut={()=>logout.mutate(undefined,{onSuccess:()=>{client.clear();clearOfflineData();setLocation('/login')}})}/>;
  const pathTitle = currentPath;
  const home = homeFor(user.role);
  if (pathTitle === '/' || (pathTitle === '/dashboard' && home !== '/dashboard')) return <Redirect to={home}/>;
  return <div className="min-h-[100dvh] bg-[#f2f7f7] text-[#203c46]">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col bg-[#174353] px-4 py-6 text-white lg:flex">
      <div className="px-3"><Brand light/></div>
      <div className="mx-3 mt-8 rounded-2xl border border-white/10 bg-white/[.06] p-3"><div className="flex items-center gap-3"><Avatar name={user.name}/><div className="min-w-0"><div className="truncate text-sm font-semibold" data-testid="text-user-name">{user.name}</div><div className="mt-0.5 text-xs capitalize text-white/55" data-testid="text-user-role">{roleName(user.role)} workspace</div></div></div></div>
      <div className="mb-3 mt-8 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-white/40">Workspace</div>
      <nav aria-label="Main" className="sidebar-scroll -mx-2 min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {navItems.filter(n=>n.roles.includes(user.role)).map(({href,label:navLabel,icon:Icon})=>{const label=href==='/messages'&&user.role==='patient'?'Message my doctor':navLabel;return <Link key={href} href={href} data-testid={`link-nav-${href.slice(1).replace('/','-')}`} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium transition ${pathTitle===href?'bg-[#236275] text-white shadow-inner':'text-white/65 hover:bg-white/[.06] hover:text-white'}`}><Icon size={18} strokeWidth={1.8}/>{label}{href==='/today'&&<span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#74d9c5]"/>}{href==='/messages'&&unreadMessages>0&&<span data-testid="status-unread-messages" className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-[#74d9c5] px-1.5 text-[10px] font-bold text-[#123f4d]">{unreadMessages}</span>}</Link>})}
      </nav>
      <div className="mt-3 shrink-0 rounded-2xl border border-white/10 bg-[#103747] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#86ded0]"><ShieldCheck size={15}/> Private demo space</div><p className="mt-2 text-[11px] leading-5 text-white/50">Only your assigned care team can see this information.</p></div>
      <button data-testid="button-logout" onClick={()=>logout.mutate(undefined,{onSuccess:()=>{client.clear();clearOfflineData();setLocation('/login')}})} className="mt-4 flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/65 hover:bg-white/[.06] hover:text-white"><LogOut size={17}/> Sign out</button>
    </aside>
    {mobileNav&&<div className="fixed inset-0 z-50 bg-[#102e39]/45 lg:hidden" onClick={()=>setMobileNav(false)}><div className="sidebar-scroll flex h-full w-[280px] flex-col overflow-y-auto bg-[#174353] p-5 text-white" onClick={e=>e.stopPropagation()}><div className="flex items-center justify-between"><Brand light/><button data-testid="button-close-navigation" onClick={()=>setMobileNav(false)} className="rounded-lg p-2"><X size={18}/></button></div><nav className="mt-8 space-y-1">{navItems.filter(n=>n.roles.includes(user.role)).map(({href,label,icon:Icon})=><Link key={href} href={href} onClick={()=>setMobileNav(false)} data-testid={`mobile-link-${href.slice(1).replace('/','-')}`} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/75 hover:bg-white/10"><Icon size={18}/>{label}{href==='/messages'&&unreadMessages>0&&<span className="ml-auto rounded-full bg-[#74d9c5] px-1.5 text-[10px] font-bold text-[#123f4d]">{unreadMessages}</span>}</Link>)}</nav><button data-testid="button-logout-mobile" onClick={()=>logout.mutate(undefined,{onSuccess:()=>{client.clear();clearOfflineData();setLocation('/login')}})} className="mt-8 flex items-center gap-3 px-3 py-3 text-sm text-white/70"><LogOut size={17}/>Sign out</button></div></div>}
    <div className="lg:pl-[252px]">
      <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-[#dfebeb] bg-[#f7fbfb]/95 px-4 backdrop-blur sm:px-8">
        <button data-testid="button-open-navigation" onClick={()=>setMobileNav(true)} className="rounded-lg p-2 text-[#42616c] lg:hidden"><Menu size={21}/></button>
        <div className="hidden text-sm text-[#67818a] sm:block">Care, made clearer <span className="mx-2 text-[#a5b7bb]">/</span><span className="font-semibold text-[#254a57]">{navItems.find(x=>x.href===pathTitle)?.label||'Patient details'}</span></div>
        <div className="ml-auto flex items-center gap-3"><div className="hidden items-center gap-2 rounded-full border border-[#d9e8e8] bg-white px-3 py-1.5 text-xs text-[#67818a] sm:flex"><span className="h-2 w-2 rounded-full bg-[#4cb7a3]"/>{new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</div><NotificationBell readOnly={user.role==='caregiver'}/><button data-testid="button-help" title="CareTrack demo help" className="grid h-9 w-9 place-items-center rounded-full border border-[#dce8e9] bg-white text-[#587680] hover:bg-[#f0f7f7]"><CircleHelp size={17}/></button><Avatar name={user.name} small/></div>
      </header>
      <OfflineSync/>
      <main className="mx-auto max-w-[1450px] px-4 py-6 sm:px-8 sm:py-8">
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
          <Route path="/appointments"><AppointmentsPage user={user}/></Route>
          <Route path="/messages"><MessagesPage user={user}/></Route>
          <Route path="/analytics"><RoleGate user={user} allowed={['admin','provider']}><AnalyticsPage/></RoleGate></Route>
          <Route path="/reports"><RoleGate user={user} allowed={['admin','provider','caregiver']}><ReportsPage user={user}/></RoleGate></Route>
          <Route path="/admin/users"><RoleGate user={user} allowed={['admin']}><UsersPage user={user}/></RoleGate></Route>
          <Route path="/admin/audit"><RoleGate user={user} allowed={['admin']}><AuditPage/></RoleGate></Route>
          <Route component={NotFound}/>
        </Switch>
      </main>
      <footer className="px-4 pb-8 text-center text-[11px] leading-5 text-[#90a5aa] sm:px-8"><span className="block">CareTrack is a capstone demonstration. All people and care schedules are fictional.</span><span className="block">AI suggestions support, not replace, clinical judgment.</span></footer>
      {(user.role==='patient'||user.role==='caregiver')&&<AssistantWidget/>}
    </div>
  </div>;
}

/** SSE is the primary live update channel; existing React Query polling remains a fallback. */
function useRealtimeEvents(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events');
    const refresh = (event: Event) => {
      let data: {patientId?:number} = {};
      try { data = (event as MessageEvent<string>).data ? JSON.parse((event as MessageEvent<string>).data) : {}; } catch { /* non-message SSE keepalive */ }
      qc.invalidateQueries({ queryKey: getListMessageThreadsQueryKey() });
      qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
      if (data.patientId) qc.invalidateQueries({ queryKey: getListPatientMessagesQueryKey(data.patientId) });
    };
    source.addEventListener('message', refresh);
    source.addEventListener('notification', refresh);
    source.onerror = () => { source.close(); };
    return () => source.close();
  }, [enabled, qc]);
}

function LoginRedirect(){const [,setLocation]=useLocation();setLocation('/login');return <LoadingScreen/>}
function RoleGate({user,allowed,children}:{user:AuthUser;allowed:string[];children:ReactNode}){return allowed.includes(user.role)?<>{children}</>:<AccessDenied/>}
function LoadingScreen(){return <div className="grid min-h-[100dvh] place-items-center bg-[#f2f7f7]"><div className="w-full max-w-md space-y-4 p-8" data-testid="status-loading"><div className="h-12 w-40 animate-pulse rounded-xl bg-[#dce9e9]"/><div className="h-32 animate-pulse rounded-2xl bg-white"/><div className="h-24 animate-pulse rounded-2xl bg-white"/></div></div>}
function Avatar({name,small=false}:{name:string;small?:boolean}){return <div data-testid="img-avatar" className={`grid shrink-0 place-items-center rounded-full bg-[#d9efeb] font-bold text-[#23716f] ${small?'h-9 w-9 text-xs':'h-10 w-10 text-sm'}`}>{initials(name)}</div>}

function PageHeading({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:ReactNode}){return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 text-[11px] font-bold uppercase tracking-[.17em] text-[#3d9290]">{eyebrow}</div><h1 className="text-[28px] font-extrabold leading-tight tracking-[-.045em] text-[#1c424f] sm:text-[34px]" data-testid="heading-page">{title}</h1><p className="mt-2 max-w-xl text-sm leading-6 text-[#708990]" data-testid="text-page-description">{description}</p></div>{action}</div>}
function Card({children,className='',testId}:{children:ReactNode;className?:string;testId?:string}){return <section data-testid={testId} className={`care-shadow rounded-2xl border border-[#e0ebeb] bg-white ${className}`}>{children}</section>}
function EmptyState({title,body,icon:Icon=ClipboardList}:{title:string;body:string;icon?:typeof ClipboardList}){return <div className="grid place-items-center px-5 py-12 text-center" data-testid="state-empty"><div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#e8f5f2] text-[#358f88]"><Icon size={22}/></div><p className="font-semibold text-[#31535e]">{title}</p><p className="mt-1 max-w-sm text-sm leading-6 text-[#83989e]">{body}</p></div>}
function ErrorState({retry}:{retry:()=>void}){return <div className="m-5 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4" data-testid="status-error"><div><div className="text-sm font-semibold text-red-900">We couldn’t load this information</div><div className="mt-1 text-xs text-red-700">Check your connection and try again.</div></div><button data-testid="button-retry" onClick={retry} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800">Try again</button></div>}
function StatusPill({status}:{status:string}){const styles:Record<string,string>={taken:'bg-[#e5f5ee] text-[#28745a]',scheduled:'bg-[#e9f2f6] text-[#366a7d]',missed:'bg-[#fff0eb] text-[#ad5b45]',skipped:'bg-[#f1f1f0] text-[#687a7c]',active:'bg-[#e5f5ee] text-[#28745a]',inactive:'bg-[#f2f3f3] text-[#778589]'};return <span data-testid={`status-pill-${status}`} className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${styles[status]||styles.scheduled}`}>{status}</span>}

function NotificationBell({readOnly}:{readOnly:boolean}){
  const query=useListNotifications({query:{queryKey:getListNotificationsQueryKey(),refetchInterval:30_000}}),mark=useMarkNotificationRead(),qc=useQueryClient(),[open,setOpen]=useState(false);
  const notifications=query.data||[],unread=notifications.filter(n=>!n.read).length;
  useNotificationAlerts(notifications);
  const [,go]=useLocation();
  const read=(item:Notification)=>{if(item.kind==='reminder'||item.kind==='overdue'){setOpen(false);go('/today')}else if(item.kind==='ai-risk'&&item.patientId){setOpen(false);go(`/patients/${item.patientId}`)}else if(item.kind==='appointment'){setOpen(false);go('/appointments')}else if(item.kind==='prescription'){setOpen(false);go('/prescriptions')}else if(item.kind==='message'){setOpen(false);go(item.patientId?`/messages?patient=${item.patientId}`:'/messages')}if(item.read||readOnly)return;mark.mutate({id:item.id},{onSuccess:()=>qc.invalidateQueries({queryKey:getListNotificationsQueryKey()})})};
  return <div className="relative">
    <button data-testid="button-open-notifications" aria-label={`Notifications${unread?`, ${unread} unread`:''}`} aria-expanded={open} onClick={()=>setOpen(!open)} className="relative grid h-9 w-9 place-items-center rounded-full border border-[#dce8e9] bg-white text-[#587680] transition hover:bg-[#f0f7f7]"><Bell size={16}/>{unread>0&&<span data-testid="status-unread-notifications" className="absolute -right-1 -top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-[#d9755e] px-1 text-[9px] font-bold text-white">{unread>9?'9+':unread}</span>}</button>
    {open&&<div data-testid="panel-notifications" className="absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[#dce8e8] bg-white shadow-[0_18px_45px_rgba(22,62,76,.16)]">
      <div className="flex items-center justify-between border-b border-[#edf2f2] px-4 py-3"><div><div className="text-sm font-bold text-[#254954]">Notifications</div><div className="text-[11px] text-[#81969b]">{unread?`${unread} unread`:'You’re all caught up'}</div></div><button data-testid="button-close-notifications" onClick={()=>setOpen(false)} className="rounded-lg p-1.5 text-[#789096] hover:bg-[#f2f7f7]"><X size={16}/></button></div>
      <SoundSettings/>{query.isLoading?<div data-testid="status-notifications-loading" className="space-y-2 p-4"><div className="h-12 animate-pulse rounded-xl bg-[#eff5f5]"/><div className="h-12 animate-pulse rounded-xl bg-[#eff5f5]"/></div>:query.isError?<div data-testid="status-notifications-error" className="p-4 text-xs text-[#a55348]">Notifications couldn’t be loaded. <button data-testid="button-retry-notifications" onClick={()=>query.refetch()} className="font-semibold underline">Try again</button></div>:notifications.length===0?<div data-testid="state-notifications-empty" className="p-6 text-center"><div className="text-sm font-semibold text-[#45636c]">Nothing new</div><div className="mt-1 text-xs text-[#8aa0a4]">Updates from your care team will appear here.</div></div>:<div className="max-h-[360px] divide-y divide-[#edf2f2] overflow-y-auto">{notifications.slice(0,8).map(n=><button key={n.id} data-testid={`notification-item-${n.id}`} onClick={()=>read(n)} disabled={mark.isPending} className={`block w-full px-4 py-3 text-left transition hover:bg-[#f6faf9] ${n.read?'':'bg-[#f1f8f6]'}`}><div className="flex items-start gap-2.5"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read?'bg-transparent':'bg-[#42ad99]'}`}/><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-[#355661]" data-testid={`text-notification-title-${n.id}`}>{n.title}</span><span className="shrink-0 text-[10px] text-[#96a8ac]">{new Date(n.createdAt).toLocaleDateString()}</span></span><span className="mt-1 block text-xs leading-5 text-[#71888e]">{n.message}</span></span></div></button>)}</div>}
    </div>}
  </div>;
}

function Dashboard({user}:{user:AuthUser}){
  const patients=useListPatients(), doses=useListDoses({date:dateToday()}), meds=useListMedications(), createDemo=useCreateDemoDose(), simulate=useSimulateOverdueDoses();
  const qc=useQueryClient(),[demoFeedback,setDemoFeedback]=useState('');
  const doseList=doses.data||[], patientList=(patients.data||[]).filter(p=>p.active);
  const completed=doseList.filter(d=>d.status==='taken').length, total=doseList.length, percent=total?Math.round(completed/total*100):0;
  const canDemo=user.role==='provider'||user.role==='admin';
  const refreshDemo=()=>{qc.invalidateQueries({queryKey:getListDosesQueryKey()});qc.invalidateQueries({queryKey:getListNotificationsQueryKey()});qc.invalidateQueries({queryKey:getGetAnalyticsQueryKey()})};
  // The linked demo patient (Alex Morgan) makes reminders visible on the patient and caregiver accounts.
  const addDemo=()=>{const p=patientList.find(x=>x.userId)||patientList[0],m=(meds.data||[]).find(x=>x.patientId===p?.id&&x.active);if(!p||!m){setDemoFeedback('Add an active medication to a patient first.');return}createDemo.mutate({data:{patientId:p.id,medicationId:m.id}},{onSuccess:()=>{refreshDemo();setDemoFeedback(`${m.name} for ${p.name} is now due. A reminder was sent to the patient and caregiver.`)},onError:()=>setDemoFeedback('Could not create a demo dose.')})};
  const simulateNow=()=>simulate.mutate(undefined,{onSuccess:r=>{refreshDemo();setDemoFeedback(r.missedCount?`Simulated 2 hours passing: ${r.missedCount} overdue dose${r.missedCount===1?' was':'s were'} marked missed and alerts were sent.`:'No doses are currently due. Add a demo dose first, then simulate time.')},onError:()=>setDemoFeedback('Could not run the simulation.')});
  const loading=patients.isLoading||doses.isLoading;
  return <div className="page-enter">
    <PageHeading eyebrow="Your care at a glance" title={`Good ${new Date().getHours()<12?'morning':new Date().getHours()<18?'afternoon':'evening'}, ${user.name.split(' ')[0]}`} description="Here’s how today is taking shape across your care team." action={canDemo?<div className="flex flex-wrap gap-2"><button data-testid="button-demo-dose" title="Creates a dose that is due right now" onClick={addDemo} disabled={createDemo.isPending||patientList.length===0} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#c8e2df] bg-white px-4 text-sm font-semibold text-[#247b79] transition hover:bg-[#eef9f6] disabled:opacity-50"><Plus size={16}/>{createDemo.isPending?'Adding dose…':'Mark a dose due now'}</button><button data-testid="button-simulate-time" title="Moves due doses past the 2-hour grace period" onClick={simulateNow} disabled={simulate.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#17647a] px-4 text-sm font-semibold text-white transition hover:bg-[#125366] disabled:opacity-50"><Clock3 size={16}/>{simulate.isPending?'Simulating…':'Simulate 2 hours'}</button></div>:undefined}/>
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
           {doseList.length===0?<EmptyState title="A clear start to the day" body="There are no doses scheduled for today yet. Active medication schedules will appear here."/>:<div className="divide-y divide-[#edf2f2]">{doseList.slice(0,6).map(d=><DoseRow key={d.id} dose={d} patientName={patientList.find(p=>p.id===d.patientId)?.name} compact readOnly={user.role==='caregiver'} role={user.role}/>)}</div>}
        </Card>
        <Card><div className="flex items-center justify-between border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><h2 className="font-bold text-[#254954]">Assigned patients</h2><p className="mt-1 text-xs text-[#80969c]">Your active care relationships</p></div><Link href="/patients" data-testid="link-view-patients" className="grid h-8 w-8 place-items-center rounded-lg text-[#60818b] hover:bg-[#f1f7f7]"><ArrowRight size={16}/></Link></div>
          {!patientList.length?<EmptyState title="No patients assigned yet" body="New patient profiles assigned to your care will appear here." icon={Users}/>:<div className="divide-y divide-[#edf2f2]">{patientList.slice(0,5).map(p=><Link href={`/patients/${p.id}`} key={p.id} data-testid={`row-dashboard-patient-${p.id}`} className="flex items-center gap-3 px-5 py-4 transition hover:bg-[#f8fbfb] sm:px-6"><Avatar name={p.name} small/><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-[#31535e]">{p.name}</div><div className="mt-1 truncate text-xs text-[#81969b]">{p.age} years · {p.conditions?.[0]||'Care plan in progress'}</div></div><ArrowRight size={15} className="text-[#9aafb2]"/></Link>)}</div>}
        </Card>
      </div>
      <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[#d9eae8] bg-[#eaf6f3] px-5 py-4"><div className="mt-0.5 text-[#388b81]"><HeartPulse size={18}/></div><div><p className="text-sm font-semibold text-[#315f60]">A gentle reminder</p><p className="mt-1 text-xs leading-5 text-[#698b89]">Medication tracking is here to support a conversation—not replace one. Reach out to your care team with questions.</p></div></div>
    </>}
  </div>
}
function Metric({label,value,detail,icon:Icon,accent,progress}:{label:string;value:string;detail:string;icon:typeof Activity;accent:string;progress?:number}){const color=accent==='teal'?'bg-[#e4f4f0] text-[#25867c]':accent==='blue'?'bg-[#e7f0f6] text-[#3c7790]':'bg-[#fbf1df] text-[#a77b36]';return <Card className="relative overflow-hidden p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold text-[#789098]">{label}</p><p className="mt-3 text-[32px] font-extrabold leading-none tracking-[-.05em] text-[#214754]" data-testid={`metric-${label.toLowerCase().replaceAll(' ','-')}`}>{value}</p><p className="mt-2 text-xs text-[#879ba0]">{detail}</p></div><div className={`grid h-10 w-10 place-items-center rounded-xl ${color}`}><Icon size={19}/></div></div>{progress!==undefined&&<div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#edf3f2]"><div className="h-full rounded-full bg-[#46b5a0] transition-all" style={{width:`${progress}%`}}/></div>}</Card>}
function SkeletonGrid(){return <div className="space-y-5" data-testid="status-loading"><div className="grid gap-4 sm:grid-cols-3">{[1,2,3].map(n=><div key={n} className="h-32 animate-pulse rounded-2xl bg-white"/> )}</div><div className="h-80 animate-pulse rounded-2xl bg-white"/></div>}

/** Patients can log or correct a dose until 24 hours after it was due, and up to 2 hours early. */
const DOSE_CORRECTION_WINDOW_MS=24*60*60*1000, DOSE_EARLY_WINDOW_MS=2*60*60*1000;
function DoseRow({dose,patientName,compact=false,readOnly=false,role}:{dose:Dose;patientName?:string;compact?:boolean;readOnly?:boolean;role?:string}){
  const update=useUpdateDoseStatus(), qc=useQueryClient();
  const [flash,setFlash]=useState('');
  // Offline: save locally, update the screen, and sync later.
  const saveOffline=(status:'taken'|'missed'|'skipped'|'scheduled')=>{const now=new Date().toISOString();queueDose({id:dose.id,status,takenAt:now});qc.setQueriesData<Dose[]>({queryKey:getListDosesQueryKey()},old=>old?.map(d=>d.id===dose.id?{...d,status,takenTime:status==='taken'?now:null,loggedBy:'Saved on this device (waiting to sync)'}:d));setFlash('Saved on this device. It will sync when you’re back online.');setTimeout(()=>setFlash(''),5000)};
  const change=(status:'taken'|'missed'|'skipped'|'scheduled')=>{if(!navigator.onLine){saveOffline(status);return}update.mutate({id:dose.id,data:{status}},{onSuccess:(d)=>{qc.invalidateQueries({queryKey:getListDosesQueryKey()});qc.invalidateQueries({queryKey:getGetAnalyticsQueryKey()});qc.invalidateQueries({predicate:q=>String(q.queryKey[0]).includes('medication-progress')});setFlash(status==='taken'?`Marked as taken at ${timeLabel(d.takenTime||new Date().toISOString())}`:status==='scheduled'?'Undone. This dose is waiting for you again.':`Marked as ${status}.`);setTimeout(()=>setFlash(''),4000)},onError:(err)=>{if(isNetworkError(err)){update.reset();saveOffline(status)}}})};
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
      <div className="flex min-w-0 flex-1 items-center gap-3"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${dose.status==='taken'?'bg-[#e7f5ef] text-[#35896c]':dose.status==='missed'?'bg-[#fff0eb] text-[#ad5b45]':'bg-[#eaf3f5] text-[#4a8494]'}`}>{dose.status==='taken'?<Check size={20}/>:<Pill size={19}/>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold text-[#31535e]" data-testid={`text-dose-medication-${dose.id}`}>{dose.medicationName}</span><StatusPill status={dose.status}/>{dose.status==='scheduled'&&due&&<span className="rounded-full bg-[#fbf1df] px-2 py-0.5 text-[10px] font-bold text-[#99702f]">DUE NOW</span>}</div><div className="mt-1 flex flex-wrap gap-x-3 text-xs text-[#81959a]"><span>{dose.dosage}</span>{patientName&&<span>{patientName}</span>}<span className="inline-flex items-center gap-1"><Clock3 size={12}/>Scheduled {timeLabel(dose.scheduledTime)}</span>{dose.loggedBy&&dose.status!=='scheduled'&&<span data-testid={`text-dose-logged-by-${dose.id}`} className="text-[#91a4a8]">by {dose.loggedBy}</span>}{dose.status==='taken'&&dose.takenTime&&<span className="font-semibold text-[#35896c]" data-testid={`text-dose-taken-at-${dose.id}`}>✓ Taken at {timeLabel(dose.takenTime)}</span>}{takenLate&&<span className="rounded-full bg-[#fbf1df] px-2 py-0.5 text-[10px] font-bold text-[#99702f]" title="Confirmed more than 2 hours after the scheduled time">TAKEN LATE</span>}</div></div></div>
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
  useEffect(() => {
    if (!doses.data) return;
    navigator.serviceWorker?.ready.then((registration) => registration.active?.postMessage({ type: 'cache-dose-schedule', doses: doses.data }));
  }, [doses.data]);
  useEffect(() => {
    const alarm = () => {
      const due = (doses.data || []).find((dose) => dose.status === 'scheduled' && Math.abs(new Date(dose.scheduledTime).getTime() - Date.now()) < 30_000);
      if (due) playChime();
    };
    const timer = window.setInterval(alarm, 30_000);
    alarm();
    return () => window.clearInterval(timer);
  }, [doses.data]);
  return <div className="page-enter">
    <PageHeading eyebrow="Daily routine" title="Today’s doses" description="A clear, reassuring view of what’s planned and what’s already been logged." action={<label className="flex h-10 items-center gap-2 rounded-xl border border-[#dbe7e7] bg-white px-3 text-sm text-[#58747d]"><CalendarDays size={16}/><input data-testid="input-dose-date" type="date" min={dateToday()} value={selectedDate} onChange={e=>{if(e.target.value>=dateToday())setSelectedDate(e.target.value)}} className="w-[125px] bg-transparent text-xs outline-none"/></label>}/>
    {(user.role==='patient'||user.role==='caregiver')&&<PatientAdherenceStats patientId={(patients.data||[])[0]?.id}/>}
    {(user.role==='patient'||user.role==='caregiver')&&(patients.data||[])[0]&&<MyCarePlan patientId={(patients.data||[])[0].id}/>}
    {(user.role==='patient'||user.role==='caregiver')&&(patients.data||[])[0]&&<div className="mb-5"><MedicationProgressPanel patientId={(patients.data||[])[0].id} canAdd={false} patientFacing={user.role==='patient'}/></div>}
    <Card className="mb-5 overflow-hidden"><div className="flex flex-col gap-4 bg-gradient-to-r from-[#eaf6f3] to-[#f4f9f9] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7"><div><div className="text-xs font-bold uppercase tracking-[.14em] text-[#478d88]">{selectedDate===dateToday()?'Your day, at a glance':'Selected day'}</div><h2 className="mt-1 text-xl font-bold text-[#274e58]">{filtered.filter(d=>d.status==='taken').length} of {filtered.length} doses logged</h2><p className="mt-1 text-xs text-[#789397]">Every small step counts. You can update a dose whenever you’re ready.</p></div><div className="flex h-14 w-14 items-center justify-center rounded-full border-[5px] border-[#c7e9df] bg-white text-sm font-extrabold text-[#378c7d]">{filtered.length?Math.round(filtered.filter(d=>d.status==='taken').length/filtered.length*100):0}%</div></div></Card>
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><h2 className="font-bold text-[#254954]">Dose list</h2><p className="mt-1 text-xs text-[#81969b]">{filtered.length} scheduled item{filtered.length===1?'':'s'}</p></div><div className="flex gap-1 rounded-xl bg-[#f1f6f6] p-1">{[['all','All',counts.all],['scheduled','To do',counts.scheduled],['taken','Logged',counts.taken]].map(([id,label,count])=><button key={id} data-testid={`button-dose-filter-${id}`} onClick={()=>setFilter(String(id))} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${filter===id?'bg-white text-[#285d69] shadow-sm':'text-[#81969b] hover:text-[#365963]'}`}>{label} <span className="ml-1 text-[10px] opacity-65">{count}</span></button>)}</div></div>
      {doses.isLoading?<div className="space-y-3 p-5" data-testid="status-loading">{[1,2,3].map(x=><div key={x} className="h-16 animate-pulse rounded-xl bg-[#f2f6f6]"/>)}</div>:doses.isError?<ErrorState retry={()=>doses.refetch()}/>:shown.length===0?<EmptyState title={filter==='all'?'No doses on this day':'Nothing in this view'} body={filter==='all'?'When a medication schedule is active, its planned doses will be shown here.':'Try another view to see more of the day.'}/>:<div className="divide-y divide-[#edf2f2]">{shown.map(d=><DoseRow key={d.id} dose={d} patientName={(patients.data||[]).find(p=>p.id===d.patientId)?.name} readOnly={user.role==='caregiver'} role={user.role}/>)}</div>}
    </Card>
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

/** Doctor–patient messaging. Patients see their own thread; care team members pick a patient. */
function MessagesPage({user}:{user:AuthUser}){
  const threads=useListMessageThreads({query:{queryKey:getListMessageThreadsQueryKey(),refetchInterval:5_000}});
  const initial=Number(new URLSearchParams(window.location.search).get('patient'))||0;
  const [selected,setSelected]=useState(initial);
  const [search,setSearch]=useState('');
  const list=(threads.data||[]).filter(t=>t.patientName.toLowerCase().includes(search.toLowerCase()));
  const activeId=user.role==='patient'?(threads.data?.[0]?.patientId||0):selected;
  const active=(threads.data||[]).find(t=>t.patientId===activeId);
  const showList=user.role!=='patient';
  return <div className="page-enter">
    <PageHeading eyebrow="Care conversations" title="Messages" description={user.role==='patient'?'Message your care team about your medications and how you’re feeling.':user.role==='caregiver'?'Follow conversations between your linked patient and their care team.':'Secure conversations with the patients in your care.'}/>
    <Card className="overflow-hidden"><div className={`grid ${showList?'lg:grid-cols-[320px_1fr]':''} min-h-[560px]`}>
      {showList&&<div className={`border-[#eaf0f0] lg:border-r ${activeId?'hidden lg:block':''}`}>
        <div className="border-b border-[#eaf0f0] p-4"><label className="flex h-10 items-center gap-2 rounded-xl border border-[#dce8e8] bg-[#fbfdfd] px-3"><Search size={15} className="text-[#81969b]"/><input data-testid="input-search-threads" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search patients…" className="w-full bg-transparent text-sm outline-none"/></label></div>
        {threads.isLoading?<ListSkeleton/>:threads.isError?<ErrorState retry={()=>threads.refetch()}/>:list.length===0?<EmptyState title="No conversations" body="Patients in your care will appear here." icon={MessageSquare}/>:<div className="max-h-[520px] divide-y divide-[#edf2f2] overflow-y-auto">{list.map(t=><button key={t.patientId} data-testid={`thread-${t.patientId}`} onClick={()=>setSelected(t.patientId)} className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[#f6faf9] ${activeId===t.patientId?'bg-[#eef8f6]':''}`}><Avatar name={t.patientName} small/><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-[#31535e]">{t.patientName}</span>{t.lastMessageAt&&<span className="shrink-0 text-[10px] text-[#96a8ac]">{new Date(t.lastMessageAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span>}</div><div className="mt-0.5 flex items-center gap-2"><span className={`truncate text-xs ${t.unreadCount?'font-semibold text-[#31535e]':'text-[#81969b]'}`}>{t.lastMessage?`${t.lastSenderName?.split(' ')[0]}: ${t.lastMessage}`:'No messages yet'}</span>{t.unreadCount>0&&<span className="ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#17647a] px-1.5 text-[10px] font-bold text-white">{t.unreadCount}</span>}</div></div></button>)}</div>}
      </div>}
      <div className={`flex flex-col ${showList&&!activeId?'hidden lg:flex':''}`}>
        {activeId&&active?<Conversation key={activeId} user={user} patientId={activeId} patientName={active.patientName} onBack={showList?()=>setSelected(0):undefined}/>:threads.isLoading?<ListSkeleton/>:<div className="grid flex-1 place-items-center"><EmptyState title={user.role==='patient'?'Your care team inbox':'Select a conversation'} body={user.role==='patient'?'Your profile isn’t linked to a care team yet.':'Choose a patient on the left to view and send messages.'} icon={MessageSquare}/></div>}
      </div>
    </div></Card>
    <p className="mt-4 text-xs leading-5 text-[#859a9e]">For emergencies, call your local emergency number. Messages are not monitored around the clock.</p>
  </div>;
}
function Conversation({user,patientId,patientName,onBack}:{user:AuthUser;patientId:number;patientName:string;onBack?:()=>void}){
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
    <div className="flex items-center gap-3 border-b border-[#eaf0f0] px-4 py-3 sm:px-5">{onBack&&<button data-testid="button-back-threads" onClick={onBack} aria-label="Back to conversations" className="rounded-lg p-1.5 text-[#587680] hover:bg-[#f1f7f7] lg:hidden"><ArrowLeft size={18}/></button>}<Avatar name={user.role==='patient'?(doctorName||'Care Team'):patientName} small/><div className="min-w-0"><div className="truncate text-sm font-bold text-[#254954]" data-testid="text-conversation-title">{user.role==='patient'?(doctorName||'My care team'):patientName}</div><div className="flex items-center gap-1.5 text-[11px] text-[#81969b]"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4bb19d] opacity-60"/><span className="relative inline-flex h-2 w-2 rounded-full bg-[#4bb19d]"/></span>{user.role==='patient'?(me?.coveringProviderName?`Covering for ${me.assignedProviderName} · live chat`:'Your doctor · live chat'):'Patient · live chat'}</div></div>{user.role!=='patient'&&<Link href={`/patients/${patientId}`} className="ml-auto rounded-lg border border-[#dce8e8] px-2.5 py-1.5 text-[11px] font-semibold text-[#397d7e] hover:bg-[#f3f9f8]">View profile</Link>}</div>
    <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto bg-[#f7fbfb] px-4 py-5 sm:px-6" style={{maxHeight:440,minHeight:320}} data-testid="list-messages">
      {messages.isLoading?<ListSkeleton/>:messages.isError?<ErrorState retry={()=>messages.refetch()}/>:list.length===0&&pending.length===0?<EmptyState title="No messages yet" body={canSend?'Start the conversation below.':'Messages between the patient and care team will appear here.'} icon={MessageSquare}/>:list.map(m=>{const mine=m.senderId===user.id;const day=new Date(m.createdAt).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});const showDay=day!==lastDay;lastDay=day;return <div key={m.id}>{showDay&&<div className="my-2 text-center text-[10px] font-semibold uppercase tracking-wider text-[#9aadb1]">{day}</div>}<div data-testid={`message-${m.id}`} className={`flex ${mine?'justify-end':'justify-start'}`}><div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm ${mine?'rounded-br-md bg-[#17647a] text-white':'rounded-bl-md border border-[#e3eded] bg-white text-[#31535e]'}`}>{!mine&&<div className="mb-0.5 text-[11px] font-bold text-[#2f8a84]">{m.senderName} <span className="font-normal text-[#91a4a8]">· {m.senderRole==='provider'?'Doctor':roleLabel(m.senderRole)}</span></div>}<div className="whitespace-pre-wrap break-words">{m.body}</div><div className={`mt-1 text-right text-[10px] ${mine?'text-white/60':'text-[#9aadb1]'}`}>{timeLabel(m.createdAt)}</div></div></div></div>})}
      {pending.map(p=><div key={p.key} className="flex justify-end"><button type="button" disabled={!p.failed} onClick={()=>retry(p.key,p.body)} className={`max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-left text-sm leading-6 shadow-sm ${p.failed?'border border-red-200 bg-red-50 text-red-800':'bg-[#17647a]/80 text-white'}`}><div className="whitespace-pre-wrap break-words">{p.body}</div><div className={`mt-1 text-right text-[10px] ${p.failed?'text-red-600':'text-white/60'}`}>{p.failed?'Not sent · tap to retry':'Sending…'}</div></button></div>)}
    </div>
    {canSend?<form onSubmit={submit} className="border-t border-[#eaf0f0] p-3 sm:p-4"><div className="flex items-end gap-2"><textarea data-testid="input-message" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit(e)}}} rows={1} maxLength={2000} placeholder={user.role==='patient'?`Write to ${doctorName||'your doctor'}…`:`Write to ${patientName.split(' ')[0]}…`} className="max-h-32 min-h-11 flex-1 resize-y rounded-xl border border-input bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"/><button data-testid="button-send-message" disabled={!text.trim()} aria-label="Send message" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#17647a] text-white transition hover:bg-[#125366] disabled:opacity-50"><Send size={18}/></button></div>{error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}<p className="mt-1.5 text-[10px] text-[#9aadb1]">Press Enter to send, Shift+Enter for a new line.</p></form>:<div className="border-t border-[#eaf0f0] px-4 py-3 text-xs text-[#81969b]">Caregiver accounts can read this conversation but not send messages.</div>}
  </>;
}

/** Password field with a show/hide toggle. */
function PasswordInput({value,onChange,name,id,placeholder,required=false,minLength,autoComplete,className='',testId}:{value?:string;onChange?:(v:string)=>void;name?:string;id?:string;placeholder?:string;required?:boolean;minLength?:number;autoComplete?:string;className?:string;testId?:string}){
  const [shown,setShown]=useState(false);
  return <div className="relative"><input id={id} name={name} data-testid={testId} type={shown?'text':'password'} required={required} minLength={minLength} autoComplete={autoComplete} value={onChange?value:undefined} defaultValue={onChange?undefined:value} onChange={onChange?e=>onChange(e.target.value):undefined} placeholder={placeholder} className={`${className} pr-11`}/><button type="button" onClick={()=>setShown(!shown)} aria-label={shown?'Hide password':'Show password'} aria-pressed={shown} data-testid={testId?`${testId}-toggle`:undefined} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[#7b9399] hover:text-[#17647a]">{shown?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>;
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
      <div className="mb-5 flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#fbf1df] text-[#a77b36]"><KeyRound size={21}/></div><div><h1 className="text-lg font-bold text-[#173d4a]">Welcome, {user.name.split(' ')[0]}! Create your password</h1><p className="mt-1 text-xs leading-5 text-muted-foreground">Your account was set up with a temporary password. For security, choose a private password only you know before continuing.</p></div></div>
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
      const response = await fetch("/api/auth/privacy-consent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: "2026-11" }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Could not save consent.");
      await qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save consent.");
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
      <Card className="p-5 sm:p-6"><div className="flex items-center gap-3"><Avatar name={user.name}/><div className="min-w-0"><div className="truncate font-bold text-[#254954]">{user.name}</div><div className="truncate text-xs text-[#81969b]">{user.email}</div></div></div><div className="mt-5 grid grid-cols-2 gap-3"><Info label="Role" value={roleLabel(user.role)}/><Info label="Status" value={user.active?'Active':'Inactive'}/></div><div className="mt-5 rounded-xl bg-[#f4f9f8] p-3 text-xs leading-5 text-[#5f7d83]"><b className="text-[#37685f]">Sign-in protection:</b> each login asks for your password and a one-time code sent to your Gmail or phone.</div></Card>
      <Card className="p-5 sm:p-6"><h2 className="font-bold text-[#254954]">Change password</h2><p className="mb-5 mt-1 text-xs text-[#81969b]">Changing your password signs you out on every other device.</p><ChangePasswordForm/></Card>
    </div>
  </div>;
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
        <p className="mt-4 text-[11px] leading-5 text-[#91a4a8]">To move a patient to another doctor permanently, open the patient’s profile, choose <b>Edit profile</b>, and change <b>Assigned doctor</b>.</p>
      </Card>
      <Card><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Coverage schedule</h2><p className="mt-1 text-xs text-[#81969b]">Current, upcoming and past handovers</p></div>
        {coverage.isLoading?<ListSkeleton/>:coverage.isError?<ErrorState retry={()=>coverage.refetch()}/>:list.length===0?<EmptyState title="No coverage arranged" body="Handovers you create will appear here." icon={ArrowLeftRight}/>:<div className="divide-y divide-[#edf2f2]">{list.map(c=><CoverageRow key={c.id} coverage={c} onChange={refresh}/>)}</div>}
      </Card>
    </div>
  </div>;
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
    {done&&<div className="mt-4 space-y-2" data-testid="panel-patient-login-created"><div className="rounded-xl border border-[#cfe7df] bg-[#eef8f4] p-3 text-xs text-[#37796b]"><div className="font-semibold">Login created. Give these details to {patient.name.split(' ')[0]}:</div><div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1"><span>Email</span><span className="font-mono">{done.email}</span><span>Temporary password</span><span className="font-mono font-bold">{done.password}</span></div></div><p className="text-[11px] leading-5 text-[#8ba0a4]">They sign in, enter the code sent to their Gmail or phone, then create their own password.</p><button type="button" onClick={()=>navigator.clipboard?.writeText(`CareTrack login\nEmail: ${done.email}\nTemporary password: ${done.password}`)} className="h-9 rounded-lg border border-[#dce8e8] px-3 text-xs font-semibold text-[#52737c] hover:bg-[#f5f9f9]">Copy details</button></div>}
  </Card>;
}

// ---- Notification sound: gentle, rate-limited, respects mute and quiet hours ----
const SOUND_KEY='caretrack-sound', QUIET_KEY='caretrack-quiet-hours';
const readPref=(key:string,fallback:string)=>{try{return localStorage.getItem(key)??fallback}catch{return fallback}};
const writePref=(key:string,value:string)=>{try{localStorage.setItem(key,value)}catch{/* private mode */}};
let lastChime=0;
/** Two soft tones (about half a second). Plays at most once a minute and never during quiet hours (10 PM to 7 AM). */
function playChime(){
  if(readPref(SOUND_KEY,'on')!=='on')return false;
  const hour=new Date().getHours();
  if(readPref(QUIET_KEY,'on')==='on'&&(hour>=22||hour<7))return false;
  if(Date.now()-lastChime<60_000)return false;
  lastChime=Date.now();
  try{const ctx=new (window.AudioContext||(window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext)();[[660,0],[880,0.18]].forEach(([freq,at])=>{const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(0.0001,ctx.currentTime+at);gain.gain.exponentialRampToValueAtTime(0.12,ctx.currentTime+at+0.02);gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+at+0.35);osc.connect(gain).connect(ctx.destination);osc.start(ctx.currentTime+at);osc.stop(ctx.currentTime+at+0.4)});setTimeout(()=>ctx.close(),1200)}catch{/* audio blocked until the user interacts */}
  return true;
}
const ALERT_KINDS=['reminder','overdue','message','ai-risk','appointment','risk','lab','prescription'];
/** Plays a sound and shows a system notification when new important notifications arrive. */
function useNotificationAlerts(notifications:Notification[]){
  const seen=useRef<number|null>(null);
  useEffect(()=>{
    const newest=notifications.reduce((m,n)=>Math.max(m,n.id),0);
    if(seen.current===null){seen.current=newest;return}
    const fresh=notifications.filter(n=>n.id>seen.current!&&!n.read&&ALERT_KINDS.includes(n.kind));
    seen.current=Math.max(seen.current,newest);
    if(!fresh.length)return;
    const played=playChime();
    if(played&&document.hidden&&'Notification' in window&&Notification.permission==='granted'){const n=fresh[0];try{new window.Notification(`CareTrack: ${n.title}`,{body:n.message,tag:`caretrack-${n.id}`})}catch{/* unsupported */}}
  },[notifications]);
}
function SoundSettings(){
  const [sound,setSound]=useState(readPref(SOUND_KEY,'on')),[quiet,setQuiet]=useState(readPref(QUIET_KEY,'on')),[perm,setPerm]=useState(typeof Notification!=='undefined'?Notification.permission:'denied');
  return <div className="flex flex-wrap items-center gap-2 border-b border-[#edf2f2] bg-[#f8fbfb] px-4 py-2 text-[11px]">
    <button data-testid="button-toggle-sound" onClick={()=>{const v=sound==='on'?'off':'on';setSound(v);writePref(SOUND_KEY,v);if(v==='on'){lastChime=0;playChime()}}} className={`rounded-full border px-2.5 py-1 font-semibold ${sound==='on'?'border-[#9fcfc9] text-[#2f8a74]':'border-[#dce8e8] text-[#8a989b]'}`}>{sound==='on'?'🔔 Sound on':'🔕 Sound off'}</button>
    <button data-testid="button-toggle-quiet" onClick={()=>{const v=quiet==='on'?'off':'on';setQuiet(v);writePref(QUIET_KEY,v)}} className={`rounded-full border px-2.5 py-1 font-semibold ${quiet==='on'?'border-[#9fcfc9] text-[#2f8a74]':'border-[#dce8e8] text-[#8a989b]'}`}>Quiet 10 PM–7 AM: {quiet}</button>
    {perm==='default'&&<button onClick={()=>Notification.requestPermission().then(setPerm)} className="rounded-full border border-[#dce8e8] px-2.5 py-1 font-semibold text-[#397d7e]">Allow pop-up alerts</button>}
  </div>;
}

// ---- Offline mode: queue dose confirmations, sync when back online ----
const QUEUE_KEY='caretrack-offline-doses';
type QueuedDose={id:number;status:'taken'|'missed'|'skipped'|'scheduled';takenAt:string};
const readQueue=():QueuedDose[]=>{try{return JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]')}catch{return []}};
const writeQueue=(q:QueuedDose[])=>{try{localStorage.setItem(QUEUE_KEY,JSON.stringify(q));window.dispatchEvent(new Event('caretrack-queue'))}catch{/* storage unavailable */}};
const isNetworkError=(err:unknown)=>!navigator.onLine||err instanceof TypeError||(err as {status?:number})?.status===503;
function queueDose(entry:QueuedDose){writeQueue([...readQueue().filter(q=>q.id!==entry.id),entry])}
function useOnline(){const [online,setOnline]=useState(navigator.onLine);useEffect(()=>{const on=()=>setOnline(true),off=()=>setOnline(false);window.addEventListener('online',on);window.addEventListener('offline',off);return()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off)}},[]);return online}
/** Shows offline status and sends queued dose confirmations once the connection is back. */
function OfflineSync(){
  const online=useOnline(),qc=useQueryClient();
  const [pending,setPending]=useState(readQueue().length),[synced,setSynced]=useState(0);
  useEffect(()=>{const update=()=>setPending(readQueue().length);window.addEventListener('caretrack-queue',update);return()=>window.removeEventListener('caretrack-queue',update)},[]);
  useEffect(()=>{
    let stop=false;
    const flush=async()=>{if(!navigator.onLine)return;const queue=readQueue();if(!queue.length)return;let done=0;
      for(const item of queue){try{await updateDoseStatus(item.id,{status:item.status,...(item.status==='taken'?{takenAt:item.takenAt}:{})});writeQueue(readQueue().filter(q=>q.id!==item.id));done+=1}catch(err){if(isNetworkError(err))break;writeQueue(readQueue().filter(q=>q.id!==item.id))}}
      if(done&&!stop){setSynced(done);qc.invalidateQueries({queryKey:getListDosesQueryKey()});qc.invalidateQueries({queryKey:getGetAnalyticsQueryKey()});setTimeout(()=>setSynced(0),5000)}};
    void flush();const timer=setInterval(flush,20_000);window.addEventListener('online',flush);
    return()=>{stop=true;clearInterval(timer);window.removeEventListener('online',flush)};
  },[qc]);
  if(online&&!pending&&!synced)return null;
  return <div data-testid="banner-offline" role="status" className={`sticky top-[68px] z-20 flex items-center gap-2 px-4 py-2 text-xs font-semibold sm:px-8 ${!online?'bg-[#fdf3dd] text-[#7a5a1c]':synced?'bg-[#e6f4ed] text-[#2f7a5d]':'bg-[#eef5fa] text-[#2f5d72]'}`}>{!online?<WifiOff size={14}/>:<Wifi size={14}/>}{!online?`You’re offline. Showing saved information.${pending?` ${pending} dose update${pending===1?'':'s'} will sync when you’re back online.`:' Doses you log will be saved and synced later.'}`:synced?`Back online. ${synced} dose update${synced===1?'':'s'} synced.`:`Syncing ${pending} saved dose update${pending===1?'':'s'}…`}</div>;
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
    ['2','Extract features','12 parameters from each patient’s last 14 days, such as adherence, trend, missed streak, time-of-day misses, lateness, regimen complexity, age and conditions.'],
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
        <Metric label="Last trained" value={new Date(m.trainedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})} detail={`${new Date(m.trainedAt).toLocaleDateString()} · retrains every 6 hours`} icon={Clock3} accent="blue"/>
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
      <div><div className="text-[10px] font-bold uppercase tracking-wider text-[#7c9699]">Next check-up</div>{next?<div className="mt-2 rounded-xl bg-[#eef5fa] p-3 text-xs text-[#2f5d72]"><div className="font-bold">{new Date(next.scheduledAt).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</div><div className="mt-1">{next.reason}</div>{next.providerName&&<div className="mt-1 text-[#5d7f8f]">with {next.providerName}</div>}</div>:<p className="mt-2 text-xs text-[#81969b]">No check-up scheduled.</p>}</div>
    </div></Card>;
}

/** Lab result files: patients upload, doctors review. Files are encrypted on the server. */
function LabResultsPanel({patientId,canUpload,canReview,category='lab'}:{patientId:number;canUpload:boolean;canReview:boolean;category?:'lab'|'prescription'}){
  const rx=category==='prescription';
  const labs=useListLabResults(patientId,{query:{queryKey:getListLabResultsQueryKey(patientId)}});
  const upload=useUploadLabResult(),review=useReviewLabResult(),qc=useQueryClient();
  const [title,setTitle]=useState(''),[file,setFile]=useState<File|null>(null),[error,setError]=useState(''),[comment,setComment]=useState<Record<number,string>>({}),[open,setOpen]=useState(false);
  const refresh=()=>qc.invalidateQueries({queryKey:getListLabResultsQueryKey(patientId)});
  const submit=(e:FormEvent)=>{e.preventDefault();setError('');if(!file)return;if(file.size>5*1024*1024){setError('The file must be smaller than 5 MB.');return}
    const reader=new FileReader();reader.onload=()=>{const data=String(reader.result).split(',')[1]||'';upload.mutate({id:patientId,data:{title:title||file.name,fileName:file.name,mimeType:file.type||'application/octet-stream',dataBase64:data,category}},{onSuccess:()=>{setTitle('');setFile(null);setOpen(false);refresh()},onError:err=>setError(apiError(err,'Upload failed.'))})};reader.readAsDataURL(file)};
  const list=(labs.data||[]).filter(l=>l.category===category);
  return <Card testId={rx?'panel-prescription-files':'panel-lab-results'}><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><div><h2 className="font-bold text-[#254954]">{rx?'Prescription files':'Lab results'}</h2><p className="mt-1 flex items-center gap-1 text-xs text-[#81969b]"><ShieldCheck size={12}/> Files are encrypted and only visible to the care team</p></div>{canUpload&&!open&&<button data-testid="button-open-lab-upload" onClick={()=>setOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white hover:bg-[#125366]"><Plus size={14}/> {rx?'Upload prescription':'Upload result'}</button>}</div>
    {open&&<form onSubmit={submit} className="space-y-3 border-b border-[#eaf0f0] bg-[#f8fbfb] p-5 sm:px-6"><label className="block text-xs font-semibold text-[#526f77]">{rx?'Title':'What test is this?'}<input data-testid="input-lab-title" value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} placeholder={rx?'e.g. Prescription – Oct 28 check-up':'e.g. CBC, Fasting blood sugar'} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal"/></label><label className="block text-xs font-semibold text-[#526f77]">File (PDF or photo, up to 5 MB)<input data-testid="input-lab-file" type="file" required accept="application/pdf,image/png,image/jpeg,image/webp" capture="environment" onChange={e=>setFile(e.target.files?.[0]||null)} className="mt-1.5 block w-full text-xs"/></label>{error&&<p role="alert" className="text-xs text-red-700">{error}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={()=>setOpen(false)} className="h-9 rounded-lg px-3 text-xs font-semibold text-[#6b8389]">Cancel</button><button data-testid="button-upload-lab" disabled={upload.isPending||!file} className="h-9 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white disabled:opacity-50">{upload.isPending?'Uploading…':'Upload'}</button></div></form>}
    {labs.isLoading?<ListSkeleton/>:list.length===0?<EmptyState title={rx?'No prescription files yet':'No lab results yet'} body={rx?(canUpload?'Upload a scanned or photographed prescription for the patient to view and keep.':'Prescriptions your doctor uploads will appear here.'):canUpload?'Upload a photo or PDF of a laboratory result for the care team to review.':'Lab results uploaded by the patient will appear here.'} icon={FileText}/>:<div className="divide-y divide-[#edf2f2]">{list.map(l=><div key={l.id} data-testid={`row-lab-${l.id}`} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#eaf3f5] text-[#477f8e]"><FileText size={16}/></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-[#31535e]">{l.title}</div><div className="text-[11px] text-[#81969b]">{l.fileName} · {(l.sizeBytes/1024).toFixed(0)} KB · {l.uploadedByName} · {new Date(l.createdAt).toLocaleDateString()}</div></div><a href={`/api/lab-results/${l.id}/file`} target="_blank" rel="noreferrer" data-testid={`link-lab-file-${l.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dce8e8] px-2.5 text-[11px] font-semibold text-[#52747c] hover:bg-[#f4f8f8]"><Download size={13}/>Open</a></div>
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
  const row=(a:Appointment)=><div key={a.id} data-testid={`row-appointment-${a.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#eef5fa] text-[#366a7d]"><CalendarDays size={16}/></div><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-[#31535e]">{new Date(a.scheduledAt).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}{!patientId&&<span className="font-normal text-[#81969b]"> · {a.patientName}</span>}</div><div className="truncate text-xs text-[#81969b]">{a.reason}{a.providerName?` · ${a.providerName}`:''}</div></div>{a.status!=='scheduled'?<StatusPill status={a.status==='completed'?'taken':'skipped'}/>:canManage&&<div className="flex gap-1.5"><button onClick={()=>update.mutate({id:a.id,data:{status:'completed'}},{onSuccess:refresh})} className="rounded-lg border border-[#dce8e8] px-2.5 py-1.5 text-[11px] font-semibold text-[#2f8a74] hover:bg-[#eef8f4]">Done</button><button onClick={()=>{if(window.confirm('Cancel this check-up?'))update.mutate({id:a.id,data:{status:'cancelled'}},{onSuccess:refresh})}} className="rounded-lg border border-[#dce8e8] px-2.5 py-1.5 text-[11px] font-semibold text-[#a75848] hover:bg-red-50">Cancel</button></div>}</div>;
  return <Card testId="panel-appointments"><div className="border-b border-[#eaf0f0] px-5 py-4 sm:px-6"><h2 className="font-bold text-[#254954]">Follow-up check-ups</h2><p className="mt-1 text-xs text-[#81969b]">Reminders are sent a day before</p></div>
    {canManage&&<form onSubmit={submit} className="grid gap-2 border-b border-[#eaf0f0] bg-[#f8fbfb] p-4 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:px-6">{!patientId&&<select data-testid="select-appointment-patient" required value={pid} onChange={e=>setPid(e.target.value)} className="h-9 rounded-lg border border-input bg-white px-2 text-xs"><option value="" disabled>Patient</option>{(patients.data||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}<input data-testid="input-appointment-when" type="datetime-local" min={dateTimeNow()} required value={when} onChange={e=>{if(e.target.value>=dateTimeNow())setWhen(e.target.value)}} className="h-9 rounded-lg border border-input bg-white px-2 text-xs"/><input data-testid="input-appointment-reason" required maxLength={200} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason, e.g. BP follow-up" className={`h-9 rounded-lg border border-input bg-white px-2 text-xs ${patientId?'sm:col-span-2':''}`}/><button data-testid="button-create-appointment" disabled={create.isPending} className="h-9 rounded-lg bg-[#17647a] px-3 text-xs font-semibold text-white disabled:opacity-50">Schedule</button>{error&&<p className="text-xs text-red-700 sm:col-span-4">{error}</p>}</form>}
    {appts.isLoading?<ListSkeleton/>:list.length===0?<EmptyState title="No check-ups" body={canManage?'Schedule a follow-up above.':'Your doctor will schedule your next check-up here.'} icon={CalendarDays}/>:<div className="divide-y divide-[#edf2f2]">{upcoming.map(row)}{past.slice(-5).reverse().map(row)}</div>}
  </Card>;
}
function AppointmentsPage({user}:{user:AuthUser}){return <div className="page-enter"><PageHeading eyebrow="Follow-up care" title="Check-ups" description="Upcoming and past follow-up check-ups. Patients get a reminder one day before."/><AppointmentsPanel user={user}/></div>}

/** Medication assistant. It only answers care-related questions and declines anything else. */
function AssistantWidget(){
  const ask=useAskAssistant();
  const [open,setOpen]=useState(false),[text,setText]=useState('');
  const [chat,setChat]=useState<{from:'me'|'bot';text:string;offTopic?:boolean}[]>([{from:'bot',text:'Hi! Ask me about your medicines, next dose, progress or check-ups.'}]);
  const [suggestions,setSuggestions]=useState(['When is my next dose?','What if I missed a dose?','How am I doing?']);
  const send=(q:string)=>{const message=q.trim();if(!message)return;setChat(c=>[...c,{from:'me',text:message}]);setText('');ask.mutate({data:{message}},{onSuccess:r=>{setChat(c=>[...c,{from:'bot',text:r.reply,offTopic:!r.relevant}]);if(r.suggestions.length)setSuggestions(r.suggestions)},onError:()=>setChat(c=>[...c,{from:'bot',text:'I couldn’t answer right now. Please try again.'}])})};
  return <>{open&&<div data-testid="panel-assistant" className="fixed bottom-20 right-4 z-50 flex h-[460px] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#dce8e8] bg-white shadow-[0_18px_45px_rgba(22,62,76,.2)]"><div className="flex items-center justify-between bg-[#174353] px-4 py-3 text-white"><div><div className="text-sm font-bold">CareTrack assistant</div><div className="text-[10px] text-white/60">Answers medication questions only</div></div><button aria-label="Close assistant" onClick={()=>setOpen(false)} className="rounded p-1 hover:bg-white/10"><X size={16}/></button></div>
    <div className="flex-1 space-y-2 overflow-y-auto bg-[#f7fbfb] p-3">{chat.map((m,i)=><div key={i} className={`flex ${m.from==='me'?'justify-end':''}`}><div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-5 ${m.from==='me'?'bg-[#17647a] text-white':m.offTopic?'border border-[#f0dfb8] bg-[#fdf7ea] text-[#8a6a2a]':'border border-[#e3eded] bg-white text-[#31535e]'}`}>{m.text}</div></div>)}{ask.isPending&&<div className="text-[11px] text-[#81969b]">Thinking…</div>}</div>
    <div className="flex flex-wrap gap-1.5 border-t border-[#eaf0f0] px-3 py-2">{suggestions.map(s=><button key={s} onClick={()=>send(s)} className="rounded-full border border-[#dce8e8] px-2.5 py-1 text-[10px] text-[#397d7e] hover:bg-[#f3f9f8]">{s}</button>)}</div>
    <form onSubmit={e=>{e.preventDefault();send(text)}} className="flex gap-2 border-t border-[#eaf0f0] p-2"><input data-testid="input-assistant" value={text} onChange={e=>setText(e.target.value)} maxLength={500} placeholder="Ask about your medicines…" className="h-9 flex-1 rounded-lg border border-input px-3 text-xs outline-none focus:border-primary"/><button aria-label="Send" className="grid h-9 w-9 place-items-center rounded-lg bg-[#17647a] text-white"><Send size={15}/></button></form></div>}
    <button data-testid="button-open-assistant" onClick={()=>setOpen(!open)} aria-label="Open the CareTrack assistant" className="fixed bottom-4 right-4 z-50 flex h-12 items-center gap-2 rounded-full bg-[#17647a] px-4 text-sm font-semibold text-white shadow-lg hover:bg-[#125366]"><MessageSquare size={18}/>{open?'Close':'Ask CareTrack'}</button></>;
}


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
      <div className="mt-1.5 pl-5 text-sm text-[#31535e]"><span className="font-semibold text-[#17647a]">Sig:</span> Take {m.dosage} {FREQ_TEXT(m)}{m.scheduleTimes?.length?` at ${m.scheduleTimes.join(', ')}`:''}{m.endDate?` for ${Math.round((new Date(m.endDate).getTime()-new Date(m.startDate).getTime())/86_400_000)+1} days`:''}.</div>
      {m.instructions&&<div className="mt-1 pl-5 text-xs italic text-[#5f7d83]">{m.instructions}</div>}
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
  const query=useListPatients(), [search,setSearch]=useState(''), [open,setOpen]=useState(false), [editing,setEditing]=useState<Patient|null>(null);
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
      {query.isLoading?<div className="space-y-3 p-5" data-testid="status-loading">{[1,2,3].map(x=><div key={x} className="h-20 animate-pulse rounded-xl bg-[#f2f6f6]"/>)}</div>:query.isError?<ErrorState retry={()=>query.refetch()}/>:patients.length===0?<EmptyState title={search||riskFilter!=='all'?'No matching patients':'Your directory is ready'} body={search||riskFilter!=='all'?'Try a different search or status filter.':'Patients assigned to your care team will appear here.'} icon={Users}/>:<div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">{patients.map(p=><div key={p.id} data-testid={`card-patient-${p.id}`} className="rounded-2xl border border-[#e3eded] bg-white p-4 transition hover:border-[#b7d9d6] hover:shadow-[0_8px_22px_rgba(31,74,88,.06)]"><div className="flex items-start gap-3"><Avatar name={p.name}/><div className="min-w-0 flex-1"><Link href={`/patients/${p.id}`} data-testid={`link-patient-${p.id}`} className="block truncate text-sm font-bold text-[#31535e] hover:text-[#19777d]">{p.name}</Link><div className="mt-1 text-xs text-[#81969b]">{p.age} years · {p.sex.replace('_',' ')}</div></div><StatusPill status={p.active?'active':'inactive'}/></div><div className="mt-3"><RiskBadge level={levelOf(p.id)} suffix={riskOf(p.id)?`${riskOf(p.id)!.adherenceRate}%`:undefined}/></div><div className="mt-3 min-h-10 text-xs leading-5 text-[#758d93]">{p.conditions?.length?p.conditions.slice(0,2).join(' · '):'No conditions listed'}</div><div className="mt-3 flex items-center justify-between border-t border-[#edf2f2] pt-3"><span className="min-w-0 truncate text-[11px] text-[#8ba0a4]">{p.assignedProviderName||'Doctor not assigned'}{p.coveringProviderName&&<span className="ml-1 rounded-full bg-[#e9f2f6] px-1.5 py-0.5 font-semibold text-[#366a7d]" title={`${p.assignedProviderName} is away`}>Covering: {p.coveringProviderName}</span>}</span><div className="flex gap-1"><Link href={`/patients/${p.id}`} data-testid={`button-view-patient-${p.id}`} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#287d80] hover:bg-[#eef8f6]">View profile</Link>{providerMode&&<button data-testid={`button-edit-patient-${p.id}`} onClick={()=>start(p)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#728990] hover:bg-[#f3f7f7]">Edit</button>}</div></div></div>)}</div>}
    </Card>
    {open&&<PatientModal patient={editing} onClose={()=>setOpen(false)}/>}
  </div>;
}

function PatientModal({patient,onClose}:{patient:Patient|null;onClose:()=>void}){
  const create=useCreatePatient(), update=useUpdatePatient(), qc=useQueryClient(), providers=useListProviders();
  const [error,setError]=useState('');
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const data={name:String(f.get('name')),age:Number(f.get('age')),sex:String(f.get('sex')) as 'female'|'male'|'other'|'not_specified',phone:String(f.get('phone')||''),assignedProviderId:Number(f.get('assignedProviderId'))||undefined,conditions:String(f.get('conditions')||'').split(',').map(x=>x.trim()).filter(Boolean),allergies:String(f.get('allergies')||'').split(',').map(x=>x.trim()).filter(Boolean),notes:String(f.get('notes')||'')};
    const done=()=>{qc.invalidateQueries({queryKey:getListPatientsQueryKey()});if(patient)qc.invalidateQueries({queryKey:getGetPatientQueryKey(patient.id)});onClose()};
    const emailValue=String(f.get('email')||'').trim();
    if(patient)update.mutate({id:patient.id,data:{...data,email:emailValue||null}},{onSuccess:done,onError:()=>setError('Could not save patient details. Please try again.')});
    else create.mutate({data:{...data,...(emailValue?{email:emailValue}:{})}},{onSuccess:done,onError:(err)=>setError(apiError(err,'Could not create this patient. Please try again.'))});
  };
  const busy=create.isPending||update.isPending;
  return <Modal title={patient?'Edit patient profile':'Add a patient'} subtitle="A clear profile helps the care team stay in sync." onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Full name" name="name" required defaultValue={patient?.name}/><Field label="Age" name="age" type="number" required defaultValue={patient?.age||''}/></div>
    <div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs font-semibold text-[#526f77]">Sex<select name="sex" defaultValue={patient?.sex||'not_specified'} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal text-[#31515c]"><option value="not_specified">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label><Field label="Phone" name="phone" defaultValue={patient?.phone||''}/></div>
    <Field label="Email" name="email" type="email" defaultValue={patient?.email||''}/><label className="block text-xs font-semibold text-[#526f77]">Assigned doctor<select name="assignedProviderId" data-testid="select-assigned-doctor" defaultValue={patient?.assignedProviderId||''} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal text-[#31515c]"><option value="">{patient?'Keep current doctor':'Assign automatically'}</option>{(providers.data||[]).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><span className="mt-1 block font-normal text-[#8ba0a4]">Changing the doctor moves this patient permanently. For short absences, use Doctor coverage instead.</span></label><Field label="Conditions (comma separated)" name="conditions" defaultValue={patient?.conditions?.join(', ')||''}/><Field label="Allergies (comma separated)" name="allergies" defaultValue={patient?.allergies?.join(', ')||''}/><label className="block text-xs font-semibold text-[#526f77]">Care notes<textarea name="notes" defaultValue={patient?.notes||''} rows={3} className="mt-1.5 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm font-normal outline-none focus:border-primary"/></label>
    {error&&<div role="alert" data-testid="status-patient-form-error" className="text-xs text-red-700">{error}</div>}<ModalActions onClose={onClose} busy={busy} submitLabel={patient?'Save changes':'Add patient'}/>
  </form></Modal>;
}

function PatientDetailPage({user}:{user:AuthUser}){
  const params=useParams<{id:string}>(), id=Number(params.id)||0;
  const query=useGetPatient(id,{query:{enabled:!!id,queryKey:getGetPatientQueryKey(id)}});
  const patient=query.data as (Patient & {medications:Medication[];recentDoses:Dose[]})|undefined;
  const [edit,setEdit]=useState(false);
  if(query.isLoading)return <DetailSkeleton/>;
  if(query.isError||!patient)return <div><Link href="/patients" data-testid="link-back-patients" className="mb-5 inline-flex items-center gap-2 text-sm text-[#47737b]"><ArrowLeft size={16}/> Patients</Link><Card><ErrorState retry={()=>query.refetch()}/></Card></div>;
  return <div className="page-enter"><Link href="/patients" data-testid="link-back-patients" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-[#47737b] hover:text-primary"><ArrowLeft size={16}/> Patient directory</Link>
    <div className="mb-6 flex flex-col gap-4 rounded-3xl bg-[#174b5b] p-5 text-white sm:flex-row sm:items-center sm:justify-between sm:p-7"><div className="flex items-center gap-4"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-lg font-bold">{initials(patient.name)}</div><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-extrabold tracking-tight" data-testid="text-patient-detail-name">{patient.name}</h1><span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#a6e5d9]">{patient.active?'Active':'Inactive'}</span></div><p className="mt-1 text-sm text-white/60">{patient.age} years · {patient.sex.replace('_',' ')}{patient.phone?` · ${patient.phone}`:''}</p></div></div><div className="flex flex-wrap gap-2"><Link href={`/messages?patient=${patient.id}`} data-testid="button-message-patient" className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#174b5b] hover:bg-[#e8f4f2]"><MessageSquare size={16}/> Messages</Link>{(user.role==='admin'||user.role==='provider')&&<button data-testid="button-edit-patient-detail" onClick={()=>setEdit(true)} className="h-10 rounded-xl border border-white/20 px-4 text-sm font-semibold hover:bg-white/10">Edit profile</button>}</div></div>
    <div className="mb-5"><AiRiskCard patientId={patient.id}/></div>
    <div className="mb-5"><HealthMetricsPanel patientId={patient.id} canRecord={user.role==='admin'||user.role==='provider'||user.role==='patient'||user.role==='caregiver'}/></div>
    <div className="mb-5"><MedicationProgressPanel patientId={patient.id} canAdd={user.role==='admin'||user.role==='provider'}/></div>
    <div className="mb-5 grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><DigitalPrescription patientId={patient.id}/><LabResultsPanel patientId={patient.id} category="prescription" canUpload={user.role==='admin'||user.role==='provider'} canReview={false}/></div>
    <div className="mb-5 grid gap-5 xl:grid-cols-2"><LabResultsPanel patientId={patient.id} canUpload={user.role==='admin'||user.role==='provider'} canReview={user.role==='admin'||user.role==='provider'}/><AppointmentsPanel user={user} patientId={patient.id}/></div>
    <div className="mb-5"><PatientInsightPanel patient={patient} patientFacing={false} canGenerate={user.role==='admin'||user.role==='provider'}/></div>
    <div className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
      <div className="space-y-5">{(user.role==='admin'||user.role==='provider')&&<PatientLoginCard key={patient.id} patient={patient}/>}<Card className="p-5"><h2 className="font-bold text-[#254954]">Care overview</h2><div className="mt-4 grid grid-cols-2 gap-3"><Info label="Doctor" value={`${patient.assignedProviderName||'Not assigned'}${patient.coveringProviderName?` (away, covered by ${patient.coveringProviderName})`:''}`}/><Info label="Profile status" value={patient.active?'Active':'Inactive'}/><Info label="Phone" value={patient.phone||'Not provided'}/><Info label="Email" value={patient.email||'Not provided'}/></div><div className="mt-5 border-t border-[#edf2f2] pt-4"><Info label="Conditions" value={patient.conditions?.join(', ')||'None listed'}/><div className="mt-4"><Info label="Allergies" value={patient.allergies?.join(', ')||'None listed'}/></div>{patient.notes&&<div className="mt-4"><Info label="Care notes" value={patient.notes}/></div>}</div></Card>
        <Card className="p-5"><h2 className="font-bold text-[#254954]">Medication schedule</h2><div className="mt-4 space-y-3">{patient.medications?.filter(m=>m.active).length?patient.medications.filter(m=>m.active).map(m=><MedicationMini key={m.id} med={m}/>):<EmptyState title="No active medications" body="Active medication schedules will appear here." icon={Pill}/>}</div></Card></div>
      <Card><div className="border-b border-[#eaf0f0] px-5 py-4"><h2 className="font-bold text-[#254954]">Recent doses</h2><p className="mt-1 text-xs text-[#81969b]">Recent activity from this patient’s schedule</p></div>{patient.recentDoses?.length?<div className="divide-y divide-[#edf2f2]">{patient.recentDoses.slice(0,10).map(d=><div key={d.id} data-testid={`row-patient-dose-${d.id}`} className="flex items-center gap-3 px-5 py-4"><div className={`grid h-9 w-9 place-items-center rounded-xl ${d.status==='taken'?'bg-[#e7f5ef] text-[#35896c]':'bg-[#eaf3f5] text-[#4a8494]'}`}><Pill size={16}/></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-[#31535e]">{d.medicationName}</div><div className="mt-1 text-xs text-[#81969b]">{timeLabel(d.scheduledTime)} · {d.dosage}</div></div><StatusPill status={d.status}/></div>)}</div>:<EmptyState title="No dose history yet" body="Logged doses will show here as this schedule gets underway."/>}</Card>
    </div>{edit&&<PatientModal patient={patient} onClose={()=>setEdit(false)}/>}
  </div>;
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
  const rows=(metrics.data||[]) as HealthMetric[];
  const chartRows=[...rows].filter((row)=>row.metricType===metricType).reverse().slice(-14).map((row,index)=>({name:`${index+1}`,value:row.value}));
  const units:Record<string,string>={blood_pressure:'mmHg',blood_sugar:'mg/dL',weight:'kg',heart_rate:'bpm',temperature:'°C'};
  const submit=(event:FormEvent)=>{event.preventDefault();const parsed=Number(value);if(!Number.isFinite(parsed)||parsed<=0)return;
    createMetric.mutate({patientId,data:{metricType,value:parsed,secondaryValue:metricType==='blood_pressure'&&secondary?Number(secondary):undefined,unit:units[metricType]}},{onSuccess:()=>{setValue('');setSecondary('');qc.invalidateQueries({queryKey:getListHealthMetricsQueryKey(patientId)});}});
  };
  return <Card><div className="grid gap-5 p-5 lg:grid-cols-[1fr_280px] lg:p-6">
    <div><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-[#254954]">Health metrics</h2><p className="mt-1 text-xs text-[#81969b]">Home measurements and trend history</p></div>
      <select value={metricType} onChange={(event)=>setMetricType(event.target.value as HealthMetricInputMetricType)} className="h-10 rounded-xl border border-[#dce7e7] bg-white px-3 text-sm">{[['blood_pressure','Blood pressure'],['blood_sugar','Blood sugar'],['weight','Weight'],['heart_rate','Heart rate'],['temperature','Temperature']].map(([key,label])=> <option key={key} value={key}>{label}</option>)}</select></div>
      <div className="mt-4 h-52">{chartRows.length?<ResponsiveContainer width="100%" height="100%"><LineChart data={chartRows}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name" tick={{fontSize:11}}/><YAxis tick={{fontSize:11}}/><Tooltip/><Line type="monotone" dataKey="value" stroke="#287d8e" strokeWidth={2.5} dot={{r:3}}/></LineChart></ResponsiveContainer>:<EmptyState title="No measurements yet" body="Recorded metrics will appear here."/>}</div>
      <div className="mt-3 space-y-2">{rows.slice(0,4).map((row)=><div key={row.id} className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${row.outOfRange?'bg-[#fff0ed] text-[#b14b3d]':'bg-[#f5f9f8] text-[#3d5e67]'}`}><span>{row.metricType.replaceAll('_',' ')}</span><strong>{row.value}{row.secondaryValue!=null?`/${row.secondaryValue}`:''} {row.unit}{row.outOfRange?' · Out of range':''}</strong></div>)}</div>
    </div>
    {canRecord&&<form onSubmit={submit} className="rounded-2xl bg-[#f6faf9] p-4">
      <h3 className="text-sm font-bold text-[#31535e]">Record a reading</h3>
      {metricType==='blood_pressure'?<div className="mt-3 grid grid-cols-2 gap-2"><input value={value} onChange={(event)=>setValue(event.target.value)} required inputMode="numeric" placeholder="Systolic" className="h-10 rounded-xl border border-[#dce7e7] px-3 text-sm"/><input value={secondary} onChange={(event)=>setSecondary(event.target.value)} required inputMode="numeric" placeholder="Diastolic" className="h-10 rounded-xl border border-[#dce7e7] px-3 text-sm"/></div>:<input value={value} onChange={(event)=>setValue(event.target.value)} required inputMode="decimal" placeholder={units[metricType]} className="mt-3 h-10 w-full rounded-xl border border-[#dce7e7] px-3 text-sm"/>}
      <button type="submit" disabled={createMetric.isPending} className="mt-3 h-10 w-full rounded-xl bg-[#17647a] text-sm font-semibold text-white">{createMetric.isPending?'Saving...':'Save reading'}</button>
      <button
        type="button"
        disabled={createLog.isPending}
        onClick={()=>{
          createLog.mutate(
            {patientId,data:{symptoms:['fatigue']}},
            {onSuccess:()=>qc.invalidateQueries({queryKey:getListHealthLogsQueryKey(patientId)})},
          );
        }}
        className="mt-2 h-10 w-full rounded-xl border border-[#dce7e7] text-sm font-semibold text-[#47737b]"
      >
        Add fatigue note
      </button>
    </form>}
  </div></Card>;
}
function Info({label,value}:{label:string;value:string}){return <div><div className="text-[10px] font-bold uppercase tracking-wider text-[#8ba0a4]">{label}</div><div data-testid={`text-patient-${label.toLowerCase().replaceAll(' ','-')}`} className="mt-1 text-sm font-medium leading-5 text-[#3d5e67]">{value}</div></div>}
function MedicationMini({med}:{med:Medication}){return <div data-testid={`card-patient-medication-${med.id}`} className="flex items-center gap-3 rounded-xl bg-[#f5f9f8] p-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#e2f2ee] text-[#39847e]"><Pill size={17}/></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-[#355761]">{med.name}</div><div className="mt-0.5 text-xs text-[#80969b]">{med.dosage} · {med.scheduleTimes.join(', ')||med.frequency.replace('_',' ')}</div></div></div>}
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
      {meds.isLoading||patients.isLoading?<div className="space-y-3 p-5" data-testid="status-loading">{[1,2,3].map(x=><div key={x} className="h-20 animate-pulse rounded-xl bg-[#f2f6f6]"/>)}</div>:meds.isError||patients.isError?<ErrorState retry={()=>{meds.refetch();patients.refetch()}}/>:list.length===0?<EmptyState title={search?'No matching schedules':'No schedules yet'} body={search?'Try a different medication or patient name.':'Schedules added for your patients will appear here.'} icon={Pill}/>:<div className="divide-y divide-[#edf2f2]">{list.map(m=><MedicationRow key={m.id} med={m} patientName={patientName(m.patientId)} editable={authorized} onEdit={()=>start(m)}/>)}</div>}
    </Card>{open&&<MedicationModal medication={editing} patients={patients.data||[]} onClose={()=>setOpen(false)}/>}
  </div>;
}
function MedicationRow({med,patientName,editable,onEdit}:{med:Medication;patientName:string;editable:boolean;onEdit:()=>void}){
  const update=useUpdateMedication(), remove=useDeleteMedication(), qc=useQueryClient();
  const [message,setMessage]=useState('');
  const toggle=()=>{update.mutate({id:med.id,data:{active:!med.active}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListMedicationsQueryKey()});setMessage(med.active?'Schedule deactivated':'Schedule activated')},onError:()=>setMessage('Could not update schedule')})};
  const del=()=>{if(window.confirm(`Permanently delete ${med.name}?`))remove.mutate({id:med.id},{onSuccess:()=>qc.invalidateQueries({queryKey:getListMedicationsQueryKey()}),onError:()=>setMessage('Could not remove schedule')})};
  return <div data-testid={`row-medication-${med.id}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-6"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e8f4f1] text-[#39847e]"><Pill size={19}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-[#31535e]" data-testid={`text-medication-name-${med.id}`}>{med.name}</span><StatusPill status={med.active?'active':'inactive'}/></div><div className="mt-1 flex flex-wrap gap-x-3 text-xs text-[#81969b]"><span>{med.dosage} · {med.form||'Medication'}</span><span>{patientName}</span><span>{med.frequency==='every_hours'?`Every ${med.intervalHours||'?'} hours`:med.frequency==='specific_days'?`${med.daysOfWeek?.length||0} days per week`:`${med.timesPerDay}× daily`}</span><span>{med.scheduleTimes?.join(', ')}</span></div></div><div className="flex items-center gap-2 pl-[52px] sm:pl-0">{message&&<span className="text-[11px] text-[#448279]">{message}</span>}{editable&&<><button data-testid={`button-edit-medication-${med.id}`} onClick={onEdit} className="rounded-lg border border-[#dce8e8] px-3 py-2 text-xs font-semibold text-[#52737c] hover:bg-[#f5f9f9]">Edit</button><button data-testid={`button-toggle-medication-${med.id}`} disabled={update.isPending} onClick={toggle} className="rounded-lg px-3 py-2 text-xs font-semibold text-[#71868c] hover:bg-[#f3f7f7]">{med.active?'Deactivate':'Activate'}</button>{!med.active&&<button data-testid={`button-delete-medication-${med.id}`} disabled={remove.isPending} onClick={del} className="rounded-lg px-2 py-2 text-xs font-semibold text-[#a85a50] hover:bg-red-50">Delete</button>}</>}</div></div>;
}
/** End date from an explicit date, or from a course length counted from the start date. */
function courseEnd(start:string,end:string,days:number){if(end)return end;if(!days)return null;const d=new Date(`${start}T12:00:00`);d.setDate(d.getDate()+days-1);return d.toLocaleDateString('en-CA')}
function MedicationModal({medication,patients,defaultPatientId,onClose}:{medication:Medication|null;patients:Patient[];defaultPatientId?:number;onClose:()=>void}){
  const create=useCreateMedication(), update=useUpdateMedication(), qc=useQueryClient();
  const [error,setError]=useState('');
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const freq=String(f.get('frequency')) as 'daily'|'specific_days'|'every_hours';const times=String(f.get('scheduleTimes')||'').split(',').map(x=>x.trim()).filter(Boolean);const data={patientId:Number(f.get('patientId')),name:String(f.get('name')),dosage:String(f.get('dosage')),form:String(f.get('form')||''),frequency:freq,timesPerDay:Number(f.get('timesPerDay')||times.length||1),scheduleTimes:times,daysOfWeek:freq==='specific_days'?String(f.get('days')||'').split(',').map(Number).filter(n=>n>=0&&n<=6):[],intervalHours:freq==='every_hours'?Number(f.get('intervalHours')):null,startDate:String(f.get('startDate')||dateToday()),endDate:courseEnd(String(f.get('startDate')||dateToday()),String(f.get('endDate')||''),Number(f.get('courseDays')||0)),instructions:String(f.get('instructions')||'')};
    const done=()=>{qc.invalidateQueries({queryKey:getListMedicationsQueryKey()});qc.invalidateQueries({queryKey:getListDosesQueryKey()});qc.invalidateQueries({predicate:q=>String(q.queryKey[0]).includes('medication-progress')});onClose()};
    if(medication){const {patientId,...patch}=data;void patientId;update.mutate({id:medication.id,data:patch},{onSuccess:done,onError:()=>setError('Could not save this schedule. Check the details and try again.')})}
    else create.mutate({data},{onSuccess:done,onError:()=>setError('Could not create this schedule. Check the details and try again.')});
  };
  const busy=create.isPending||update.isPending;
  return <Modal title={medication?'Edit medication schedule':'Create medication schedule'} subtitle="Set a routine that’s clear for the patient and their care team." onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-semibold text-[#526f77]">Patient<select required name="patientId" defaultValue={medication?.patientId||defaultPatientId||''} disabled={!!medication} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal"><option value="" disabled>Select a patient</option>{patients.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Medication name" name="name" required defaultValue={medication?.name}/><Field label="Dosage" name="dosage" required defaultValue={medication?.dosage} placeholder="e.g. 10 mg"/></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Form" name="form" defaultValue={medication?.form} placeholder="Tablet, capsule…"/><label className="block text-xs font-semibold text-[#526f77]">Frequency<select name="frequency" defaultValue={medication?.frequency||'daily'} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal"><option value="daily">Daily</option><option value="specific_days">Specific days</option><option value="every_hours">Every few hours</option></select></label></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Scheduled times" name="scheduleTimes" defaultValue={medication?.scheduleTimes?.join(', ')||'08:00'} placeholder="08:00, 20:00"/><Field label="Times per day" name="timesPerDay" type="number" defaultValue={medication?.timesPerDay||1}/></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Days of week (0=Sun, comma separated)" name="days" defaultValue={medication?.daysOfWeek?.join(',')||''}/><Field label="Interval hours (if applicable)" name="intervalHours" type="number" defaultValue={medication?.intervalHours||''}/></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Start date" name="startDate" type="date" defaultValue={medication?.startDate||dateToday()} min={dateToday()}/><Field label="End date (optional)" name="endDate" type="date" defaultValue={medication?.endDate||''} min={dateToday()}/></div>
    {!medication&&<label className="block text-xs font-semibold text-[#526f77]">Course length<select name="courseDays" defaultValue="0" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal"><option value="0">Ongoing, or use the end date above</option>{[3,5,7,10,14,21,30].map(d=><option key={d} value={d}>{d} days</option>)}</select><span className="mt-1 block font-normal text-[#8ba0a4]">A fixed course shows a day-by-day progress bar.</span></label>}
    <label className="block text-xs font-semibold text-[#526f77]">Instructions<textarea name="instructions" defaultValue={medication?.instructions||''} rows={2} className="mt-1.5 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm font-normal outline-none focus:border-primary"/></label>
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
  return <div data-testid={`row-user-${user.id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6"><Avatar name={user.name} small/><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-[#31535e]" data-testid={`text-user-${user.id}`}>{user.name}</div><div className="mt-1 truncate text-xs text-[#81969b]">{user.email}{user.phone?` · ${user.phone}`:''} · Joined {new Date(user.createdAt).toLocaleDateString()}</div></div><span className="rounded-full bg-[#eef5f5] px-2.5 py-1 text-[11px] font-semibold text-[#54747a]">{roleLabel(user.role)}</span>{user.mustChangePassword&&<span title="Must set a new password at next sign-in" className="rounded-full bg-[#fbf1df] px-2.5 py-1 text-[11px] font-semibold text-[#99702f]">Temporary password</span>}<StatusPill status={user.active?'active':'inactive'}/><button data-testid={`button-edit-user-${user.id}`} onClick={onEdit} className="rounded-lg border border-[#dce8e8] px-3 py-2 text-xs font-semibold text-[#54737b] hover:bg-[#f5f9f9]">Edit</button><button data-testid={`button-toggle-user-${user.id}`} onClick={toggle} disabled={update.isPending} className="rounded-lg border border-[#dce8e8] px-3 py-2 text-xs font-semibold text-[#54737b] hover:bg-[#f5f9f9]">{user.active?'Deactivate':'Activate'}</button></div>;
}
function UserModal({user,defaultRole='provider',onClose}:{user:User|null;defaultRole?:string;onClose:()=>void}){
  const create=useCreateUser(),update=useUpdateUser(),qc=useQueryClient(),[error,setError]=useState('');
  const [tempPassword,setTempPassword]=useState(user?'':generateTempPassword()),[created,setCreated]=useState<{name:string;email:string;password:string;reset:boolean}|null>(null);
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const name=String(f.get('name')),email=String(f.get('email')),password=String(f.get('password')||''),phone=String(f.get('phone')||'').trim()||null;
    const success=()=>{qc.invalidateQueries({queryKey:getListUsersQueryKey()});if(password)setCreated({name,email,password,reset:!!user});else onClose()};
    if(user){update.mutate({id:user.id,data:{name,email,phone,...(password?{password}:{})}},{onSuccess:success,onError:()=>setError('Could not update this user. Check the details and try again.')})}
    else create.mutate({data:{name,email,password,phone,role:String(f.get('role')) as 'admin'|'provider'|'patient'|'caregiver'}},{onSuccess:success,onError:()=>setError('Could not create the user. Check the email and password requirements.')})
  };
  const busy=create.isPending||update.isPending;
  if(created)return <Modal title={created.reset?'Password reset':'Account created'} subtitle="Share these sign-in details privately." onClose={onClose}><div className="space-y-4" data-testid="panel-account-created"><div className="rounded-xl border border-[#cfe7df] bg-[#eef8f4] p-4 text-sm text-[#37796b]"><div className="font-semibold">{created.name}</div><div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><span className="text-[#5d8f86]">Email</span><span className="font-mono">{created.email}</span><span className="text-[#5d8f86]">Temporary password</span><span className="font-mono font-bold" data-testid="text-temp-password">{created.password}</span></div></div><p className="text-xs leading-5 text-[#71888e]">At first sign-in they’ll verify a code sent to their Gmail or phone, then must replace this temporary password with their own.</p><div className="flex justify-end gap-2"><button type="button" onClick={()=>navigator.clipboard?.writeText(`Email: ${created.email}\nTemporary password: ${created.password}`)} className="h-10 rounded-lg border border-[#dce8e8] px-4 text-sm font-semibold text-[#52737c] hover:bg-[#f5f9f9]">Copy details</button><button type="button" data-testid="button-done-created" onClick={onClose} className="h-10 rounded-lg bg-[#17647a] px-4 text-sm font-semibold text-white hover:bg-[#125366]">Done</button></div></div></Modal>;
  return <Modal title={user?'Edit team member':defaultRole==='provider'?'Add a doctor':'Add a user'} subtitle={user?'Update account details. Role access is controlled by the administrator.':'Create a demo login and choose the right workspace role.'} onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label="Full name" name="name" required defaultValue={user?.name}/><Field label="Email address" name="email" type="email" required defaultValue={user?.email}/><Field label="Mobile number (for SMS login codes)" name="phone" type="tel" defaultValue={user?.phone||''} placeholder="09XXXXXXXXX"/><div><div className="flex items-center justify-between"><span className="text-xs font-semibold text-[#526f77]">{user?'Reset password (leave blank to keep current)':'Temporary password'}</span><button type="button" data-testid="button-generate-password" onClick={()=>setTempPassword(generateTempPassword())} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#287d80] hover:underline"><KeyRound size={12}/> Generate</button></div><PasswordInput testId="input-user-password" name="password" value={tempPassword} onChange={setTempPassword} required={!user} minLength={8} autoComplete="new-password" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal outline-none focus:border-primary"/><p className="mt-1 text-[11px] text-[#8ba0a4]">They’ll be asked to create their own password the first time they sign in.</p></div>{!user&&<label className="block text-xs font-semibold text-[#526f77]">Role<select name="role" defaultValue={defaultRole} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm font-normal">  <option value="provider">Doctor</option><option value="patient">Patient</option><option value="caregiver">Caregiver</option><option value="admin">Administrator</option></select></label>}{error&&<div data-testid="status-user-form-error" className="text-xs text-red-700">{error}</div>}<ModalActions onClose={onClose} busy={busy} submitLabel={user?'Save changes':'Create user'}/></form></Modal>;
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
  return <div data-testid={`row-report-${r.id}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eaf3f5] text-[#477f8e]"><FileText size={18}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold capitalize text-[#355661]" data-testid={`text-report-period-${r.id}`}>{r.period} report</span><span className="rounded-full bg-[#f0f5f5] px-2 py-0.5 text-[10px] text-[#71898e]">{name}</span></div><div className="mt-1 text-xs text-[#82979b]">{r.rangeStart} – {r.rangeEnd} · Created {new Date(r.createdAt).toLocaleDateString()}</div><p data-testid={`text-report-summary-${r.id}`} className="mt-1 line-clamp-2 text-xs leading-5 text-[#688188]">{r.summary}</p></div><div className="flex items-center gap-2 sm:flex-col sm:items-end"><span className="text-lg font-extrabold text-[#337d7a]" data-testid={`text-report-adherence-${r.id}`}>{Math.round(r.adherenceRate)}%</span><div className="flex gap-1.5"><a href={`/api/reports/${r.id}/pdf`} download data-testid={`link-download-report-pdf-${r.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dce8e8] px-2.5 text-[11px] font-semibold text-[#52747c] hover:bg-[#f4f8f8]"><Download size={13}/>PDF</a><a href={`/api/reports/${r.id}/csv`} download data-testid={`link-download-report-csv-${r.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dce8e8] px-2.5 text-[11px] font-semibold text-[#52747c] hover:bg-[#f4f8f8]"><Download size={13}/>CSV</a></div></div></div>;
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
  return <div data-testid={`row-audit-log-${log.id}`} className="flex items-start gap-3 px-5 py-4 sm:px-6"><div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#edf4f4] text-[#64868a]"><Activity size={16}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-[#355661]" data-testid={`text-audit-action-${log.id}`}>{log.action.replaceAll('_',' ')}</span><span className="rounded-full bg-[#f1f6f6] px-2 py-0.5 text-[10px] capitalize text-[#71898e]">{log.entityType}{log.entityId?` · #${log.entityId}`:''}</span></div><div className="mt-1 text-xs text-[#82979b]">{log.userName||'System'} · {new Date(log.createdAt).toLocaleString()}</div>{Object.keys(log.details||{}).length>0&&<details className="mt-2"><summary data-testid={`button-audit-details-${log.id}`} className="cursor-pointer text-[11px] font-semibold text-[#42817f]">View event details</summary><pre data-testid={`text-audit-details-${log.id}`} className="mt-2 max-w-full overflow-x-auto rounded-lg bg-[#f5f8f8] p-3 text-[10px] leading-4 text-[#60797f]">{JSON.stringify(log.details,null,2)}</pre></details>}</div></div>;
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
