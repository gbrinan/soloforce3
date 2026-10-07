"use client";

import { useState } from "react";
import EditorScreen from "@/components/EditorScreen";
import ResultScreen from "@/components/ResultScreen";

type Phase = "editor" | "result";

export default function HomePage() {
  const [phase, setPhase] = useState<Phase>("editor");
  // editorKey forces a fresh EditorScreen (reset to import state) on restart.
  const [editorKey, setEditorKey] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);

  if (phase === "result" && jobId) {
    return (
      <ResultScreen
        jobId={jobId}
        onRestart={() => {
          setJobId(null);
          setEditorKey((k) => k + 1);
          setPhase("editor");
        }}
      />
    );
  }

  return (
    <EditorScreen
      key={editorKey}
      onResult={(id) => {
        setJobId(id);
        setPhase("result");
      }}
      onBack={() => {
        // Back from editor — reset to a fresh import state.
        setJobId(null);
        setEditorKey((k) => k + 1);
        setPhase("editor");
      }}
    />
  );
}
