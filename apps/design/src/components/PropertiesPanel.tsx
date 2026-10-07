"use client";

import {
  ColorInput,
  Group,
  NumberInput,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useDesign } from "@/lib/store/designStore";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Shape, TextShape } from "@/lib/design/types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap={6} px="sm" py={8} style={{ borderBottom: "1px solid #1B2740" }}>
      <Text size="xs" fw={700} c="dimmed" tt="uppercase">
        {title}
      </Text>
      {children}
    </Stack>
  );
}

const numStyle = { input: { background: "#04070F" } };

export default function PropertiesPanel() {
  const { t } = useI18n();
  const doc = useDesign((s) => s.doc);
  const activePageId = useDesign((s) => s.activePageId);
  const selectedIds = useDesign((s) => s.selectedIds);
  const updateShape = useDesign((s) => s.updateShape);

  const page = doc.pages.find((p) => p.id === activePageId) ?? doc.pages[0];
  const sel = page.shapes.filter((s) => selectedIds.includes(s.id));

  return (
    <Stack
      gap={0}
      h="100%"
      style={{
        width: 248,
        background: "#070D1A",
        borderLeft: "1px solid #1F293D",
        flex: "0 0 auto",
        overflowY: "auto",
      }}
    >
      <Text size="xs" fw={700} c="dimmed" px="sm" py={8} tt="uppercase">
        {t("panel.design")}
      </Text>
      {sel.length === 0 && (
        <Text size="xs" c="dimmed" px="sm">
          {t("panel.empty")}
        </Text>
      )}
      {sel.length > 1 && (
        <Text size="xs" c="dimmed" px="sm">
          {t("panel.multi")} ({sel.length})
        </Text>
      )}
      {sel.length === 1 && <SingleEditor shape={sel[0]} onChange={updateShape} t={t} />}
    </Stack>
  );
}

function SingleEditor({
  shape,
  onChange,
  t,
}: {
  shape: Shape;
  onChange: (id: string, patch: Partial<Shape>) => void;
  t: (k: string) => string;
}) {
  const set = (patch: Partial<Shape>) => onChange(shape.id, patch);
  const isText = shape.type === "text";
  const isGroup = shape.type === "group";

  const hasShadow = !!shape.shadow;
  const shadow = shape.shadow ?? { x: 4, y: 4, blur: 8, color: "#000000" };

  return (
    <>
      <Section title={shape.name}>
        <TextInput
          size="xs"
          styles={numStyle}
          value={shape.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
        />
      </Section>

      {!isGroup && (
        <>
          <Section title={t("prop.position")}>
            <Group grow gap={6}>
              <NumberInput
                size="xs"
                label="X"
                styles={numStyle}
                value={Math.round(shape.x)}
                onChange={(v) => set({ x: Number(v) || 0 })}
              />
              <NumberInput
                size="xs"
                label="Y"
                styles={numStyle}
                value={Math.round(shape.y)}
                onChange={(v) => set({ y: Number(v) || 0 })}
              />
            </Group>
          </Section>

          <Section title={t("prop.size")}>
            <Group grow gap={6}>
              <NumberInput
                size="xs"
                label="W"
                styles={numStyle}
                value={Math.round(shape.width)}
                onChange={(v) => set({ width: Number(v) || 1 })}
              />
              <NumberInput
                size="xs"
                label="H"
                styles={numStyle}
                value={Math.round(shape.height)}
                onChange={(v) => set({ height: Number(v) || 1 })}
              />
            </Group>
            <Group grow gap={6}>
              <NumberInput
                size="xs"
                label={t("prop.rotation")}
                styles={numStyle}
                value={Math.round(shape.rotation)}
                onChange={(v) => set({ rotation: Number(v) || 0 })}
              />
              {(shape.type === "rect" || shape.type === "frame") && (
                <NumberInput
                  size="xs"
                  label={t("prop.radius")}
                  styles={numStyle}
                  min={0}
                  value={Math.round(shape.radius)}
                  onChange={(v) => set({ radius: Number(v) || 0 })}
                />
              )}
            </Group>
          </Section>

          <Section title={t("prop.opacity")}>
            <Slider
              color="jarvis"
              value={Math.round(shape.opacity * 100)}
              onChange={(v) => set({ opacity: v / 100 })}
              label={(v) => `${v}%`}
            />
          </Section>

          {isText ? (
            <Section title={t("prop.text")}>
              <TextInput
                size="xs"
                styles={numStyle}
                value={(shape as TextShape).text}
                onChange={(e) => set({ text: e.currentTarget.value } as Partial<Shape>)}
              />
              <Group grow gap={6}>
                <NumberInput
                  size="xs"
                  label={t("prop.fontSize")}
                  styles={numStyle}
                  min={1}
                  value={(shape as TextShape).fontSize}
                  onChange={(v) => set({ fontSize: Number(v) || 12 } as Partial<Shape>)}
                />
              </Group>
              <ColorInput
                size="xs"
                label={t("prop.fill")}
                styles={numStyle}
                value={(shape as TextShape).color}
                onChange={(v) => set({ color: v } as Partial<Shape>)}
              />
              <SegmentedControl
                size="xs"
                fullWidth
                value={(shape as TextShape).align}
                onChange={(v) => set({ align: v } as Partial<Shape>)}
                data={[
                  { label: "L", value: "left" },
                  { label: "C", value: "center" },
                  { label: "R", value: "right" },
                ]}
              />
            </Section>
          ) : (
            <Section title={t("prop.fill")}>
              <ColorInput
                size="xs"
                styles={numStyle}
                value={shape.fill === "none" ? "" : shape.fill}
                placeholder="none"
                onChange={(v) => set({ fill: v || "none" })}
              />
            </Section>
          )}

          <Section title={t("prop.stroke")}>
            <ColorInput
              size="xs"
              styles={numStyle}
              value={shape.stroke === "none" ? "" : shape.stroke}
              placeholder="none"
              onChange={(v) => set({ stroke: v || "none" })}
            />
            <NumberInput
              size="xs"
              label={t("prop.strokeWidth")}
              styles={numStyle}
              min={0}
              value={shape.strokeWidth}
              onChange={(v) => set({ strokeWidth: Number(v) || 0 })}
            />
          </Section>

          {/* Shadow section */}
          <Section title={t("prop.shadow")}>
            <Switch
              size="xs"
              label={t("prop.shadowOn")}
              checked={hasShadow}
              onChange={(e) =>
                set({ shadow: e.currentTarget.checked ? shadow : undefined })
              }
            />
            {hasShadow && (
              <>
                <Group grow gap={6}>
                  <NumberInput
                    size="xs"
                    label="X"
                    styles={numStyle}
                    value={shadow.x}
                    onChange={(v) => set({ shadow: { ...shadow, x: Number(v) || 0 } })}
                  />
                  <NumberInput
                    size="xs"
                    label="Y"
                    styles={numStyle}
                    value={shadow.y}
                    onChange={(v) => set({ shadow: { ...shadow, y: Number(v) || 0 } })}
                  />
                </Group>
                <NumberInput
                  size="xs"
                  label={t("prop.shadowBlur")}
                  styles={numStyle}
                  min={0}
                  value={shadow.blur}
                  onChange={(v) => set({ shadow: { ...shadow, blur: Number(v) || 0 } })}
                />
                <ColorInput
                  size="xs"
                  label={t("prop.shadowColor")}
                  styles={numStyle}
                  value={shadow.color}
                  onChange={(v) => set({ shadow: { ...shadow, color: v || "#000000" } })}
                />
              </>
            )}
          </Section>
        </>
      )}
    </>
  );
}
