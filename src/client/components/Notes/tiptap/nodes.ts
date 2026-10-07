import Mention, { type MentionOptions } from '@tiptap/extension-mention';
import type { SuggestionItem } from './SuggestionList';
import { renderSuggestion } from './renderSuggestion';

type ItemsFn = (query: string) => SuggestionItem[];

// [[위키링크]] — Mention을 확장한 인라인 atom 노드.
// - 트리거 '[[', 노트 제목 자동완성
// - 화면 표시 [[label]], 마크다운 직렬화 [[label]] (라운드트립용 tokenizer/parser 포함)
export function createWikiLink(getItems: ItemsFn) {
  return Mention.extend({
    name: 'wikiLink',
    markdownTokenName: 'wikiLink',
    addOptions() {
      return {
        ...(this.parent?.() as MentionOptions),
        HTMLAttributes: { class: 'note-wikilink' },
        renderText({ node }) {
          return `[[${node.attrs.label ?? node.attrs.id}]]`;
        },
        renderHTML({ node }) {
          const label = node.attrs.label ?? node.attrs.id ?? '';
          return ['span', {
            'data-type': 'wikiLink',
            'data-id': node.attrs.id ?? '',
            'data-label': node.attrs.label ?? '',
            class: 'note-wikilink',
          }, `[[${label}]]`];
        },
        suggestion: {
          char: '[[',
          allowSpaces: true,
          allowedPrefixes: null,
          items: ({ query }: { query: string }) => getItems(query),
          render: renderSuggestion(),
        },
      };
    },
    renderMarkdown(node) {
      const label = node.attrs?.label ?? node.attrs?.id ?? '';
      return `[[${label}]]`;
    },
    parseMarkdown(token, helpers) {
      const label = (token.label ?? token.text ?? '').toString().trim();
      return helpers.createNode('wikiLink', { id: label, label, mentionSuggestionChar: '[[' });
    },
    markdownTokenizer: {
      name: 'wikiLink',
      level: 'inline',
      start: (src) => src.indexOf('[['),
      tokenize: (src) => {
        const m = /^\[\[([^\]\n]+)\]\]/.exec(src);
        if (!m) return undefined;
        // [[event:..|..]] / [[task:..|..]]는 entityLink가 처리 — wikiLink는 양보.
        if (/^(event|task):[^|\]\n]+\|/.test(m[1])) return undefined;
        return { type: 'wikiLink', raw: m[0], label: m[1].trim() };
      },
    },
  });
}

