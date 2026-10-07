import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor, Range } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { showMinimap } from '@replit/codemirror-minimap';
import { Group, ActionIcon, Box, Tooltip, Loader, Text, Popover, ScrollArea, SegmentedControl, TextInput, Button, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBold, IconItalic, IconStrikethrough, IconCode, IconLink, IconSubtask, IconSparkles, IconSettings, IconH1, IconH2, IconH3, IconList, IconListNumbers, IconMinus, IconTable, IconPhoto, IconRowInsertTop, IconRowInsertBottom, IconRowRemove, IconColumnInsertLeft, IconColumnInsertRight, IconColumnRemove, IconTableOff, IconTextWrap, IconTextWrapDisabled, IconSearch, IconMap2 } from '@tabler/icons-react';
import TableSizePicker from './TableSizePicker';
import { useI18n } from '../../i18n/I18nProvider';
import { useMantineColorScheme } from '@mantine/core';
import type { SuggestionItem } from './tiptap/SuggestionList';
import { createWikiLink, createEntityMention, createTag } from './tiptap/nodes';
import { createSlashCommand } from './tiptap/slashCommand';
import { useNoteAI } from './ai/useNoteAI';
import AISettings from './ai/AISettings';
import {
  generate, summarizePrompt, rewritePrompt, continuePrompt, tonePrompt, extractActionsPrompt, parseActions,
  type ChatMsg,
} from './ai/aiProvider';
import './notes.css';

// @멘션 자동완성 항목 — 마이크루 일정(event)/태스크(task) 엔티티.
export interface EntityItem {
  kind: 'event' | 'task';
  id: string;
  label: string;
}

interface Props {
  noteId: string;
  value: string;                                  // 현재 노트 마크다운(단일 진실 소스)
  onChange: (noteId: string, markdown: string) => void;
  getWikiItems: (query: string) => SuggestionItem[];
  getTagItems: (query: string) => SuggestionItem[];
  getEntityItems?: (query: string) => EntityItem[];   // @멘션 자동완성(일정/태스크)
  onNavigate: (title: string) => void;            // [[위키링크]] 클릭 시
  onOpenEntity?: (kind: string, id: string) => void;  // 엔티티 링크 클릭 시 패널 전환
  onConvertToTask?: (text: string) => Promise<{ taskId: string; todoId: string } | null>;  // 체크리스트 항목 → 태스크
}

const CHANGE_DEBOUNCE_MS = 400;

type EditorMode = 'wysiwyg' | 'source' | 'split';

// HTML 삽입(요약 blockquote / 액션 체크리스트)용 텍스트 이스케이프.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface NoteEditorHandle {
  insertTag: (tag: string) => void;            // 추천 태그 칩 클릭 시 커서에 #태그 삽입
  insertEntityLink: (kind: string, id: string, label: string) => void;  // @멘션 엔티티 링크 삽입
  flush: () => void;                           // 내부 디바운스 중인 변경을 즉시 onChange로 push(beforeunload 등)
}

