import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Stack, Button, Group, Text } from '@mantine/core';
import { IconCamera } from '@tabler/icons-react';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  opened: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

export default function CameraCaptureModal({ opened, onClose, onCapture }: Props) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'camera failed');
    }
  }, []);

  useEffect(() => {
    if (opened) {
      void start();
    } else {
      stop();
    }
    return () => stop();
  }, [opened, start, stop]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !active) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `card-${Date.now()}.jpg`, { type: 'image/jpeg' });
      onCapture(file);
    }, 'image/jpeg', 0.92);
  }, [active, onCapture]);

  return (
    <Modal opened={opened} onClose={onClose} title={t('contacts.camera')} size="lg">
      <Stack gap="sm">
        {error ? (
          <Text c="red" size="sm">{error}</Text>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: '100%', maxHeight: 480, background: '#000', borderRadius: 10 }}
          />
        )}
        <Group justify="space-between">
          <Button variant="subtle" onClick={onClose}>{t('contacts.cameraClose')}</Button>
          <Button leftSection={<IconCamera size={16} />} onClick={capture} disabled={!active}>
            {t('contacts.cameraCapture')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
