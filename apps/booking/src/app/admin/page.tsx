"use client";

import { useState } from "react";
import { Box, Tabs, Container } from "@mantine/core";
import { AvailabilitySettingsScreen } from "../../components/admin/AvailabilitySettingsScreen";
import BookingDashboard from "../../components/admin/BookingDashboard";
import AvailabilityTextGenerator from "../../components/admin/AvailabilityTextGenerator";
import EventTypeList from "../../components/admin/EventTypeList";
import EventTypeForm from "../../components/admin/EventTypeForm";
import { useI18n } from "../../lib/i18n";
import type { EventType } from "../../types/event-type";

type ETView = "list" | "new" | "edit";

export default function AdminPage() {
  const { t } = useI18n();
  const [etView, setEtView] = useState<ETView>("list");
  const [editingET, setEditingET] = useState<EventType | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

  function handleSaved() {
    setEtView("list");
    setEditingET(undefined);
    setRefreshKey((k) => k + 1);
  }

  return (
    <Box style={{ minHeight: "100vh", background: "#070D1A", color: "white" }}>
      <Container size="lg" py="xl">
        <Tabs defaultValue="bookings" color="jarvis">
          <Tabs.List>
            <Tabs.Tab value="bookings">{t("adm.tabBookings")}</Tabs.Tab>
            <Tabs.Tab value="availability">{t("avail.title")}</Tabs.Tab>
            <Tabs.Tab value="event-types">{t("etl.title")}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="bookings" pt="xl">
            <BookingDashboard />
          </Tabs.Panel>

          <Tabs.Panel value="availability" pt="xl">
            <AvailabilitySettingsScreen />
            <AvailabilityTextGenerator />
          </Tabs.Panel>

          <Tabs.Panel value="event-types" pt="xl">
            {etView === "list" && (
              <EventTypeList
                refreshKey={refreshKey}
                onNew={() => {
                  setEditingET(undefined);
                  setEtView("new");
                }}
                onEdit={(et) => {
                  setEditingET(et);
                  setEtView("edit");
                }}
              />
            )}
            {(etView === "new" || etView === "edit") && (
              <EventTypeForm
                existing={editingET}
                onSaved={handleSaved}
                onCancel={() => {
                  setEtView("list");
                  setEditingET(undefined);
                }}
              />
            )}
          </Tabs.Panel>
        </Tabs>
      </Container>
    </Box>
  );
}
