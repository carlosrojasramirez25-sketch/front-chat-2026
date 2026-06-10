import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let currentSocketUrl: string | null = null;
let currentUserId: number | null = null;
let currentToken: string | null = null;

export const getSocket = (url: string, userId?: number, token?: string): Socket => {
  let cleanUrl = url.trim();
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = `http://${cleanUrl}`;
  }

  const needsNew =
    !socket ||
    currentSocketUrl !== cleanUrl ||
    currentUserId !== (userId ?? null) ||
    currentToken !== (token ?? null);

  if (needsNew) {
    if (socket) socket.disconnect();

    socket = io(cleanUrl, {
      autoConnect: false,
      transports: ['websocket'],
      withCredentials: true,
      query: userId ? { userId: String(userId) } : undefined,
      auth: token ? { token } : undefined,
    });
    currentSocketUrl = cleanUrl;
    currentUserId = userId ?? null;
    currentToken = token ?? null;
  }

  return socket!;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
    currentSocketUrl = null;
    currentUserId = null;
    currentToken = null;
  }
};