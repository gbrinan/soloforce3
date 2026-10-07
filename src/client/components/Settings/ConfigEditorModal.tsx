import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, Button, Group, Text, Loader, Box, ScrollArea, Stack,
  Badge, ActionIcon, Tooltip, useMantineColorScheme,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconFile, IconFolder, IconFolderOpen, IconHistory, IconCode, IconAlignLeft,
} from '@tabler/icons-react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  listConfigFiles, loadFileForEdit, saveFileContent, rollbackConfig,
  type ConfigFileEntry,
} from '../../utils/api';
import { uiAlert, uiConfirm } from '../Dialog/dialog';
import { useI18n } from '../../i18n/I18nProvider';

// ─── Tree types ──────────────────────────────────────────────────────────────

type FileNode = { kind: 'file'; name: string; relPath: string };
type DirNode  = { kind: 'dir';  name: string; children: TreeNode[] };
type TreeNode = FileNode | DirNode;

function buildTree(files: ConfigFileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const f of [...files].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    insertNode(root, f.relPath.split('/'), f.relPath);
  }
  return root;
}

function insertNode(nodes: TreeNode[], parts: string[], relPath: string): void {
  if (parts.length === 1) {
    nodes.push({ kind: 'file', name: parts[0], relPath });
    return;
  }
  let dir = nodes.find((n): n is DirNode => n.kind === 'dir' && n.name === parts[0]);
  if (!dir) {
    dir = { kind: 'dir', name: parts[0], children: [] };
    nodes.push(dir);
  }
  insertNode(dir.children, parts.slice(1), relPath);
}

// ─── FileBrowser ─────────────────────────────────────────────────────────────

function TreeRow({
  node, depth, selectedPath, onSelect, expandedDirs, onToggleDir, parentPath,
}: {
  node: TreeNode; depth: number; selectedPath: string | null;
  onSelect: (p: string) => void; expandedDirs: Set<string>;
  onToggleDir: (p: string) => void; parentPath: string;
}) {
  const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;

  if (node.kind === 'file') {
    const selected = selectedPath === node.relPath;
    return (
      <Box
        onClick={() => onSelect(node.relPath)}
        style={{
          paddingLeft: 6 + depth * 14, paddingTop: 3, paddingBottom: 3, paddingRight: 6,
          cursor: 'pointer', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4,
          background: selected ? 'var(--mantine-color-jarvis-light)' : 'transparent',
        }}
      >
        <IconFile size={11} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
        <Text size="xs" style={{ wordBreak: 'break-all' }}>{node.name}</Text>
      </Box>
    );
  }

  const expanded = expandedDirs.has(fullPath);
  return (
    <>
      <Box
        onClick={() => onToggleDir(fullPath)}
        style={{
          paddingLeft: 6 + depth * 14, paddingTop: 3, paddingBottom: 3, paddingRight: 6,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        {expanded
          ? <IconFolderOpen size={11} style={{ flexShrink: 0, color: 'var(--mantine-color-yellow-5)' }} />
          : <IconFolder size={11} style={{ flexShrink: 0, color: 'var(--mantine-color-yellow-5)' }} />}
        <Text size="xs" fw={600}>{node.name}/</Text>
      </Box>
      {expanded && node.children.map((child) => (
        <TreeRow
          key={child.kind === 'file' ? child.relPath : `${fullPath}/${child.name}`}
          node={child} depth={depth + 1} selectedPath={selectedPath}
          onSelect={onSelect} expandedDirs={expandedDirs}
          onToggleDir={onToggleDir} parentPath={fullPath}
        />
      ))}
    </>
  );
}

// ─── DiffPreview — LCS line diff ─────────────────────────────────────────────

type DiffKind = 'equal' | 'insert' | 'delete';
interface DiffLine { kind: DiffKind; text: string }

function computeLineDiff(a: string, b: string): DiffLine[] {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const m = aLines.length, n = bLines.length;

  // LCS DP — O(m*n) fine for small config files
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = aLines[i - 1] === bLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const ops: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      ops.unshift({ kind: 'equal', text: aLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ kind: 'insert', text: bLines[j - 1] });
      j--;
    } else {
      ops.unshift({ kind: 'delete', text: aLines[i - 1] });
      i--;
    }
  }
  return ops;
}

