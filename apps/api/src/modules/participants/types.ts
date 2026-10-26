export type AddParticipant = (
  | { participantId: string }
  | { name: string; federationNumber: string; clubNumber: string; clubName?: string }
) & {
  bowType: string;
  targetType: string;
};

export interface ImportedClub {
  clubNumber: string;
  name: string;
}

export interface ImportedParticipant {
  federationNumber: string;
  name: string;
  clubNumber: string;
}

export interface ImportData {
  clubs: ImportedClub[];
  participants: ImportedParticipant[];
}

export interface ScrapedParticipants extends ImportData {
  season: string;
  pages: number;
}

export type ScrapeParticipants = (progress: (message: string) => void) => Promise<ScrapedParticipants>;

export interface ParticipantImportState {
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress: string | null;
  result: { season: string; participants: number; clubs: number } | null;
  error: string | null;
}

export type ParticipantWorkbookRow = Record<'Bondsnummer' | 'Schutter' | 'Vereniging' | 'Boog' | 'Blazoen', string> & {
  row: number;
};
