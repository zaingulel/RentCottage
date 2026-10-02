import "server-only";
import type { ExactPoint } from "./exact-point";

export type NavigationHandoff = { kind: "simulated" };

export interface MapProvider {
  navigationHandoff(point: ExactPoint): NavigationHandoff;
}

export const simulatedMapProvider: MapProvider = {
  navigationHandoff: () => ({ kind: "simulated" }),
};
