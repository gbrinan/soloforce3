import React, { useState, useRef, useEffect } from 'react';
import {
  ActionIcon, Badge, Button, Group, Modal, Radio,
  ScrollArea, Select, Stack, Text, TextInput, Loader,
} from '@mantine/core';
import { useHumanChat, type HChannel, type HMessage } from '../../hooks/useHumanChat';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.replace('@', '').slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--bg-elevated)',
      color: 'var(--text-secondary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.375, fontWeight: 600, flexShrink: 0,
    }}>
      {initials || '?'}
    </div>
  );
}

// ── MessageItem ───────────────────────────────────────────────────────────────
function MessageItem({
  msg, prevSenderKey, onThread,
}: {
  msg: HMessage;
  prevSenderKey?: string;
  onThread: (m: HMessage) => void;
}) {
  const t = useT();
  const [hovered, setHovered] = useState(false);
  const isContinued = prevSenderKey === msg.senderId;
  const displayName = msg.senderId === '__me__' ? t('chat.me') : msg.senderId.split('@')[0];
  const time = new Date(msg.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', gap: 8, padding: '4px 16px',
        background: hovered ? 'rgba(21,31,50,0.7)' : 'transparent',
        position: 'relative',
      }}
    >
      {!isContinued ? (
        <Avatar name={displayName} />
      ) : (
        <div style={{ width: 32 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!isContinued && (
          <Group gap={8} mb={2}>
            <Text size="sm" fw={600} style={{ color: 'var(--text-primary)' }}>{displayName}</Text>
            <Text size="xs" style={{ color: 'var(--text-muted)' }}>{time}</Text>
          </Group>
        )}
        <Text size="sm" style={{ color: 'var(--text-primary)', lineHeight: 1.6, wordBreak: 'break-word' }}>
          {msg.text}
        </Text>
        {msg.reactions && Object.entries(msg.reactions).map(([emoji, count]) => (
          <span key={emoji} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 10, padding: '2px 6px', fontSize: 12, marginTop: 4, marginRight: 4,
          }}>
            {emoji} <span style={{ color: 'var(--text-muted)' }}>{count}</span>
          </span>
        ))}
      </div>

      {hovered && (
        <div style={{
          position: 'absolute', right: 16, top: 4,
          background: 'var(--bg-surface, var(--bg-card))',
          border: '1px solid var(--border-default)',
          borderRadius: 6, padding: '2px 4px',
          display: 'flex', gap: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          zIndex: 10,
        }}>
          <ActionIcon size="sm" variant="subtle" title={t('chat.emojiTitle')}>😊</ActionIcon>
          <ActionIcon size="sm" variant="subtle" title={t('chat.threadTitle')} onClick={() => onThread(msg)}>💬</ActionIcon>
        </div>
      )}
    </div>
  );
}

// ── MessageInput ──────────────────────────────────────────────────────────────
function MessageInput({ onSend, placeholder, disabled }: {
  onSend: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <div style={{
      border: '1px solid var(--border-default)',
      borderRadius: 10, overflow: 'hidden', margin: '0 12px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px' }}>
        <TextInput
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={placeholder ?? t('chat.messageInputPlaceholder')}
          disabled={disabled}
          variant="unstyled"
          style={{ flex: 1 }}
        />
        <ActionIcon
          color="jarvis"
          variant={text.trim() ? 'filled' : 'subtle'}
          disabled={!text.trim() || disabled}
          onClick={handleSend}
          size={24}
          radius={8}
        >↑</ActionIcon>
      </div>
    </div>
  );
}

