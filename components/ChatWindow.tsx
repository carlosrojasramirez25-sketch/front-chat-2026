'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Hash, CornerDownLeft, MessageSquare, AlertCircle, Loader2, ChevronLeft, MoreHorizontal, Pencil, Trash2, Check, X, ImagePlus, Sticker, Reply, Phone, Mic, Play, Pause } from 'lucide-react';
import { Socket } from 'socket.io-client';
import type { Conversation } from '@/app/page';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ReplyPreview {
  id: number;
  content: string | null;
  sender_id: number;
  type?: string;
  users?: { name?: string | null };
}

interface Message {
  id: string | number;
  content: string | null;
  type?: 'text' | 'image' | 'file' | 'system' | 'audio';
  reply_to_id?: number | null;
  messages?: ReplyPreview | null; // Prisma self-relation: the replied-to message
  conversation_id: number;
  sender_id: number;
  users?: { id: number; name: string; email: string; avatar_url?: string | null };
  created_at?: string;
  _isSystem?: boolean;
}

interface ChatWindowProps {
  socket: Socket | null;
  activeRoomId: number | null;
  currentUser: { name: string; email: string; id: number };
  apiUrl?: string;
  token?: string | null;
  onBack?: () => void;
  activeConversation?: Conversation | null;
  aliases?: Record<number, string>;
  onSaveAlias?: (convoId: number, newName: string) => void;
  onDeleteConversation?: (convoId: number) => void;
  socketConnected?: boolean;
  userStatuses?: Record<number, { status: string; lastSeenAt: string | null }>;
  contactAvatars?: Record<number, string>;
  onSaveContactAvatar?: (contactId: number, dataUrl: string) => void;
  onCall?: (userId: number, name: string, avatar?: string) => void;
}

// ─── Stickers ────────────────────────────────────────────────────────────────
const STICKERS: Record<string, string[]> = {
  'Caras':       ['😀','😂','🥰','😍','😎','🤔','😢','😡','🥺','🤯','😳','🥳','🤩','😘','😊','🫶'],
  'Gestos':      ['👍','👎','👋','🤝','🙏','👏','✌️','🤞','💪','🫂','🤙','👌','🫵','🤌'],
  'Corazones':   ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💕','💞','💓','💗','💖','💝','💘'],
  'Animales':    ['🐶','🐱','🐸','🐼','🦊','🐨','🦁','🐯','🐮','🐷','🐻','🦋','🐧','🦄','🐝'],
  'Celebración': ['🎉','🎊','🎁','🔥','💯','✨','🌟','⭐','🏆','🎯','🚀','💥','🎶','🎸','🌈'],
};

function isStickerMsg(content: string | null): boolean {
  if (!content) return false;
  const t = content.trim();
  if (t.length > 12 || t.length === 0) return false;
  return !/[a-zA-Z0-9]/.test(t) && /\p{Emoji}/u.test(t);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return 'Desconectado';
  const diffSec = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 1000);
  if (diffSec < 60) return 'Hace un momento';
  if (diffSec < 3600) return `Hace ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `Hace ${Math.floor(diffSec / 3600)} h`;
  return `Hace ${Math.floor(diffSec / 86400)} d`;
}

function normalizeUrl(url: string) {
  let u = (url ?? 'http://localhost:3000').trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`;
  if (u.endsWith('/')) u = u.slice(0, -1);
  return u;
}

// ─── Audio Player ─────────────────────────────────────────────────────────────
const WAVEFORM = [3, 6, 10, 7, 13, 8, 5, 9, 14, 7, 11, 5, 8, 12, 6, 9, 4, 7, 11, 6];