const NoteEditor = forwardRef<NoteEditorHandle, Props>(function NoteEditor(
  { noteId, value, onChange, getWikiItems, getTagItems, getEntityItems, onNavigate, onOpenEntity, onConvertToTask }, ref,
) {
  const { t } = useI18n();
  const { colorScheme } = useMantineColorScheme();
  const [, forceRender] = useState(0);

  // Editor features state
  const [editorMode, setEditorMode] = useState<EditorMode>('wysiwyg');
  const [wordWrap, setWordWrap] = useState(true);
  const [minimap, setMinimap] = useState(true);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const ai = useNoteAI();
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);   // 표 삽입 크기 선택 팝오버

  // CodeMirror refs for source/split mode
  const cmHostRef = useRef<HTMLDivElement | null>(null);
  const cmViewRef = useRef<EditorView | null>(null);
  // Compartment lets us reconfigure the minimap extension at runtime without rebuilding the view.
  const minimapCompartment = useRef(new Compartment());

  // Minimap extension — shown when `minimap` state is true (CodeMirror modes only).
  const minimapExtension = useMemo(() => showMinimap.compute(['doc'], () => ({
    create: () => ({ dom: document.createElement('div') }),
    displayText: 'blocks',
    showOverlay: 'always',
    gutters: [],
  })), []);

  // 슬래시 메뉴가 호출하는 최신 AI 핸들러/가용성 — 확장은 1회만 생성하므로 ref로 최신값 전달.
  const aiRef = useRef<{
    aiAvailable: boolean;
    runInline: (kind: 'rewrite' | 'continue' | 'tone', range: Range) => void;
    extractActions: (range: Range) => void;
  }>({ aiAvailable: false, runInline: () => {}, extractActions: () => {} });

  // 슬래시 커맨드 아이템(i18n 라벨) — t 의존이라 매 렌더 갱신, ref로 확장에 전달.
  const slashItems = useCallback((query: string): SuggestionItem[] => {
    const items: SuggestionItem[] = [
      { id: 'h1', label: t('notes.slash.h1'), hint: 'H1', run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 1 }).run() },
      { id: 'h2', label: t('notes.slash.h2'), hint: 'H2', run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 2 }).run() },
      { id: 'h3', label: t('notes.slash.h3'), hint: 'H3', run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 3 }).run() },
      { id: 'code', label: t('notes.slash.code'), hint: '```', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
      { id: 'quote', label: t('notes.slash.quote'), hint: '>', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
      { id: 'bullet', label: t('notes.slash.bullet'), hint: '•', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
      { id: 'todo', label: t('notes.slash.todo'), hint: '☑', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
      { id: 'ordered', label: t('notes.slash.ordered'), hint: '1.', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
      { id: 'divider', label: t('notes.slash.divider'), hint: '―', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
      { id: 'table', label: t('notes.slash.table'), hint: '⊞', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { id: 'image', label: t('notes.slash.image'), hint: '🖼', run: (e, r) => { e.chain().focus().deleteRange(r).run(); const url = window.prompt(t('notes.imagePrompt')); if (url && url.trim()) e.chain().focus().setImage({ src: url.trim() }).run(); } },
      { id: 'link-schedule', label: t('notes.slash.linkSchedule'), hint: '@', run: (e, r) => e.chain().focus().deleteRange(r).insertContent('@').run() },
    ];
    // AI 옵션 — 현재 설정으로 AI 사용 가능할 때만 노출(WebGPU/Ollama/BYOK) - WYSIWYG 모드만
    if (aiRef.current.aiAvailable && editorMode === 'wysiwyg') {
      items.push(
        { id: 'ai-rewrite', label: t('notes.slash.aiRewrite'), hint: 'AI', run: (_e, r) => aiRef.current.runInline('rewrite', r) },
        { id: 'ai-continue', label: t('notes.slash.aiContinue'), hint: 'AI', run: (_e, r) => aiRef.current.runInline('continue', r) },
        { id: 'ai-tone', label: t('notes.slash.aiTone'), hint: 'AI', run: (_e, r) => aiRef.current.runInline('tone', r) },
        { id: 'extract-actions', label: t('notes.slash.extractActions'), hint: 'AI', run: (_e, r) => aiRef.current.extractActions(r) },
      );
    }
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q) || (i.hint ?? '').toLowerCase().includes(q));
  }, [t, editorMode]);

  // 최신 콜백/값을 ref로 보관 — 확장은 1회만 생성하고 내부에서 ref를 통해 최신값을 읽는다.
  const cb = useRef({ getWikiItems, getTagItems, getEntityItems, onNavigate, onOpenEntity, onConvertToTask, onChange, value, slashItems });
  cb.current = { getWikiItems, getTagItems, getEntityItems, onNavigate, onOpenEntity, onConvertToTask, onChange, value, slashItems };

  const editorRef = useRef<Editor | null>(null);
  const loadedId = useRef<string>(noteId);          // 현재 에디터에 로드된 노트 id
  const suppressChange = useRef(false);             // setContent로 인한 onUpdate 무시
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest editorMode read by stable callbacks/refs without triggering re-creation.
  const modeRef = useRef<EditorMode>(editorMode);
  useEffect(() => { modeRef.current = editorMode; }, [editorMode]);

  // 보류 중인 변경을 즉시 flush(로드된 노트 기준) — 노트 전환/언마운트 시 유실/오염 방지.
  const flushChange = useCallback(() => {
    if (changeTimer.current) {
      clearTimeout(changeTimer.current);
      changeTimer.current = null;
      const ed = editorRef.current;
      const cm = cmViewRef.current;
      const mode = modeRef.current;

      let markdown = '';
      if ((mode === 'source' || mode === 'split') && cm) {
        markdown = cm.state.doc.toString();
      } else if (ed) {
        markdown = ed.getMarkdown();
      }

      if (markdown) cb.current.onChange(loadedId.current, markdown);
    }
  }, []);

  const extensions = useMemo(() => [
    StarterKit,
    Markdown,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    createWikiLink((q) => cb.current.getWikiItems(q)),
    createEntityMention((q) => cb.current.getEntityItems?.(q) ?? []),
    createTag((q) => cb.current.getTagItems(q)),
    createSlashCommand((q) => cb.current.slashItems(q)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const editor = useEditor({
    extensions,
    content: cb.current.value,
    contentType: 'markdown',
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => {
      if (suppressChange.current) return;
      if (changeTimer.current) clearTimeout(changeTimer.current);
      changeTimer.current = setTimeout(() => {
        changeTimer.current = null;
        const markdown = ed.getMarkdown();

        // Sync to CodeMirror in split mode (mode read via ref to keep deps stable).
        if (modeRef.current === 'split' && cmViewRef.current && !syncInProgress.current) {
          syncInProgress.current = true;
          cmViewRef.current.dispatch({
            changes: { from: 0, to: cmViewRef.current.state.doc.length, insert: markdown }
          });
          syncInProgress.current = false;
        }

        cb.current.onChange(loadedId.current, markdown);
      }, CHANGE_DEBOUNCE_MS);
    },
    // Empty deps: extensions is now stable (configured once), and editorMode is read
    // via modeRef. The editor instance must NOT be re-created on mode/focus/typewriter
    // toggles — that was the source of throws in dependent effects/handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  editorRef.current = editor;

  // Track sync to prevent infinite loop in split mode
  const syncInProgress = useRef(false);

  // CodeMirror setup for source/split mode
  useEffect(() => {
    if ((editorMode === 'source' || editorMode === 'split') && cmHostRef.current && !cmViewRef.current) {
      const isDark = colorScheme === 'dark';
      const state = EditorState.create({
        doc: cb.current.value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          markdown(),
          ...(isDark ? [oneDark] : []),
          minimapCompartment.current.of(minimap ? [minimapExtension] : []),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || syncInProgress.current) return;
            
            const newMarkdown = update.state.doc.toString();
            
            // Sync to Tiptap in split mode
            if (editorMode === 'split' && editorRef.current) {
              syncInProgress.current = true;
              suppressChange.current = true;
              editorRef.current.commands.setContent(newMarkdown, { contentType: 'markdown' });
              setTimeout(() => { suppressChange.current = false; }, 0);
              syncInProgress.current = false;
            }
            
            // Trigger onChange
            if (changeTimer.current) clearTimeout(changeTimer.current);
            changeTimer.current = setTimeout(() => {
              changeTimer.current = null;
              cb.current.onChange(loadedId.current, newMarkdown);
            }, CHANGE_DEBOUNCE_MS);
          }),
        ],
      });
      
      cmViewRef.current = new EditorView({ state, parent: cmHostRef.current });
    }
    
    // Always tear down on mode change (or unmount): the next effect run will remount
    // onto the currently rendered cmHostRef DOM node. Using stale-closure editorMode
    // here would skip destroy on source↔split and leave the view detached.
    return () => {
      if (cmViewRef.current) {
        cmViewRef.current.destroy();
        cmViewRef.current = null;
      }
    };
  }, [editorMode, colorScheme]);

  // Reconfigure minimap extension when the toggle state changes (without rebuilding the view).
  useEffect(() => {
    const view = cmViewRef.current;
    if (!view) return;
    view.dispatch({
      effects: minimapCompartment.current.reconfigure(minimap ? [minimapExtension] : []),
    });
  }, [minimap, minimapExtension, editorMode]);

  // 추천 태그 삽입 — 커서 위치에 '#태그 ' 텍스트를 넣는다(마크다운 저장 시 #태그로 직렬화됨).
  useImperativeHandle(ref, () => ({
    insertTag: (tag: string) => {
      const ed = editorRef.current;
      if (!ed || !tag.trim()) return;
      ed.chain().focus().insertContent(`#${tag.trim()} `).run();
    },
    insertEntityLink: (kind, id, label) => {
      const ed = editorRef.current;
      if (!ed || !id) return;
      ed.chain().focus().insertContent([
        { type: 'entityLink', attrs: { kind, id, label } },
        { type: 'text', text: ' ' },
      ]).run();
    },
    // 보류 중인 입력 디바운스를 즉시 flush(onChange 동기 호출). 보류 없으면 no-op.
    flush: () => flushChange(),
  }), [flushChange]);

  // ── 생성 AI 핸들러 ──────────────────────────────────────────────
  // 요약 — 본문 전체를 요약해 노트 상단에 blockquote로 삽입.
  const summarize = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || aiBusy) return;
    const text = ed.getText().trim();
    if (!text) return;
    setAiBusy(true);
    try {
      const out = (await generate(summarizePrompt(text))).trim();
      if (out) {
        const body = escapeHtml(out).replace(/\n/g, '<br>');
        const html = `<blockquote><p><strong>📌 ${escapeHtml(t('notes.ai.summarize'))}</strong><br>${body}</p></blockquote>`;
        ed.chain().focus().insertContentAt(0, html).run();
      }
    } catch {
      window.alert(t('notes.ai.failed'));
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, t]);

  // 인라인 AI — 슬래시 텍스트 제거 후 선택/직전 텍스트 기준으로 스트리밍 삽입.
  const runInline = useCallback(async (kind: 'rewrite' | 'continue' | 'tone', range: Range) => {
    const ed = editorRef.current;
    if (!ed || aiBusy) return;
    ed.chain().focus().deleteRange(range).run();
    const { from, to, empty } = ed.state.selection;
    let messages: ChatMsg[];
    let insertPos: number;
    if (kind === 'continue') {
      const before = ed.state.doc.textBetween(Math.max(0, from - 2000), from, '\n');
      if (!before.trim()) return;
      messages = continuePrompt(before);
      insertPos = from;
    } else {
      const target = empty
        ? ed.state.doc.textBetween(Math.max(0, from - 2000), from, '\n')
        : ed.state.doc.textBetween(from, to, '\n');
      if (!target.trim()) return;
      if (kind === 'tone') {
        const tone = window.prompt(t('notes.ai.tonePrompt'));
        if (!tone || !tone.trim()) return;
        messages = tonePrompt(target, tone.trim());
      } else {
        messages = rewritePrompt(target);
      }
      insertPos = empty ? from : to;
    }
    setAiBusy(true);
    try {
      let last = insertPos;
      await generate(messages, {
        onToken: (full) => {
          const e2 = editorRef.current;
          if (!e2) return;
          // 직전에 삽입한 영역을 매 토큰마다 교체(스트리밍). 평문은 1:1 위치 대응.
          e2.chain().insertContentAt({ from: insertPos, to: last }, full).run();
          last = insertPos + full.length;
        },
      });
    } catch {
      window.alert(t('notes.ai.failed'));
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, t]);

  // 회의록 → 액션아이템 추출(JSON-mode) → 체크리스트로 삽입.
  const extractActions = useCallback(async (range: Range) => {
    const ed = editorRef.current;
    if (!ed || aiBusy) return;
    ed.chain().focus().deleteRange(range).run();
    const text = ed.getText().trim();
    if (!text) return;
    setAiBusy(true);
    try {
      const out = await generate(extractActionsPrompt(text), { json: true });
      const actions = parseActions(out);
      if (actions.length === 0) { window.alert(t('notes.ai.noActions')); return; }
      const lis = actions.map((a) =>
        `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>${escapeHtml(a)}</p></div></li>`).join('');
      editorRef.current?.chain().focus().insertContent(`<ul data-type="taskList">${lis}</ul>`).run();
    } catch {
      window.alert(t('notes.ai.failed'));
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, t]);

  // 슬래시 메뉴가 참조하는 최신 핸들러/가용성 갱신.
  aiRef.current = { aiAvailable: ai.aiAvailable, runInline, extractActions };

  // 툴바 active 상태 갱신을 위해 트랜잭션마다 리렌더.
  useEffect(() => {
    if (!editor) return;
    const update = () => forceRender((n) => n + 1);
    editor.on('transaction', update);
    return () => { editor.off('transaction', update); };
  }, [editor]);

  // 노트 전환: 이전 노트의 보류 변경을 flush한 뒤 새 내용을 로드.
  useEffect(() => {
    if (!editor) return;
    flushChange();
    suppressChange.current = true;
    editor.commands.setContent(cb.current.value, { contentType: 'markdown' });
    if (cmViewRef.current) {
      cmViewRef.current.dispatch({
        changes: { from: 0, to: cmViewRef.current.state.doc.length, insert: cb.current.value }
      });
    }
    loadedId.current = noteId;
    const id = setTimeout(() => { suppressChange.current = false; }, 0);
    return () => clearTimeout(id);
    // value는 의도적 제외 — onChange 피드백 루프 방지(전환 시에만 로드).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, noteId, flushChange]);

  // 언마운트 시 보류 변경 flush.
  useEffect(() => () => { flushChange(); }, [flushChange]);

  // [[위키링크]] 클릭 → 대상 노트로 이동.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handler = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest('[data-type="wikiLink"]') as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      const label = el.getAttribute('data-label') || el.textContent?.replace(/^\[\[|\]\]$/g, '') || '';
      if (label.trim()) cb.current.onNavigate(label.trim());
    };
    dom.addEventListener('click', handler);
    return () => dom.removeEventListener('click', handler);
  }, [editor]);

  // 엔티티 링크([[event:..]]/[[task:..]]) 클릭 → 해당 패널로 이동.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handler = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest('[data-type="entityLink"]') as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      const kind = el.getAttribute('data-entity-kind') || '';
      const id = el.getAttribute('data-entity-id') || '';
      if (kind && id) cb.current.onOpenEntity?.(kind, id);
    };
    dom.addEventListener('click', handler);
    return () => dom.removeEventListener('click', handler);
  }, [editor]);

  // 체크리스트 항목 → 태스크 변환: 커서가 위치한 항목 텍스트로 마이크루 태스크 생성 후
  // 항목 끝에 [[task:..]] 링크 삽입 + 성공 토스트. (Phase C: 노트↔태스크 연결)
  const convertToTask = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed) return;
    const text = ed.state.selection.$from.parent.textContent.trim();
    if (!text) return;
    const res = await cb.current.onConvertToTask?.(text);
    if (!res) return;
    const endPos = ed.state.selection.$from.end();   // 현재 항목(블록) 끝
    ed.chain().focus().setTextSelection(endPos).insertContent([
      { type: 'text', text: ' ' },
      { type: 'entityLink', attrs: { kind: 'task', id: res.todoId, label: text.slice(0, 60) } },
    ]).run();
    notifications.show({ message: t('notes.taskCreated'), color: 'teal' });
  }, [t]);

  const insertImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt(t('notes.imagePrompt'));
    if (url && url.trim()) editor.chain().focus().setImage({ src: url.trim() }).run();
  }, [editor, t]);

  const toggleLink = useCallback(() => {
    if (!editor) return;
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt(t('notes.linkPrompt'));
    if (url && url.trim()) editor.chain().focus().setLink({ href: url.trim() }).run();
  }, [editor, t]);

  // Intercept Cmd+F to open find overlay
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && editorMode === 'wysiwyg') {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editorMode]);

  const renderToolbar = () => {
    const isWysiwyg = editorMode === 'wysiwyg';
    const isSourceOrSplit = editorMode === 'source' || editorMode === 'split';

    return (
      <ScrollArea type="hover" scrollbarSize={6} style={{ flexShrink: 0, borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group gap={2} px="xs" py={4} wrap="nowrap" w="100%">
          {/* Mode switcher */}
          <SegmentedControl
            size="xs"
            value={editorMode}
            onChange={(value) => setEditorMode(value as EditorMode)}
            data={[
              { label: t('notes.mode.wysiwyg'), value: 'wysiwyg' },
              { label: t('notes.mode.source'), value: 'source' },
              { label: t('notes.mode.split'), value: 'split' },
            ]}
          />

          <Box style={{ width: 1, height: 18, background: 'var(--mantine-color-default-border)', margin: '0 4px', flexShrink: 0 }} />

          {/* Word Wrap */}
          <Tooltip label={t('notes.wordWrap')} withArrow>
            <ActionIcon variant={wordWrap ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => setWordWrap(!wordWrap)} aria-label={t('notes.wordWrap')}>
              {wordWrap ? <IconTextWrap size={14} stroke={1.5} /> : <IconTextWrapDisabled size={14} stroke={1.5} />}
            </ActionIcon>
          </Tooltip>

          {/* Minimap - Source/Split only (CodeMirror) */}
          {isSourceOrSplit && (
            <Tooltip label={t('notes.minimap')} withArrow>
              <ActionIcon variant={minimap ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => setMinimap(!minimap)} aria-label={t('notes.minimap')}>
                <IconMap2 size={14} stroke={1.5} />
              </ActionIcon>
            </Tooltip>
          )}

          {/* Find - WYSIWYG only */}
          {isWysiwyg && (
            <Tooltip label={t('notes.find')} withArrow>
              <ActionIcon variant={findOpen ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => setFindOpen(!findOpen)} aria-label={t('notes.find')}>
                <IconSearch size={14} stroke={1.5} />
              </ActionIcon>
            </Tooltip>
          )}

          {/* WYSIWYG formatting buttons */}
          {isWysiwyg && (
            <>
              <Box style={{ width: 1, height: 18, background: 'var(--mantine-color-default-border)', margin: '0 4px', flexShrink: 0 }} />

              <Tooltip label={t('notes.bold')} withArrow>
                <ActionIcon variant={editor?.isActive('bold') ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => editor?.chain().focus().toggleBold().run()} aria-label={t('notes.bold')}>
                  <IconBold size={14} stroke={1.5} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('notes.italic')} withArrow>
                <ActionIcon variant={editor?.isActive('italic') ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => editor?.chain().focus().toggleItalic().run()} aria-label={t('notes.italic')}>
                  <IconItalic size={14} stroke={1.5} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('notes.strike')} withArrow>
                <ActionIcon variant={editor?.isActive('strike') ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => editor?.chain().focus().toggleStrike().run()} aria-label={t('notes.strike')}>
                  <IconStrikethrough size={14} stroke={1.5} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('notes.code')} withArrow>
                <ActionIcon variant={editor?.isActive('code') ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => editor?.chain().focus().toggleCode().run()} aria-label={t('notes.code')}>
                  <IconCode size={14} stroke={1.5} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('notes.link')} withArrow>
                <ActionIcon variant={editor?.isActive('link') ? 'light' : 'subtle'} color="gray" size="sm" onClick={toggleLink} aria-label={t('notes.link')}>
                  <IconLink size={14} stroke={1.5} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('notes.heading1')} withArrow>
                <ActionIcon variant={editor?.isActive('heading', { level: 1 }) ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} aria-label={t('notes.heading1')}>
                  <IconH1 size={14} stroke={1.5} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('notes.heading2')} withArrow>
                <ActionIcon variant={editor?.isActive('heading', { level: 2 }) ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} aria-label={t('notes.heading2')}>
                  <IconH2 size={14} stroke={1.5} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('notes.heading3')} withArrow>
                <ActionIcon variant={editor?.isActive('heading', { level: 3 }) ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} aria-label={t('notes.heading3')}>
                  <IconH3 size={14} stroke={1.5} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('notes.bulletList')} withArrow>
                <ActionIcon variant={editor?.isActive('bulletList') ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-label={t('notes.bulletList')}>
                  <IconList size={14} stroke={1.5} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('notes.orderedList')} withArrow>
                <ActionIcon variant={editor?.isActive('orderedList') ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => editor?.chain().focus().toggleOrderedList().run()} aria-label={t('notes.orderedList')}>
                  <IconListNumbers size={14} stroke={1.5} />
                </ActionIcon>
              </Tooltip>
              <Popover opened={tableMenuOpen} onChange={setTableMenuOpen} position="bottom-start" withArrow shadow="md" trapFocus={false}>
                <Popover.Target>
                  <ActionIcon variant={tableMenuOpen ? 'light' : 'subtle'} color="gray" size="sm" onClick={() => setTableMenuOpen((o) => !o)} aria-label={t('notes.tableInsert')}>
                    <IconTable size={14} stroke={1.5} />
                  </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown p={8}>
                  <TableSizePicker
                    onPick={(rows, cols) => {
                      editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
                      setTableMenuOpen(false);
                    }}
                  />
                </Popover.Dropdown>
              </Popover>
              <Tooltip label={t('notes.image')} withArrow>
                <ActionIcon variant={"subtle"} color="gray" size="sm" onClick={insertImage} aria-label={t('notes.image')}>
                  <IconPhoto size={14} stroke={1.5} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t('notes.divider')} withArrow>
                <ActionIcon variant={"subtle"} color="gray" size="sm" onClick={() => editor?.chain().focus().setHorizontalRule().run()} aria-label={t('notes.divider')}>
                  <IconMinus size={14} stroke={1.5} />
                </ActionIcon>
              </Tooltip>

              {/* 표 안에 커서가 있을 때만 노출 — 행/열 추가·삭제 및 표 삭제(셀 편집은 셀 클릭 후 직접 입력). */}
              {editor?.isActive('table') && (
                <>
                  <Box style={{ width: 1, height: 18, background: 'var(--mantine-color-default-border)', margin: '0 2px', flexShrink: 0 }} />
                  <Tooltip label={t('notes.tableRowAbove')} withArrow>
                    <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => editor?.chain().focus().addRowBefore().run()} aria-label={t('notes.tableRowAbove')}>
                      <IconRowInsertTop size={14} stroke={1.5} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('notes.tableRowBelow')} withArrow>
                    <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => editor?.chain().focus().addRowAfter().run()} aria-label={t('notes.tableRowBelow')}>
                      <IconRowInsertBottom size={14} stroke={1.5} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('notes.tableDelRow')} withArrow>
                    <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => editor?.chain().focus().deleteRow().run()} aria-label={t('notes.tableDelRow')}>
                      <IconRowRemove size={14} stroke={1.5} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('notes.tableColLeft')} withArrow>
                    <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => editor?.chain().focus().addColumnBefore().run()} aria-label={t('notes.tableColLeft')}>
                      <IconColumnInsertLeft size={14} stroke={1.5} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('notes.tableColRight')} withArrow>
                    <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => editor?.chain().focus().addColumnAfter().run()} aria-label={t('notes.tableColRight')}>
                      <IconColumnInsertRight size={14} stroke={1.5} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('notes.tableDelCol')} withArrow>
                    <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => editor?.chain().focus().deleteColumn().run()} aria-label={t('notes.tableDelCol')}>
                      <IconColumnRemove size={14} stroke={1.5} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('notes.tableDelete')} withArrow>
                    <ActionIcon variant="subtle" color="red" size="sm" onClick={() => editor?.chain().focus().deleteTable().run()} aria-label={t('notes.tableDelete')}>
                      <IconTableOff size={14} stroke={1.5} />
                    </ActionIcon>
                  </Tooltip>
                </>
              )}

              {/* 체크리스트(taskItem) 항목에 커서가 있을 때만 노출 — 항목 텍스트를 마이크루 태스크로 변환. */}
              {editor?.isActive('taskItem') && onConvertToTask && (
                <Tooltip label={t('notes.toTask')} withArrow>
                  <ActionIcon variant="subtle" color="teal" size="sm" onClick={() => { void convertToTask(); }} aria-label={t('notes.toTask')}>
                    <IconSubtask size={14} stroke={1.5} />
                  </ActionIcon>
                </Tooltip>
              )}
            </>
          )}

          <Box style={{ flex: 1 }} />

          {ai.progress.progress > 0 && ai.progress.progress < 1 && (
            <Tooltip label={ai.progress.text} withArrow>
              <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                <Loader size={12} />
                <Text size="xs" c="dimmed">{Math.round(ai.progress.progress * 100)}%</Text>
              </Group>
            </Tooltip>
          )}
          {ai.webgpuOK === false && ai.config.provider === 'webllm' && (
            <Tooltip label={t('notes.ai.unsupported')} withArrow>
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>AI ✕</Text>
            </Tooltip>
          )}
          {ai.aiAvailable && isWysiwyg && (
            <Tooltip label={t('notes.ai.summarize')} withArrow>
              <ActionIcon variant="subtle" color="grape" size="sm" loading={aiBusy} onClick={summarize} aria-label={t('notes.ai.summarize')}>
                <IconSparkles size={14} stroke={1.5} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={t('notes.ai.settings')} withArrow>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setAiSettingsOpen(true)} aria-label={t('notes.ai.settings')}>
              <IconSettings size={14} stroke={1.5} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </ScrollArea>
    );
  };

  const renderContent = () => {
    const wrapClass = wordWrap ? 'word-wrap-on' : 'word-wrap-off';

    if (editorMode === 'wysiwyg') {
      return (
        <Box className={`note-editor ${wrapClass}`} style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}>
          <EditorContent editor={editor} />
          
          {/* Find/Replace overlay */}
          {findOpen && (
            <Box className="note-find-overlay">
              <Stack gap="xs">
                <TextInput
                  size="xs"
                  placeholder={t('notes.findPlaceholder')}
                  value={findQuery}
                  onChange={(e) => setFindQuery(e.target.value)}
                  rightSection={
                    <ActionIcon size="xs" variant="subtle" onClick={() => setFindOpen(false)}>
                      ✕
                    </ActionIcon>
                  }
                />
                <TextInput
                  size="xs"
                  placeholder={t('notes.replacePlaceholder')}
                  value={replaceQuery}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                />
                <Group gap="xs">
                  <Button size="compact-xs" variant="light">{t('notes.previous')}</Button>
                  <Button size="compact-xs" variant="light">{t('notes.next')}</Button>
                  <Button size="compact-xs" variant="light">{t('notes.replace')}</Button>
                  <Button size="compact-xs" variant="light">{t('notes.replaceAll')}</Button>
                </Group>
              </Stack>
            </Box>
          )}
        </Box>
      );
    }

    if (editorMode === 'source') {
      return (
        <Box className={`note-codemirror ${wrapClass}`} style={{ flex: 1, minHeight: 0 }}>
          <div ref={cmHostRef} style={{ height: '100%' }} />
        </Box>
      );
    }

    // Split mode
    return (
      <Box className="note-editor-split-container">
        <Box className={`note-editor-split-pane note-editor ${wrapClass}`}>
          <EditorContent editor={editor} />
        </Box>
        <Box className={`note-editor-split-pane note-codemirror ${wrapClass}`}>
          <div ref={cmHostRef} style={{ height: '100%' }} />
        </Box>
      </Box>
    );
  };

  return (
    <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {renderToolbar()}
      {renderContent()}

      <AISettings
        opened={aiSettingsOpen}
        onClose={() => setAiSettingsOpen(false)}
        config={ai.config}
        onSave={ai.setConfig}
      />

    </Box>
  );
});

export default NoteEditor;
