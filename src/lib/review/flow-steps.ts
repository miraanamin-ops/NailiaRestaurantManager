import "server-only";
import type { FlowStep } from "./flow";
import type { StepHandler } from "./flow-run";

// Each step of the guided flow, once it's built. A step not listed is passed over.
export const FLOW_HANDLERS: Partial<Record<FlowStep, StepHandler>> = {};
