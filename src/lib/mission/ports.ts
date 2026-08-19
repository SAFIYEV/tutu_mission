import type { HotelOption, MissionConstraints, MissionResponse, TransportMode, TransportOption } from "./schema";

export type SearchDirectionResult = {
  options: TransportOption[];
  unavailableModes: TransportMode[];
  warnings: string[];
  attempts: number;
  successfulSearches: number;
};

export type MissionSearchResult = {
  outbound: SearchDirectionResult;
  returns: SearchDirectionResult;
  hotels?: {
    options: HotelOption[];
    warnings: string[];
    attempts: number;
    successfulSearches: number;
  };
};

export interface MissionSearchProvider {
  searchForMission(constraints: MissionConstraints, signal?: AbortSignal): Promise<MissionSearchResult>;
}

export type ParsedMission = {
  constraints: MissionConstraints;
  source: Exclude<MissionResponse["parserSource"], "agent-adjustment">;
  warning?: string | null;
};

export type MissionParser = (text: string) => Promise<ParsedMission>;
