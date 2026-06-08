'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket, disconnectSocket } from '@/lib/socket';
import AuthForm from '@/components/AuthForm';
import Sidebar from '@/components/Sidebar';
import ChatWindow from '@/components/ChatWindow';
import { Socket } from 'socket.io-client';
import { RefreshCw, MessageSquare } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  name: string;
  email: string;
  id: number;
}

export interface Conversation {
  id: number;
  participant: {
    id: number;
    name: string;
    email: string;
    avatar?: string;
  };
  lastMessage?: string;
  updatedAt?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNumericId(emailStr: string): number {
  let hash = 0;
  for (let i = 0; i < emailStr.length; i++) {
    hash = emailStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash % 10000);
}

function decodeToken(jwtToken: string): any {
  try {
    const parts = jwtToken.split('.');
    if (parts.length === 3) {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join(''),
      );
      return JSON.parse(jsonPayload);
    }
  } catch {
    // ignore
  }
  return null;
}

function normalizeUrl(url: string) {
  let u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`;
  if (u.endsWith('/')) u = u.slice(0, -1);
  return u;
}

function loadAliasesFromStorage(userId: number): Record<number, string> {
  try {
    const raw = localStorage.getItem(`chat_aliases_${userId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadContactAvatarsFromStorage(userId: number): Record<number, string> {
  try {
    const raw = localStorage.getItem(`chat_contact_avatars_${userId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [apiUrl, setApiUrl] = useState('http://localhost:3000');
  const [socketUrl, setSocketUrl] = useState('http://localhost:3000');

  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);
  const activeRoomIdRef = useRef<number | null>(null);
  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // ── Conversations list ────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(false);

  // ── Aliases (lifted so both Sidebar and ChatWindow share the same state) ─
  const [aliases, setAliases] = useState<Record<number, string>>({});

  // ── Contact avatars (local photo overrides per contact) ──────────────────
  const [contactAvatars, setContactAvatars] = useState<Record<number, string>>({});

  // ── User presence ─────────────────────────────────────────────────────────
  const [userStatuses, setUserStatuses] = useState<Record<number, { status: string; lastSeenAt: string | null }>>({});

  // Sync aliases to localStorage whenever they change
  useEffect(() => {
    if (user && mounted) {
      localStorage.setItem(`chat_aliases_${user.id}`, JSON.stringify(aliases));
    }
  }, [aliases, user, mounted]);

  // ── Load conversations from REST ──────────────────────────────────────────
  const loadConversations = useCallback(async (userId: number, currentToken: string, currentApiUrl: string) => {
    setLoadingConvos(true);
    try {
      const base = normalizeUrl(currentApiUrl);
      const res = await fetch(`${base}/api/conversations?userId=${userId}`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const rawList = Array.isArray(data) ? data : data.data ?? [];

      const mapped: Conversation[] = rawList.map((convo: any) => {
        const other = convo.conversations_members?.find((m: any) => m.user_id !== userId);
        return {
          id: convo.id,
          participant: other?.users
            ? { id: other.users.id, name: other.users.name || other.users.email.split('@')[0], email: other.users.email, avatar: other.users.avatar_url ?? undefined }
            : { id: 0, name: `Chat #${convo.id}`, email: '' },
          lastMessage: convo.messages?.[0]?.content ?? 'No messages yet',
          updatedAt: convo.updated_at ?? new Date().toISOString(),
        };
      });

      setConversations(mapped);
    } catch (err) {
      console.error('loadConversations error:', err);
    } finally {
      setLoadingConvos(false);
    }
  }, []);

  // ── Hydration / localStorage restore ─────────────────────────────────────
  useEffect(() => {
    setMounted(true);

    const storedToken = localStorage.getItem('chat_token');
    const storedApiUrl = localStorage.getItem('chat_api_url');
    const storedSocketUrl = localStorage.getItem('chat_socket_url');

    const resolvedApiUrl = storedApiUrl ?? 'http://localhost:3000';

    if (storedApiUrl) setApiUrl(storedApiUrl);
    if (storedSocketUrl) setSocketUrl(storedSocketUrl);

    if (storedToken) {
      const decoded = decodeToken(storedToken);
      if (decoded && decoded.exp * 1000 > Date.now()) {
        const uid = Number(decoded.id || decoded.userId || decoded.sub || getNumericId(decoded.email || ''));
        setToken(storedToken);
        const userData: User = {
          name: decoded.name || decoded.email?.split('@')[0] || 'User',
          email: decoded.email || 'user@example.com',
          id: uid,
        };
        setUser(userData);
        setAliases(loadAliasesFromStorage(uid));
        setContactAvatars(loadContactAvatarsFromStorage(uid));
        loadConversations(uid, storedToken, resolvedApiUrl);

        const storedActiveRoom = localStorage.getItem('chat_active_room_id');
        if (storedActiveRoom) {
          setActiveRoomId(Number(storedActiveRoom));
        }
      } else {
        localStorage.removeItem('chat_token');
        localStorage.removeItem('chat_active_room_id');
      }
    }
  }, [loadConversations]);

  // ── Socket connection ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted || !user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocketConnected(false);
      }
      return;
    }

    const socketInstance = getSocket(socketUrl, user.id);
    socketRef.current = socketInstance;
    socketInstance.connect();

    const onConnect = () => {
      setSocketConnected(true);
      socketInstance.emit('registerUser', user.id);
      if (activeRoomIdRef.current !== null) socketInstance.emit('joinRoom', activeRoomIdRef.current);
    };

    const onDisconnect = () => setSocketConnected(false);
    const onConnectError = () => setSocketConnected(false);

    const onConversationCreated = (convo: Conversation) => {
      setConversations((prev) => {
        if (prev.some((c) => c.id === convo.id)) return prev;
        return [convo, ...prev];
      });
    };

    const onNewMessage = (msg: any) => {
      setConversations((prev) =>
        prev
          .map((c) =>
            c.id === msg.conversation_id
              ? { ...c, lastMessage: msg.content ?? '', updatedAt: msg.created_at ?? new Date().toISOString() }
              : c,
          )
          .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()),
      );
    };

    const onUserStatusChanged = (data: { userId: number; status: string; last_seen_at: string | null }) => {
      setUserStatuses((prev) => ({
        ...prev,
        [data.userId]: { status: data.status, lastSeenAt: data.last_seen_at },
      }));
    };

    const onProfilePhotoUpdate = (data: { userId: number; avatar_url: string }) => {
      setContactAvatars((prev) => {
        const updated = { ...prev, [data.userId]: data.avatar_url };
        try {
          localStorage.setItem(`chat_contact_avatars_${user.id}`, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      setConversations((prev) =>
        prev.map((c) =>
          c.participant.id === data.userId
            ? { ...c, participant: { ...c.participant, avatar: data.avatar_url } }
            : c,
        ),
      );
    };

    socketInstance.on('connect', onConnect);
    socketInstance.on('disconnect', onDisconnect);
    socketInstance.on('connect_error', onConnectError);
    socketInstance.on('conversationCreated', onConversationCreated);
    socketInstance.on('newMessage', onNewMessage);
    socketInstance.on('userStatusChanged', onUserStatusChanged);
    socketInstance.on('profilePhotoUpdate', onProfilePhotoUpdate);

    if (socketInstance.connected) {
      setSocketConnected(true);
      socketInstance.emit('registerUser', user.id);
    }

    return () => {
      socketInstance.off('connect', onConnect);
      socketInstance.off('disconnect', onDisconnect);
      socketInstance.off('connect_error', onConnectError);
      socketInstance.off('conversationCreated', onConversationCreated);
      socketInstance.off('newMessage', onNewMessage);
      socketInstance.off('userStatusChanged', onUserStatusChanged);
      socketInstance.off('profilePhotoUpdate', onProfilePhotoUpdate);
      socketInstance.disconnect();
      socketRef.current = null;
      setSocketConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, user, socketUrl]);

  // ── Contact avatar management ─────────────────────────────────────────────
  const handleSaveContactAvatar = (contactId: number, dataUrl: string) => {
    setContactAvatars((prev) => {
      const updated = { ...prev, [contactId]: dataUrl };
      if (user) {
        try {
          localStorage.setItem(`chat_contact_avatars_${user.id}`, JSON.stringify(updated));
        } catch {}
      }
      return updated;
    });
  };

  // ── Alias management ──────────────────────────────────────────────────────
  const handleSaveAlias = (convoId: number, newName: string) => {
    setAliases((prev) => {
      const updated = { ...prev };
      if (newName.trim()) {
        updated[convoId] = newName.trim();
      } else {
        delete updated[convoId];
      }
      return updated;
    });
  };

  // ── Delete conversation ───────────────────────────────────────────────────
  const handleDeleteConversation = async (convoId: number) => {
    const base = normalizeUrl(apiUrl);
    const res = await fetch(`${base}/api/conversations/${convoId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token ?? ''}` },
    });
    if (!res.ok) throw new Error('Failed to delete');
    setConversations((prev) => prev.filter((c) => c.id !== convoId));
    setAliases((prev) => {
      const updated = { ...prev };
      delete updated[convoId];
      return updated;
    });
    if (activeRoomId === convoId) {
      setActiveRoomId(null);
      localStorage.removeItem('chat_active_room_id');
    }
  };

  // ── Room select ───────────────────────────────────────────────────────────
  const handleRoomSelect = (roomId: number) => {
    if (!socketRef.current) return;
    if (activeRoomId !== null) socketRef.current.emit('leaveRoom', activeRoomId);
    socketRef.current.emit('joinRoom', roomId);
    setActiveRoomId(roomId);
    localStorage.setItem('chat_active_room_id', String(roomId));
  };

  const handleAuthSuccess = (newToken: string, userData: User) => {
    localStorage.setItem('chat_token', newToken);
    setToken(newToken);
    setUser(userData);
    setAliases(loadAliasesFromStorage(userData.id));
    setContactAvatars(loadContactAvatarsFromStorage(userData.id));
    loadConversations(userData.id, newToken, apiUrl);
  };

  const handleLogout = () => {
    if (socketRef.current) {
      if (activeRoomId !== null) socketRef.current.emit('leaveRoom', activeRoomId);
      socketRef.current.disconnect();
    }
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_active_room_id');
    setToken(null);
    setUser(null);
    setActiveRoomId(null);
    setSocketConnected(false);
    setConversations([]);
    setAliases({});
    setContactAvatars({});
    disconnectSocket();
  };

  const handleSettingsChange = (settings: { apiUrl: string; socketUrl: string }) => {
    localStorage.setItem('chat_api_url', settings.apiUrl);
    localStorage.setItem('chat_socket_url', settings.socketUrl);
    setApiUrl(settings.apiUrl);
    setSocketUrl(settings.socketUrl);
  };

  // ── Derived state ─────────────────────────────────────────────────────────
  const activeConversation = conversations.find((c) => c.id === activeRoomId) ?? null;

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (!mounted) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950 text-zinc-100">
        <RefreshCw className="w-10 h-10 animate-spin text-violet-500" />
        <span className="mt-4 text-sm font-semibold text-zinc-400">Loading NexusChat...</span>
      </div>
    );
  }

  // ─── Not Logged In ────────────────────────────────────────────────────────
  if (!user) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center min-h-screen p-4 bg-zinc-950 text-zinc-100 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-[40rem] h-[40rem] bg-violet-600/10 rounded-full blur-[160px] -z-10 animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[40rem] h-[40rem] bg-fuchsia-600/10 rounded-full blur-[160px] -z-10 animate-pulse" />

        <div className="flex items-center gap-3.5 mb-8">
          <div className="p-3 bg-gradient-to-tr from-violet-600 to-fuchsia-600 rounded-2xl text-white shadow-xl">
            <MessageSquare className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold bg-gradient-to-r from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent tracking-tight">
              NexusChat
            </h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mt-0.5">Real-time Gateway client</p>
          </div>
        </div>

        <AuthForm
          apiUrl={apiUrl}
          socketUrl={socketUrl}
          onSettingsChange={handleSettingsChange}
          onAuthSuccess={handleAuthSuccess}
        />
      </main>
    );
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────
  return (
    <main className="flex-1 flex flex-col md:flex-row h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <Sidebar
        user={user}
        activeRoomId={activeRoomId}
        onRoomSelect={handleRoomSelect}
        onLogout={handleLogout}
        apiUrl={apiUrl}
        socketUrl={socketUrl}
        onSettingsChange={handleSettingsChange}
        socketConnected={socketConnected}
        token={token}
        conversations={conversations}
        loadingConvos={loadingConvos}
        onConversationsChange={setConversations}
        socket={socketRef.current}
        aliases={aliases}
        onSaveAlias={handleSaveAlias}
        onDeleteConversation={handleDeleteConversation}
        userStatuses={userStatuses}
        contactAvatars={contactAvatars}
      />

      <ChatWindow
        socket={socketRef.current}
        activeRoomId={activeRoomId}
        currentUser={user}
        apiUrl={apiUrl}
        token={token}
        onBack={() => {
          setActiveRoomId(null);
          localStorage.removeItem('chat_active_room_id');
        }}
        activeConversation={activeConversation}
        aliases={aliases}
        onSaveAlias={handleSaveAlias}
        onDeleteConversation={handleDeleteConversation}
        socketConnected={socketConnected}
        userStatuses={userStatuses}
        contactAvatars={contactAvatars}
        onSaveContactAvatar={handleSaveContactAvatar}
      />
    </main>
  );
}
