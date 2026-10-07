"use client";

import { useState } from "react";
import { ActionIcon, ScrollArea, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconPlus, IconDotsVertical, IconMail, IconTrash } from "@tabler/icons-react";
import { plainTextFromHtml, type Note } from "@/lib/storage";
import { useI18n } from "@/lib/i18n";

interface NoteListProps {
  notes: Note[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onReorder: (draggedId: string, targetId: string) => void;
}

// 마이크루 채팅창(ChatPanel/ChatInput)이 인식하는 공용 MIME.
// 같은 카드에서 리스트 내부 순서변경 MIME과 함께 세팅해 drop target이 의도를 판별한다.
const ATTACH_MIME = "application/x-mycrew-attachment";
const REORDER_MIME = "application/x-mycrew-note-reorder";

export default function NoteList({ notes, activeId, onSelect, onCreate, onDelete, onReorder }: NoteListProps) {
  const { t } = useI18n();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const handleMailNote = (n: Note) => {
    const body = plainTextFromHtml(n.content);
    const mailto = `mailto:?subject=${encodeURIComponent(n.title || t("note.untitled"))}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    setOpenMenuId(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", borderRight: "1px solid #1B2740" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px" }}>
        <Text fw={700}>{t("list.title")}</Text>
        <ActionIcon variant="filled" color="dark" onClick={onCreate} aria-label={t("list.new")}>
          <IconPlus size={16} />
        </ActionIcon>
      </div>
      <ScrollArea style={{ flex: 1 }}>
        <Stack gap={0} px="xs">
          {notes.map((n) => (
            <UnstyledButton
              key={n.id}
              onClick={() => onSelect(n.id)}
              draggable
              onDragStart={(e) => {
                const plainText = plainTextFromHtml(n.content);
                const attachment = { type: "note", name: n.title || t("note.untitled"), content: plainText };
                e.dataTransfer.setData(ATTACH_MIME, JSON.stringify(attachment));
                e.dataTransfer.setData(REORDER_MIME, n.id);
                e.dataTransfer.setData("text/plain", plainText);
                e.dataTransfer.effectAllowed = "copyMove";
                try {
                  window.parent?.postMessage({ source: "mycrew-notes", type: "drag.start", payload: { attachment } }, "*");
                } catch { /* silent */ }
              }}
              onDragEnd={() => {
                try {
                  window.parent?.postMessage({ source: "mycrew-notes", type: "drag.end" }, "*");
                } catch { /* silent */ }
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(REORDER_MIME)) e.preventDefault();
              }}
              onDrop={(e) => {
                const draggedId = e.dataTransfer.getData(REORDER_MIME);
                if (draggedId) {
                  e.preventDefault();
                  onReorder(draggedId, n.id);
                }
              }}
              p="sm"
              style={{
                borderRadius: 10,
                background: n.id === activeId ? "#1B2740" : "transparent",
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                position: "relative",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text fw={600} size="sm" truncate>{n.title || t("note.untitled")}</Text>
                <Text size="xs" c="dimmed" truncate>{plainTextFromHtml(n.content).slice(0, 60) || t("list.noContent")}</Text>
              </div>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === n.id ? null : n.id);
                }}
                aria-label={t("list.more")}
              >
                <IconDotsVertical size={14} />
              </ActionIcon>
              {openMenuId === n.id && (
                <>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(null);
                    }}
                    style={{ position: "fixed", inset: 0, zIndex: 10 }}
                  />
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute",
                      top: 32,
                      right: 8,
                      background: "#151F32",
                      border: "1px solid #1F293D",
                      borderRadius: 10,
                      padding: 4,
                      zIndex: 11,
                      minWidth: 140,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                    }}
                  >
                    <UnstyledButton
                      onClick={() => handleMailNote(n)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, width: "100%", fontSize: 14 }}
                    >
                      <IconMail size={14} /> {t("list.mail")}
                    </UnstyledButton>
                    <UnstyledButton
                      onClick={() => {
                        setOpenMenuId(null);
                        const label = n.title?.trim() || t("note.untitled");
                        if (window.confirm(t("list.deleteConfirm", { title: label }))) {
                          onDelete(n.id);
                        }
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, width: "100%", fontSize: 14, color: "#F87171" }}
                    >
                      <IconTrash size={14} /> {t("list.delete")}
                    </UnstyledButton>
                  </div>
                </>
              )}
            </UnstyledButton>
          ))}
          {notes.length === 0 && (
            <Text size="sm" c="dimmed" p="sm">{t("list.empty")}</Text>
          )}
        </Stack>
      </ScrollArea>
    </div>
  );
}
