"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Box, Drawer } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import MailFab from "@/components/MailFab";
import MailSidebar from "@/components/sidebar/MailSidebar";
import MailListPanel from "@/components/list/MailListPanel";
import MailContentPanel from "@/components/reader/MailContentPanel";
import ComposeModal, { type ComposeContext } from "@/components/compose/ComposeModal";
import MailboxManagementScreen from "@/components/admin/MailboxManagementScreen";
import SettingsScreen from "@/components/settings/SettingsScreen";
import { apiUrl } from "@/lib/api-url";
import { useI18n } from "@/lib/i18n";
import { uploadAttachment } from "@/lib/upload-attachment";
import { postReadyToHost, subscribeHost } from "@/lib/host-bridge";
import type { Mail, Mailbox, MailFolder, MailCategory, MailImportance } from "@/types/mail";

type AppView = "mail" | "mailboxes" | "settings";

const EMPTY_UNREAD: Record<MailFolder, number> = {
  inbox: 0, sent: 0, draft: 0, starred: 0, spam: 0, trash: 0,
};

export default function MailPage() {
  const { t } = useI18n();
  const [mails, setMails] = useState<Mail[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<MailFolder>("inbox");
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(null);
  const [selectedMailId, setSelectedMailId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeContext, setComposeContext] = useState<ComposeContext | null>(null);
  const [appView, setAppView] = useState<AppView>("mail");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'content'>('list');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const loadMails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedMailboxId) params.set("mailboxId", selectedMailboxId);
      params.set("folder", selectedFolder);
      const res = await fetch(apiUrl(`/api/mails?${params.toString()}`));
      if (res.ok) {
        setMails((await res.json()) as Mail[]);
      } else {
        notifications.show({ color: "red", title: t("page.loadFailTitle"), message: t("page.loadFailServer", { status: res.status }) });
      }
    } catch {
      notifications.show({ color: "red", title: t("page.loadFailTitle"), message: t("page.loadFailNetwork") });
    } finally {
      setLoading(false);
    }
  }, [selectedFolder, selectedMailboxId]);

  const loadMailboxes = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/mailboxes"));
      if (res.ok) setMailboxes((await res.json()) as Mailbox[]);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => { void loadMails(); }, [loadMails]);
  useEffect(() => { void loadMailboxes(); }, [loadMailboxes]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => { setIsMobile(e.matches); if (!e.matches) setMobileView('list'); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const unsub = subscribeHost({
      onAsset: (asset) => {
        void (async () => {
          try {
            const res = await fetch(asset.url);
            if (!res.ok) throw new Error(`fetch asset ${res.status}`);
            const blob = await res.blob();
            const name = asset.name || asset.url.split("/").pop()?.split("?")[0] || "attachment";
            const att = await uploadAttachment(blob, name);
            setComposeContext({ mode: "new", attachments: [att] });
            setComposing(true);
          } catch {
            notifications.show({ color: "red", message: t("page.attachmentLoadFail") });
          }
        })();
      },
      onMailto: (email) => {
        setComposeContext({ mode: "new", to: [email] });
        setComposing(true);
      },
      onAssets: (assets) => {
        void (async () => {
          try {
            const attachments = await Promise.all(assets.map(async (asset) => {
              const res = await fetch(asset.url);
              if (!res.ok) throw new Error(`fetch asset ${res.status}`);
              const blob = await res.blob();
              const name = asset.name || asset.url.split("/").pop()?.split("?")[0] || "attachment";
              return uploadAttachment(blob, name);
            }));
            setComposeContext({ mode: "new", attachments });
            setComposing(true);
          } catch {
            notifications.show({ color: "red", message: t("page.attachmentLoadFail") });
          }
        })();
      },
    });
    postReadyToHost(mails.filter((m) => !m.read && m.folder === "inbox").length);
    return unsub;
  }, [mails]);

  // Reset selected mail on folder change
  useEffect(() => { setSelectedMailId(null); setMobileView('list'); }, [selectedFolder, selectedMailboxId]);

  const unreadCounts = mails.reduce<Record<MailFolder, number>>(
    (acc, m) => {
      if (!m.read) acc[m.folder] = (acc[m.folder] ?? 0) + 1;
      if (!m.read && m.starred) acc.starred = (acc.starred ?? 0) + 1;
      return acc;
    },
    { ...EMPTY_UNREAD },
  );

  const selectedMail = mails.find((m) => m.id === selectedMailId) ?? null;

  function openCompose(mode: ComposeContext["mode"], mail?: Mail) {
    setComposeContext({ mode, mail });
    setComposing(true);
  }

  const classifyingRef = useRef<Set<string>>(new Set());

  // 미분류 inbox 메일 자동 배치 분류 (호출당 최대 10건, 서버가 스토어에 캐시)
  const categorizeAttemptedRef = useRef<Set<string>>(new Set());
  const categorizeBatchInFlight = useRef(false);

  const runBatchCategorize = useCallback(async () => {
    if (categorizeBatchInFlight.current) return;
    const targets = mails
      .filter((m) => m.folder === "inbox" && !m.category && !categorizeAttemptedRef.current.has(m.id))
      .slice(0, 10);
    if (targets.length === 0) return;
    targets.forEach((m) => categorizeAttemptedRef.current.add(m.id));
    categorizeBatchInFlight.current = true;
    try {
      const res = await fetch(apiUrl("/api/mail/categorize/batch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailIds: targets.map((m) => m.id) }),
      });
      if (!res.ok) return; // 분류 실패 시 배지 미표시 (best-effort)
      const data = (await res.json()) as {
        classified: { id: string; category: MailCategory; priority: MailImportance; reason: string }[];
      };
      if (!Array.isArray(data.classified) || data.classified.length === 0) return;
      setMails((prev) =>
        prev.map((m) => {
          const r = data.classified.find((c) => c.id === m.id);
          return r
            ? { ...m, category: r.category, priority: r.priority, categoryReason: r.reason }
            : m;
        }),
      );
    } catch {
      // silent — classification is best-effort
    } finally {
      categorizeBatchInFlight.current = false;
    }
  }, [mails]);

  useEffect(() => {
    if (!loading) void runBatchCategorize();
  }, [loading, runBatchCategorize]);

  async function classifyMail(mail: Mail) {
    // Classify inbox mails once, on first open (rule-first, Claude fallback server-side)
    if (mail.label || mail.folder !== "inbox" || classifyingRef.current.has(mail.id)) return;
    classifyingRef.current.add(mail.id);
    try {
      const res = await fetch(apiUrl("/api/mail/classify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: mail.subject,
          from: mail.from.name ? `${mail.from.name} <${mail.from.email}>` : mail.from.email,
          body: mail.body,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { label: Mail["label"]; importance: Mail["importance"] };
      if (!data.label) return;
      await fetch(apiUrl(`/api/mails/${mail.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: data.label, importance: data.importance }),
      });
      setMails((prev) =>
        prev.map((m) => (m.id === mail.id ? { ...m, label: data.label, importance: data.importance } : m)),
      );
    } catch {
      // silent — classification is best-effort
    } finally {
      classifyingRef.current.delete(mail.id);
    }
  }

  async function handleSelectMail(id: string) {
    setSelectedMailId(id);
    setMobileView('content');
    const mail = mails.find((m) => m.id === id);
    if (mail) void classifyMail(mail);
    if (mail && !mail.read) {
      try {
        await fetch(apiUrl(`/api/mails/${id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ read: true }),
        });
        setMails((prev) => prev.map((m) => (m.id === id ? { ...m, read: true } : m)));
      } catch {
        // silent
      }
    }
  }

  async function handleToggleStar(id: string) {
    const mail = mails.find((m) => m.id === id);
    if (!mail) return;
    try {
      await fetch(apiUrl(`/api/mails/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: !mail.starred }),
      });
      setMails((prev) => prev.map((m) => (m.id === id ? { ...m, starred: !m.starred } : m)));
    } catch {
      notifications.show({ color: "red", message: t("page.updateFail") });
    }
  }

  async function handleDelete(id: string) {
    const mail = mails.find((m) => m.id === id);
    if (!mail) return;
    try {
      if (mail.folder === "trash") {
        await fetch(apiUrl(`/api/mails/${id}`), { method: "DELETE" });
        setMails((prev) => prev.filter((m) => m.id !== id));
      } else {
        await fetch(apiUrl(`/api/mails/${id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: "trash" }),
        });
        setMails((prev) => prev.filter((m) => m.id !== id));
      }
      setSelectedMailId(null);
    } catch {
      notifications.show({ color: "red", message: t("common.deleteFail") });
    }
  }

  async function handleQuickReply(originalMail: Mail, body: string) {
    const fromMailbox = mailboxes.find((m) => m.id === originalMail.mailboxId);
    if (!fromMailbox) throw new Error("mailbox not found");
    const res = await fetch(apiUrl("/api/mails"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mailboxId: fromMailbox.id,
        folder: "sent",
        from: { email: fromMailbox.email, name: fromMailbox.displayName },
        to: [{ email: originalMail.from.email, name: originalMail.from.name }],
        subject: `RE: ${originalMail.subject}`,
        body,
        bodyType: "text",
      }),
    });
    if (!res.ok) throw new Error("send failed");
  }

  return (
    <Box
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#070D1A",
        overflow: "hidden",
        color: "white",
      }}
    >
      <Box style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        {!isMobile && (
          <MailSidebar
            mailboxes={mailboxes}
            selectedFolder={selectedFolder}
            selectedMailboxId={selectedMailboxId}
            unreadCounts={unreadCounts}
            onSelectFolder={(f) => { setSelectedFolder(f); setAppView("mail"); }}
            onSelectMailbox={(id) => { setSelectedMailboxId(id); setAppView("mail"); }}
            onManageMailboxes={() => setAppView("mailboxes")}
            onCompose={() => openCompose("new")}
            onSettings={() => setAppView((v) => (v === "settings" ? "mail" : "settings"))}
          />
        )}

        {isMobile && (
          <Drawer
            opened={mobileSidebarOpen}
            onClose={() => setMobileSidebarOpen(false)}
            position="left"
            size={240}
            padding={0}
            withCloseButton={false}
            styles={{ body: { padding: 0, height: "100%" }, content: { background: "#151F32" } }}
          >
            <MailSidebar
              mailboxes={mailboxes}
              selectedFolder={selectedFolder}
              selectedMailboxId={selectedMailboxId}
              unreadCounts={unreadCounts}
              onSelectFolder={(f) => { setSelectedFolder(f); setAppView("mail"); setMobileSidebarOpen(false); }}
              onSelectMailbox={(id) => { setSelectedMailboxId(id); setAppView("mail"); setMobileSidebarOpen(false); }}
              onManageMailboxes={() => { setAppView("mailboxes"); setMobileSidebarOpen(false); }}
              onCompose={() => { openCompose("new"); setMobileSidebarOpen(false); }}
              onSettings={() => { setAppView((v) => (v === "settings" ? "mail" : "settings")); setMobileSidebarOpen(false); }}
            />
          </Drawer>
        )}

        {appView === "mail" && (
          <>
            {(!isMobile || mobileView === 'list') && (
              <MailListPanel
                mails={mails}
                selectedMailId={selectedMailId}
                loading={loading}
                folder={selectedFolder}
                searchQuery={searchQuery}
                onSelect={(id) => void handleSelectMail(id)}
                onToggleStar={(id) => void handleToggleStar(id)}
                onSearchChange={setSearchQuery}
                rootStyle={isMobile ? { width: '100%', minWidth: 0, flexShrink: 1 } : undefined}
                onOpenMenu={isMobile ? () => setMobileSidebarOpen(true) : undefined}
              />
            )}
            {(!isMobile || mobileView === 'content') && (
              <MailContentPanel
                mail={selectedMail}
                onReply={() => selectedMail && openCompose("reply", selectedMail)}
                onForward={() => selectedMail && openCompose("forward", selectedMail)}
                onDelete={() => selectedMail && void handleDelete(selectedMail.id)}
                onToggleStar={() => selectedMail && void handleToggleStar(selectedMail.id)}
                onQuickReply={(body) => selectedMail ? handleQuickReply(selectedMail, body) : Promise.reject()}
                onBack={isMobile ? () => setMobileView('list') : undefined}
              />
            )}
          </>
        )}

        {appView === "mailboxes" && (
          <Box style={{ flex: 1, overflowY: "auto", padding: 24 }}>
            <MailboxManagementScreen
              mailboxes={mailboxes}
              onRefresh={() => void loadMailboxes()}
              onBack={() => setAppView("mail")}
            />
          </Box>
        )}

        {appView === "settings" && (
          <Box style={{ flex: 1, overflowY: "auto", padding: 24 }}>
            <SettingsScreen
              mailboxes={mailboxes}
              onBack={() => setAppView("mail")}
            />
          </Box>
        )}
      </Box>

      {appView === "mail" && <MailFab onClick={() => openCompose("new")} />}

      <ComposeModal
        opened={composing}
        context={composeContext}
        mailboxes={mailboxes}
        onClose={() => setComposing(false)}
        onSent={() => void loadMails()}
      />
    </Box>
  );
}
