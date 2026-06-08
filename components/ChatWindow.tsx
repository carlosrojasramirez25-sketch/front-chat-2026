'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Hash, CornerDownLeft, Sparkles, MessageSquare, AlertCircle, Loader2, ChevronLeft } from 'lucide-react';
import { Socket } from 'socket.io-client';

// ─── Types ────────────────────────────────────────────────────────────────────
// The backend returns messages with `sender_id` and includes `users` (sender info)
interface Message {
  id: string | number;
  content: string | null;
  conversation_id: number;
  sender_id: number;            // real DB field
  users?: { id: number; name: string; email: string }; // included relation
  created_at?: string;
  // extras for optimistic / system messages
  _isSystem?: boolean;
}

interface ChatWindowProps {
  socket: Socket | null;
  activeRoomId: number | null;
  currentUser: { name: string; email: string; id: number };
  apiUrl?: string;
  token?: string | null;
  onBack?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function normalizeUrl(url: string) {
  let u = (url ?? 'http://localhost:3000').trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`;
  if (u.endsWith('/')) u = u.slice(0, -1);
  return u;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function ChatWindow({ socket, activeRoomId, currentUser, apiUrl = 'http://localhost:3000', token, onBack }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [typingUsers, setTypingUsers] = useState<{ [userId: number]: { name: string; timestamp: number } }>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<{ [userId: number]: NodeJS.Timeout }>({});
  const lastTypingEmitRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => { scrollToBottom(); }, [messages, typingUsers]);

  // ── Load message history when room changes ────────────────────────────────
  useEffect(() => {
    if (!activeRoomId) return;

    setMessages([]);
    setTypingUsers({});
    Object.values(typingTimeoutRef.current).forEach(clearTimeout);
    typingTimeoutRef.current = {};

    const fetchHistory = async () => {
      setLoadingHistory(true);
      try {
        const base = normalizeUrl(apiUrl);
        const headers: HeadersInit = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${base}/api/messages?conversationId=${activeRoomId}`, { headers });
        if (!res.ok) return;
        const data: Message[] = await res.json();
        setMessages(data);
      } catch (err) {
        console.error('Failed to load history:', err);
      } finally {
        setLoadingHistory(false);
      }
    };

    fetchHistory();
  }, [activeRoomId, apiUrl, token]);

  // ── Listen to socket events ───────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !activeRoomId) return;

    const handleNewMessage = (msg: Message) => {
      console.log('newMessage received:', msg);
      if (Number(msg.conversation_id) !== activeRoomId) return;

      setMessages((prev) => {
        // Replace any matching optimistic message (same sender + approximate time + same content)
        const optIdx = prev.findIndex(
          (m) =>
            String(m.id).startsWith('opt-') &&
            m.sender_id === msg.sender_id &&
            m.content === msg.content,
        );
        if (optIdx !== -1) {
          const next = [...prev];
          next[optIdx] = msg;
          return next;
        }
        // Deduplicate by real id
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });

      setTypingUsers((prev) => {
        const updated = { ...prev };
        delete updated[msg.sender_id];
        return updated;
      });
    };

    const handleUserTyping = (data: { user_id: number }) => {
      const uid = Number(data.user_id);
      if (uid === currentUser.id) return;

      setTypingUsers((prev) => ({
        ...prev,
        [uid]: { name: `User #${uid}`, timestamp: Date.now() },
      }));

      if (typingTimeoutRef.current[uid]) clearTimeout(typingTimeoutRef.current[uid]);
      typingTimeoutRef.current[uid] = setTimeout(() => {
        setTypingUsers((prev) => { const u = { ...prev }; delete u[uid]; return u; });
      }, 3000);
    };

    socket.on('newMessage', handleNewMessage);
    socket.on('userTyping', handleUserTyping);

    return () => {
      socket.off('newMessage', handleNewMessage);
      socket.off('userTyping', handleUserTyping);
      Object.values(typingTimeoutRef.current).forEach(clearTimeout);
    };
  }, [socket, activeRoomId, currentUser.id]);

  // ── Typing event ─────────────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);

    // Auto-adjust height dynamically
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 128)}px`;
    }

    if (!socket || !activeRoomId) return;
    const now = Date.now();
    if (now - lastTypingEmitRef.current > 1500) {
      lastTypingEmitRef.current = now;
      socket.emit('typing', { conversation_id: activeRoomId, user_id: currentUser.id });
    }
  };

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !activeRoomId || !socket) return;

    const content = inputValue.trim();

    // Optimistic message — will be replaced by the server's real message
    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      content,
      conversation_id: activeRoomId,
      sender_id: currentUser.id,
      users: { id: currentUser.id, name: currentUser.name, email: currentUser.email },
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInputValue('');

    // Reset textarea height to default
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Emit to gateway — uses `sender_id` as per CreateMessageDto
    socket.emit('sendMessage', {
      conversation_id: activeRoomId,
      sender_id: currentUser.id,
      content,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); }
  };


  if (!activeRoomId) {
    return (
      <div className="flex-1 hidden md:flex flex-col items-center justify-center bg-zinc-900/20 text-center p-8 text-zinc-400 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-violet-600/5 rounded-full blur-3xl -z-10" />
        <div className="p-4 bg-zinc-950/60 border border-zinc-800 rounded-2xl mb-4 text-violet-400 shadow-xl">
          <MessageSquare className="w-8 h-8 animate-bounce" />
        </div>
        <h3 className="text-xl font-bold text-zinc-200">No Chat Selected</h3>
        <p className="text-sm max-w-sm mt-2 text-zinc-500">
          Select a conversation from the sidebar or search for a user to start chatting.
        </p>
      </div>
    );
  }

  const typingArray = Object.values(typingUsers);

  return (
    <div className={`flex-1 flex flex-col min-h-0 overflow-hidden bg-zinc-950/40 relative ${activeRoomId === null ? 'hidden md:flex' : 'flex'}`}>
      {/* Header */}
      <div className="h-20 border-b border-zinc-900 px-6 flex items-center justify-between bg-zinc-950/80 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden p-2 -ml-2 hover:bg-zinc-900 rounded-xl text-zinc-400 hover:text-zinc-250 transition-all active:scale-95 shrink-0"
              title="Back to Chats"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div className="p-2.5 bg-violet-600/10 border border-violet-500/20 text-violet-400 rounded-xl shrink-0">
            <Hash className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-zinc-100 leading-tight truncate">{currentUser?.name}</h2>
            <p className="text-[10px] text-zinc-500 font-semibold tracking-wider uppercase">Aqui ira cunado el usuario se conecte o se desconecte</p>
          </div>
        </div>
        <div className="text-xs text-zinc-500 flex items-center gap-1.5 bg-zinc-900/40 border border-zinc-800 py-1.5 px-3 rounded-xl shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          <span className="hidden sm:inline">Real-time via Socket.io</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 scrollbar-thin">

        {/* Loading history */}
        {loadingHistory && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
          </div>
        )}

        {/* Empty state */}
        {!loadingHistory && messages.length === 0 && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/60 text-xs text-zinc-400">
              <AlertCircle className="w-4 h-4 text-violet-400 shrink-0" />
              <span>No messages yet. Say hello! 👋</span>
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const isMe = Number(msg.sender_id) === currentUser.id;

          return (
            <div
              key={msg.id}
              className={`flex flex-col max-w-[75%] ${isMe ? 'ml-auto items-end' : 'mr-auto items-start'}`}
            >
              {/* Sender name (only for the other person) */}
              {!isMe && (
                <span className="text-[10px] font-bold text-zinc-500 mb-1.5 px-1">
                  {msg.users?.name || `User #${msg.sender_id}`}
                </span>
              )}

              {/* Bubble */}
              <div
                className={`px-4 py-3 rounded-2xl text-sm shadow-md whitespace-pre-wrap ${
                  isMe
                    ? 'bg-gradient-to-tr from-violet-600 to-fuchsia-600 text-white rounded-tr-none'
                    : 'bg-zinc-900 text-zinc-100 rounded-tl-none border border-zinc-800'
                }`}
              >
                {msg.content ?? ''}
              </div>

              {/* Timestamp */}
              <span className="text-[9px] text-zinc-600 mt-1 px-1">
                {msg.created_at
                  ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}

        {/* Typing indicator */}
        {typingArray.length > 0 && (
          <div className="flex items-center gap-2.5 mr-auto max-w-[75%]">
            <div className="px-4 py-3 rounded-2xl rounded-tl-none bg-zinc-900 border border-zinc-800 flex items-center gap-1.5">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-xs text-zinc-400 italic ml-1.5">
                {typingArray.map((u) => u.name).join(', ')} is typing...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input panel */}
      <div className="p-4 border-t border-zinc-900 bg-zinc-950/80 shrink-0">
        <form onSubmit={handleSendMessage} className="relative flex items-end gap-2 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-2 focus-within:border-violet-500/80 focus-within:ring-2 focus-within:ring-violet-500/10 transition-all">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message #conversation_${activeRoomId}...`}
            rows={1}
            className="flex-1 max-h-32 bg-transparent border-0 focus:ring-0 focus:outline-none py-2 px-3 text-sm text-zinc-100 placeholder-zinc-550 resize-none overflow-y-auto"
          />
          <div className="flex items-center gap-2 pr-1.5 pb-1">
            <span className="text-[10px] text-zinc-600 hidden md:flex items-center gap-1 bg-zinc-950/80 border border-zinc-800 py-1 px-2 rounded-lg">
              <span>Enter to send</span>
              <CornerDownLeft className="w-2.5 h-2.5" />
            </span>
            
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className="p-2.5 bg-gradient-to-tr from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:from-zinc-900 disabled:to-zinc-900 text-white disabled:text-zinc-600 rounded-xl transition-all shadow-md shadow-violet-600/10 active:scale-[0.96] disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
