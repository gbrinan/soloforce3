import React from 'react';

// 렌더 중 발생한 throw를 가둬 앱 전체 화이트스크린을 방지하는 경계.
// 자식 컴포넌트가 던지면 fallback을 렌더하고, reset()으로 자식을 다시 마운트한다.
// (실패 가시성: componentDidCatch에서 console.error로 스택 로깅)
interface Props {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  // 값이 바뀌면 경계 상태를 자동 리셋(예: 선택 노트 id) — 다른 항목으로 전환 시 복구.
  resetKey?: unknown;
}
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 실패 가시성 — 콘솔에 컴포넌트 스택과 함께 로깅.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    if (this.state.error) {
      return this.props.fallback ? this.props.fallback(this.state.error, this.reset) : null;
    }
    return this.props.children;
  }
}
