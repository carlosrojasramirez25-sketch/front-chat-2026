'use client';

import { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';

interface CallUIProps {
  status: 'calling' | 'incoming' | 'active';
  remoteName: string;
  remoteAvatar?: string;
  isMuted: boolean;
  callType: 'audio' | 'video';
  localStream?: MediaStream | null;
  remoteStream?: MediaStream | null;
  onAccept?: () => void;
  onReject?: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function CallUI({
  status, remoteName, remoteAvatar, isMuted,
  callType, localStream, remoteStream,
  onAccept, onReject, onHangUp, onToggleMute,
}: CallUIProps) {
  const [duration, setDuration] = useState(0);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (status !== 'active') { setDuration(0); return; }
    const t = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  const toggleCamera = () => {
    localStream?.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsCameraOff((v) => !v);
  };

  const initials = remoteName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  // ── Video call active layout ───────────────────────────────────────────────
  if (callType === 'video' && status === 'active') {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        {/* Remote video — full screen */}
        <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />

        {/* Name + timer */}
        <div className="absolute top-0 inset-x-0 p-5 bg-gradient-to-b from-black/60 to-transparent z-10 pointer-events-none">
          <p className="text-white font-semibold text-lg leading-none">{remoteName}</p>
          <p className="text-white/60 text-sm mt-0.5">{formatDuration(duration)}</p>
        </div>

        {/* Local video — picture-in-picture */}
        <div className="absolute top-16 right-4 w-28 h-40 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl z-10">
          {isCameraOff
            ? <div className="w-full h-full bg-zinc-800 flex items-center justify-center"><VideoOff className="w-6 h-6 text-zinc-400" /></div>
            : <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
          }
        </div>

        {/* Controls */}
        <div className="absolute bottom-0 inset-x-0 p-8 bg-gradient-to-t from-black/70 to-transparent z-10">
          <div className="flex items-center justify-center gap-5">
            <button onClick={onToggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${isMuted ? 'bg-red-600' : 'bg-white/20 hover:bg-white/30'}`} title={isMuted ? 'Activar mic' : 'Silenciar'}>
              {isMuted ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-white" />}
            </button>
            <button onClick={onHangUp} className="w-16 h-16 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg">
              <PhoneOff className="w-7 h-7 text-white" />
            </button>
            <button onClick={toggleCamera} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 ${isCameraOff ? 'bg-red-600' : 'bg-white/20 hover:bg-white/30'}`} title={isCameraOff ? 'Activar cámara' : 'Apagar cámara'}>
              {isCameraOff ? <VideoOff className="w-6 h-6 text-white" /> : <Video className="w-6 h-6 text-white" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Audio call / incoming / calling layout ─────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 w-80 flex flex-col items-center gap-6 shadow-2xl relative">

        {/* Avatar */}
        <div className="relative">
          <div className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-violet-500/40">
            {remoteAvatar
              ? <img src={remoteAvatar} alt={remoteName} className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-violet-600/30 flex items-center justify-center text-2xl font-bold text-violet-300">{initials}</div>
            }
          </div>
          {status === 'active' && (
            <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full border-2 border-zinc-900 animate-pulse" />
          )}
        </div>

        {/* Name & status */}
        <div className="text-center">
          <h2 className="text-xl font-bold text-zinc-100">{remoteName}</h2>
          <p className="text-sm text-zinc-400 mt-1">
            {status === 'calling' && (callType === 'video' ? 'Videollamada...' : 'Llamando...')}
            {status === 'incoming' && (callType === 'video' ? 'Videollamada entrante' : 'Llamada entrante')}
            {status === 'active' && formatDuration(duration)}
          </p>
        </div>

        {/* Pulsing ring */}
        {status !== 'active' && (
          <div className="absolute w-36 h-36 rounded-full border-2 border-violet-500/20 animate-ping pointer-events-none" />
        )}

        {/* Buttons */}
        <div className="flex items-center gap-6">
          {status === 'incoming' && (
            <>
              <button onClick={onReject} className="w-14 h-14 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg" title="Rechazar">
                <PhoneOff className="w-6 h-6 text-white" />
              </button>
              <button onClick={onAccept} className="w-14 h-14 bg-emerald-600 hover:bg-emerald-500 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg" title="Aceptar">
                {callType === 'video' ? <Video className="w-6 h-6 text-white" /> : <Phone className="w-6 h-6 text-white" />}
              </button>
            </>
          )}
          {status === 'calling' && (
            <button onClick={onHangUp} className="w-14 h-14 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg" title="Cancelar">
              <PhoneOff className="w-6 h-6 text-white" />
            </button>
          )}
          {status === 'active' && (
            <>
              <button onClick={onToggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg ${isMuted ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-zinc-800 hover:bg-zinc-700'}`} title={isMuted ? 'Activar micrófono' : 'Silenciar'}>
                {isMuted ? <MicOff className="w-6 h-6 text-red-400" /> : <Mic className="w-6 h-6 text-zinc-300" />}
              </button>
              <button onClick={onHangUp} className="w-14 h-14 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg" title="Colgar">
                <PhoneOff className="w-6 h-6 text-white" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}