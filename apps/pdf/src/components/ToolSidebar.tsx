"use client";

import { Box, Text, Stack, UnstyledButton, Tooltip } from "@mantine/core";
import { IconMessageChatbot } from "@tabler/icons-react";
import { TOOLS, type PdfTool } from "@/lib/stirling";
import { useI18n } from "@/lib/i18n/I18nProvider";

const CATEGORIES = [
  { id: "edit", toolIds: ["merge", "split", "remove-pages", "rotate"] },
  { id: "optimize", toolIds: ["compress", "flatten", "repair"] },
  { id: "overlay", toolIds: ["watermark", "add-page-numbers"] },
  { id: "security", toolIds: ["add-password", "remove-password"] },
  { id: "convert", toolIds: ["pdf-to-img", "img-to-pdf", "pdf-to-word", "office-to-pdf"] },
  { id: "extract", toolIds: ["ocr", "extract-images"] },
] as const;

interface ToolSidebarProps {
  activeTool: string;
  onSelect: (id: string) => void;
  onOpenHelper: () => void;
}

export default function ToolSidebar({ activeTool, onSelect, onOpenHelper }: ToolSidebarProps) {
  const { t } = useI18n();

  const toolMap = new Map<string, PdfTool>(TOOLS.map((tl) => [tl.id, tl]));

  return (
    <Box
      style={{
        width: 200,
        flexShrink: 0,
        background: "#070D1A",
        borderRight: "1px solid #1B2740",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box style={{ flex: "1 1 auto", overflowY: "auto", minHeight: 0 }}>
      {CATEGORIES.map((cat) => (
        <Box key={cat.id} py={8}>
          <Text
            size="xs"
            c="dimmed"
            fw={600}
            px={12}
            pb={4}
            style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
          >
            {t(`sidebar.${cat.id}`)}
          </Text>
          <Stack gap={1} px={6}>
            {cat.toolIds.map((toolId) => {
              const tool = toolMap.get(toolId);
              if (!tool) return null;
              const active = toolId === activeTool;
              return (
                <Tooltip key={toolId} label={t(tool.descKey)} position="right" openDelay={600} withinPortal multiline w={200}>
                  <UnstyledButton
                    onClick={() => onSelect(toolId)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: active ? "rgba(99, 102, 241, 0.2)" : "transparent",
                      color: active ? "#818CF8" : "#9DB7EB",
                      cursor: "pointer",
                      transition: "background 0.15s, color 0.15s",
                      fontWeight: active ? 600 : 400,
                      fontSize: 14,
                    }}
                    onMouseEnter={(e) => {
                      if (!active) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
                    }}
                    onMouseLeave={(e) => {
                      if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    }}
                  >
                    <span style={{ fontSize: 14, lineHeight: 1 }}>{tool.icon}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t(tool.labelKey)}
                    </span>
                    {active && (
                      <Box
                        style={{
                          width: 3,
                          height: 14,
                          borderRadius: 2,
                          background: "#6366F1",
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </UnstyledButton>
                </Tooltip>
              );
            })}
          </Stack>
        </Box>
      ))}
      </Box>

      <UnstyledButton
        onClick={onOpenHelper}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          margin: 8,
          padding: "10px 8px",
          borderRadius: 6,
          background: "rgba(99, 102, 241, 0.15)",
          color: "#818CF8",
          border: "1px solid rgba(99, 102, 241, 0.4)",
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 600,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(99, 102, 241, 0.28)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(99, 102, 241, 0.15)";
        }}
      >
        <IconMessageChatbot size={18} />
        <span>{t("fab.title")}</span>
      </UnstyledButton>
    </Box>
  );
}
