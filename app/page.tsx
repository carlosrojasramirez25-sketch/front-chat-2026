'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { registerPush } from '@/lib/push';
import AuthForm from '@/components/AuthForm';
import Sidebar from '@/components/Sidebar';
import ChatWindow from '@/components/ChatWindow';
import CallUI from '@/components/CallUI';
import { Socket } from 'socket.io-client';
import { RefreshCw, MessageSquare } from 'lucide-react';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

type CallStatus = 'idle' | 'calling' | 'incoming' | 'active';

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

function sanitizeAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('https://') || url.startsWith('http://')) return url;
  if (/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url)) return url;
  return null;
}

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

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL!;
  const [apiUrl] = useState(BACKEND_URL);
  const [socketUrl] = useState(BACKEND_URL);

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

  // ── Call state ────────────────────────────────────────────────────────────
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [callPeer, setCallPeer] = useState<{ userId: number; name: string; avatar?: string } | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [pendingOffer, setPendingOffer] = useState<RTCSessionDescriptionInit | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);

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
      const res = await fetch(`${base}/api/conversations`, {
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
            ? { id: other.users.id, name: other.users.name || other.users.email.split('@')[0], email: other.users.email, avatar: sanitizeAvatarUrl(other.users.avatar_url) ?? undefined }
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
        loadConversations(uid, storedToken, apiUrl);
        registerPush(uid, apiUrl, storedToken);

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

  // ── WebRTC cleanup (defined before socket useEffect so handlers can reference it) ──
  const cleanupCall = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    iceCandidateQueueRef.current = [];
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setLocalStream(null);
    setRemoteStream(null);
    setCallStatus('idle');
    setCallPeer(null);
    setCallType('audio');
    setPendingOffer(null);
    setIsMuted(false);
  }, []);

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
      const safeAvatar = sanitizeAvatarUrl(data.avatar_url);
      if (!safeAvatar) return;
      setContactAvatars((prev) => {
        const updated = { ...prev, [data.userId]: safeAvatar };
        try {
          localStorage.setItem(`chat_contact_avatars_${user.id}`, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      setConversations((prev) =>
        prev.map((c) =>
          c.participant.id === data.userId
            ? { ...c, participant: { ...c.participant, avatar: safeAvatar } }
            : c,
        ),
      );
    };

    const onIncomingCall = (data: { callerId: number; callerName: string; offer: RTCSessionDescriptionInit; callType?: 'audio' | 'video' }) => {
      setPendingOffer(data.offer);
      setCallType(data.callType ?? 'audio');
      setCallPeer({ userId: data.callerId, name: data.callerName });
      setCallStatus('incoming');
    };

    const onCallAnswered = async (data: { answer: RTCSessionDescriptionInit }) => {
      if (peerRef.current) {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        for (const c of iceCandidateQueueRef.current) {
          await peerRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
        iceCandidateQueueRef.current = [];
        setCallStatus('active');
      }
    };

    const onCallRejected = () => {
      cleanupCall();
    };

    const onCallEnded = () => {
      cleanupCall();
    };

    const onIceCandidate = async (data: { candidate: RTCIceCandidateInit }) => {
      if (!data.candidate) return;
      if (peerRef.current?.remoteDescription) {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
      } else {
        iceCandidateQueueRef.current.push(data.candidate);
      }
    };

    socketInstance.on('connect', onConnect);
    socketInstance.on('disconnect', onDisconnect);
    socketInstance.on('connect_error', onConnectError);
    socketInstance.on('conversationCreated', onConversationCreated);
    socketInstance.on('newMessage', onNewMessage);
    socketInstance.on('userStatusChanged', onUserStatusChanged);
    socketInstance.on('profilePhotoUpdate', onProfilePhotoUpdate);
    socketInstance.on('incomingCall', onIncomingCall);
    socketInstance.on('callAnswered', onCallAnswered);
    socketInstance.on('callRejected', onCallRejected);
    socketInstance.on('callEnded', onCallEnded);
    socketInstance.on('iceCandidate', onIceCandidate);

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
      socketInstance.off('incomingCall', onIncomingCall);
      socketInstance.off('callAnswered', onCallAnswered);
      socketInstance.off('callRejected', onCallRejected);
      socketInstance.off('callEnded', onCallEnded);
      socketInstance.off('iceCandidate', onIceCandidate);
      socketInstance.disconnect();
      socketRef.current = null;
      setSocketConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, user, socketUrl]);

  // ── WebRTC helpers ────────────────────────────────────────────────────────
  const createPeer = (targetUserId: number) => {
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peer.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        socketRef.current.emit('iceCandidate', { targetUserId, candidate: e.candidate.toJSON() });
      }
    };
    peer.ontrack = (e) => {
      const stream = e.streams[0];
      if (e.track.kind === 'audio' && remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
      }
      setRemoteStream(stream);
    };
    return peer;
  };

  const startCall = async (targetUserId: number, targetName: string, targetAvatar?: string, type: 'audio' | 'video' = 'audio') => {
    if (!socketRef.current || !user) return;
    try {
      const constraints = type === 'video' ? { audio: true, video: true } : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);
      const peer = createPeer(targetUserId);
      stream.getTracks().forEach((t) => peer.addTrack(t, stream));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      peerRef.current = peer;
      setCallType(type);
      setCallPeer({ userId: targetUserId, name: targetName, avatar: targetAvatar });
      setCallStatus('calling');
      socketRef.current.emit('callOffer', { targetUserId, callerId: user.id, callerName: user.name, offer, callType: type, conversationId: activeRoomId });
    } catch {
      cleanupCall();
    }
  };

  const acceptCall = async () => {
    if (!socketRef.current || !user || !pendingOffer || !callPeer) return;
    try {
      const constraints = callType === 'video' ? { audio: true, video: true } : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);
      const peer = createPeer(callPeer.userId);
      stream.getTracks().forEach((t) => peer.addTrack(t, stream));
      await peer.setRemoteDescription(new RTCSessionDescription(pendingOffer));
      for (const c of iceCandidateQueueRef.current) {
        await peer.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      iceCandidateQueueRef.current = [];
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      peerRef.current = peer;
      setCallStatus('active');
      socketRef.current.emit('callAnswer', { callerId: callPeer.userId, answer });
    } catch {
      cleanupCall();
    }
  };

  const rejectCall = () => {
    if (socketRef.current && callPeer) {
      socketRef.current.emit('callReject', { callerId: callPeer.userId });
    }
    cleanupCall();
  };

  const hangUp = () => {
    if (socketRef.current && callPeer) {
      socketRef.current.emit('callEnd', { targetUserId: callPeer.userId });
    }
    cleanupCall();
  };

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsMuted((m) => !m);
  };

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
    registerPush(userData.id, apiUrl, newToken);
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

  // ── Derived state ─────────────────────────────────────────────────────────
  const activeConversation = conversations.find((c) => c.id === activeRoomId) ?? null;

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (!mounted) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-zinc-950 text-zinc-100">
        <RefreshCw className="w-10 h-10 animate-spin text-violet-500" />
        <span className="mt-4 text-sm font-semibold text-zinc-400">Cargando Y&C - Chat...</span>
      </div>
    );
  }

  // ─── Not Logged In ────────────────────────────────────────────────────────
  if (!user) {
    return (
      <main className="fixed inset-0 flex flex-col items-center justify-center p-4 bg-zinc-950 text-zinc-100 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-[40rem] h-[40rem] bg-violet-600/10 rounded-full blur-[160px] -z-10 animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[40rem] h-[40rem] bg-fuchsia-600/10 rounded-full blur-[160px] -z-10 animate-pulse" />

        <div className="flex items-center gap-3.5 mb-8">
          <div className="p-3 bg-gradient-to-tr from-violet-600 to-fuchsia-600 rounded-2xl text-white shadow-xl">
            <MessageSquare className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold bg-gradient-to-r from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent tracking-tight">
              Y&C - CHAT
            </h1>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mt-0.5">Chat de Prueba Beta 1.0</p>
          </div>
        </div>

        <AuthForm
          onAuthSuccess={handleAuthSuccess}
        />
      </main>
    );
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────
  return (
    <main className="fixed inset-0 flex flex-col md:flex-row bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Hidden audio element for remote call audio */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* Call overlay */}
      {callStatus !== 'idle' && callPeer && (
        <CallUI
          status={callStatus}
          remoteName={callPeer.name}
          remoteAvatar={callPeer.avatar}
          isMuted={isMuted}
          callType={callType}
          localStream={localStream}
          remoteStream={remoteStream}
          onAccept={acceptCall}
          onReject={rejectCall}
          onHangUp={hangUp}
          onToggleMute={toggleMute}
        />
      )}

      <Sidebar
        user={user}
        activeRoomId={activeRoomId}
        onRoomSelect={handleRoomSelect}
        onLogout={handleLogout}
        apiUrl={apiUrl}
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
        onCall={(userId, name, avatar) => startCall(userId, name, avatar, 'audio')}
        onVideoCall={(userId, name, avatar) => startCall(userId, name, avatar, 'video')}
      />
    </main>
  );
}
