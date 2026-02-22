'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, User } from 'lucide-react';
import { cn } from '@/lib/utils';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const STORAGE_KEY = 'vantage-chat-history';

const STARTER_PROMPTS = [
  "What's the current team availability summary?",
  'Which tasks are at risk right now?',
  'Who has the most bandwidth to take on a P0 task?',
  'List all team members who are OOO this week',
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

function loadHistory(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(messages: Message[]) {
  try {
    // Keep last 60 messages to avoid unbounded growth
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-60)));
  } catch {
    // localStorage quota exceeded — ignore
  }
}

export default function ChatClient() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setMessages(loadHistory());
  }, []);

  // Persist whenever messages change
  useEffect(() => {
    if (messages.length > 0) saveHistory(messages);
  }, [messages]);

  // Auto-scroll to the latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      const newMessages: Message[] = [
        ...messages,
        { role: 'user', content: content.trim() },
      ];
      setMessages(newMessages);
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      setIsStreaming(true);

      // Optimistic placeholder for the assistant turn
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      try {
        const response = await fetch(`${API_URL}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: newMessages }),
        });

        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setMessages((prev) => [
            ...prev.slice(0, -1),
            { role: 'assistant', content: accumulated },
          ]);
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          {
            role: 'assistant',
            content: `Something went wrong. Please try again.\n\n_${err instanceof Error ? err.message : String(err)}_`,
          },
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, isStreaming],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-bg-surface flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-status-green/10 border border-status-green/20 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-status-green" />
        </div>
        <div>
          <h1 className="text-sm font-heading font-bold text-foreground leading-none">
            Vantage AI
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Team coverage assistant · powered by Gemini
          </p>
        </div>
        {!isEmpty && (
          <button
            onClick={clearChat}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isEmpty ? (
          /* Empty state with starter prompts */
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div>
              <div className="w-16 h-16 rounded-2xl bg-status-green/10 border border-status-green/20 flex items-center justify-center mx-auto mb-5">
                <Sparkles className="w-8 h-8 text-status-green" />
              </div>
              <h2 className="text-xl font-heading font-bold text-foreground">
                What can I help with?
              </h2>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-xs mx-auto">
                Ask me anything about your team, tasks, or coverage — I can read and update data too.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-left px-4 py-3 rounded-xl bg-bg-surface border border-border text-sm text-muted-foreground hover:text-foreground hover:border-status-green/30 hover:bg-bg-surface2 transition-all duration-150"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Message list */
          <div className="space-y-5 max-w-3xl mx-auto">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  'flex gap-3',
                  msg.role === 'user' ? 'flex-row-reverse' : 'flex-row',
                )}
              >
                {/* Avatar */}
                <div
                  className={cn(
                    'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                    msg.role === 'user'
                      ? 'bg-bg-surface2 border border-border'
                      : 'bg-status-green/10 border border-status-green/20',
                  )}
                >
                  {msg.role === 'user' ? (
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-status-green" />
                  )}
                </div>

                {/* Bubble */}
                <div
                  className={cn(
                    'rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-[78%]',
                    msg.role === 'user'
                      ? 'bg-status-green/10 border border-status-green/20 text-foreground rounded-tr-sm'
                      : 'bg-bg-surface border border-border text-foreground rounded-tl-sm',
                  )}
                >
                  {/* Streaming indicator on empty assistant message */}
                  {msg.content === '' && isStreaming ? (
                    <span className="flex gap-1.5 items-center h-5">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
                    </span>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Input ── */}
      <div className="flex-shrink-0 border-t border-border bg-bg-surface px-6 py-4">
        <div className="flex gap-3 items-end max-w-3xl mx-auto">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask about team coverage, tasks, availability…"
            rows={1}
            disabled={isStreaming}
            className="flex-1 resize-none bg-bg-surface2 border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-status-green/40 focus:ring-1 focus:ring-status-green/20 transition-colors min-h-[44px] max-h-[120px] disabled:opacity-50"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isStreaming}
            className={cn(
              'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-all',
              input.trim() && !isStreaming
                ? 'bg-status-green text-bg-base hover:opacity-90 shadow-[0_0_12px_rgba(129,140,248,0.25)]'
                : 'bg-bg-surface2 text-muted-foreground cursor-not-allowed border border-border',
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground/40 mt-2 max-w-3xl mx-auto">
          Enter to send · Shift+Enter for new line · Write actions will ask for confirmation
        </p>
      </div>
    </div>
  );
}