function AudioPlayer({ src, isMe }: { src: string; isMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); setIsPlaying(false); }
    else { audio.play(); setIsPlaying(true); }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2.5 w-52">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
        onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
        onEnded={() => { setIsPlaying(false); setCurrentTime(0); }}
      />
      <button
        type="button"
        onClick={toggle}
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-95 ${
          isMe ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-violet-500/20 hover:bg-violet-500/40 text-violet-300'
        }`}
      >
        {isPlaying
          ? <Pause className="w-3.5 h-3.5" />
          : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="flex items-end gap-[2px] h-4 cursor-pointer" onClick={handleSeek}>
          {WAVEFORM.map((h, i) => {
            const active = (i / WAVEFORM.length) * 100 <= progress;
            return (
              <div
                key={i}
                style={{ height: `${h}px` }}
                className={`flex-1 rounded-full transition-colors ${
                  active
                    ? (isMe ? 'bg-white' : 'bg-violet-400')
                    : (isMe ? 'bg-white/30' : 'bg-zinc-600')
                }`}
              />
            );
          })}
        </div>
        <div className={`flex justify-between text-[9px] font-mono tabular-nums ${isMe ? 'text-white/50' : 'text-zinc-500'}`}>
          <span>{fmt(currentTime)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function ChatWindow({
  socket,
  activeRoomId,
  currentUser,
  apiUrl = 'http://localhost:3000',
  token,
  onBack,
  activeConversation,
  aliases,
  onSaveAlias,
  onDeleteConversation,
  userStatuses,
  contactAvatars,
  onSaveContactAvatar,
  onCall,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [typingUsers, setTypingUsers] = useState<{ [userId: number]: { name: string; timestamp: number } }>({});
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [activeStickerTab, setActiveStickerTab] = useState('Caras');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<{ [userId: number]: NodeJS.Timeout }>({});
  const lastTypingEmitRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickerPickerRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Header menu state
  const [showMenu, setShowMenu] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Track rooms where we've already sent our avatar this session
  const avatarSentRoomsRef = useRef<Set<number>>(new Set());

  // Computed display name: alias takes priority over participant's real name
  const displayName = (activeRoomId && aliases?.[activeRoomId])
    ? aliases[activeRoomId]
    : (activeConversation?.participant?.name ?? 'Chat');

  const participantPresence = activeConversation?.participant?.id
    ? userStatuses?.[activeConversation.participant.id]
    : undefined;
  const isParticipantOnline = participantPresence?.status === 'online';

  const contactAvatarSrc = activeConversation?.participant?.id
    ? (contactAvatars?.[activeConversation.participant.id] || activeConversation.participant.avatar || null)
    : null;
  const participantInitials = displayName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => { scrollToBottom(); }, [messages, typingUsers]);

  // Reset header UI state when switching rooms
  useEffect(() => {
    setShowMenu(false);
    setIsEditingName(false);
    setShowDeleteConfirm(false);
    setReplyingTo(null);
    setShowStickerPicker(false);
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordingTime(0);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }, [activeRoomId]);

  // ── Long press (mobile reply) ─────────────────────────────────────────────
  const startLongPress = (msg: Message) => {
    longPressTimerRef.current = setTimeout(() => {
      setReplyingTo(msg);
      setShowStickerPicker(false);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showMenu]);

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
        // Sync contact avatar from the server-authoritative avatar_url on any message
        if (onSaveContactAvatar && activeConversation) {
          const participantId = activeConversation.participant.id;
          for (const m of data) {
            if (m.sender_id === participantId && m.users?.avatar_url) {
              onSaveContactAvatar(participantId, m.users.avatar_url);
              break;
            }
          }
        }
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

    const handleNewMessage = (msg: Message & { sender_avatar?: string }) => {
      if (Number(msg.conversation_id) !== activeRoomId) return;
      // Use server-side avatar_url first, fall back to client-piggyback sender_avatar
      const incomingAvatar = msg.users?.avatar_url || msg.sender_avatar || null;
      if (incomingAvatar && msg.sender_id !== currentUser.id && onSaveContactAvatar) {
        onSaveContactAvatar(msg.sender_id, incomingAvatar);
      }

      setMessages((prev) => {
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

  // ── Close sticker picker on outside click ────────────────────────────────
  useEffect(() => {
    if (!showStickerPicker) return;
    const handler = (e: MouseEvent) => {
      if (stickerPickerRef.current && !stickerPickerRef.current.contains(e.target as Node)) {
        setShowStickerPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showStickerPicker]);

  // ── Send sticker ──────────────────────────────────────────────────────────
  const handleSendSticker = (emoji: string) => {
    if (!activeRoomId || !socket) return;
    setShowStickerPicker(false);
    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      content: emoji,
      conversation_id: activeRoomId,
      sender_id: currentUser.id,
      users: { id: currentUser.id, name: currentUser.name, email: currentUser.email },
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    socket.emit('sendMessage', { conversation_id: activeRoomId, sender_id: currentUser.id, content: emoji });
  };

  // ── Image select ──────────────────────────────────────────────────────────
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputValue.trim() && !imageFile) || !activeRoomId || !socket) return;

    const myAvatar = localStorage.getItem(`chat_avatar_${currentUser.id}`);
    const needsSendAvatar = !!myAvatar && !avatarSentRoomsRef.current.has(activeRoomId);
    if (needsSendAvatar) avatarSentRoomsRef.current.add(activeRoomId);

    if (imageFile) {
      setIsUploadingImage(true);
      try {
        const base = normalizeUrl(apiUrl);
        const formData = new FormData();
        formData.append('file', imageFile);
        formData.append('uploadedBy', String(currentUser.id));
        const headers: HeadersInit = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${base}/api/attachments/upload`, {
          method: 'POST',
          headers,
          body: formData,
        });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        const imageUrl = `${base}${data.url}`;

        const optimistic: Message = {
          id: `opt-${Date.now()}`,
          content: imageUrl,
          type: 'image',
          conversation_id: activeRoomId,
          sender_id: currentUser.id,
          users: { id: currentUser.id, name: currentUser.name, email: currentUser.email },
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimistic]);
        setImageFile(null);
        setImagePreview(null);
        setReplyingTo(null);

        socket.emit('sendMessage', {
          conversation_id: activeRoomId,
          sender_id: currentUser.id,
          content: imageUrl,
          type: 'image',
          ...(replyingTo ? { reply_to_id: Number(replyingTo.id) } : {}),
          ...(needsSendAvatar ? { sender_avatar: myAvatar } : {}),
        });
      } catch (err) {
        console.error('Image upload failed:', err);
      } finally {
        setIsUploadingImage(false);
      }
      return;
    }

    const content = inputValue.trim();
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
    setReplyingTo(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    socket.emit('sendMessage', {
      conversation_id: activeRoomId,
      sender_id: currentUser.id,
      content,
      ...(replyingTo ? { reply_to_id: Number(replyingTo.id) } : {}),
      ...(needsSendAvatar ? { sender_avatar: myAvatar } : {}),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); }
  };

  // ── Audio recording ───────────────────────────────────────────────────────
  const handleStartRecording = async () => {
    if (!activeRoomId || !socket) return;
    const capturedRoomId = activeRoomId;
    const capturedSocket = socket;
    setShowStickerPicker(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (audioChunksRef.current.length === 0) return;
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];
        setIsUploadingAudio(true);
        try {
          const base = normalizeUrl(apiUrl);
          const ext = mimeType === 'audio/mp4' ? 'mp4' : 'webm';
          const formData = new FormData();
          formData.append('file', blob, `audio-${Date.now()}.${ext}`);
          formData.append('uploadedBy', String(currentUser.id));
          const headers: HeadersInit = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const res = await fetch(`${base}/api/attachments/upload`, { method: 'POST', headers, body: formData });
          if (!res.ok) throw new Error('Upload failed');
          const data = await res.json();
          const audioUrl = `${base}${data.url}`;
          const optimistic: Message = {
            id: `opt-${Date.now()}`,
            content: audioUrl,
            type: 'audio',
            conversation_id: capturedRoomId,
            sender_id: currentUser.id,
            users: { id: currentUser.id, name: currentUser.name, email: currentUser.email },
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, optimistic]);
          capturedSocket.emit('sendMessage', { conversation_id: capturedRoomId, sender_id: currentUser.id, content: audioUrl, type: 'audio' });
        } catch { /* upload failed */ } finally {
          setIsUploadingAudio(false);
        }
      };

      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch { /* mic permission denied */ }
  };

  const handleStopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setRecordingTime(0);
    if (recordingIntervalRef.current) { clearInterval(recordingIntervalRef.current); recordingIntervalRef.current = null; }
  };

  const handleCancelRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordingTime(0);
    if (recordingIntervalRef.current) { clearInterval(recordingIntervalRef.current); recordingIntervalRef.current = null; }
  };

  // ── Header name edit ──────────────────────────────────────────────────────
  const handleSaveNameEdit = () => {
    if (activeRoomId && onSaveAlias) {
      onSaveAlias(activeRoomId, editingNameValue);
    }
    setIsEditingName(false);
  };

  const handleDeleteConfirm = () => {
    if (!activeRoomId || !onDeleteConversation) return;
    onDeleteConversation(activeRoomId);
    setShowDeleteConfirm(false);
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
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden p-2 -ml-2 hover:bg-zinc-900 rounded-xl text-zinc-400 hover:text-zinc-250 transition-all active:scale-95 shrink-0"
              title="Back to Chats"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          {/* Contact avatar — read-only, photo set by the contact themselves */}
          <div className="w-10 h-10 rounded-xl overflow-hidden ring-1 ring-violet-500/20 shrink-0">
            {contactAvatarSrc ? (
              <img src={contactAvatarSrc} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-violet-600/20 flex items-center justify-center font-bold text-violet-300 text-sm">
                {participantInitials || <Hash className="w-4 h-4" />}
              </div>
            )}
          </div>

          {/* Inline name editing */}
          {isEditingName ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <input
                autoFocus
                value={editingNameValue}
                onChange={(e) => setEditingNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveNameEdit();
                  if (e.key === 'Escape') setIsEditingName(false);
                }}
                placeholder={activeConversation?.participant?.name ?? 'Nombre...'}
                className="bg-zinc-900/60 border border-violet-500/40 rounded-lg py-1 px-2 text-sm text-white focus:outline-none focus:border-violet-500 min-w-0 flex-1"
              />
              <button
                onClick={handleSaveNameEdit}
                className="shrink-0 p-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-all"
                title="Guardar"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsEditingName(false)}
                className="shrink-0 p-1 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg transition-all"
                title="Cancelar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : showDeleteConfirm ? (
            /* Delete confirmation inline */
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Trash2 className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-300 flex-1 truncate">¿Eliminar este chat?</p>
              <button
                onClick={handleDeleteConfirm}
                className="shrink-0 flex items-center gap-1 px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold rounded-lg transition-all"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="shrink-0 p-1 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg transition-all"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            /* Normal title */
            <div className="min-w-0">
              <h2 className="font-bold text-zinc-100 leading-tight truncate">{displayName}</h2>
              <p className="text-[10px] font-semibold tracking-wider uppercase truncate flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isParticipantOnline ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                <span className={isParticipantOnline ? 'text-emerald-400' : 'text-zinc-500'}>
                  {isParticipantOnline ? 'En línea' : formatLastSeen(participantPresence?.lastSeenAt ?? null)}
                </span>
              </p>
            </div>
          )}
        </div>

        {/* Call button */}
        {!isEditingName && !showDeleteConfirm && onCall && activeConversation?.participant?.id && (
          <button
            onClick={() => onCall(activeConversation.participant.id, activeConversation.participant.name, activeConversation.participant.avatar)}
            className="p-2 hover:bg-zinc-900/60 text-zinc-400 hover:text-emerald-400 rounded-xl transition-all border border-transparent hover:border-zinc-800 shrink-0"
            title="Llamada de voz"
          >
            <Phone className="w-4 h-4" />
          </button>
        )}

        {/* Three-dot menu — hidden while editing/confirming */}
        {!isEditingName && !showDeleteConfirm && (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={() => setShowMenu((v) => !v)}
              className="p-2 hover:bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 rounded-xl transition-all border border-transparent hover:border-zinc-800"
              title="Opciones"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden">
                <button
                  onClick={() => {
                    setEditingNameValue(activeRoomId && aliases?.[activeRoomId] ? aliases[activeRoomId] : '');
                    setIsEditingName(true);
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all"
                >
                  <Pencil className="w-3.5 h-3.5 text-violet-400" />
                  Editar nombre
                </button>
                <button
                  onClick={() => {
                    setShowDeleteConfirm(true);
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-zinc-300 hover:bg-red-950/40 hover:text-red-400 transition-all border-t border-zinc-800"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  Eliminar chat
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6 space-y-6 scrollbar-thin overflow-x-hidden">

        {loadingHistory && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
          </div>
        )}

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
          const isSticker = isStickerMsg(msg.content);
          const isSelected = replyingTo !== null && Number(replyingTo.id) === Number(msg.id);
          // Resolve replied-to message: from Prisma include or local state fallback
          const quotedMsg = msg.reply_to_id
            ? (msg.messages ?? messages.find((m) => Number(m.id) === msg.reply_to_id) ?? null)
            : null;

          return (
            <div
              key={msg.id}
              className={`group flex flex-col max-w-[75%] min-w-0 rounded-2xl transition-colors duration-200 ${
                isMe ? 'ml-auto items-end' : 'mr-auto items-start'
              } ${isSelected ? 'bg-violet-500/10' : ''}`}
            >
              {!isMe && (
                <span className="text-[10px] font-bold text-zinc-500 mb-1.5 px-1">
                  {msg.users?.name || `User #${msg.sender_id}`}
                </span>
              )}

              {/* Bubble row: reply button + bubble */}
              <div className={`flex items-end gap-1 min-w-0 max-w-full ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                {/* Reply button — desktop hover only */}
                {!isSticker && (
                  <button
                    type="button"
                    onClick={() => { setReplyingTo(msg); setShowStickerPicker(false); textareaRef.current?.focus(); }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-500 hover:text-violet-400 hover:bg-zinc-800 rounded-full transition-all shrink-0 hidden md:flex"
                    title="Responder"
                  >
                    <Reply className="w-3.5 h-3.5" />
                  </button>
                )}

                <div
                  className={`rounded-2xl text-sm shadow-md min-w-0 max-w-full transition-colors duration-200 ${
                    isSticker
                      ? 'bg-transparent shadow-none p-1'
                      : msg.type === 'image'
                      ? 'overflow-hidden p-0'
                      : msg.type === 'audio'
                      ? 'px-3 py-2'
                      : 'px-4 py-3 whitespace-pre-wrap break-words overflow-hidden'
                  } ${
                    isSticker
                      ? ''
                      : isMe
                      ? 'bg-gradient-to-tr from-violet-600 to-fuchsia-600 text-white rounded-tr-none'
                      : 'bg-zinc-900 text-zinc-100 rounded-tl-none border border-zinc-800'
                  }`}
                  onTouchStart={() => !isSticker && startLongPress(msg)}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                >
                  {/* Quoted message inside bubble */}
                  {quotedMsg && !isSticker && (
                    <div className={`mb-2 px-2.5 py-1.5 rounded-lg text-xs border-l-2 min-w-0 w-full overflow-hidden ${
                      isMe ? 'bg-white/10 border-white/40' : 'bg-zinc-800 border-violet-500/70'
                    }`}>
                      <p className={`font-bold text-[10px] mb-0.5 truncate ${isMe ? 'text-white/70' : 'text-violet-400'}`}>
                        {quotedMsg.sender_id === currentUser.id ? 'Tú' : (quotedMsg.users?.name ?? 'Usuario')}
                      </p>
                      <p className="opacity-70 truncate">
                        {quotedMsg.type === 'image' ? '📷 Imagen' : quotedMsg.type === 'audio' ? '🎵 Audio' : (quotedMsg.content ?? '...')}
                      </p>
                    </div>
                  )}

                  {isSticker ? (
                    <span className="text-5xl leading-none block">{msg.content}</span>
                  ) : msg.type === 'image' && msg.content ? (
                    <img
                      src={msg.content}
                      alt="imagen"
                      className="max-w-[260px] max-h-[320px] object-cover block"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : msg.type === 'audio' && msg.content ? (
                    <AudioPlayer src={msg.content} isMe={isMe} />
                  ) : (
                    <span>{msg.content ?? ''}</span>
                  )}
                </div>
              </div>

              <span className="text-[9px] text-zinc-600 mt-1 px-1">
                {msg.created_at
                  ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}

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
      <div className="p-4 border-t border-zinc-900 bg-zinc-950/80 shrink-0 relative">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageSelect}
        />

        {/* Reply preview strip */}
        {replyingTo && (
       <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-zinc-800/60 border border-zinc-700/50 rounded-xl overflow-hidden"> <div className="w-0.5 h-8 bg-violet-500 rounded-full shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-violet-400 mb-0.5">
                {replyingTo.sender_id === currentUser.id ? 'Tú' : (replyingTo.users?.name ?? 'Usuario')}
              </p>
        <p className="text-xs text-zinc-400 truncate max-w-full overflow-hidden">
  {replyingTo.type === 'image' ? '📷 Imagen' : replyingTo.type === 'audio' ? '🎵 Audio' : (replyingTo.content ?? '')}
</p>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="shrink-0 p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Image preview strip */}
        {imagePreview && (
          <div className="mb-2 flex items-center gap-2 px-1">
            <div className="relative inline-block">
              <img
                src={imagePreview}
                alt="preview"
                className="h-16 w-16 object-cover rounded-xl border border-zinc-700"
              />
              <button
                type="button"
                onClick={handleRemoveImage}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-zinc-800 hover:bg-red-600 text-zinc-300 hover:text-white rounded-full flex items-center justify-center transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
            <span className="text-xs text-zinc-500 truncate max-w-[160px]">{imageFile?.name}</span>
          </div>
        )}

        {/* Sticker picker */}
        {showStickerPicker && (
          <div ref={stickerPickerRef} className="absolute bottom-full left-0 mb-2 w-72 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden z-50">
            <div className="flex border-b border-zinc-800 px-2 pt-2 gap-1 overflow-x-auto">
              {Object.keys(STICKERS).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveStickerTab(cat)}
                  className={`px-2.5 py-1.5 text-[10px] font-bold rounded-t-lg whitespace-nowrap transition-colors shrink-0 ${activeStickerTab === cat ? 'bg-zinc-800 text-violet-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-8 gap-0.5 p-2 max-h-44 overflow-y-auto">
              {STICKERS[activeStickerTab].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleSendSticker(emoji)}
                  className="text-2xl hover:bg-zinc-800 rounded-lg p-1 transition-colors leading-none"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {isRecording ? (
          <div className="flex items-center gap-2 bg-zinc-900/50 border border-red-500/40 rounded-2xl p-2">
            <button
              type="button"
              onClick={handleCancelRecording}
              className="p-2 text-zinc-500 hover:text-red-400 rounded-xl transition-colors shrink-0"
              title="Cancelar"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex-1 flex items-center gap-2 px-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
              <span className="text-sm text-red-400 font-mono tabular-nums">
                {String(Math.floor(recordingTime / 60)).padStart(2, '0')}:{String(recordingTime % 60).padStart(2, '0')}
              </span>
              <span className="text-xs text-zinc-500 truncate">Grabando audio...</span>
            </div>
            <button
              type="button"
              onClick={handleStopRecording}
              className="p-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl transition-all active:scale-[0.96] shrink-0"
              title="Enviar audio"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <form onSubmit={handleSendMessage} className="relative flex items-end gap-2 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-2 focus-within:border-violet-500/80 focus-within:ring-2 focus-within:ring-violet-500/10 transition-all">
            {/* Image button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingImage || isUploadingAudio}
              className="p-2 bg-zinc-800 text-violet-400 hover:bg-violet-600 hover:text-white rounded-xl transition-all shrink-0 self-end mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Adjuntar imagen"
            >
              <ImagePlus className="w-5 h-5" />
            </button>

            {/* Sticker button */}
            <button
              type="button"
              onClick={() => setShowStickerPicker((v) => !v)}
              disabled={isUploadingImage || isUploadingAudio}
              className={`p-2 rounded-xl transition-all shrink-0 self-end mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed ${showStickerPicker ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-violet-400 hover:bg-violet-600 hover:text-white'}`}
              title="Stickers"
            >
              <Sticker className="w-5 h-5" />
            </button>

            {/* Mic button */}
            <button
              type="button"
              onClick={handleStartRecording}
              disabled={isUploadingImage || isUploadingAudio}
              className="p-2 bg-zinc-800 text-violet-400 hover:bg-red-600 hover:text-white rounded-xl transition-all shrink-0 self-end mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Grabar audio"
            >
              <Mic className="w-5 h-5" />
            </button>

            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={imageFile ? 'Agregar caption (opcional)...' : `Message #conversation_${activeRoomId}...`}
              rows={1}
              disabled={isUploadingImage || isUploadingAudio}
              className="flex-1 max-h-32 bg-transparent border-0 focus:ring-0 focus:outline-none py-2 px-3 text-sm text-zinc-100 placeholder-zinc-550 resize-none overflow-y-auto disabled:opacity-50"
            />

            <div className="flex items-center gap-2 pr-1.5 pb-1">
              <span className="text-[10px] text-zinc-600 hidden md:flex items-center gap-1 bg-zinc-950/80 border border-zinc-800 py-1 px-2 rounded-lg">
                <span>Enter to send</span>
                <CornerDownLeft className="w-2.5 h-2.5" />
              </span>

              <button
                type="submit"
                disabled={(!inputValue.trim() && !imageFile) || isUploadingImage || isUploadingAudio}
                className="p-2.5 bg-gradient-to-tr from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:from-zinc-900 disabled:to-zinc-900 text-white disabled:text-zinc-600 rounded-xl transition-all shadow-md shadow-violet-600/10 active:scale-[0.96] disabled:cursor-not-allowed"
              >
                {isUploadingImage || isUploadingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