const DIFF_CONTEXT = 3;

function DiffPreview({ original, current }: { original: string; current: string }) {
  const rows = useMemo(() => {
    const ops = computeLineDiff(original, current);
    const changed = new Set<number>();
    ops.forEach((op, i) => { if (op.kind !== 'equal') changed.add(i); });
    if (changed.size === 0) return null;

    const visible = new Set<number>();
    changed.forEach((idx) => {
      for (let k = Math.max(0, idx - DIFF_CONTEXT); k <= Math.min(ops.length - 1, idx + DIFF_CONTEXT); k++) {
        visible.add(k);
      }
    });

    const result: { op: DiffLine; idx: number; gap: boolean }[] = [];
    let lastIdx = -2;
    [...visible].sort((a, b) => a - b).forEach((idx) => {
      result.push({ op: ops[idx], idx, gap: idx > lastIdx + 1 });
      lastIdx = idx;
    });
    return result;
  }, [original, current]);

  const { t } = useI18n();
  if (!rows) {
    return (
      <Group justify="center" align="center" style={{ height: '100%' }}>
        <Text size="sm" c="dimmed">{t('settings.configEditor.noChanges')}</Text>
      </Group>
    );
  }

  return (
    <ScrollArea style={{ height: '100%' }}>
      <pre style={{ fontSize: 12, margin: 0, fontFamily: 'monospace', lineHeight: 1.5 }}>
        {rows.map(({ op, idx, gap }) => (
          <React.Fragment key={idx}>
            {gap && (
              <div style={{ color: 'var(--text-secondary)', padding: '0 8px', opacity: 0.5 }}>···</div>
            )}
            <div style={{
              background: op.kind === 'insert' ? 'rgba(52,211,153,0.15)'
                : op.kind === 'delete' ? 'rgba(248,113,113,0.15)' : 'transparent',
              color: op.kind === 'insert' ? '#34D399'
                : op.kind === 'delete' ? '#F87171' : 'inherit',
              padding: '0 8px',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              <span style={{ opacity: 0.5, userSelect: 'none', marginRight: 8, fontSize: 'var(--font-s)' }}>
                {op.kind === 'insert' ? '+' : op.kind === 'delete' ? '-' : ' '}
              </span>
              {op.text}
            </div>
          </React.Fragment>
        ))}
      </pre>
    </ScrollArea>
  );
}

// ─── JSON validation ──────────────────────────────────────────────────────────

function validateConfig(relPath: string, content: string, t: (key: any, vars?: Record<string, string | number>) => string): string | null {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  if (ext !== 'json') return null;
  try {
    const parsed = JSON.parse(content);
    if (relPath === 'mcp-base.json' && (typeof parsed !== 'object' || !parsed.mcpServers)) {
      return t('settings.configEditor.missingMcpServersKey');
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : t('settings.configEditor.invalidJson');
  }
}

// ─── ConfigEditorModal ────────────────────────────────────────────────────────

interface Props {
  opened: boolean;
  onClose: () => void;
}

const DEFAULT_EXPANDED = new Set(['agents', 'guides', 'system-prompt-templates']);

export default function ConfigEditorModal({ opened, onClose }: Props) {
  const { t } = useI18n();
  const { colorScheme } = useMantineColorScheme();

  const [files, setFiles] = useState<ConfigFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(DEFAULT_EXPANDED));

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [original, setOriginal] = useState('');
  const [current, setCurrent] = useState('');
  const [mtime, setMtime] = useState<string | undefined>();

  const [saving, setSaving] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const dirty = current !== original;
  const ext = selectedFile?.split('.').pop()?.toLowerCase() ?? '';
  const isJson = ext === 'json';
  const validationError = selectedFile && current ? validateConfig(selectedFile, current, t) : null;

  // Load file list when modal opens
  useEffect(() => {
    if (!opened) return;
    setFilesLoading(true);
    void listConfigFiles().then((f) => {
      setFiles(f);
      setFilesLoading(false);
    });
  }, [opened]);

  // Reset on close
  useEffect(() => {
    if (!opened) {
      setSelectedFile(null);
      setOriginal('');
      setCurrent('');
      setShowDiff(false);
    }
  }, [opened]);

  // Mount / remount CodeMirror when file loads or theme changes
  useEffect(() => {
    if (fileLoading || !editorHostRef.current || !selectedFile || showDiff) return;
    const isDark = colorScheme === 'dark';
    const fileExt = selectedFile.split('.').pop()?.toLowerCase() ?? '';
    const state = EditorState.create({
      doc: original,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        ...(fileExt === 'md' ? [markdown()] : []),
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
  }, [fileLoading, original, selectedFile, colorScheme, showDiff]);

  const handleSelectFile = async (relPath: string) => {
    if (dirty) {
      const ok = await uiConfirm({
        title: t('settings.configEditor.unsavedChangesTitle'),
        description: t('settings.configEditor.switchFileWarning'),
        variant: 'danger',
        confirmLabel: t('settings.configEditor.discardAndMove'),
        cancelLabel: t('settings.configEditor.continueEditing'),
      });
      if (!ok) return;
    }
    setSelectedFile(relPath);
    setFileLoading(true);
    setOriginal('');
    setCurrent('');
    setMtime(undefined);
    setShowDiff(false);
    const res = await loadFileForEdit('config', relPath);
    if (!res.ok || res.content === undefined) {
      await uiAlert({ title: t('settings.configEditor.loadFailTitle'), description: res.error ?? t('settings.unknownError'), variant: 'info' });
      setFileLoading(false);
      setSelectedFile(null);
      return;
    }
    setOriginal(res.content);
    setCurrent(res.content);
    setMtime(res.mtime);
    setFileLoading(false);
  };

  const handleSave = async () => {
    if (!selectedFile || !dirty) return;
    if (isJson && validationError) {
      await uiAlert({ title: t('settings.configEditor.jsonErrorTitle'), description: validationError, variant: 'info' });
      return;
    }
    setSaving(true);
    const res = await saveFileContent('config', selectedFile, current, mtime);
    setSaving(false);
    if (!res.ok) {
      if (res.error === 'etag mismatch') {
        await uiAlert({ title: t('settings.configEditor.etagMismatchTitle'), description: t('settings.configEditor.etagMismatchDesc'), variant: 'info' });
      } else {
        await uiAlert({ title: t('settings.configEditor.saveFailTitle'), description: res.error ?? t('settings.unknownError'), variant: 'info' });
      }
      return;
    }
    setOriginal(current);
    setMtime(res.mtime);
    notifications.show({ message: t('settings.configEditor.saveSuccessMessage', { file: selectedFile }), color: 'green' });
  };

  const handleRollback = async () => {
    const ok = await uiConfirm({
      title: t('settings.configEditor.rollbackConfirmTitle'),
      description: t('settings.configEditor.rollbackConfirmDesc'),
      variant: 'danger',
      confirmLabel: t('settings.configEditor.rollback'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    setRolling(true);
    const res = await rollbackConfig();
    setRolling(false);
    if (!res.ok) {
      await uiAlert({ title: t('settings.configEditor.rollbackFailTitle'), description: res.error ?? t('settings.unknownError'), variant: 'info' });
      return;
    }
    notifications.show({ message: t('settings.configEditor.rollbackSuccessMessage', { count: res.restoredFiles }), color: 'blue' });
    void listConfigFiles().then(setFiles);
    if (selectedFile) {
      const r = await loadFileForEdit('config', selectedFile);
      if (r.ok && r.content !== undefined) {
        setOriginal(r.content);
        setCurrent(r.content);
        setMtime(r.mtime);
      }
    }
  };

  const handleClose = async () => {
    if (dirty) {
      const ok = await uiConfirm({
        title: t('settings.configEditor.unsavedChangesTitle'),
        description: t('settings.configEditor.closeWarning'),
        variant: 'danger',
        confirmLabel: t('settings.configEditor.closeDiscard'),
        cancelLabel: t('settings.configEditor.continueEditing'),
      });
      if (!ok) return;
    }
    onClose();
  };

  const tree = useMemo(() => buildTree(files), [files]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={() => void handleClose()}
      title={`${t('settings.configEditor.modalTitle')}${dirty ? ' *' : ''}`}
      size="90vw"
      centered
      overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
    >
      <Group align="stretch" wrap="nowrap" gap={0} style={{ height: 480 }}>
        {/* Left: file tree */}
        <Box
          style={{
            width: 200, flexShrink: 0, overflowY: 'auto',
            borderRight: '1px solid var(--mantine-color-default-border)',
          }}
        >
          {filesLoading ? (
            <Group justify="center" pt="md"><Loader size="xs" /></Group>
          ) : (
            <Stack gap={0} pt={4}>
              {tree.map((node) => (
                <TreeRow
                  key={node.kind === 'file' ? node.relPath : node.name}
                  node={node} depth={0} selectedPath={selectedFile}
                  onSelect={(p) => void handleSelectFile(p)}
                  expandedDirs={expandedDirs} onToggleDir={toggleDir}
                  parentPath=""
                />
              ))}
            </Stack>
          )}
        </Box>

        {/* Right: editor / diff */}
        <Box style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {!selectedFile ? (
            <Group justify="center" align="center" style={{ flex: 1 }}>
              <Text size="sm" c="dimmed">{t('settings.configEditor.selectFileHint')}</Text>
            </Group>
          ) : fileLoading ? (
            <Group justify="center" align="center" style={{ flex: 1 }}>
              <Loader size="sm" />
            </Group>
          ) : (
            <>
              {/* File header bar */}
              <Group
                px="xs" py={4} gap="xs"
                style={{ borderBottom: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
              >
                <Text size="xs" c="dimmed" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedFile}
                </Text>
                {isJson && (
                  validationError
                    ? <Badge size="xs" color="red" title={validationError}>{t('settings.configEditor.jsonInvalid')}</Badge>
                    : <Badge size="xs" color="green">{t('settings.configEditor.jsonValid')}</Badge>
                )}
                <Tooltip label={showDiff ? t('settings.configEditor.viewEdit') : t('settings.configEditor.viewChanges')}>
                  <ActionIcon
                    size="xs" variant="subtle"
                    color={showDiff ? 'jarvis' : 'gray'}
                    disabled={!dirty}
                    onClick={() => setShowDiff((v) => !v)}
                  >
                    {showDiff ? <IconCode size={12} /> : <IconAlignLeft size={12} />}
                  </ActionIcon>
                </Tooltip>
              </Group>

              {/* Editor / DiffPreview */}
              <Box style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {showDiff ? (
                  <DiffPreview original={original} current={current} />
                ) : (
                  <div
                    ref={editorHostRef}
                    style={{ height: '100%', overflow: 'auto' }}
                  />
                )}
              </Box>
            </>
          )}
        </Box>
      </Group>

      {/* Footer */}
      <Group
        justify="space-between" pt="sm" mt="xs"
        style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}
      >
        <Tooltip label={t('settings.configEditor.rollbackTooltip')}>
          <Button
            size="compact-sm" variant="light" color="orange"
            leftSection={<IconHistory size={14} />}
            loading={rolling}
            onClick={() => void handleRollback()}
          >
            {t('settings.configEditor.rollback')}
          </Button>
        </Tooltip>
        <Group gap="xs">
          <Button size="compact-sm" variant="default" onClick={() => void handleClose()}>
            {t('common.close')}
          </Button>
          <Button
            size="compact-sm" color="jarvis.6"
            loading={saving}
            disabled={!dirty || saving || !selectedFile || (isJson && !!validationError)}
            onClick={() => void handleSave()}
          >
            {t('settings.save')}
          </Button>
        </Group>
      </Group>
    </Modal>
  );
}
