import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Modal, ScrollArea } from '@mantine/core';
import './styles.css';
import ChatPanel from './components/Chat/ChatPanel';
import JarvisView from './components/Jarvis/JarvisView';
import StaffPanel from './components/Staff/StaffPanel';
import JobResultModal from './components/Jobs/JobResultModal';
import TodoPanel from './components/Todos/TodoPanel';
import FilesPanel from './components/Files/FilesPanel';
import CostsPanel from './components/Files/CostsPanel';
import SchedulesPanel from './components/Calendar/SchedulesPanel';
import NotesPanel from './components/Notes/NotesPanel';
import ErrorBoundary from './components/ErrorBoundary';
import InboxPanel from './components/External/InboxPanel';
import ContactsPanel from './components/Contacts/ContactsPanel';
import OnboardingView from './components/Onboarding/OnboardingView';
import ProfileMenu from './components/ProfileMenu';
import AppLauncherButton from './components/Apps/AppLauncherButton';
import AskMyCrew, { AskMyCrewButton } from './components/AskMyCrew';

// Ask MyCrew는 기능 미성숙으로 기본 숨김 — 내부 테스트는 localStorage 'mycrew:askEnabled'='1' 로 활성화.
function isAskEnabled(): boolean {
  try { return localStorage.getItem('mycrew:askEnabled') === '1'; } catch { return false; }
}
import AppHostFrame from './components/Apps/AppHostFrame';
import DetachedChat from './components/Apps/DetachedChat';
import MyCrewFab from './components/MyCrewFab';
import { getManifests, onAppRegistryChanged, type AppManifestClient } from './utils/appRegistry';
import { ensureAppBootstrapped, isAppBootstrapped, markAppBootstrapped } from './utils/appBootstrap';
import AppSetupGuideModal from './components/AppSetupGuideModal';
import { reconcileNavSettingsFromServer } from './utils/storeSync';
import { funnelPing } from './utils/funnel';
import { onOpenAppWithAsset, openAppWithAsset, type AssetHandoff } from './utils/assetHandoff';
import SettingsModal from './components/Settings/SettingsModal';
import { useT } from './i18n/I18nProvider';
import {
  loadNavSettings, resolveVisibleItems, NAV_SETTINGS_CHANGED_EVENT,
  type NavSettings, type PanelId,
} from './utils/navSettings';
import SidebarResizer from './components/SidebarResizer';
import ImageZoomModal from './components/ImageZoomModal';
import ReportViewer from './components/ReportViewer/ReportViewer';
import FileEditorModal from './components/Files/FileEditorModal';
import MeetingDrawer from './components/Meeting/MeetingDrawer';
import TerminalPanel from './components/Terminal/TerminalPanel';
import { useSSE } from './hooks/useSSE';
import { useChat } from './hooks/useChat';
import { useApprovals } from './hooks/useApprovals';
import { useScheduleNotifications } from './hooks/useScheduleNotifications';
import { fetchOnboardingNeeded, fetchGenieStatus, setOwnerAway, sendOwnerActivity, setAutoMode, resolveApproval, loadApprovalToken, fetchChatHistory, fetchStaff, fetchTodos, fetchSchedules, abortGenieResponse, fetchExternalMessages, fetchMe } from './utils/api';
import { flushPendingConsent } from './utils/consent';
import { loadMarked } from './utils/markdown';
import type { ChatMessage, ExternalMessage, MeInfo, ToolApprovalEvent } from './utils/api';
import { ToolApprovalModal } from './components/Services/ToolApprovalModal';
import { useIdleTimer } from './hooks/useIdleTimer';
import LockScreen, { getLockSettings, isLockEnabled, LOCK_SETTINGS_CHANGED_EVENT, LOCK_NOW_EVENT } from './components/Security/LockScreen';
import type { LockSettings } from './components/Security/LockScreen';
import LoginGate, { WarningBanner, getCachedClaudeAuth, setCachedClaudeAuth, getClaudeAuthBypassed, setClaudeAuthBypassed } from './components/Auth/LoginGate';
import NotificationCenter from './components/Notifications/NotificationCenter';
import NotificationBell from './components/Notifications/NotificationBell';
import { useNotificationStore } from './hooks/useNotificationStore';
import { notifications as mantineNotifications } from '@mantine/notifications';
import { loadNotificationSettings } from '../shared/notifications';
import type { Notification as AppNotification } from '../shared/notifications';
import mycrewWordmark from './assets/mycrew-wordmark.png';
import mycrewWordmarkDark from './assets/mycrew-wordmark-dark.png';

const browserId = Math.random().toString(36).slice(2, 10);

// 상단 메뉴 바 버튼. (드래그 정렬 제거 — 모바일 좌우 스와이프 UX 우선. 순서 변경은 설정 화면에서.)
function NavButton({
  label, ariaLabel, active, badgeCount, badgeColor, onClick,
}: {
  label: string;
  ariaLabel: string;
  active: boolean;
  badgeCount: number | null;
  badgeColor: string;
  onClick: () => void;
}) {
  return (
    <button
      className="header-btn"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
    >
      {label}
      {badgeCount !== null && (
        <span className="header-badge" style={{ background: badgeColor }}>{badgeCount}</span>
      )}
    </button>
  );
}

// 업무 뱃지 카운트 — 진행/대기 중인 "활성 업무"만 센다.
// 활성 상태 화이트리스트로 판정한다 → 위임됐으나 relatedJobIds 링크가 비어 있는
// working/reporting 업무도 정확히 포함된다.
//   (이전 구현은 relatedJobIds.length>0 을 요구해서, 진행 중이지만 Job 링크가
//    채워지지 않은 업무가 전부 누락 → 뱃지가 0으로 고정되는 버그가 있었음)
// 제외 대상:
//   - 완료(status==='done')
//   - 자연어 캡처/미위임 TODO: state==='received' 또는 state 미지정/빈값
//     → 화이트리스트에 없으므로 자연히 제외(server/todo-monitor.ts의 "TODO 시스템 항목" 정의와 일치).
const ACTIVE_TODO_STATES = new Set(['delegated', 'plan_review', 'working', 'reporting', 'failed', 'stuck']);
function countActiveTodos(todos: any[]): number {
  return todos.filter((t) => {
    if (t.status === 'done') return false;
    return ACTIVE_TODO_STATES.has(t.state);
  }).length;
}

