'use client';

import { useState, useEffect, useRef } from 'react';
import {
  LogOut,
  Settings,
  MessageSquare,
  Sliders,
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
} from 'lucide-react';
import type { Socket } from 'socket.io-client';
import type { Conversation } from '@/app/page';

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
  socketUrl: string;
  onSettingsChange: (settings: { apiUrl: string; socketUrl: string }) => void;
  socketConnected: boolean;
  token: string | null;
  conversations: Conversation[];
  loadingConvos: boolean;
  onConversationsChange: React.Dispatch<React.SetStateAction<Conversation[]>>;
  socket: Socket | null;
  onActiveRoomClear?: () => void;
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

function normalizeUrl(url: string) {
  let u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = `http://${u}`;
  if (u.endsWith('/')) u = u.slice(0, -1);
  return u;
}

// ─── Local alias helpers (stored per user in localStorage) ────────────────────

function loadAliases(userId: number): Record<number, string> {
  try {
    const raw = localStorage.getItem(`chat_aliases_${userId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAliases(userId: number, aliases: Record<number, string>) {
  localStorage.setItem(`chat_aliases_${userId}`, JSON.stringify(aliases));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Sidebar({
  user,
  activeRoomId,
  onRoomSelect,
  onLogout,
  apiUrl,
  socketUrl,
  onSettingsChange,
  socketConnected,
  token,
  conversations,
  loadingConvos,
  onConversationsChange,
  socket,
  onActiveRoomClear,
}: SidebarProps) {
  // Settings panel
  const [showSettings, setShowSettings] = useState(false);
  const [tempApiUrl, setTempApiUrl] = useState(apiUrl);
  const [tempSocketUrl, setTempSocketUrl] = useState(socketUrl);

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
  // Map of conversationId -> local display name override
  const [aliases, setAliases] = useState<Record<number, string>>({});
  const [editingAliasId, setEditingAliasId] = useState<number | null>(null);
  const [editingAliasValue, setEditingAliasValue] = useState('');
  const aliasInputRef = useRef<HTMLInputElement>(null);

  // Load aliases from localStorage on mount
  useEffect(() => {
    setAliases(loadAliases(user.id));
  }, [user.id]);

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
    const trimmed = editingAliasValue.trim();
    const updated = { ...aliases };
    if (trimmed) {
      updated[convoId] = trimmed;
    } else {
      delete updated[convoId]; // empty = reset to real name
    }
    setAliases(updated);
    saveAliases(user.id, updated);
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
      const base = normalizeUrl(apiUrl);
      const res = await fetch(`${base}/api/conversations/${convoId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to delete');

      // Remove from local list
      onConversationsChange((prev) => prev.filter((c) => c.id !== convoId));

      // Remove local alias if any
      const updated = { ...aliases };
      delete updated[convoId];
      setAliases(updated);
      saveAliases(user.id, updated);

      // If this was the active room, clear it
      if (activeRoomId === convoId && onActiveRoomClear) {
        onActiveRoomClear();
      }
    } catch {
      // silently fail — could show a toast here
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

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    onSettingsChange({ apiUrl: tempApiUrl.trim(), socketUrl: tempSocketUrl.trim() });
    setShowSettings(false);
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

        {/* Socket Status */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900/60 border border-zinc-800 rounded-full">
          <span className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
          <span className="text-[10px] font-bold text-zinc-400">{socketConnected ? 'Live' : 'Offline'}</span>
        </div>
      </div>

      {/* ── User Profile ── */}
      {/* <div className="p-4 mx-4 mt-4 bg-zinc-900/40 border border-zinc-800/60 rounded-2xl flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-500 to-fuchsia-500 flex items-center justify-center font-bold text-white shadow-md text-xs shrink-0">
            {getInitials(user.name)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate text-zinc-200">{user.name}</p>
            <p className="text-[10px] text-zinc-400 truncate">{user.email}</p>
          </div>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2 rounded-lg transition-all shrink-0 ${showSettings ? 'bg-zinc-800 text-violet-400' : 'hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
          title="Server Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div> */}

      {/* ── Settings Panel ── */}
      {showSettings && (
        <div className="mx-4 mt-2 p-4 bg-zinc-950/90 border border-zinc-900 rounded-2xl shadow-xl shrink-0">
          <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            <Sliders className="w-3.5 h-3.5" />
            <span>Connection Settings</span>
          </div>
          <form onSubmit={handleSaveSettings} className="space-y-2">
            <div>
              <label className="block text-[10px] text-zinc-400 font-bold mb-1 uppercase">REST API Url</label>
              <input type="text" value={tempApiUrl} onChange={(e) => setTempApiUrl(e.target.value)} placeholder="http://localhost:3000"
                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg py-1.5 px-3 text-xs text-white focus:outline-none focus:border-violet-500" />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400 font-bold mb-1 uppercase">WebSocket Url</label>
              <input type="text" value={tempSocketUrl} onChange={(e) => setTempSocketUrl(e.target.value)} placeholder="http://localhost:3000"
                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg py-1.5 px-3 text-xs text-white focus:outline-none focus:border-violet-500" />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" className="flex-1 bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold py-1.5 rounded-lg transition-all">Apply</button>
              <button type="button" onClick={() => { setTempApiUrl(apiUrl); setTempSocketUrl(socketUrl); setShowSettings(false); }}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[11px] font-bold py-1.5 rounded-lg transition-all">Cancel</button>
            </div>
          </form>
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
                      <div className={`flex items-center gap-2 pl-3 pr-1 py-2.5 rounded-xl transition-all duration-200 ${
                        isActive
                          ? 'bg-gradient-to-r from-violet-600/20 to-fuchsia-600/10 border border-violet-500/20 shadow-sm'
                          : 'hover:bg-zinc-900/50 border border-transparent'
                      }`}>
                        {/* Avatar + info (click to open) */}
                        <button
                          onClick={() => onRoomSelect(convo.id)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        >
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${isActive ? 'bg-gradient-to-tr from-violet-600 to-fuchsia-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
                            {getInitials(displayName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-semibold truncate ${isActive ? 'text-white' : 'text-zinc-300'}`}>
                              {displayName}
                              {aliases[convo.id] && (
                                <span className="ml-1 text-[9px] text-violet-400 font-normal">(alias)</span>
                              )}
                            </p>
                            <p className="text-[10px] text-zinc-500 truncate">
                              {convo.lastMessage ?? convo.participant?.email ?? `#${convo.id}`}
                            </p>
                          </div>
                        </button>

                        {/* Action buttons — visible on hover or when active */}
                        <div className={`flex items-center gap-0.5 shrink-0 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
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

      {/* ── Footer / Logout ── */}
      <div className="p-4 border-t border-zinc-900 bg-zinc-950/40 shrink-0">
        <button onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-900/20 hover:bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 text-sm font-semibold transition-all active:scale-[0.98]">
          <LogOut className="w-4 h-4" />
          <span>Disconnect / Logout</span>
        </button>
      </div>
    </aside>
  );
}
