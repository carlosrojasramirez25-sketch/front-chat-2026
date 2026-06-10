'use client';

import { useState, useEffect, useRef } from 'react';
import {
  LogOut,
  MessageSquare,
  Search,
  UserCheck,
  UserX,
  Loader2,
  AlertCircle,
  Plus,
  Mail,
  Pencil,
  Trash2,
  Check,
  X,
  MoreHorizontal,
  User,
  Camera,
  Sun,
  Moon,
} from 'lucide-react';
import type { Socket } from 'socket.io-client';
import type { Conversation } from '@/app/page';
import { useTheme } from '@/app/providers';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FoundUser {
  id: number;
  name: string;
  email: string;
}

interface SidebarProps {
  user: { name: string; email: string; id: number };
  activeRoomId: number | null;
  onRoomSelect: (roomId: number) => void;
  onLogout: () => void;
  apiUrl: string;
  socketConnected: boolean;
  token: string | null;
  conversations: Conversation[];
  loadingConvos: boolean;
  onConversationsChange: React.Dispatch<React.SetStateAction<Conversation[]>>;
  socket: Socket | null;
  aliases: Record<number, string>;
  onSaveAlias: (convoId: number, newName: string) => void;
  onDeleteConversation: (convoId: number) => Promise<void>;
  userStatuses: Record<number, { status: string; lastSeenAt: string | null }>;
  contactAvatars: Record<number, string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(nameStr: string) {
  return nameStr
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return 'Desconectado';
  const diffSec = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 1000);
  if (diffSec < 60) return 'Hace un momento';
  if (diffSec < 3600) return `Hace ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `Hace ${Math.floor(diffSec / 3600)} h`;
  return `Hace ${Math.floor(diffSec / 86400)} d`;
}

function formatChatTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 7) return d.toLocaleDateString('es', { weekday: 'short' });
  return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function normalizeUrl(url: string) {
  let u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`;
  if (u.endsWith('/')) u = u.slice(0, -1);
  return u;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Sidebar({
  user,
  activeRoomId,
  onRoomSelect,
  onLogout,
  apiUrl,
  socketConnected,
  token,
  conversations,
  loadingConvos,
  onConversationsChange,
  socket,
  aliases,
  onSaveAlias,
  onDeleteConversation,
  userStatuses,
  contactAvatars,
}: SidebarProps) {
  // Header three-dot menu
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);