function App() {
  const t = useT();
  useScheduleNotifications();
  const [lockState, setLockState] = useState<'unlocked' | 'locked'>(() =>
    isLockEnabled() ? 'locked' : 'unlocked'
  );
  const [lockSettings, setLockSettings] = useState<LockSettings>(() => getLockSettings());
  const handleIdle = useCallback(() => {
    if (getLockSettings().enabled) setLockState('locked');
  }, []);
  useIdleTimer(lockSettings.enabled ? lockSettings.timeoutMinutes * 60_000 : 0, handleIdle);

  const [claudeGate, setClaudeGate] = useState<'checking' | 'passed' | 'bypassed'>(() => {
    try {
      if (sessionStorage.getItem('jarvis:claudeAuthOk') === 'true') return 'passed';
      if (sessionStorage.getItem('jarvis:claudeAuthBypassed') === 'true') return 'bypassed';
    } catch {}
    return 'checking';
  });
  const [showClaudeGate, setShowClaudeGate] = useState(false);
  // 첫 설정(온보딩) 전에는 클로드 게이트 건너뛰기 불가 — 미연동 상태로 설정 진입을 막는다.
  const [gateAllowSkip, setGateAllowSkip] = useState(true);
  const gateResolveRef = useRef<((passed: boolean) => void) | null>(null);

  const handleClaudePass = useCallback(() => {
    setCachedClaudeAuth(true);
    setClaudeAuthBypassed(false);
    setClaudeGate('passed');
    setShowClaudeGate(false);
    gateResolveRef.current?.(true);
    gateResolveRef.current = null;
  }, []);

  const handleClaudeBypass = useCallback(() => {
    setClaudeAuthBypassed(true);
    setClaudeGate('bypassed');
    setShowClaudeGate(false);
    gateResolveRef.current?.(false);
    gateResolveRef.current = null;
  }, []);

  const [settingsState, setSettingsState] = useState<{ open: boolean; category?: string }>({ open: false });
  const [askOpen, setAskOpen] = useState(false);
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  // 스토어 설치(optional) 앱 최초 진입 온보딩 — setupGuide 보유 앱은 모달을 먼저 띄우고
  // 닫는 시점에 bootstrap 마킹(1회만 표시), 미보유 앱은 기존대로 즉시 마킹.
  const [setupGuideApp, setSetupGuideApp] = useState<AppManifestClient | null>(null);
  const handleOptionalAppEntered = useCallback((m: AppManifestClient) => {
    if (m.category !== 'optional') return;
    if (m.setupGuide) {
      void isAppBootstrapped('app', m.id).then((done) => { if (!done) setSetupGuideApp(m); });
    } else {
      void ensureAppBootstrapped('app', m.id);
    }
  }, []);

  // 패키지 온보딩: 스토어 SSO 브릿지가 ?onboarding=settings로 되돌리면 설정 화면으로 바로 진입.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('onboarding') === 'settings') {
      setSettingsState({ open: true });
      params.delete('onboarding');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);

  // 앱 딥링크: ?app=<id> 진입 시 해당 앱을 바로 연다 (스토어 유저 메뉴 '구독 관리' → ?app=payment).
  // 앱 레지스트리가 비동기 로드되므로 미발견 시 레지스트리 변경을 구독해 재시도한다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const appId = params.get('app');
    if (!appId) return;
    const tryOpen = () => {
      const m = getManifests().find((x) => x.id === appId);
      if (!m) return false;
      setCurrentApp(m); setPendingAsset(null); setViewMode('photos'); setActivePanel(null);
      handleOptionalAppEntered(m);
      params.delete('app');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
      return true;
    };
    if (tryOpen()) return;
    const off = onAppRegistryChanged(() => { if (tryOpen()) off(); });
    return off;
  }, []);
  const [genieName, setGenieName] = useState('');
  const [ownerName, setOwnerName] = useState(t('app.defaultOwnerName'));
  const [genieBusy, setGenieBusy] = useState(false);
  const [genieBusyStartTime, setGenieBusyStartTime] = useState(0);
  const [ownerAway, setOwnerAwayState] = useState(false);
  const [autoModeOn, setAutoModeOn] = useState(false);
  const [autoCount, setAutoCount] = useState(0);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [navSettings, setNavSettings] = useState<NavSettings>(() => loadNavSettings());
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);   // 태스크 상세 "관련 노트"에서 열 노트 id
  const [viewMode, setViewMode] = useState<'chat' | 'terminal' | 'photos' | 'jarvis'>('chat');
  const [currentApp, setCurrentApp] = useState<AppManifestClient | null>(null);
  const [pendingAsset, setPendingAsset] = useState<AssetHandoff | null>(null);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatContext, setChatContext] = useState<{ view?: string; albumId?: string | null; assetId?: string | null }>({});
  const [me, setMe] = useState<MeInfo | null>(null);
  const [jobModalId, setJobModalId] = useState<string | null>(null);
  const [toolApprovalEvent, setToolApprovalEvent] = useState<ToolApprovalEvent | null>(null);
  const [activeTodoCount, setActiveTodoCount] = useState(0);
  const [todayScheduleCount, setTodayScheduleCount] = useState(0);
  const [staffRefreshKey, setStaffRefreshKey] = useState(0);
  const [busyStaffCount, setBusyStaffCount] = useState(0);
  const [fileViewer, setFileViewer] = useState<{ name: string; raw: string; base?: 'history'; subpath?: string } | null>(null);
  const [fileViewerEditing, setFileViewerEditing] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [genieProgressLog, setGenieProgressLog] = useState<string[]>([]);
  const [genieQueueItems, setGenieQueueItems] = useState<any[]>([]);
  const [jobLogs, setJobLogs] = useState<Record<string, string[]>>({});
  // 외부 인박스
  const [externalMessages, setExternalMessages] = useState<ExternalMessage[]>([]);
  const [inboxVisitedAt, setInboxVisitedAt] = useState<number>(() => {
    try { return Number(localStorage.getItem('jarvis:inboxVisitedAt')) || 0; } catch { return 0; }
  });
  const [highlightExternalMessageId, setHighlightExternalMessageId] = useState<string | null>(null);
  const [externalPartnerHint, setExternalPartnerHint] = useState<string | null>(null);
  // 회의 드로어 → 채팅 첨부 흐름. 클릭 시 ChatInput 첨부 영역에 File 추가.
  const [chatAttachFiles, setChatAttachFiles] = useState<File[]>([]);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('jarvis-sidebar-width'));
      if (Number.isFinite(saved) && saved >= 320) return saved;
    } catch { /* */ }
    return 480;
  });
  const [isMobile, setIsMobile] = useState<boolean>(() => typeof window !== 'undefined' && window.innerWidth <= 768);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const handleSidebarResize = useCallback((next: number) => {
    setSidebarWidth(next);
    try { localStorage.setItem('jarvis-sidebar-width', String(next)); } catch { /* */ }
  }, []);

  const chat = useChat(browserId);
  const approvals = useApprovals();
  const notifStore = useNotificationStore();
  // SSE error 시 서버 재연결 폴링 핸들 — unmount cleanup 위해 ref로 추적 (P2-2).
  const errorPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateBusyStaff = useCallback(() => {
    fetchStaff().then(data => {
      // 서버 bootTime 기록 (SSE 에러 복구 시 재시작 감지용)
      if (data.bootTime) (window as any).__bootTime = data.bootTime;
      let count = 0;
      if (data.genie?.busy) count++;
      for (const t of data.teams || []) {
        if (t.lead?.busy) count++;
        for (const m of t.members || []) { if (m.busy) count++; }
      }
      setBusyStaffCount(count);
    }).catch(() => {});
  }, []);

  // 브라우저 알림 요청
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // 안전망: server SSE 'genie-status' busy:false 누락 시 영구 stuck 방지.
  // genieBusy=true 진입 시 30초 timer. busy=false 진입 시 cleanup. SSE 정상 도착하면 timer 무관하게 풀림.
  useEffect(() => {
    if (!genieBusy) return;
    const t = setTimeout(() => setGenieBusy(false), 30_000);
    return () => clearTimeout(t);
  }, [genieBusy]);

  // 배지 폴링 안전망 — SSE 끊김/이벤트 누락/초기 레이스 시에도 직원·업무 배지가 0에 고착되지 않게
  // 15초마다 /api/staff·/api/todos를 재동기화. (SSE가 정상이면 그 사이 이미 갱신되어 무해)
  useEffect(() => {
    const iv = setInterval(() => {
      updateBusyStaff();
      fetchTodos().then(todos => setActiveTodoCount(countActiveTodos(todos))).catch(() => {});
    }, 15_000);
    return () => clearInterval(iv);
  }, [updateBusyStaff]);

  // 금일 일정 배지 카운트 — 마운트 시 즉시 로드 + 1분마다 갱신.
  useEffect(() => {
    const load = () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
      const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
      fetchSchedules({ from, to }).then(list => setTodayScheduleCount(list.length)).catch(() => {});
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  const notify = useCallback((title: string, body: string) => {
    if (document.hasFocus()) return;
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body: body.slice(0, 100) });
    }
  }, []);

  // 초기 로드
  // 인라인 이미지 클릭 → 줌 모달
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || t.tagName !== 'IMG') return;
      if (!t.closest('.md, .ext-msg-body, .image-zoomable')) return;
      const src = (t as HTMLImageElement).src;
      if (src) setZoomedImage(src);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // mailto 링크 클릭 → 메일 앱 열고 To 필드에 주소 채우기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest('a[href^="mailto:"]') as HTMLAnchorElement | null;
      if (!link) return;
      const email = decodeURIComponent(link.href.replace(/^mailto:/i, '').split('?')[0].trim());
      if (!email) return;
      e.preventDefault();
      openAppWithAsset({ appId: 'mail', kind: 'file', url: '', mailto: email });
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // 대화창 미디어 액션("사진 앱에 저장하기"/"디자인 편집하기"/"영상 편집하기") →
  // 해당 마이크루 앱을 열고, 이미지/영상을 핸드오프 페이로드로 전달.
  useEffect(() => {
    return onOpenAppWithAsset((asset) => {
      const manifest = getManifests().find((m) => m.id === asset.appId);
      if (!manifest) return;
      setCurrentApp(manifest);
      setViewMode('photos');
      setActivePanel(null);
      setPendingAsset(asset);
    });
  }, []);

  useEffect(() => {
    (async () => {
      await loadMarked();
      // 스토어 installed.jsonl → navSettings(hidden) 동기화, fire-and-forget(부팅 흐름 차단 안 함).
      void reconcileNavSettingsFromServer();

      // SSO 게이트: onboarding보다 먼저 확인.
      // SSO 활성(enabled=true)인데 미인증이면 /auth/google로 리디렉션.
      // fetchMe 내부에서 401+{login} 감지 시 이미 리디렉션하므로 여기서는 enabled+!authenticated 체크만.
      let meInfo: MeInfo | null = null;
      try {
        meInfo = await fetchMe();
        if (meInfo.enabled && !meInfo.authenticated) {
          // fetchMe가 리디렉션하지 않은 경우(login 필드 없는 단순 401) 폴백.
          // 패키지 배포본은 로컬 Google 자격증명이 없으므로 온보딩(스토어 SSO)으로.
          window.location.href = '/onboarding';
          return;
        }
        setMe(meInfo);
        // 퍼널(1-4): SSO 로그인 완료(인증된 세션으로 앱 진입).
        if (meInfo.enabled && meInfo.authenticated) funnelPing('sso_done');
      } catch { /* SSO 비활성/네트워크 오류 — SSO 없이 계속 */ }

      // 약관 동의 → SSO → 설정 플로우: SSO 전 /onboarding 동의 페이지가 남긴 동의 선택을 기록.
      // OnboardingView가 /api/consent/status로 동의 단계 스킵을 판단하므로 반드시 그보다 먼저 실행.
      await flushPendingConsent();

      const needed = await fetchOnboardingNeeded();
      // Claude auth 게이트 — 로그인/첫 설정보다 최우선(SSO 활성 환경 포함).
      // 첫 설정(온보딩)이 남아 있으면 클로드 연동 없이 진행할 수 없도록 건너뛰기를 숨긴다.
      if (!getCachedClaudeAuth() && !getClaudeAuthBypassed()) {
        setGateAllowSkip(!needed);
        await new Promise<boolean>((resolve) => { gateResolveRef.current = resolve; });
      }
      if (needed) {
        setOnboarding(true);
        return;
      }
      setOnboarding(false);
      // 퍼널(1-4): 온보딩까지 마치고 대시보드 도달(설치 여정 최종 단계).
      funnelPing('setup_done');
      await loadApprovalToken();
      try {
        const gnRes = await fetch('/api/genie-name');
        const gnData = await gnRes.json();
        if (gnData.name) setGenieName(gnData.name);
      } catch { /* */ }
      try {
        const mpRes = await fetch('/api/genie/my-profile');
        const mpData = await mpRes.json();
        if (mpData?.contactName) setOwnerName(mpData.contactName);
      } catch { /* */ }
      await approvals.load();
      await chat.loadHistory();
      try {
        const status = await fetchGenieStatus();
        setGenieBusy(status.busy);
        if (status.busy && status.startTime) setGenieBusyStartTime(status.startTime);
        setOwnerAwayState(!!status.away);
        setAutoModeOn(!!status.autoMode);
        setAutoCount(status.autoCount ?? 0);
      } catch { /* */ }
      updateBusyStaff();
      // 배지 카운트 초기 로드
      try {
        const todos = await fetchTodos();
        setActiveTodoCount(countActiveTodos(todos));
      } catch { /* */ }
      try {
        const list = await fetchExternalMessages({ limit: 200 });
        setExternalMessages(list);
      } catch { /* */ }
      try {
        const nRes = await fetch('/api/notifications');
        if (nRes.ok) {
          const nData = await nRes.json();
          const items: AppNotification[] = Array.isArray(nData) ? nData : (nData.notifications ?? []);
          for (const n of items) notifStore.addOne(n);
        }
      } catch { /* */ }
    })();
    // 1회 부팅 로드 의도. approvals.load/chat.loadHistory는 의존성에서 의도적 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SSE 이벤트 핸들러
  useSSE({
    'connected': () => {
      console.log('[SSE] 연결됨');
      chat.clearReconnecting();
    },
    'chat-stream': (data: any) => {
      chat.handleStreamChunk(data);
      // 마이크루 텍스트 청크 → 진행 로그에 첫 줄만 (도구 호출이 아닌 텍스트 출력)
      if (data.chunk && !data.chunk.includes('🔧')) {
        const line = data.chunk.replace(/<!--[\s\S]*?-->/g, '').trim();
        if (line && line.length > 3) {
          const ts = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          setGenieProgressLog(prev => {
            const last = prev[prev.length - 1];
            // 중복 방지
            if (last?.endsWith(line.slice(0, 30))) return prev;
            return [...prev.slice(-50), `${ts} 💬 ${line.slice(0, 80)}`];
          });
        }
      }
    },
    'stream-restore': (data: any) => {
      chat.handleStreamRestore(data);
      chat.clearReconnecting();
    },
    'chat': (data: any) => {
      chat.handleChatEvent(data);
      if (data.role === 'genie') notify(genieName, data.content);
    },
    'chat-update': (data: any) => {
      chat.handleChatUpdate(data);
    },
    'owner-away': (data: any) => {
      setOwnerAwayState(data.away);
    },
    'approval-request': (data: any) => {
      approvals.handleRequest(data);
    },
    'approval-resolved': (data: any) => {
      approvals.handleResolved(data);
    },
    'approval-opinion': (data: any) => {
      approvals.handleOpinion(data);
    },
    'job-update': () => {
      fetchTodos().then(todos => setActiveTodoCount(countActiveTodos(todos))).catch(() => {});
      setStaffRefreshKey(k => k + 1);
      updateBusyStaff();
    },
    'todo-update': () => {
      fetchTodos().then(todos => setActiveTodoCount(countActiveTodos(todos))).catch(() => {});
    },
    'job-log': (data: any) => {
      if (data.id && data.line) {
        setJobLogs(prev => {
          const logs = prev[data.id] || [];
          return { ...prev, [data.id]: [...logs.slice(-200), data.line] };
        });
      }
    },
    'external-message': (data: any) => {
      // SSE 페이로드: { op: 'create'|'update', message: ExternalMessage, partner: {id, companyName, contactName} }
      const m = data?.message as ExternalMessage | undefined;
      if (!m) return;
      setExternalMessages(prev => {
        const idx = prev.findIndex(x => x.id === m.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = m;
          return next;
        }
        return [m, ...prev];
      });
      if (m.direction === 'inbound' && data.partner) {
        notify(`${data.partner.companyName} ${data.partner.contactName ?? ''}`.trim(), m.body);
      }
    },
    'staff-change': () => {
      setStaffRefreshKey(k => k + 1);
      updateBusyStaff();
    },
    'genie-queue': (data: any) => {
      setGenieQueueItems(Array.isArray(data) ? data : []);
    },
    'genie-progress': (data: any) => {
      // 도구 호출 = 이전 텍스트 확정 → messages로 flush
      chat.flushStreamText();
      // 모든 기기에서 도구 progress 수신
      chat.setStream(prev => ({ ...prev, progress: data.progress ? `🔧 ${data.progress}` : '' }));
      // 마이크루 진행 로그 수집
      if (data.progress) {
        const ts = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setGenieProgressLog(prev => [...prev.slice(-50), `${ts} ${data.progress}`]);
      }
    },
    'genie-status': (data: any) => {
      setGenieBusy(data.busy);
      if (data.autoMode !== undefined) setAutoModeOn(data.autoMode);
      if (data.autoCount !== undefined) setAutoCount(data.autoCount);
      if (data.busy && data.startTime) {
        setGenieBusyStartTime(data.startTime);
        const ts = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setGenieProgressLog(prev => [...prev.slice(-50), `${ts} ▶ ${t('app.taskStarted')}${data.task ? `: ${data.task}` : ''}`]);
      }
      if (!data.busy) {
        setGenieBusyStartTime(0);
        setGenieProgressLog([]);
      }
      if (data.name) setGenieName(data.name);
      setStaffRefreshKey(k => k + 1);
      updateBusyStaff();
      // busy → idle: 스트림 + progress + RECONNECTING indicator 정리
      if (!data.busy) {
        chat.setStream(prev => prev.active && !chat.loading
          ? { active: false, completed: false, text: '', progress: '', startTime: 0 }
          : { ...prev, progress: '' });
        chat.clearReconnecting();
      }
    },
    'tool-approval': (data: any) => {
      const ev = data as ToolApprovalEvent;
      if (ev.type === 'request') {
        setToolApprovalEvent(ev);
      } else if (ev.type === 'resolved' || ev.type === 'timeout') {
        setToolApprovalEvent(null);
      }
    },
    'job-complete-toast': (data: any) => {
      // 대화 기록에 추가 (별도 toast UI는 없음 — ChatBubble의 JOB_COMPLETE 마커가 렌더)
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'genie',
        content: `<!--JOB_COMPLETE:${JSON.stringify(data)}-->`,
        timestamp: new Date().toISOString(),
      };
      chat.setMessages(prev => [...prev, msg]);
    },
    'notification': (data: any) => {
      const ev = data as { type?: string; notification?: AppNotification };
      const n = ev.notification;
      if (!n) return;
      if (ev.type === 'created') {
        notifStore.addOne(n);
        const settings = loadNotificationSettings();
        if (settings.toast && settings.kinds[n.kind]) {
          mantineNotifications.show({ title: n.title, message: n.body ?? '', autoClose: 5000 });
        }
      } else if (ev.type === 'updated') {
        notifStore.updateOne(n);
      } else if (ev.type === 'deleted') {
        notifStore.removeLocal(n.id);
      }
    },
    'error': () => {
      // 서버 다운 감지 → 복구 시 bootTime 비교로 재시작 여부 판단
      if (errorPollRef.current) return;
      errorPollRef.current = setInterval(() => {
        fetch('/api/staff').then(r => {
          if (r.ok) {
            if (errorPollRef.current) { clearInterval(errorPollRef.current); errorPollRef.current = null; }
            r.json().then((data: any) => {
              if (data.bootTime && data.bootTime !== (window as any).__bootTime) {
                // 서버가 재시작됨 → reload
                location.reload();
              }
              // 네트워크 순단 (같은 서버) → 무시 (SSE 자동 재연결)
            }).catch(() => location.reload());
          }
        }).catch(() => {});
      }, 2000);
    },
  });

  // errorPoll cleanup (SSE 에러 시 서버 복구 감지용)
  useEffect(() => {
    return () => {
      if (errorPollRef.current) { clearInterval(errorPollRef.current); errorPollRef.current = null; }
    };
  }, []);

  const handleApprovalResolve = useCallback(async (id: string, allow: boolean) => {
    try {
      await resolveApproval(id, allow);
    } catch { /* SSE로 처리 */ }
  }, []);

  const handleJobClick = useCallback((jobId: string) => {
    setJobModalId(jobId);
  }, []);

  const handleExternalMessageClick = useCallback((messageId: string, partnerId: string) => {
    setHighlightExternalMessageId(messageId);
    setExternalPartnerHint(partnerId);
    setActivePanel('inbox');
  }, []);

  const handleFileClick = useCallback(async (fp: string) => {
    const ext = fp.split('.').pop()?.toLowerCase();
    if (ext === 'md' || ext === 'txt') {
      const histIdx = fp.indexOf('history/outputs/');
      const projIdx = fp.indexOf('agentTeam/');
      const dlUrl = histIdx >= 0
        ? '/api/files/download/history/' + fp.slice(histIdx + 'history/outputs/'.length)
        : projIdx >= 0
          ? '/api/files/download/projects/' + fp.slice(projIdx)
          : null;
      if (!dlUrl) return;
      try {
        const res = await fetch(dlUrl);
        if (!res.ok) return;
        const text = await res.text();
        const subpath = histIdx >= 0 ? fp.slice(histIdx + 'history/outputs/'.length) : undefined;
        setFileViewer({ name: fp.split('/').pop() || fp, raw: text, base: subpath ? 'history' : undefined, subpath });
      } catch { /* */ }
    }
  }, []);

  // 대화창 md 모달 리사이즈 크기 영속
  // rAF로 ResizeObserver 등록을 크기 복원 후 한 틱 뒤로 미뤄 레이스 컨디션 차단.
  useEffect(() => {
    if (!fileViewer) return;
    let ro: ResizeObserver | null = null;
    let rafId: number | null = null;
    const t = setTimeout(() => {
      const el = document.querySelector('.modal-resizable-chat-md') as HTMLElement | null;
      if (!el) return;
      // 1) 이전 크기 복원
      const saved = sessionStorage.getItem('jarvis:chatMdModalSize');
      if (saved) {
        try {
          const { w, h } = JSON.parse(saved);
          if (typeof w === 'number' && typeof h === 'number') {
            el.style.width = Math.min(w, window.innerWidth * 0.95) + 'px';
            el.style.height = Math.min(h, window.innerHeight * 0.95) + 'px';
          }
        } catch { /* */ }
      }
      // 2) rAF 한 틱 뒤에 ResizeObserver 등록 — 복원된 크기가 레이아웃에 반영된 후부터 관찰
      rafId = requestAnimationFrame(() => {
        const el2 = document.querySelector('.modal-resizable-chat-md') as HTMLElement | null;
        if (!el2) return;
        ro = new ResizeObserver(() => {
          sessionStorage.setItem('jarvis:chatMdModalSize', JSON.stringify({ w: el2.offsetWidth, h: el2.offsetHeight }));
        });
        ro.observe(el2);
      });
    }, 50);
    return () => { clearTimeout(t); if (rafId !== null) cancelAnimationFrame(rafId); ro?.disconnect(); };
  }, [fileViewer]);

  const togglePanel = useCallback((panel: string) => {
    setActivePanel(prev => prev === panel ? null : panel);
  }, []);

  // inbox(동료) 패널 진입 시 visitedAt 갱신 → 배지 즉시 0으로
  useEffect(() => {
    if (activePanel === 'inbox') {
      const now = Date.now();
      setInboxVisitedAt(now);
      try { localStorage.setItem('jarvis:inboxVisitedAt', String(now)); } catch { /* */ }
    }
  }, [activePanel]);

  // 미확인 메시지를 가진 동료 수 (메시지 수가 아님) — inbox 진입(visitedAt) 이후 수신분만 카운트
  // auto_handled 포함: 마이크루가 자동 응답해도 사용자가 inbox 미방문이면 미확인으로 간주.
  const externalUnread = useMemo(() => {
    const partnerIds = new Set(
      externalMessages
        .filter(m => (m.status === 'awaiting_approval' || m.status === 'received' || m.status === 'auto_handled') && m.direction === 'inbound' && new Date(m.receivedAt).getTime() > inboxVisitedAt)
        .map(m => m.partnerId)
    );
    return partnerIds.size;
  }, [externalMessages, inboxVisitedAt]);

  // 메뉴 설정 동기화 — 설정 화면(다른 컴포넌트)·다른 탭에서 변경 시 헤더 즉시 반영.
  useEffect(() => {
    const reload = () => setNavSettings(loadNavSettings());
    window.addEventListener(NAV_SETTINGS_CHANGED_EVENT, reload);
    window.addEventListener('storage', reload);
    window.addEventListener('jarvis:open-notes', () => setActivePanel('notes'));
    return () => {
      window.removeEventListener(NAV_SETTINGS_CHANGED_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, []);

  // 잠금 설정 변경 + 즉시 잠금 이벤트 수신
  useEffect(() => {
    const reloadLock = () => setLockSettings(getLockSettings());
    const lockNow = () => { if (getLockSettings().enabled) setLockState('locked'); };
    window.addEventListener(LOCK_SETTINGS_CHANGED_EVENT, reloadLock);
    window.addEventListener(LOCK_NOW_EVENT, lockNow);
    return () => {
      window.removeEventListener(LOCK_SETTINGS_CHANGED_EVENT, reloadLock);
      window.removeEventListener(LOCK_NOW_EVENT, lockNow);
    };
  }, []);

  useEffect(() => {
    if (!isMobile || !activePanel) return;
    const el = document.querySelector<HTMLElement>('.header-btns [aria-pressed="true"]');
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activePanel, isMobile]);

  const toggleAway = useCallback(async () => {
    const next = !ownerAway;
    await setOwnerAway(next);
    setOwnerAwayState(next);
  }, [ownerAway]);

  // 활동 하트비트 — 실제 조작(포인터/키 입력)이 있고 탭이 보일 때만 60초 스로틀로 전송.
  // 자동 폴링은 신호로 치지 않으므로 유휴 감지를 오염시키지 않는다.
  useEffect(() => {
    let lastSent = 0;
    const HEARTBEAT_MS = 60_000;
    const onInteract = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastSent < HEARTBEAT_MS) return;
      lastSent = now;
      void sendOwnerActivity().then((r) => {
        // 서버가 자동 재석 복귀했으면 헤더 배지 즉시 동기화 (SSE로도 오지만 즉각 반영)
        if (r && typeof r.away === 'boolean') setOwnerAwayState(r.away);
      });
    };
    window.addEventListener('pointerdown', onInteract);
    window.addEventListener('keydown', onInteract);
    return () => {
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('keydown', onInteract);
    };
  }, []);

  const toggleAutoMode = useCallback(async () => {
    const next = !autoModeOn;
    await setAutoMode(next);
    setAutoModeOn(next);
  }, [autoModeOn]);

  // 온보딩 화면
  if (onboarding === null) {
    if (claudeGate === 'checking') {
      return <LoginGate onPass={handleClaudePass} onBypass={handleClaudeBypass} allowSkip={gateAllowSkip} />;
    }
    return null; // 로딩 중
  }
  if (onboarding) {
    return <OnboardingView onComplete={() => setOnboarding(false)} />;
  }

  const navVisibleItems = resolveVisibleItems(navSettings);
  const navBadgeFor = (id: PanelId): { count: number; color: string } | null => {
    if (id === 'todos') return { count: activeTodoCount, color: activeTodoCount > 0 ? '#6366F1' : '#7D8699' };
    if (id === 'inbox') return externalUnread > 0 ? { count: externalUnread, color: '#6366F1' } : null;
    if (id === 'staff') return { count: busyStaffCount, color: busyStaffCount > 0 ? '#6366F1' : '#7D8699' };
    if (id === 'schedules') return todayScheduleCount > 0 ? { count: todayScheduleCount, color: '#6366F1' } : null;
    if (id === 'notifications') return notifStore.unreadCount > 0 ? { count: notifStore.unreadCount, color: '#6366F1' } : null;
    return null;
  };

  // 알림 딥링크 공용 핸들러 — panel='apps'는 해당 앱으로 전환, 그 외 panel은 대시보드 사이드 패널.
  // 사이드 패널은 앱 화면(photos)에서 렌더링되지 않으므로 대시보드로 복귀 후 연다.
  // deepLink.route는 AppHostFrame에 초기 라우트 전달 수단이 없어 미지원(앱 홈으로 진입).
  const handleNotificationDeepLink = (item: AppNotification) => {
    const dl = item.deepLink;
    if (!dl) return;
    if (dl.panel === 'settings') {
      // 업데이트 알림 등 — 설정 모달의 해당 카테고리(route, 기본 general)로 이동
      setSettingsState({ open: true, category: dl.route ?? 'general' });
      return;
    }
    if (dl.panel === 'apps') {
      if (!dl.appId) return;
      const m = getManifests().find((x) => x.id === dl.appId);
      if (!m) return;
      setCurrentApp(m); setPendingAsset(null); setViewMode('photos'); setActivePanel(null);
      handleOptionalAppEntered(m);
      return;
    }
    if (dl.panel) {
      setViewMode('chat'); setCurrentApp(null); setChatVisible(false);
      setActivePanel(dl.panel);
    }
  };

  return (
    <>
      {claudeGate === 'bypassed' && !showClaudeGate && (
        <WarningBanner onSettings={() => setShowClaudeGate(true)} />
      )}
      {showClaudeGate && (
        <LoginGate onPass={handleClaudePass} onBypass={() => setShowClaudeGate(false)} />
      )}
      <header className="header">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="app-logo-button"
              onClick={() => { setViewMode('chat'); setCurrentApp(null); setChatVisible(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewMode('chat'); setCurrentApp(null); setChatVisible(false); } }}
              title={t('app.toChat')}
            >
              <img src={mycrewWordmark} alt="MyCrew" className="logo-light" />
              <img src={mycrewWordmarkDark} alt="MyCrew" className="logo-dark" />
            </button>
            <span style={{ display: 'inline-block', width: '1.2em' }}>{genieBusy ? '💬' : ''}</span>
          </span>
          {viewMode !== 'photos' && (
          <span style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
            <button onClick={toggleAway} title={ownerAway ? t('app.toAttend') : t('app.toAway')} style={{ background: ownerAway ? 'color-mix(in srgb, var(--accent-danger) 20%, transparent)' : 'color-mix(in srgb, var(--accent-success) 20%, transparent)', border: `1px solid ${ownerAway ? 'var(--accent-danger)' : 'var(--accent-success)'}`, color: ownerAway ? 'var(--accent-danger)' : 'var(--accent-success)', padding: '1px 8px', borderRadius: 10, fontSize: 'var(--font-s)', cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: ownerAway ? 'var(--accent-danger)' : 'var(--accent-success)', display: 'inline-block' }} />
              {ownerAway ? t('app.away') : t('app.attend')}
            </button>
            <button onClick={toggleAutoMode} title={autoModeOn ? t('app.autoTitleOn') : t('app.autoTitleOff')} style={{ background: autoModeOn ? '#6366F133' : '#7D869933', border: `1px solid ${autoModeOn ? '#6366F1' : '#7D8699'}`, color: autoModeOn ? '#6366F1' : '#7D8699', padding: '1px 8px', borderRadius: 10, fontSize: 'var(--font-s)', cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: autoModeOn ? '#6366F1' : '#7D8699', display: 'inline-block' }} />
              {autoModeOn ? t('app.auto') : t('app.manual')}{autoModeOn && autoCount > 0 ? ` ${autoCount}` : ''}
            </button>
            {/* 3모드 탭: 채팅 · 터미널 · Voice — 토글 2개를 세그먼트 탭으로 통합 */}
            <span style={{ display: 'inline-flex', border: '1px solid var(--accent-info, #818CF8)', borderRadius: 10, overflow: 'hidden' }}>
              {([['chat', t('app.chat')], ['terminal', t('app.terminal')], ['jarvis', t('app.jarvis')]] as ['chat' | 'terminal' | 'jarvis', string][]).map(([m, label]) => (
                <button key={m} onClick={() => setViewMode(m)} title={label}
                  style={{ background: viewMode === m ? 'color-mix(in srgb, var(--accent-info, #818CF8) 25%, transparent)' : 'transparent', border: 'none', color: viewMode === m ? 'var(--accent-info, #818CF8)' : 'var(--text-muted, #7D8699)', padding: '1px 8px', fontSize: 'var(--font-s)', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: viewMode === m ? 600 : 400 }}>
                  {label}
                </button>
              ))}
            </span>
          </span>
          )}
        </h1>
        <div className="header-btns">
          {viewMode !== 'photos' && navVisibleItems.map((item) => {
            const badge = navBadgeFor(item.id);
            const label = t(item.labelKey);
            return (
              <NavButton
                key={item.id}
                label={label}
                ariaLabel={t('app.panelToggle', { name: label })}
                active={activePanel === item.id}
                badgeCount={badge ? badge.count : null}
                badgeColor={badge ? badge.color : '#7D8699'}
                onClick={() => togglePanel(item.id)}
              />
            );
          })}
        </div>
        <div className="header-btns-end">
          {/* 알림 벨은 앱 화면에서만 — 대시보드에는 알림 플러그인 버튼이 이미 있음 */}
          {viewMode === 'photos' && (
            <NotificationBell
              items={notifStore.items}
              unreadCount={notifStore.unreadCount}
              onMarkRead={notifStore.markRead}
              onMarkAllRead={notifStore.markAllRead}
              onRemove={notifStore.removeOne}
              onOpenSettings={() => setSettingsState({ open: true, category: 'notifications' })}
              onDeepLink={handleNotificationDeepLink}
            />
          )}
          {isAskEnabled() && <AskMyCrewButton onClick={() => setAskOpen(true)} />}
          <AppLauncherButton
            onEnterApp={(m) => {
              setCurrentApp(m); setPendingAsset(null); setViewMode('photos'); setActivePanel(null);
              // 스토어 Phase4: core(내장) 앱은 제외, optional(3rd-party/설치형) 앱만 최초 진입 부트스트랩.
              handleOptionalAppEntered(m);
            }}
          />
          <ProfileMenu
            name={me?.name}
            email={me?.email}
            picture={me?.picture}
            onOpenSettings={() => setSettingsState({ open: true })}
            showLogout={!!(me?.enabled && me?.authenticated)}
          />
        </div>
      </header>
      <div className="main">
        {viewMode === 'terminal' && (
          <TerminalPanel key="terminal" wsPath="/ws/terminal" messages={chat.messages} />
        )}
        {viewMode === 'jarvis' && (
          <JarvisView
            key='jarvis'
            genieName={genieName}
            ownerName={ownerName}
            messages={chat.messages}
            stream={chat.stream}
            onExit={() => setViewMode('chat')}
          />
        )}
        {viewMode === 'photos' && currentApp && (
          <AppHostFrame
            manifest={currentApp}
            onReturn={() => { setViewMode('chat'); setCurrentApp(null); setPendingAsset(null); setChatVisible(false); }}
            onChatOpenRequest={(ctx) => { setChatContext(ctx); setChatVisible(true); }}
            onChatCloseRequest={() => setChatVisible(false)}
            pendingAsset={pendingAsset}
            onAssetDelivered={() => setPendingAsset(null)}
            onNavigate={(to) => { if (to === '/settings') setSettingsState({ open: true }); else if (to === '/admin') setSettingsState({ open: true, category: 'security' }); }}
          />
        )}
        <div style={{ display: viewMode === 'chat' ? 'flex' : 'none', flex: 1, minWidth: 0 }}>
        <ChatPanel
          genieName={genieName}
          ownerName={ownerName}
          messages={chat.messages}
          stream={chat.stream}
          loading={chat.loading}
          sendDisabled={false}
          busyStartTime={genieBusyStartTime || undefined}
          approvals={{
            pending: approvals.pending,
            resolved: approvals.resolved,
            opinions: approvals.opinions,
          }}
          onSend={async (msg, files) => {
            await chat.send(msg, files);
            // busy 상태는 SSE genie-status에만 의존 — 클라이언트에서 직접 관리 안 함
          }}
          onAbort={() => { abortGenieResponse(); }}
          onApprovalResolve={handleApprovalResolve}
          onJobClick={handleJobClick}
          onFileClick={handleFileClick}
          onExternalMessageClick={handleExternalMessageClick}
          externalAttachFiles={chatAttachFiles}
          onConsumeAttachFiles={() => setChatAttachFiles([])}
        />
        </div>
        {viewMode !== 'photos' && (
        <div
          className={`side-container${activePanel ? ' open' : ''}${activePanel === 'inbox' ? ' wide-inbox' : ''}`}
          style={activePanel && !isMobile ? { width: sidebarWidth, position: 'relative' } : undefined}
        >
          {activePanel && !isMobile && <SidebarResizer onResize={handleSidebarResize} />}
          <StaffPanel visible={activePanel === 'staff'} onClose={() => setActivePanel(null)} refreshKey={staffRefreshKey} genieProgressLog={genieProgressLog} genieQueueItems={genieQueueItems} jobLogs={jobLogs} genieBusy={genieBusy} ownerName={ownerName} />
          <TodoPanel
            visible={activePanel === 'todos'}
            onClose={() => setActivePanel(null)}
            onStartTodo={(msg) => { void chat.send(msg); }}
            onJobClick={handleJobClick}
            onOpenNote={(noteId) => { setPendingNoteId(noteId); setActivePanel('notes'); }}
          />
          <FilesPanel visible={activePanel === 'files'} onClose={() => setActivePanel(null)} />
          <InboxPanel
            visible={activePanel === 'inbox'}
            onClose={() => setActivePanel(null)}
            injectedMessages={externalMessages}
            onMessagesUpdate={setExternalMessages}
            highlightMessageId={highlightExternalMessageId}
            selectedPartnerHint={externalPartnerHint}
            onAfterAction={() => { fetchExternalMessages({ limit: 200 }).then(setExternalMessages).catch(() => {}); }}
          />
          <CostsPanel visible={activePanel === 'costs'} onClose={() => setActivePanel(null)} />
          <SchedulesPanel visible={activePanel === 'schedules'} onClose={() => setActivePanel(null)} />
          <ContactsPanel visible={activePanel === 'contacts'} onClose={() => setActivePanel(null)} />
          <NotificationCenter
            visible={activePanel === 'notifications'}
            items={notifStore.items}
            onMarkRead={notifStore.markRead}
            onMarkAllRead={notifStore.markAllRead}
            onRemove={notifStore.removeOne}
            onOpenSettings={() => setSettingsState({ open: true, category: 'notifications' })}
            onClose={() => setActivePanel(null)}
            onDeepLink={handleNotificationDeepLink}
          />
          <ErrorBoundary
            fallback={(_err, reset) => (
              activePanel === 'notes' ? (
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 'var(--font-s)', color: 'var(--accent-danger)' }}>{t('notes.panelError')}</span>
                  <button className="header-btn" onClick={reset}>{t('notes.retry')}</button>
                </div>
              ) : null
            )}
          >
            <NotesPanel
        visible={activePanel === 'notes'}
        onClose={() => setActivePanel(null)}
        openNoteId={pendingNoteId}
        onConsumeOpenNote={() => setPendingNoteId(null)}
        onOpenEntity={(kind) => {
          if (kind === 'event') setActivePanel('schedules');
          else if (kind === 'task') setActivePanel('todos');
        }}
      />
          </ErrorBoundary>
          <ErrorBoundary
            fallback={(err, reset) => (
              activePanel === 'meeting' ? (
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 'var(--font-s)', color: 'var(--accent-danger)' }}>
                    {t('app.meetingPanelError', { msg: err.message.slice(0, 200) })}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="header-btn" onClick={reset}>{t('notes.retry')}</button>
                    <button className="header-btn" onClick={() => setActivePanel(null)}>{t('common.close')}</button>
                  </div>
                </div>
              ) : null
            )}
          >
            <MeetingDrawer
              visible={activePanel === 'meeting'}
              onClose={() => setActivePanel(null)}
              onAttachToChat={(files) => {
                setChatAttachFiles((prev) => [...prev, ...files]);
                setActivePanel(null);
              }}
            />
          </ErrorBoundary>
        </div>
        )}
      </div>
      {viewMode === 'photos' && (
        <MyCrewFab position="right-bottom">
          <ChatPanel
            genieName={genieName}
            ownerName={ownerName}
            messages={chat.messages}
            stream={chat.stream}
            loading={chat.loading}
            sendDisabled={false}
            busyStartTime={genieBusyStartTime || undefined}
            approvals={{
              pending: approvals.pending,
              resolved: approvals.resolved,
              opinions: approvals.opinions,
            }}
            onSend={async (msg, files) => { await chat.send(msg, files); }}
            onAbort={() => { abortGenieResponse(); }}
            onApprovalResolve={handleApprovalResolve}
            onJobClick={handleJobClick}
            onFileClick={handleFileClick}
            onExternalMessageClick={handleExternalMessageClick}
          />
        </MyCrewFab>
      )}
      {jobModalId && <JobResultModal jobId={jobModalId} onClose={() => setJobModalId(null)} />}
      <ToolApprovalModal event={toolApprovalEvent} onClose={() => setToolApprovalEvent(null)} />
      <SettingsModal opened={settingsState.open} onClose={() => setSettingsState({ open: false })} initialCategory={settingsState.category} onOpenStaff={() => setActivePanel('staff')} />
      {setupGuideApp && (
        <AppSetupGuideModal
          app={setupGuideApp}
          onClose={() => {
            void markAppBootstrapped('app', setupGuideApp.id);
            setSetupGuideApp(null);
          }}
          onOpenIntegrations={() => {
            void markAppBootstrapped('app', setupGuideApp.id);
            setSetupGuideApp(null);
            setSettingsState({ open: true, category: 'keys' });
          }}
        />
      )}
      {isAskEnabled() && <AskMyCrew opened={askOpen} onClose={() => setAskOpen(false)} />}
      <ImageZoomModal src={zoomedImage} onClose={() => setZoomedImage(null)} />
      <Modal
        opened={!!fileViewer && !fileViewerEditing}
        onClose={() => { setFileViewer(null); setFileViewerEditing(false); }}
        title={fileViewer?.name}
        size="auto"
        centered
        scrollAreaComponent={ScrollArea.Autosize}
        classNames={{ content: 'modal-resizable modal-resizable-chat-md' }}
        overlayProps={{ backgroundOpacity: 0.8, blur: 2 }}
      >
        {fileViewer && (
          <ReportViewer
            raw={fileViewer.raw}
            fontSize="s"
            fileName={fileViewer.name}
            editable={!!fileViewer.subpath}
            onEdit={() => setFileViewerEditing(true)}
          />
        )}
      </Modal>
      {fileViewer?.subpath && fileViewerEditing && (
        <FileEditorModal
          open={fileViewerEditing}
          base="history"
          subpath={fileViewer.subpath}
          displayName={fileViewer.name}
          onClose={() => { setFileViewerEditing(false); setFileViewer(null); }}
          onSaved={() => { setFileViewerEditing(false); setFileViewer(null); }}
        />
      )}
      {lockState === 'locked' && (
        <LockScreen
          mode={lockSettings.mode}
          onUnlock={() => setLockState('unlocked')}
        />
      )}
      <DetachedChat
        visible={chatVisible && viewMode === 'photos'}
        onClose={() => setChatVisible(false)}
        context={chatContext}
      />
    </>
  );
}

export default App;
