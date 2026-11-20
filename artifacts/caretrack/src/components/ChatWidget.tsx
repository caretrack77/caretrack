
import { useState, type FormEvent } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';

type Props = { role: string };
type Turn = { role: 'user' | 'model'; text: string };

export function ChatWidget({ role }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [history, setHistory] = useState<Turn[]>([]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  if (!['patient', 'caretaker', 'caregiver'].includes(role)) return null;

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText(''); setReply(''); setBusy(true);
    const turns = [...history, { role: 'user' as const, text: message }].slice(-6);
    try {
      const token = Object.keys(localStorage).filter(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
        .map(k => { try { return JSON.parse(localStorage.getItem(k) || '{}').access_token; } catch { return ''; } })[0];
      if (!token) throw new Error('CareTrack chat authentication is unavailable.');
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-assistant`, {
        method: 'POST', headers: { 'content-type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, history: turns.slice(0, -1) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not get a reply.');
      setReply(data.reply); setHistory([...turns, { role: 'model' as const, text: data.reply as string }].slice(-3));
    } catch (e) { setReply(e instanceof Error ? e.message : 'Could not get a reply.'); }
    finally { setBusy(false); }
  }

  return <>
    {open && <section data-testid="panel-assistant" className="fixed bottom-20 right-6 z-50 flex h-[min(460px,calc(100dvh-7rem))] w-[min(360px,calc(100vw-3rem))] flex-col overflow-hidden rounded-2xl border border-[#dce8e8] bg-white shadow-xl">
      <header className="flex items-center justify-between bg-[#174353] px-4 py-3 text-white"><div><b className="text-sm">CareTrack assistant</b><p className="text-[10px] text-white/70">Answers from your CareTrack records</p></div><button aria-label="Close chat" onClick={() => setOpen(false)}><X size={17}/></button></header>
      <div className="flex-1 overflow-y-auto bg-[#f7fbfb] p-3 text-xs">{history.map((m, i) => <p key={i} className={`my-2 w-fit max-w-[90%] rounded-xl p-2 ${m.role === 'user' ? 'ml-auto bg-[#17647a] text-white' : 'bg-white text-[#31535e]'}`}>{m.text}</p>)}{reply && <p role="status" className="my-2 rounded-xl bg-white p-2 text-[#31535e]">{reply}</p>}{busy && <p className="text-[#81969b]">Thinking…</p>}</div>
      <form onSubmit={send} className="flex gap-2 border-t p-2"><input aria-label="Message" value={text} onChange={e => setText(e.target.value)} maxLength={500} placeholder="Ask about your records…" className="h-9 min-w-0 flex-1 rounded-lg border px-3 text-xs"/><button disabled={busy} aria-label="Send" className="grid h-9 w-9 place-items-center rounded-lg bg-[#17647a] text-white"><Send size={15}/></button></form>
    </section>}
    <button data-testid="button-open-assistant" onClick={() => setOpen(v => !v)} aria-label="Toggle CareTrack chat" className="fixed bottom-6 right-6 z-50 flex h-12 items-center gap-2 rounded-full bg-[#17647a] px-4 text-sm font-semibold text-white shadow-lg"><MessageSquare size={18}/>{open ? 'Close' : 'Ask CareTrack'}</button>
  </>;
}
