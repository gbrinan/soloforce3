import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import SuggestionList, { type SuggestionItem, type SuggestionListHandle } from './SuggestionList';

type RenderFn = NonNullable<SuggestionOptions<SuggestionItem>['render']>;

// 캐럿(clientRect) 기준으로 떠 있는 div에 SuggestionList를 마운트한다.
// tippy.js 등 외부 의존성 없이 position:fixed div를 직접 배치하고 뷰포트 경계에서 위로 뒤집는다.
export function renderSuggestion(): RenderFn {
  return () => {
    let renderer: ReactRenderer<SuggestionListHandle, SuggestionProps<SuggestionItem>> | null = null;
    let popup: HTMLDivElement | null = null;

    const position = (clientRect?: (() => DOMRect | null) | null) => {
      if (!popup || !clientRect) return;
      const rect = clientRect();
      if (!rect) return;
      const margin = 4;
      const w = popup.offsetWidth;
      const h = popup.offsetHeight;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
      popup.style.left = `${left}px`;
      const below = rect.bottom + margin;
      // 아래 공간이 부족하고 위 공간이 충분하면 캐럿 위로 띄운다.
      if (below + h > window.innerHeight && rect.top - margin - h > 0) {
        popup.style.top = `${rect.top - margin - h}px`;
      } else {
        popup.style.top = `${below}px`;
      }
    };

    return {
      onStart: (props) => {
        renderer = new ReactRenderer(SuggestionList, { props, editor: props.editor });
        if (!props.clientRect) return;
        popup = document.createElement('div');
        popup.className = 'note-suggestion-popup';
        popup.appendChild(renderer.element);
        document.body.appendChild(popup);
        position(props.clientRect);
      },
      onUpdate: (props) => {
        renderer?.updateProps(props);
        position(props.clientRect);
      },
      onKeyDown: (props) => {
        if (props.event.key === 'Escape') {
          popup?.remove();
          popup = null;
          return true;
        }
        return renderer?.ref?.onKeyDown({ event: props.event }) ?? false;
      },
      onExit: () => {
        popup?.remove();
        renderer?.destroy();
        popup = null;
        renderer = null;
      },
    };
  };
}
