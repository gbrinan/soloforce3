"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ActionIcon } from "@mantine/core";
import { IconMenu2 } from "@tabler/icons-react";
import { createNote, deleteNote, listNotes, saveNote, type Note } from "@/lib/storage";
import { useI18n } from "@/lib/i18n";
import NoteList from "@/components/NoteList";
import NoteEditor from "@/components/NoteEditor";

const LIST_WIDTH_KEY = "notes:listWidth";
const SIDEBAR_COLLAPSE_KEY = "notes.sidebarCollapsed";
const MIN_LIST_WIDTH = 200;
const MAX_LIST_WIDTH = 600;
const DEFAULT_LIST_WIDTH = 280;

function clampListWidth(w: number): number {
  return Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, w));
}

export default function NotesPage() {
  const { t } = useI18n();
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const resizingRef = useRef(false);

  useEffect(() => {
    listNotes().then((loadedNotes) => {
      setNotes(loadedNotes);
      setActiveId(loadedNotes[0]?.id ?? null);
      setLoaded(true);
    });
    const saved = Number(localStorage.getItem(LIST_WIDTH_KEY));
    if (saved) setListWidth(clampListWidth(saved));
    const savedCollapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    if (savedCollapsed !== null) {
      setCollapsed(savedCollapsed === "1");
    } else if (window.innerWidth <= 768) {
      // 저장된 선호도 없으면 모바일 폭에서 기본 접힘 — 좁은 화면에서 편집 영역 확보
      setCollapsed(true);
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  // 화면 회전 등 폭 변경 시 재계산 — 사용자가 명시적으로 토글한 적 없을 때만 자동 적용
  useEffect(() => {
    const handleResize = () => {
      if (localStorage.getItem(SIDEBAR_COLLAPSE_KEY) !== null) return;
      setCollapsed(window.innerWidth <= 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 리사이저 드래그는 리스트/에디터 바깥(window)까지 움직일 수 있어 window 리스너로 처리한다.
  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (!resizingRef.current) return;
      setListWidth(clampListWidth(e.clientX));
    };
    const handleMouseUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setListWidth((w) => {
        localStorage.setItem(LIST_WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const active = notes.find((n) => n.id === activeId) ?? null;

  const handleCreate = async () => {
    const minOrder = notes.length ? Math.min(...notes.map((n) => n.order ?? 0)) : 0;
    const note = createNote(minOrder - 1, t("note.untitled"));
    await saveNote(note);
    setNotes((prev) => [note, ...prev]);
    setActiveId(note.id);
  };

  const handleDelete = async (id: string) => {
    await deleteNote(id);
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  };

  const handleChange = (patch: Partial<Note>) => {
    if (!active) return;
    const updated = { ...active, ...patch, updatedAt: Date.now() };
    setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    void saveNote(updated);
  };

  const handleReorder = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setNotes((prev) => {
      const sorted = [...prev].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const fromIdx = sorted.findIndex((n) => n.id === draggedId);
      const toIdx = sorted.findIndex((n) => n.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = sorted.splice(fromIdx, 1);
      sorted.splice(toIdx, 0, moved);
      const reordered = sorted.map((n, i) => ({ ...n, order: i }));
      reordered.forEach((n) => void saveNote(n));
      return reordered;
    });
  };

  const handleResizerMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  if (!loaded) return null;

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {!collapsed && (
        <div style={{ width: listWidth, flexShrink: 0, overflow: "hidden" }}>
          <NoteList
            notes={notes}
            activeId={activeId}
            onSelect={setActiveId}
            onCreate={handleCreate}
            onDelete={handleDelete}
            onReorder={handleReorder}
          />
        </div>
      )}
      {!collapsed && (
        <div
          onMouseDown={handleResizerMouseDown}
          style={{ width: 4, cursor: "col-resize", background: "#1B2740", flexShrink: 0 }}
        />
      )}
      <div
        style={{
          width: 36,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 12,
          borderRight: "1px solid #1B2740",
        }}
      >
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={toggleCollapsed}
          aria-label={collapsed ? t("page.sidebar.expand") : t("page.sidebar.collapse")}
        >
          <IconMenu2 size={16} />
        </ActionIcon>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {active ? (
          <NoteEditor note={active} onChange={handleChange} />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#7D8699" }}>
            {t("page.emptyEditor")}
          </div>
        )}
      </div>
    </div>
  );
}
