export interface Participant {
  id: string;
  name: string;
  federationNumber: string;
  clubNumber: string;
  clubName: string;
  bowType?: string | null;
  targetType?: string | null;
  checkedIn?: boolean;
  laneId?: string | null;
  targetLetter?: string | null;
}
