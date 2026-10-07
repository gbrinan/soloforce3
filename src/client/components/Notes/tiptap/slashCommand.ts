import { Extension } from '@tiptap/core';
import { Suggestion } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import type { SuggestionItem } from './SuggestionList';
import { renderSuggestion } from './renderSuggestion';

type ItemsFn = (query: string) => SuggestionItem[];

// 슬래시('/') 커맨드 메뉴 — @tiptap/suggestion 기반 자작.
// 선택된 아이템의 run(editor, range)을 실행한다(블록 변환). 아이템/라벨은 호출측에서 i18n으로 주입.
export function createSlashCommand(getItems: ItemsFn) {
  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [
        Suggestion<SuggestionItem, SuggestionItem>({
          editor: this.editor,
          char: '/',
          pluginKey: new PluginKey('slashCommand'),
          allowSpaces: false,
          startOfLine: false,
          items: ({ query }) => getItems(query),
          command: ({ editor, range, props }) => {
            props.run?.(editor, range);
          },
          render: renderSuggestion(),
        }),
      ];
    },
  });
}
