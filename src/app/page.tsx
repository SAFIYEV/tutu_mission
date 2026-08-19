"use client";

import { useMissionController } from "@/features/mission/model/use-mission-controller";
import { CreateMission, EXAMPLE_MISSION } from "@/features/mission/ui/create-mission";
import { Clarification, TechnicalError } from "@/features/mission/ui/error-screens";
import { CompleteResult, ImpossibleResult } from "@/features/mission/ui/result-screens";
import { SolvingScreen } from "@/features/mission/ui/solving-screen";

export default function Home() {
  const mission = useMissionController();

  if (mission.screen === "create") {
    return <CreateMission onSubmit={mission.submit} initialText={mission.text || EXAMPLE_MISSION} />;
  }
  if (mission.screen === "solving") {
    return <SolvingScreen text={mission.text} response={mission.response} onDone={mission.showResult} />;
  }
  if (mission.screen === "error") {
    return <TechnicalError message={mission.error} code={mission.errorCode} onRetry={() => mission.submit(mission.text)} onReset={mission.reset} />;
  }
  if (mission.screen === "clarification") {
    return <Clarification questions={mission.questions} unsupported={mission.unsupported} onEdit={mission.reset} />;
  }
  if (!mission.response) return null;
  if (mission.response.status === "complete") {
    return <CompleteResult data={mission.response} onReset={mission.reset} />;
  }
  return (
    <ImpossibleResult
      data={mission.response}
      onReset={mission.reset}
      onApplySuggestion={() => {
        if (!mission.response?.suggestion) return mission.reset();
        void mission.submit(mission.text, "auto-adjust");
      }}
    />
  );
}