// @엔티티 — Mention 확장 인라인 노드. 트리거 '@', 마이크루 일정/태스크 자동완성.
// attrs: { kind: 'event'|'task', id, label }. 마크다운 직렬화 [[kind:id|label]] (위키링크와 같은 [[...]] 계열, prefix로 구분).
// 클릭 시 NoteEditor가 data-entity-kind/data-entity-id를 읽어 해당 패널로 이동.
export function createEntityMention(getItems: ItemsFn) {
  return Mention.extend({
    name: 'entityLink',
    markdownTokenName: 'entityLink',
    addAttributes() {
      return {
        kind: { default: 'event' },
        id: { default: '' },
        label: { default: '' },
      };
    },
    addOptions() {
      return {
        ...(this.parent?.() as MentionOptions),
        HTMLAttributes: { class: 'note-entitylink' },
        renderText({ node }) {
          return `[[${node.attrs.kind}:${node.attrs.id}|${node.attrs.label}]]`;
        },
        renderHTML({ node }) {
          const kind = node.attrs.kind ?? 'event';
          const label = node.attrs.label ?? node.attrs.id ?? '';
          const icon = kind === 'task' ? '✔ ' : '📅 ';
          return ['span', {
            'data-type': 'entityLink',
            'data-entity-kind': kind,
            'data-entity-id': node.attrs.id ?? '',
            'data-label': label,
            class: 'note-entitylink',
          }, `${icon}${label}`];
        },
        suggestion: {
          char: '@',
          allowSpaces: true,
          allowedPrefixes: null,
          items: ({ query }: { query: string }) => getItems(query),
          render: renderSuggestion(),
          // Mention 기본 command는 {id,label}만 설정 → kind까지 보존하도록 override.
          // 파라미터 타입은 MentionOptions 컨텍스트에서 추론(props=MentionNodeAttrs) → kind 보존 위해 캐스트.
          command: ({ editor, range, props }) => {
            const p = props as unknown as { kind?: string; id?: string; label?: string };
            editor.chain().focus().insertContentAt(range, [
              { type: 'entityLink', attrs: { kind: p.kind ?? 'event', id: p.id ?? '', label: p.label ?? '' } },
              { type: 'text', text: ' ' },
            ]).run();
          },
        },
      };
    },
    renderMarkdown(node) {
      const kind = node.attrs?.kind ?? 'event';
      const label = node.attrs?.label ?? node.attrs?.id ?? '';
      return `[[${kind}:${node.attrs?.id ?? ''}|${label}]]`;
    },
    parseMarkdown(token, helpers) {
      const tok = token as unknown as { kind?: string; id?: string; label?: string; text?: string };
      const raw = (tok.text ?? '').toString();
      const m = /^([a-z]+):([^|\]]+)\|?([^\]]*)$/.exec(raw);
      const kind = tok.kind ?? m?.[1] ?? 'event';
      const id = tok.id ?? m?.[2] ?? '';
      const label = tok.label ?? m?.[3] ?? id;
      return helpers.createNode('entityLink', { kind, id, label, mentionSuggestionChar: '@' });
    },
    markdownTokenizer: {
      name: 'entityLink',
      level: 'inline',
      start: (src) => src.indexOf('[['),
      tokenize: (src) => {
        const m = /^\[\[(event|task):([^|\]\n]+)\|([^\]\n]*)\]\]/.exec(src);
        if (!m) return undefined;
        return { type: 'entityLink', raw: m[0], kind: m[1], id: m[2].trim(), label: m[3].trim() };
      },
    },
  });
}

// #태그 — Mention 확장 인라인 노드. 트리거 '#', 기존 태그 자동완성 + 신규 태그 허용.
// 마크다운 직렬화 #label, 인라인 tokenizer로 라운드트립. (행 머리 '# '은 marked 블록 헤딩이 우선 처리)
export function createTag(getItems: ItemsFn) {
  return Mention.extend({
    name: 'tag',
    markdownTokenName: 'tag',
    addOptions() {
      return {
        ...(this.parent?.() as MentionOptions),
        HTMLAttributes: { class: 'note-tag' },
        renderText({ node }) {
          return `#${node.attrs.label ?? node.attrs.id}`;
        },
        renderHTML({ node }) {
          const label = node.attrs.label ?? node.attrs.id ?? '';
          return ['span', {
            'data-type': 'tag',
            'data-id': node.attrs.id ?? '',
            'data-label': node.attrs.label ?? '',
            class: 'note-tag',
          }, `#${label}`];
        },
        suggestion: {
          char: '#',
          allowSpaces: false,
          allowedPrefixes: null,
          items: ({ query }: { query: string }) => getItems(query),
          render: renderSuggestion(),
        },
      };
    },
    renderMarkdown(node) {
      const label = node.attrs?.label ?? node.attrs?.id ?? '';
      return `#${label}`;
    },
    parseMarkdown(token, helpers) {
      const label = (token.label ?? token.text ?? '').toString().trim();
      return helpers.createNode('tag', { id: label, label, mentionSuggestionChar: '#' });
    },
    markdownTokenizer: {
      name: 'tag',
      level: 'inline',
      start: (src) => src.indexOf('#'),
      tokenize: (src) => {
        const m = /^#([0-9A-Za-z가-힣_/-]+)/.exec(src);
        if (!m) return undefined;
        return { type: 'tag', raw: m[0], label: m[1] };
      },
    },
  });
}
