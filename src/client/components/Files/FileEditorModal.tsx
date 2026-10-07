import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Group, Text, Loader, Box, ScrollArea, useMantineColorScheme } from '@mantine/core';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { loadFileForEdit, saveFileContent, type FileEditBase } from '../../utils/api';
import { renderMarkdown } from '../../utils/markdown';
import { uiAlert, uiConfirm } from '../Dialog/dialog';
import { useT } from '../../i18n/I18nProvider';

interface Props {
  open: boolean;
  base: FileEditBase;
  subpath: string;           // 파일 상대 경로 (rootDir 기준)
  displayName: string;       // 모달 제목
  onClose: () => void;
  onSaved?: () => void;
}

// Mark 앱 차용 권고 §2 — CodeMirror 6 split view 편집 모달.
// MD/TXT/CSV/JSON/HTML 5종 텍스트 파일 편집. ETag(mtime) 비교로 동시 편집 손실 방지.
export default function FileEditorModal({ open, base, subpath, displayName, onClose, onSaved }: Props) {
  const t = useT();
  const { colorScheme } = useMantineColorScheme();
  const [loading, setLoading] = useState(true);
  const [original, setOriginal] = useState<string>('');
  const [current, setCurrent] = useState<string>('');
  const [mtime, setMtime] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const dirty = current !== original;
  const ext = subpath.split('.').pop()?.toLowerCase() || '';
  const isMarkdown = ext === 'md';

  // 1) 마운트 시 파일 로드
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setCurrent('');
    setOriginal('');
    setMtime(undefined);
    void loadFileForEdit(base, subpath).then((res) => {
      if (cancelled) return;
      if (!res.ok || res.content === undefined) {
        void uiAlert({ title: t('files.loadFailedTitle'), description: res.error ?? t('files.unknownError'), variant: 'info' });
        onClose();
        return;
      }
      setOriginal(res.content);
      setCurrent(res.content);
      setMtime(res.mtime);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, base, subpath, onClose]);

  // 2) CodeMirror 마운트 — 로드 완료 후 1회만, original 변화 시 doc 교체
  useEffect(() => {
    if (loading || !editorHostRef.current) return;
    const isDark = colorScheme === 'dark';
    const state = EditorState.create({
      doc: original,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        markdown(),
        ...(isDark ? [oneDark] : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) setCurrent(u.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: editorHostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // colorScheme 변화 시에도 재마운트
  }, [loading, original, colorScheme]);

  // 3) 우측 미리보기 — debounce 200ms로 dirty 변경 시 갱신
  const [previewSrc, setPreviewSrc] = useState<string>('');
  useEffect(() => {
    const id = setTimeout(() => setPreviewSrc(current), 200);
    return () => clearTimeout(id);
  }, [current]);

  const previewHtml = useMemo(() => {
    if (!isMarkdown) return '';
    return renderMarkdown(previewSrc);
  }, [previewSrc, isMarkdown]);

  // 4) 저장 핸들러
  const handleSave = async () => {
    if (!dirty) { onClose(); return; }
    setSaving(true);
    const res = await saveFileContent(base, subpath, current, mtime);
    setSaving(false);
    if (!res.ok) {
      if (res.error === 'etag mismatch') {
        await uiAlert({
          title: t('files.etagMismatchTitle'),
          description: t('files.etagMismatchDesc'),
          variant: 'info',
        });
      } else {
        await uiAlert({ title: t('files.saveFailedTitle'), description: res.error ?? t('files.unknownError'), variant: 'info' });
      }
      return;
    }
    setOriginal(current);
    setMtime(res.mtime);
    onSaved?.();
    onClose();
  };

  // 5) 취소 핸들러 — dirty면 확인
  const handleClose = async () => {
    if (dirty) {
      const ok = await uiConfirm({
        title: t('files.unsavedChangesTitle'),
        description: t('files.unsavedChangesDesc'),
        variant: 'danger',
        confirmLabel: t('files.discardAndClose'),
        cancelLabel: t('files.continueEditing'),
      });
      if (!ok) return;
    }
    onClose();
  };

  return (
    <Modal
      opened={open}
      onClose={handleClose}
      title={`${t('files.editTitle', { name: displayName })}${dirty ? ' *' : ''}`}
      size="auto"
      centered
      classNames={{ content: 'modal-resizable modal-resizable-report' }}
      overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
    >
      {loading ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">{t('files.loadingFile')}</Text>
        </Group>
      ) : (
        <Box>
          <div className="file-editor-split">
            <div className="file-editor-pane">
              <div className="file-editor-pane-title">{t('files.editPaneTitle', { ext: ext.toUpperCase() || 'TEXT' })}</div>
              <div ref={editorHostRef} className="file-editor-codemirror" />
            </div>
            <div className="file-editor-pane">
              <div className="file-editor-pane-title">{t('files.previewPaneTitle', { type: isMarkdown ? '(MD)' : t('files.previewRaw') })}</div>
              {isMarkdown ? (
                <ScrollArea className="file-editor-preview">
                  <div className="md" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                </ScrollArea>
              ) : (
                <ScrollArea className="file-editor-preview">
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 'var(--font-s)', margin: 0 }}>
                    {previewSrc}
                  </pre>
                </ScrollArea>
              )}
            </div>
          </div>
          <Group className="file-editor-footer" justify="space-between">
            <Text size="xs" c="dimmed">
              {dirty ? t('files.unsavedStatus') : t('files.noChangesStatus')} · {new TextEncoder().encode(current).length}B
            </Text>
            <Group gap="xs">
              <Button size="compact-sm" variant="default" onClick={() => void handleClose()}>
                {t('common.cancel')}
              </Button>
              <Button
                size="compact-sm"
                color="jarvis.6"
                loading={saving}
                disabled={!dirty || saving}
                onClick={() => void handleSave()}
              >
                {t('notes.save')}
              </Button>
            </Group>
          </Group>
        </Box>
      )}
    </Modal>
  );
}
