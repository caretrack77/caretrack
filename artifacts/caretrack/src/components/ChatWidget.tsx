
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { MessageSquare, RotateCw, Send, X } from 'lucide-react';
import { useAskAssistant } from '@workspace/api-client-react';
import { getSyncSnapshot, subscribeSync } from '../offline';

type Props = { role: string };
type Turn = { role: 'user' | 'model'; text: string };
const DEFAULT_SUGGESTIONS = [
  'When is my next dose?',
  'What should I do if I missed a dose?',
  'How am I doing?',
];
const ASSISTANT_FALLBACK = "I couldn't reach Gemini right now. CareTrack can still answer questions about your next dose, missed doses, medication schedule, check-ups, and recent dose progress.";
const ASSISTANT_OFFLINE = "You're offline from CareTrack. Connect to the internet to ask the assistant; your saved information is still available offline.";

function assistantErrorMessage(error: unknown): string {
  const responseError = (error as { data?: { error?: unknown } } | null)?.data?.error;
  if (typeof responseError === 'string' && responseError.trim()) return responseError;
  if (error instanceof Error) {
    const configurationMessage = error.message.match(/Gemini AI is not available\.[^\r\n]*/);
    if (configurationMessage) return configurationMessage[0];
  }
  return ASSISTANT_FALLBACK;
}

export function ChatWidget({ role }: Props) {
  const ask = useAskAssistant();
  const online = useSyncExternalStore(subscribeSync, getSyncSnapshot).online;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [history, setHistory] = useState<Turn[]>([]);
  const [reply, setReply] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS);
  const [failedMessage, setFailedMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history, reply, ask.isPending]);

  if (!['patient', 'caretaker', 'caregiver'].includes(role)) return null;

  function askQuestion(question: string) {
    const message = question.trim(); if (!message || ask.isPending) return;
    setText(''); setReply(''); setFailedMessage('');
    if (!online) {
      setReply(ASSISTANT_OFFLINE);
      return;
    }
    const previous = history.slice(-6);
    setHistory([...previous, { role: 'user' as const, text: message }].slice(-6));
    ask.mutate({ data: { message, history: previous } }, {
      onSuccess: result => {
        setReply('');
        setSuggestions(result.suggestions?.length ? result.suggestions : DEFAULT_SUGGESTIONS);
        setHistory(current => [...current, { role: 'model' as const, text: result.reply }].slice(-6));
      },
      onError: error => { setReply(assistantErrorMessage(error)); setFailedMessage(message); },
    });
  }

  function send(event: FormEvent) {
    event.preventDefault();
    askQuestion(text);
  }

  function retry() {
    if (!failedMessage || ask.isPending) return;
    const message = failedMessage;
    setReply(''); setFailedMessage('');
    ask.mutate({ data: { message, history: history.slice(0, -1).slice(-6) } }, {
      onSuccess: result => {
        setReply('');
        setSuggestions(result.suggestions?.length ? result.suggestions : DEFAULT_SUGGESTIONS);
        setHistory(current => [...current, { role: 'model' as const, text: result.reply }].slice(-6));
      },
      onError: error => { setReply(assistantErrorMessage(error)); setFailedMessage(message); },
    });
  }

  return <>
    {open && <section data-testid="panel-assistant" className="fixed bottom-20 right-6 z-50 flex h-[min(460px,calc(100dvh-7rem))] w-[min(360px,calc(100vw-3rem))] flex-col overflow-hidden rounded-2xl border border-[#dce8e8] bg-white shadow-xl">
      <header className="flex items-center justify-between bg-[#174353] px-4 py-3 text-white"><div><b className="text-sm">CareTrack assistant</b><p className="text-[10px] text-white/70">Answers from your CareTrack records</p></div><button aria-label="Close chat" onClick={() => setOpen(false)}><X size={17}/></button></header>
      <div className="flex-1 overflow-y-auto bg-[#f7fbfb] p-3 text-xs">{history.map((m, i) => <p key={i} className={`my-2 w-fit max-w-[90%] rounded-xl p-2 ${m.role === 'user' ? 'ml-auto bg-[#17647a] text-white' : 'bg-white text-[#31535e]'}`}>{m.text}</p>)}{reply && <div className="my-2 flex items-start gap-2"><p role="status" className="flex-1 rounded-xl bg-white p-2 text-[#31535e]">{reply}</p>{failedMessage&&<button type="button" aria-label="Retry assistant message" onClick={retry} className="shrink-0 rounded-full bg-white p-2 text-[#17647a]" disabled={ask.isPending}><RotateCw size={14}/></button>}</div>}{ask.isPending && <p className="text-[#81969b]">Thinking…</p>}<div ref={messagesEndRef}/></div>
      {!ask.isPending&&suggestions.length>0&&<div role="group" aria-label="Suggested questions" className="flex flex-wrap gap-1.5 border-t bg-white px-3 py-2">
        {suggestions.map(question=><button key={question} type="button" onClick={()=>askQuestion(question)} disabled={!online} className="rounded-full border border-[#dce8e8] px-2.5 py-1.5 text-left text-[10px] font-medium text-[#397d7e] hover:bg-[#f0f7f7] disabled:opacity-50">{question}</button>)}
      </div>}
      <form onSubmit={send} className="flex gap-2 border-t p-2"><input aria-label="Message" value={text} onChange={e => setText(e.target.value)} maxLength={500} placeholder={online ? "Ask about your records…" : "Connect to CareTrack to ask…"} disabled={!online} className="h-9 min-w-0 flex-1 rounded-lg border px-3 text-xs disabled:bg-[#f7fbfb]"/><button disabled={ask.isPending||!online} aria-label="Send" className="grid h-9 w-9 place-items-center rounded-lg bg-[#17647a] text-white disabled:opacity-50"><Send size={15}/></button></form>
    </section>}
    <button data-testid="button-open-assistant" onClick={() => setOpen(v => !v)} aria-label="Toggle CareTrack chat" className="fixed bottom-6 right-6 z-50 flex h-12 items-center gap-2 rounded-full bg-[#17647a] px-4 text-sm font-semibold text-white shadow-lg"><MessageSquare size={18}/>{open ? 'Close' : 'Ask CareTrack'}</button>
  </>;
}
