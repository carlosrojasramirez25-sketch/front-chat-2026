'use client';

import { useState } from 'react';
import { Mail, Lock, User, LogIn, UserPlus, AlertCircle, RefreshCw, Settings } from 'lucide-react';

interface AuthFormProps {
  apiUrl: string;
  socketUrl: string;
  onSettingsChange: (settings: { apiUrl: string; socketUrl: string }) => void;
  onAuthSuccess: (token: string, userData: { name: string; email: string; id: number }) => void;
}

export default function AuthForm({ apiUrl, socketUrl, onSettingsChange, onAuthSuccess }: AuthFormProps) {
  const [showLocalSettings, setShowLocalSettings] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const getNumericId = (emailStr: string): number => {
    let hash = 0;
    for (let i = 0; i < emailStr.length; i++) {
      hash = emailStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash % 10000);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/create';
    const payload = isLogin 
      ? { email, password } 
      : { email, password, name };

    try {
      // Normalize API url
      let cleanApiUrl = apiUrl.trim();
      if (!cleanApiUrl.startsWith('http://') && !cleanApiUrl.startsWith('https://')) {
        cleanApiUrl = `http://${cleanApiUrl}`;
      }
      if (cleanApiUrl.endsWith('/')) {
        cleanApiUrl = cleanApiUrl.slice(0, -1);
      }

      const response = await fetch(`${cleanApiUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || (isLogin ? 'Failed to log in' : 'Failed to register'));
      }

      if (!data.payloadJWT) {
        throw new Error('No JWT token received from server');
      }

      const token = data.payloadJWT;
      
      // Decode JWT token
      let decoded: any = {};
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const base64Url = parts[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(
            atob(base64)
              .split('')
              .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
              .join('')
          );
          decoded = JSON.parse(jsonPayload);
        }
      } catch (err) {
        console.error('Error decoding token:', err);
      }

      const userName = decoded.name || name || email.split('@')[0];
      const userEmail = decoded.email || email;
      const userId = decoded.id || decoded.userId || decoded.sub || getNumericId(userEmail);

      onAuthSuccess(token, {
        name: userName,
        email: userEmail,
        id: Number(userId),
      });
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-8 bg-zinc-900/60 backdrop-blur-xl border border-zinc-800 rounded-3xl shadow-2xl relative overflow-hidden">
      {/* Decorative gradients */}
      <div className="absolute -top-40 -right-40 w-80 h-80 bg-violet-600/20 rounded-full blur-3xl -z-10" />
      <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-fuchsia-600/20 rounded-full blur-3xl -z-10" />

      {/* Settings Toggle button */}
      <button
        type="button"
        onClick={() => setShowLocalSettings(!showLocalSettings)}
        className="absolute top-6 right-6 p-2 rounded-xl bg-zinc-950/40 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-all cursor-pointer"
        title="Connection Settings"
      >
        <Settings className="w-4 h-4" />
      </button>

      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-violet-600 to-fuchsia-600 text-white shadow-lg mb-4">
          {isLogin ? <LogIn className="w-6 h-6 animate-pulse" /> : <UserPlus className="w-6 h-6 animate-pulse" />}
        </div>
        <h2 className="text-2xl font-bold bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </h2>
        <p className="text-sm text-zinc-400 mt-1">
          {isLogin ? 'Enter your details to log into your account' : 'Register to start chatting in real time'}
        </p>
      </div>

      {/* Connection Settings panel */}
      {showLocalSettings && (
        <div className="p-5 bg-zinc-950/80 border border-zinc-800 rounded-2xl mb-6 space-y-4 shadow-xl">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-800 pb-2">
            <span>Connection Settings</span>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-zinc-400 font-bold mb-1 uppercase">REST API Url</label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => onSettingsChange({ apiUrl: e.target.value, socketUrl })}
                placeholder="http://localhost:3000"
                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg py-1.5 px-3 text-xs text-white focus:outline-none focus:border-violet-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-400 font-bold mb-1 uppercase">Websocket Url</label>
              <input
                type="text"
                value={socketUrl}
                onChange={(e) => onSettingsChange({ apiUrl, socketUrl: e.target.value })}
                placeholder="http://localhost:3000"
                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg py-1.5 px-3 text-xs text-white focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex p-1 bg-zinc-950/60 border border-zinc-800 rounded-xl mb-6">
        <button
          type="button"
          onClick={() => { setIsLogin(true); setError(null); }}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-300 ${
            isLogin
              ? 'bg-zinc-800 text-white shadow-md'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Login
        </button>
        <button
          type="button"
          onClick={() => { setIsLogin(false); setError(null); }}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-300 ${
            !isLogin
              ? 'bg-zinc-800 text-white shadow-md'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Register
        </button>
      </div>

      {/* Alert Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 mb-6 bg-red-950/40 border border-red-900/50 rounded-xl text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleAuth} className="space-y-4">
        {!isLogin && (
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              Full Name
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Carlos Santana"
                className="w-full bg-zinc-950/40 border border-zinc-800 focus:border-violet-500/80 focus:ring-2 focus:ring-violet-500/10 focus:outline-none rounded-xl py-3 pl-10 pr-4 text-white placeholder-zinc-550 transition-all text-sm"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Email Address
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="carlos@gmail.com"
              className="w-full bg-zinc-950/40 border border-zinc-800 focus:border-violet-500/80 focus:ring-2 focus:ring-violet-500/10 focus:outline-none rounded-xl py-3 pl-10 pr-4 text-white placeholder-zinc-550 transition-all text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-zinc-950/40 border border-zinc-800 focus:border-violet-500/80 focus:ring-2 focus:ring-violet-500/10 focus:outline-none rounded-xl py-3 pl-10 pr-4 text-white placeholder-zinc-550 transition-all text-sm"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-xl py-3 font-semibold text-sm transition-all duration-300 shadow-lg shadow-violet-600/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-6"
        >
          {loading ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : isLogin ? (
            <>
              Sign In <LogIn className="w-4 h-4" />
            </>
          ) : (
            <>
              Register Account <UserPlus className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      {/* Footer Info */}
      <div className="mt-8 text-center text-xs text-zinc-500 border-t border-zinc-800 pt-6">
        Connecting to API: <code className="text-zinc-400">{apiUrl}</code>
      </div>
    </div>
  );
}
