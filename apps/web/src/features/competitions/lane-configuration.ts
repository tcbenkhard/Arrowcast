export interface Lane {
  laneId: string;
  number: number;
  distanceMeters: number;
  targetType: string | null;
  numberOfTargets: number;
}
export interface LaneChanges {
  targetType?: string;
  numberOfTargets?: number;
}
export interface BulkLaneUpdate {
  laneIds: Set<string>;
  changes: LaneChanges;
}
export const targetCounts = [1, 2];
