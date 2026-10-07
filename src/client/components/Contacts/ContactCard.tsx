import React from 'react';
import { Group, Text, ActionIcon, Badge, Stack } from '@mantine/core';
import { IconStar, IconStarFilled, IconEdit, IconTrash } from '@tabler/icons-react';
import type { Contact } from '../../utils/api';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  contact: Contact;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  // 공백 제거 후 코드포인트 단위 분리 (한글·이모지 안전)
  const compact = trimmed.replace(/\s+/g, '');
  const chars = Array.from(compact);
  if (chars.length <= 2) return compact.toUpperCase();
  return chars.slice(-2).join('').toUpperCase();
}

export default function ContactCard({ contact, onEdit, onDelete, onToggleFavorite }: Props) {
  const t = useT();
  const phone = contact.phone || contact.phones?.[0];
  const email = contact.email || contact.emails?.[0];

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const header = [contact.company, contact.department, contact.position].filter(Boolean).join(' · ');
    const lines = [
      contact.name,
      header,
      phone ? t('contacts.dragPhone', { phone }) : '',
      email ? t('contacts.dragEmail', { email }) : '',
      contact.labels.length ? t('contacts.dragLabels', { labels: contact.labels.join(', ') }) : '',
    ].filter(Boolean);
    const content = lines.join('\n');
    e.dataTransfer.setData(
      'application/x-mycrew-attachment',
      JSON.stringify({ type: 'contact', name: contact.name, content }),
    );
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="contact-card" draggable onDragStart={handleDragStart}>
      <div className="contact-card__row">
        <div className="contact-card__avatar">{initials(contact.name)}</div>
        <div className="contact-card__body">
          <Group gap={4} wrap="nowrap" justify="space-between">
            <Text fw={600} size="sm" lineClamp={1}>{contact.name}</Text>
            <ActionIcon
              size="sm"
              variant="subtle"
              color={contact.favorite ? 'yellow' : 'gray'}
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
              aria-label={t('contacts.favorite')}
            >
              {contact.favorite
                ? <IconStarFilled size={14} style={{ color: '#FBBF24', fill: '#FBBF24' }} />
                : <IconStar size={14} />}
            </ActionIcon>
          </Group>
          {(contact.company || contact.position) && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {[contact.company, contact.department, contact.position].filter(Boolean).join(' · ')}
            </Text>
          )}
          <Group gap={4} wrap="nowrap" justify="space-between" align="center">
            {phone
              ? <Text size="xs" lineClamp={1}>{phone}</Text>
              : <span />}
            <Group gap={2} wrap="nowrap" className="contact-card__actions">
              <ActionIcon size="sm" variant="subtle" onClick={(e) => { e.stopPropagation(); onEdit(); }} aria-label={t('contacts.edit')}>
                <IconEdit size={14} />
              </ActionIcon>
              <ActionIcon size="sm" variant="subtle" color="red" onClick={(e) => { e.stopPropagation(); onDelete(); }} aria-label={t('contacts.delete')}>
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
          </Group>
          {email && <Text size="xs" c="dimmed" lineClamp={1}>{email}</Text>}
        </div>
      </div>

      {(contact.labels.length > 0 || contact.source === 'photo' || contact.source === 'camera') && (
        <Group gap={4} mt={6} wrap="wrap">
          {contact.source === 'photo' && (
            <Badge size="xs" color="blue" variant="light">{t('contacts.source.photo')}</Badge>
          )}
          {contact.source === 'camera' && (
            <Badge size="xs" color="grape" variant="light">{t('contacts.source.camera')}</Badge>
          )}
          {contact.labels.map((l) => (
            <Badge key={l} size="xs" variant="outline">{l}</Badge>
          ))}
        </Group>
      )}
    </div>
  );
}