  // Profile edit modal
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editProfileName, setEditProfileName] = useState('');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [savedDisplayName, setSavedDisplayName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { theme, toggle: toggleTheme } = useTheme();

  // Load saved avatar + display name on mount
  useEffect(() => {
    const savedImg = localStorage.getItem(`chat_avatar_${user.id}`);
    if (savedImg) setProfileImage(savedImg);
    const savedName = localStorage.getItem(`chat_display_name_${user.id}`);
    setSavedDisplayName(savedName ?? user.name);
  }, [user.id, user.name]);

  // Resize image to max 400×400 before storing (avoids localStorage quota errors)
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        setProfileImage(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // User search
  const [searchEmail, setSearchEmail] = useState('');
  const [searching, setSearching] = useState(false);
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Starting conversation
  const [startingChat, setStartingChat] = useState(false);

  // ── Delete state ──────────────────────────────────────────────────────────
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // ── Alias edit state ──────────────────────────────────────────────────────
  const [editingAliasId, setEditingAliasId] = useState<number | null>(null);
  const [editingAliasValue, setEditingAliasValue] = useState('');
  const aliasInputRef = useRef<HTMLInputElement>(null);

  // Close header menu on outside click
  useEffect(() => {
    if (!showHeaderMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setShowHeaderMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showHeaderMenu]);

  // Focus alias input when editing starts
  useEffect(() => {
    if (editingAliasId !== null) {
      setTimeout(() => aliasInputRef.current?.focus(), 50);
    }
  }, [editingAliasId]);

  // ── Resolve display name (alias overrides participant name) ───────────────
  const getDisplayName = (convo: Conversation) => {
    if (aliases[convo.id]) return aliases[convo.id];
    return convo.participant?.name ?? `Conversation ${convo.id}`;
  };

  // ── Save alias ─────────────────────────────────────────────────────────────
  const handleSaveAlias = (convoId: number) => {
    onSaveAlias(convoId, editingAliasValue.trim());
    setEditingAliasId(null);
  };

  const handleCancelAlias = () => {
    setEditingAliasId(null);
  };

  // ── Delete conversation ───────────────────────────────────────────────────
  const handleDeleteConversation = async (convoId: number) => {
    if (deletingId === convoId) return;
    setDeletingId(convoId);
    try {
      await onDeleteConversation(convoId);
    } catch {
      // silently fail
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  // ── Search user by email ──────────────────────────────────────────────────
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchEmail.trim()) return;
    setSearching(true);
    setFoundUser(null);
    setSearchError(null);

    try {
      const base = normalizeUrl(apiUrl);
      const res = await fetch(
        `${base}/api/users?email=${encodeURIComponent(searchEmail.trim())}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!res.ok) {
        setSearchError(res.status === 404 ? 'No user found with that email.' : 'Error searching. Check the API.');
        return;
      }

      const data = await res.json();
      const usr: FoundUser = Array.isArray(data) ? data[0] : data;

      if (!usr?.id) { setSearchError('No user found with that email.'); return; }
      if (usr.id === user.id) { setSearchError("That's you! Search for another user."); return; }

      setFoundUser(usr);
    } catch {
      setSearchError('Could not reach the API. Is the backend running?');
    } finally {
      setSearching(false);
    }
  };

  // ── Create / find conversation then join room ─────────────────────────────
  const handleStartChat = async (targetUser: FoundUser) => {
    if (startingChat) return;
    setStartingChat(true);
    setSearchError(null);

    try {
      const base = normalizeUrl(apiUrl);
      const res = await fetch(`${base}/api/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ created_by: user.id, participant_id: targetUser.id }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Could not create conversation');
      }

      const convo = await res.json();
      const conversationId: number = convo.id ?? convo.conversation_id;
      if (!conversationId) throw new Error('Backend did not return a conversation ID');

      const newConvoItem: Conversation = {
        id: conversationId,
        participant: targetUser,
        lastMessage: 'No messages yet',
        updatedAt: new Date().toISOString(),
      };

      onConversationsChange((prev) => {
        if (prev.some((c) => c.id === conversationId)) return prev;
        return [newConvoItem, ...prev];
      });

      if (socket?.connected) {
        socket.emit('newConversation', {
          conversationId,
          targetUserId: targetUser.id,
          creatorId: user.id,
          creatorName: user.name,
          creatorEmail: user.email,
        });
      }

      setSearchEmail('');
      setFoundUser(null);
      onRoomSelect(conversationId);
    } catch (err: any) {
      setSearchError(err.message || 'Failed to start conversation');
    } finally {
      setStartingChat(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <aside className={`w-full md:w-80 bg-zinc-950/80 border-r border-zinc-900 flex flex-col h-full text-zinc-100 relative overflow-hidden backdrop-blur-md ${activeRoomId !== null ? 'hidden md:flex' : 'flex'}`}>
      {/* Ambient glow */}
      <div className="absolute -top-32 -left-32 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl -z-10" />

      {/* ── Header / Brand ── */}
      <div className="p-5 border-b border-zinc-900 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-tr from-violet-600 to-fuchsia-600 rounded-xl text-white shadow-md shadow-violet-600/10">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-base bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent leading-none">
              Y&C - CHAT
            </h1>
          </div>
        </div>

        {/* Header menu */}
        <div className="relative" ref={headerMenuRef}>
          <button
            onClick={() => setShowHeaderMenu((v) => !v)}
            className="p-2 hover:bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 rounded-xl transition-all border border-transparent hover:border-zinc-800"
            title="Menú"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {showHeaderMenu && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden">
              {/* Connection status row */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60">
                <span className={`w-2 h-2 rounded-full shrink-0 ${socketConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  {socketConnected ? 'Conectado' : 'Desconectado'}
                </span>
              </div>
              <button
                onClick={() => {
                  setEditProfileName(user.name);
                  setShowEditProfile((v) => !v);
                  setShowHeaderMenu(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all"
              >
                <User className="w-3.5 h-3.5 text-violet-400" />
                Editar perfil
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Edit Profile Modal (fixed overlay) ── */}
      {showEditProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowEditProfile(false); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Card — slides up from the bottom-right (chat input area) */}
          <div className="relative w-full h-full bg-zinc-900 overflow-y-auto">
            {/* Gradient accent bar */}
            <div className="h-1 w-full bg-gradient-to-r from-violet-600 to-fuchsia-600" />

            <div className="p-6">
              {/* Header row */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-violet-400" />
                  <h2 className="text-sm font-bold text-white">Editar perfil</h2>
                </div>
                <button
                  onClick={() => setShowEditProfile(false)}
                  className="p-1.5 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 rounded-lg transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Avatar upload */}
              <div className="flex flex-col items-center mb-6">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="relative group focus:outline-none"
                >
                  <div className="w-24 h-24 rounded-full ring-2 ring-violet-500/40 ring-offset-2 ring-offset-zinc-900 overflow-hidden">
                    {profileImage ? (
                      <img src={profileImage} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-tr from-violet-500 to-fuchsia-500 flex items-center justify-center font-bold text-white text-2xl">
                        {(editProfileName.trim() || user.name)
                          .split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                    )}
                  </div>
                  {/* Camera overlay */}
                  <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
                <p className="text-[10px] text-zinc-500 mt-2">Click para cambiar foto</p>
              </div>

              {/* Fields */}
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] text-zinc-400 font-bold mb-1.5 uppercase tracking-wider">
                    Nombre
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={editProfileName}
                    onChange={(e) => setEditProfileName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setShowEditProfile(false); }}
                    placeholder={user.name}
                    className="w-full bg-zinc-800/60 border border-zinc-700 rounded-xl py-2.5 px-3.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-400 font-bold mb-1.5 uppercase tracking-wider">
                    Email
                  </label>
                  <div className="w-full bg-zinc-800/30 border border-zinc-800 rounded-xl py-2.5 px-3.5 text-sm text-zinc-500 cursor-not-allowed">
                    {user.email}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const trimmed = editProfileName.trim();
                      if (trimmed) {
                        localStorage.setItem(`chat_display_name_${user.id}`, trimmed);
                        setSavedDisplayName(trimmed);
                      } else {
                        localStorage.removeItem(`chat_display_name_${user.id}`);
                        setSavedDisplayName(user.name);
                      }
                      if (profileImage) {
                        localStorage.setItem(`chat_avatar_${user.id}`, profileImage);

                        // 1. Persist to backend so all clients see it on next load
                        fetch(`${normalizeUrl(apiUrl)}/api/users/${user.id}`, {
                          method: 'PATCH',
                          headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { Authorization: `Bearer ${token}` } : {}),
                          },
                          body: JSON.stringify({ avatar_url: profileImage }),
                        }).catch(() => {}); // silently ignore if endpoint doesn't exist

                        // 2. Real-time broadcast for already-connected clients
                        socket?.emit('profilePhotoUpdate', { userId: user.id, avatar_url: profileImage });
                      }
                    } catch {
                      // localStorage quota exceeded — skip silently
                    }
                    setShowEditProfile(false);
                  }}
                  className="flex-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-bold py-2.5 rounded-xl transition-all shadow-md shadow-violet-600/20 active:scale-[0.98]"
                >
                  Guardar cambios
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditProfile(false)}
                  className="px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-sm font-semibold py-2.5 rounded-xl transition-all"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ── Scrollable body ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">

        {/* ── New Chat Search ── */}
        <div>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 px-1 flex items-center gap-1.5">
            <Plus className="w-3 h-3" /> New Conversation
          </p>

          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <input
                type="email"
                value={searchEmail}
                onChange={(e) => { setSearchEmail(e.target.value); setFoundUser(null); setSearchError(null); }}
                placeholder="Search by email..."
                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-all"
              />
            </div>
            <button type="submit" disabled={searching || !searchEmail.trim()}
              className="p-2 bg-zinc-900 hover:bg-violet-600 disabled:hover:bg-zinc-900 text-zinc-400 hover:text-white disabled:text-zinc-600 rounded-xl border border-zinc-800 transition-all disabled:cursor-not-allowed shrink-0">
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </button>
          </form>

          {/* Search Error */}
          {searchError && (
            <div className="mt-2 flex items-start gap-2 p-3 bg-red-950/30 border border-red-900/40 rounded-xl text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{searchError}</span>
            </div>
          )}

          {/* Found User card */}
          {foundUser && (
            <div className="mt-2 p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-white text-[11px] shrink-0">
                  {getInitials(foundUser.name)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-zinc-200 truncate">{foundUser.name}</p>
                  <p className="text-[10px] text-zinc-500 truncate">{foundUser.email}</p>
                </div>
              </div>
              <button onClick={() => handleStartChat(foundUser)} disabled={startingChat}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 text-white text-[11px] font-bold rounded-lg transition-all">
                {startingChat ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><UserCheck className="w-3.5 h-3.5" /> Chat</>}
              </button>
            </div>
          )}
        </div>

        {/* ── Conversation List ── */}
        <div>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 px-1 flex items-center gap-1.5">
            <MessageSquare className="w-3 h-3" /> Chats
          </p>

          {loadingConvos ? (
            <div className="flex items-center justify-center py-8 text-zinc-600">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <div className="p-3 bg-zinc-900/60 rounded-2xl mb-3">
                <UserX className="w-6 h-6 text-zinc-600" />
              </div>
              <p className="text-xs text-zinc-500 font-medium">No conversations yet</p>
              <p className="text-[10px] text-zinc-600 mt-1">Search by email above to start chatting</p>
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map((convo) => {
                const isActive = activeRoomId === convo.id;
                const displayName = getDisplayName(convo);
                const isEditingAlias = editingAliasId === convo.id;
                const isConfirmingDelete = confirmDeleteId === convo.id;
                const isDeleting = deletingId === convo.id;
                const isOnline = userStatuses[convo.participant.id]?.status === 'online';

                return (
                  <div key={convo.id} className="group relative">

                    {/* ── Confirm delete overlay ── */}
                    {isConfirmingDelete && (
                      <div className="flex items-center gap-2 px-3 py-3 rounded-xl bg-red-950/40 border border-red-900/40">
                        <Trash2 className="w-4 h-4 text-red-400 shrink-0" />
                        <p className="text-xs text-red-300 flex-1 truncate">Delete this chat?</p>
                        <button
                          onClick={() => handleDeleteConversation(convo.id)}
                          disabled={isDeleting}
                          className="shrink-0 flex items-center gap-1 px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold rounded-lg transition-all"
                        >
                          {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="shrink-0 p-1 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg transition-all"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* ── Alias edit mode ── */}
                    {isEditingAlias && !isConfirmingDelete && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900/60 border border-violet-500/30">
                        <Pencil className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                        <input
                          ref={aliasInputRef}
                          value={editingAliasValue}
                          onChange={(e) => setEditingAliasValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveAlias(convo.id);
                            if (e.key === 'Escape') handleCancelAlias();
                          }}
                          placeholder={convo.participant?.name ?? `Conversation ${convo.id}`}
                          className="flex-1 min-w-0 bg-transparent text-xs text-white placeholder-zinc-600 focus:outline-none"
                        />
                        <button
                          onClick={() => handleSaveAlias(convo.id)}
                          className="shrink-0 p-1 hover:bg-violet-700 bg-violet-600 text-white rounded-lg transition-all"
                          title="Save"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          onClick={handleCancelAlias}
                          className="shrink-0 p-1 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg transition-all"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* ── Normal row ── */}
                    {!isConfirmingDelete && !isEditingAlias && (
                      <div className={`flex items-center gap-0 transition-colors duration-150 ${
                        isActive ? 'bg-zinc-800/80' : 'hover:bg-zinc-900/70'
                      }`}>
                        {/* Avatar + info (click to open) */}
                        <button
                          onClick={() => onRoomSelect(convo.id)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left pl-3 pr-1 py-3"
                        >
                          {/* Avatar */}
                          <div className="relative shrink-0">
                            <div className={`w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center font-bold text-base shrink-0 ${!contactAvatars[convo.participant.id] && !convo.participant.avatar ? (isActive ? 'bg-gradient-to-tr from-violet-600 to-fuchsia-600 text-white' : 'bg-zinc-700 text-zinc-300') : ''}`}>
                              {(contactAvatars[convo.participant.id] || convo.participant.avatar) ? (
                                <img
                                  src={contactAvatars[convo.participant.id] || convo.participant.avatar}
                                  alt={displayName}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                getInitials(displayName)
                              )}
                            </div>
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-zinc-950 ${isOnline ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                              title={isOnline ? 'En línea' : formatLastSeen(userStatuses[convo.participant.id]?.lastSeenAt ?? null)}
                            />
                          </div>

                          {/* Name + timestamp + last message */}
                          <div className="min-w-0 flex-1 border-b border-zinc-800/60 pb-3">
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <p className="text-base font-semibold truncate leading-snug text-zinc-100">
                                {displayName}
                                {aliases[convo.id] && (
                                  <span className="ml-1 text-[9px] text-violet-400 font-normal">(alias)</span>
                                )}
                              </p>
                              <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">{formatChatTime(convo.updatedAt)}</span>
                            </div>
                            <p className="text-sm text-zinc-400 truncate leading-snug">
                              {convo.lastMessage ?? convo.participant?.email ?? `#${convo.id}`}
                            </p>
                          </div>
                        </button>

                        {/* Action buttons — visible on hover or when active */}
                        <div className={`flex items-center gap-0.5 shrink-0 pr-1 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          {/* Rename */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingAliasId(convo.id);
                              setEditingAliasValue(aliases[convo.id] ?? '');
                              setConfirmDeleteId(null);
                            }}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-violet-400 hover:bg-violet-500/10 transition-all"
                            title="Rename contact (local only)"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(convo.id);
                              setEditingAliasId(null);
                            }}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            title="Delete conversation"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0 ml-0.5" />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="p-4 border-t border-zinc-900 bg-zinc-950/40 shrink-0">
        <div className="flex items-center gap-3">
          {/* Avatar — click to open profile edit */}
          <button
            onClick={() => { setEditProfileName(savedDisplayName); setShowEditProfile(true); }}
            className="relative shrink-0 group"
            title="Editar perfil"
          >
            <div className="w-10 h-10 rounded-xl overflow-hidden ring-1 ring-zinc-700 group-hover:ring-violet-500/60 transition-all">
              {profileImage ? (
                <img src={profileImage} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-tr from-violet-500 to-fuchsia-500 flex items-center justify-center font-bold text-white text-xs">
                  {getInitials(savedDisplayName)}
                </div>
              )}
            </div>
            <div className="absolute inset-0 rounded-xl bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Camera className="w-3.5 h-3.5 text-white" />
            </div>
          </button>

          {/* Name + email */}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-zinc-200 truncate leading-none">{savedDisplayName}</p>
            <p className="text-[10px] text-zinc-500 truncate mt-0.5">{user.email}</p>
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="shrink-0 p-2 hover:bg-zinc-800 text-zinc-500 hover:text-violet-400 rounded-xl transition-all"
            title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Logout */}
          <button
            onClick={onLogout}
            className="shrink-0 p-2 hover:bg-zinc-800 text-zinc-500 hover:text-red-400 rounded-xl transition-all"
            title="Desconectar"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
