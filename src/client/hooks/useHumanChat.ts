import { useState, useEffect, useCallback, useRef } from 'react';

export interface HChannel {
  id: string;
  type: 'dm' | 'group';
  name?: string;
  members: string[];
  unreadCount?: number;
  lastMessage?: { text: string; senderKey: string; sentAt: string };
  createdAt: string;
  updatedAt: string;
}

export interface HMessage {
  id: string;
  channelId: string;
  senderId: string;
  text: string;
  threadOf?: string;
  createdAt: string;
  reactions?: Record<string, number>; // emoji -> count
}

export function useHumanChat() {
  const [channels, setChannels] = useState<HChannel[]>([]);
  const [messages, setMessages] = useState<HMessage[]>([]);
  const [activeChannel, setActiveChannel] = useState<HChannel | null>(null);
  const [threadMessage, setThreadMessage] = useState<HMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // Subscribe to SSE for real-time human-chat events
  useEffect(() => {
    const es = new EventSource('/api/events');
    esRef.current = es;

    const handleHumanChat = (e: MessageEvent) => {
      try {
        const env = JSON.parse(e.data) as
          | { type: 'hchat_message'; message: HMessage }
          | { type: 'hchat_channel_created'; channel: HChannel };
        if (env.type === 'hchat_message') {
          const msg = env.message;
          setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
          setChannels(prev => prev.map(ch =>
            ch.id === msg.channelId
              ? { ...ch, lastMessage: { text: msg.text, senderKey: msg.senderId, sentAt: msg.createdAt }, unreadCount: (ch.unreadCount ?? 0) + 1 }
              : ch
          ));
        } else if (env.type === 'hchat_channel_created') {
          const ch = env.channel;
          setChannels(prev => prev.find(c => c.id === ch.id) ? prev : [...prev, ch]);
        }
      } catch { /* skip */ }
    };

    es.addEventListener('human-chat', handleHumanChat);

    return () => {
      es.removeEventListener('human-chat', handleHumanChat);
      es.close();
    };
  }, []);

  const loadChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/hchat/channels');
      if (res.ok) setChannels(await res.json());
    } catch { /* offline */ }
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hchat/channels/${channelId}/messages?limit=50`);
      if (res.ok) {
        const data: HMessage[] = await res.json();
        setMessages(data);
      }
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  const selectChannel = useCallback(async (ch: HChannel) => {
    setActiveChannel(ch);
    setThreadMessage(null);
    setChannels(prev => prev.map(c => c.id === ch.id ? { ...c, unreadCount: 0 } : c));
    await loadMessages(ch.id);
  }, [loadMessages]);

  const sendMessage = useCallback(async (text: string, threadOf?: string) => {
    if (!activeChannel || !text.trim()) return;
    const optimistic: HMessage = {
      id: `opt-${Date.now()}`,
      channelId: activeChannel.id,
      senderId: '__me__',
      text,
      threadOf,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    try {
      const res = await fetch(`/api/hchat/channels/${activeChannel.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, threadOf }),
      });
      if (res.ok) {
        const real: HMessage = await res.json();
        setMessages(prev => prev.map(m => m.id === optimistic.id ? real : m));
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    }
  }, [activeChannel]);

  const createChannel = useCallback(async (params: { type: 'dm' | 'group'; name?: string; members: string[] }) => {
    const res = await fetch('/api/hchat/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      const ch: HChannel = await res.json();
      setChannels(prev => prev.find(c => c.id === ch.id) ? prev : [...prev, ch]);
      await selectChannel(ch);
      return ch;
    }
    throw new Error('채널 생성 실패');
  }, [selectChannel]);

  useEffect(() => { void loadChannels(); }, [loadChannels]);

  const threadMessages = threadMessage
    ? messages.filter(m => m.id === threadMessage.id || m.threadOf === threadMessage.id)
    : [];

  return {
    channels,
    messages: activeChannel
      ? messages.filter(m => m.channelId === activeChannel.id && !m.threadOf)
      : [],
    threadMessages,
    activeChannel,
    threadMessage,
    loading,
    selectChannel,
    sendMessage,
    createChannel,
    setThreadMessage,
    refresh: loadChannels,
  };
}