// ── ChannelSidebar ────────────────────────────────────────────────────────────
function ChannelSidebar({
  channels, activeId, onSelect, onCreateChannel,
}: {
  channels: HChannel[];
  activeId?: string;
  onSelect: (ch: HChannel) => void;
  onCreateChannel: () => void;
}) {
  const t = useT();
  const groups = channels.filter(c => c.type === 'group');
  const dms = channels.filter(c => c.type === 'dm');

  const itemStyle = (active: boolean): React.CSSProperties => ({
    height: 32, borderRadius: 6, padding: '0 8px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    cursor: 'pointer',
    background: active ? 'rgba(99,102,241,0.15)' : 'transparent',
    color: active ? 'var(--color-point-1)' : 'var(--text-secondary)',
    fontWeight: active ? 600 : 400,
    fontSize: 'var(--font-s)',
  });

  return (
    <div style={{
      width: 240, minWidth: 200, background: 'var(--jarvis-surface-bg, #04070F)',
      borderRight: '1px solid var(--border-default)',
      display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden',
    }}>
      <div style={{ padding: '16px 12px 8px', fontWeight: 700, color: 'var(--text-primary)', fontSize: 'var(--font-m)' }}>
        {t('chat.teamChatHeader')}
      </div>

      <ScrollArea style={{ flex: 1 }}>
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 'var(--font-s)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 4px 4px' }}>{t('chat.channelsSectionLabel')}</div>
          {groups.map(ch => (
            <div key={ch.id} style={itemStyle(ch.id === activeId)} onClick={() => onSelect(ch)}>
              <span><span style={{ color: 'var(--text-muted)', marginRight: 4 }}>#</span>{ch.name ?? ch.id}</span>
              {(ch.unreadCount ?? 0) > 0 && <Badge size="xs" color="jarvis" variant="filled">{ch.unreadCount}</Badge>}
            </div>
          ))}
          <div
            style={{ ...itemStyle(false), color: 'var(--text-muted)', fontSize: 12 }}
            onClick={onCreateChannel}
          >{t('chat.addChannelLabel')}</div>

          <div style={{ fontSize: 'var(--font-s)', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 4px 4px' }}>{t('chat.directMessagesSectionLabel')}</div>
          {dms.map(ch => {
            const name = ch.members.find(m => m !== '__me__') ?? ch.members[0] ?? '';
            return (
              <div key={ch.id} style={itemStyle(ch.id === activeId)} onClick={() => onSelect(ch)}>
                <Group gap={6}>
                  <Avatar name={name} size={20} />
                  <span>{name.split('@')[0]}</span>
                </Group>
                {(ch.unreadCount ?? 0) > 0 && <Badge size="xs" color="jarvis" variant="filled">{ch.unreadCount}</Badge>}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── ThreadPanel ───────────────────────────────────────────────────────────────
function ThreadPanel({ msg, replies, onClose, onReply }: {
  msg: HMessage;
  replies: HMessage[];
  onClose: () => void;
  onReply: (text: string) => void;
}) {
  const t = useT();
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [replies.length]);

  return (
    <div style={{
      width: 320, background: 'var(--bg-surface, var(--bg-card))',
      borderLeft: '1px solid var(--border-default)',
      display: 'flex', flexDirection: 'column',
    }}>
      <Group justify="space-between" px="md" py="sm" style={{ borderBottom: '1px solid var(--border-default)' }}>
        <Text fw={700} size="sm">{t('chat.threadTitle')}</Text>
        <ActionIcon variant="subtle" color="gray" size={36} className="drawer-close" onClick={onClose}>×</ActionIcon>
      </Group>
      <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 10, margin: 12, fontSize: 'var(--font-s)', color: 'var(--text-primary)' }}>
        <Text size="xs" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{msg.senderId.split('@')[0]}</Text>
        {msg.text}
      </div>
      <Text size="xs" px="md" style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{t('chat.repliesCount', { n: replies.length })}</Text>
      <ScrollArea style={{ flex: 1 }}>
        {replies.filter(r => r.id !== msg.id).map((r) => (
          <MessageItem key={r.id} msg={r} onThread={() => {}} />
        ))}
        <div ref={bottomRef} />
      </ScrollArea>
      <MessageInput onSend={onReply} placeholder={t('chat.threadReplyPlaceholder')} />
    </div>
  );
}

// ── CreateChannelModal ────────────────────────────────────────────────────────
function CreateChannelModal({ opened, onClose, onCreate }: {
  opened: boolean;
  onClose: () => void;
  onCreate: (params: { type: 'dm' | 'group'; name?: string; members: string[] }) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'private'>('public');
  const [memberInput, setMemberInput] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const toChannelName = (v: string) => v.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  const addMember = () => {
    const m = memberInput.trim();
    if (!m || members.includes(m)) return;
    setMembers(prev => [...prev, m]);
    setMemberInput('');
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onCreate({ type: 'group', name: toChannelName(name), members });
      setName(''); setMembers([]); setMemberInput('');
      onClose();
    } catch { /* error */ }
    setLoading(false);
  };

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>{t('chat.createChannelTitle')}</Text>} size={480} radius="md">
      <Stack gap="md">
        <TextInput
          label={t('chat.channelNameLabel')}
          placeholder={t('chat.channelNamePlaceholder')}
          value={name}
          onChange={(e) => setName(toChannelName(e.currentTarget.value))}
          leftSection={<Text size="sm" c="dimmed">#</Text>}
          radius="sm"
        />

        <Radio.Group value={privacy} onChange={(v) => setPrivacy(v as 'public' | 'private')} label={t('chat.privacyLabel')}>
          <Group mt="xs">
            <Radio value="public" label={t('chat.publicChannel')} color="jarvis" />
            <Radio value="private" label={t('chat.privateChannel')} color="jarvis" />
          </Group>
        </Radio.Group>

        <div>
          <Text size="sm" mb={4}>{t('chat.inviteMembersLabel')}</Text>
          <Group gap="xs">
            <TextInput
              placeholder={t('chat.memberEmailPlaceholder')}
              value={memberInput}
              onChange={(e) => setMemberInput(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addMember(); }}
              style={{ flex: 1 }}
              radius="sm"
            />
            <Button size="xs" variant="default" onClick={addMember}>{t('chat.addButton')}</Button>
          </Group>
          {members.length > 0 && (
            <Group gap={4} mt={8}>
              {members.map(m => (
                <span key={m} style={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                  borderRadius: 4, padding: '2px 8px', fontSize: 12, color: 'var(--text-primary)',
                }}>
                  {m} <button onClick={() => setMembers(p => p.filter(x => x !== m))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', marginLeft: 4 }}>×</button>
                </span>
              ))}
            </Group>
          )}
        </div>

        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onClose}>{t('common.cancel')}</Button>
          <Button color="jarvis" loading={loading} disabled={!name.trim()} onClick={handleCreate}>{t('chat.createChannelTitle')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function HumanChatPanel({ visible, onClose }: Props) {
  const t = useT();
  const hc = useHumanChat();
  const [createOpen, setCreateOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visible, hc.messages.length]);

  if (!visible) return null;

  const handleReply = (text: string) => {
    if (!hc.threadMessage) return;
    void hc.sendMessage(text, hc.threadMessage.id);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Group gap={8}>
          <Text fw={700} size="sm" style={{ color: 'var(--text-primary)' }}>
            {hc.activeChannel
              ? (hc.activeChannel.type === 'group' ? `# ${hc.activeChannel.name ?? t('chat.defaultChannelName')}` : `💬 ${hc.activeChannel.members.find(m => m !== '__me__')?.split('@')[0] ?? 'DM'}`)
              : t('chat.teamChatHeader')
            }
          </Text>
        </Group>
        <ActionIcon variant="subtle" color="gray" size={36} className="drawer-close" onClick={onClose}>×</ActionIcon>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ChannelSidebar
          channels={hc.channels}
          activeId={hc.activeChannel?.id}
          onSelect={hc.selectChannel}
          onCreateChannel={() => setCreateOpen(true)}
        />

        {/* Message area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {hc.activeChannel ? (
            <>
              <ScrollArea style={{ flex: 1 }}>
                {hc.loading && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                    <Loader size="sm" color="jarvis" />
                  </div>
                )}
                {hc.messages.map((msg, i) => (
                  <MessageItem
                    key={msg.id}
                    msg={msg}
                    prevSenderKey={i > 0 ? hc.messages[i - 1].senderId : undefined}
                    onThread={hc.setThreadMessage}
                  />
                ))}
                <div ref={bottomRef} />
              </ScrollArea>
              <MessageInput
                onSend={(text) => void hc.sendMessage(text)}
                placeholder={t('chat.sendMessageToChannel', { channel: hc.activeChannel.name ?? t('chat.defaultChannelName') })}
              />
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Stack align="center" gap={8}>
                <Text size="xl">💬</Text>
                <Text size="sm" style={{ color: 'var(--text-muted)' }}>{t('chat.selectOrCreateChannel')}</Text>
                <Button size="xs" color="jarvis" variant="outline" onClick={() => setCreateOpen(true)}>{t('chat.createChannelTitle')}</Button>
              </Stack>
            </div>
          )}
        </div>

        {/* Thread panel */}
        {hc.threadMessage && (
          <ThreadPanel
            msg={hc.threadMessage}
            replies={hc.threadMessages}
            onClose={() => hc.setThreadMessage(null)}
            onReply={handleReply}
          />
        )}
      </div>

      <CreateChannelModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (params) => { await hc.createChannel(params); }}
      />
    </div>
  );
}
