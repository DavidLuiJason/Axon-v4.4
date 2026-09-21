import { ScreenId, ContextualMessageAction } from '../types';
import {
  CapabilityRequirements,
  CapabilitySelfDescription,
  CapabilityAvailabilityStatus,
  EnvironmentSnapshot,
} from './capabilityAvailability';
import type {
  ActionExecutionType,
  FailureCategory,
  ExecutionAttempt,
  AdaptiveFallbackPolicy,
} from './actionPlan';

// ============================================================================
// 1. COMMAND SUBSYSTEM CONTRACT
// ============================================================================

export interface CapabilityCommandDefinition {
  name: string;
  aliases?: string[];
  syntax?: string;
  description?: string;
  isExplicitSlash?: boolean;
  examples?: string[];
}

// ============================================================================
// 2. INTENT & ACTION CONTRACT
// ============================================================================

export type StatementType =
  | 'conversational'
  | 'question'
  | 'explicit_instruction'
  | 'command'
  | 'confirmation'
  | 'correction'
  | 'refusal'
  | 'hypothetical'
  | 'suggestion'
  | 'request_for_alternatives'
  | 'ambiguous'
  | 'exceeds_capability';

export type ResponsePurpose =
  | 'execute'
  | 'confirm'
  | 'clarify'
  | 'correct'
  | 'provide_solution'
  | 'provide_alternative'
  | 'report_result'
  | 'explain_limitation'
  | 'request_information'
  | 'provide_information';

export type ExecutionPolicy = 'immediate' | 'suggestion' | 'confirmation';

export interface ResolvedIntent {
  statementType: StatementType;
  rawText: string;
  capabilityId?: string;
  intent: string;
  target?: string;
  parameters: Record<string, any>;
  modifiers: string[];
  executionPolicy: ExecutionPolicy;
  isExplicit: boolean;
  confidence: number;
  underlyingObjective?: string;
  preferredMethod?: string;
}

export interface CapabilityParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'enum';
  required?: boolean;
  description?: string;
  options?: string[];
  defaultValue?: any;
}

export interface AlternativeMechanismDefinition {
  underlyingObjective: string;
  description: string;
  composedCapabilities?: string[];
  steps?: {
    capabilityId: string;
    intent: string;
    target?: string;
    parameters?: Record<string, any>;
    description: string;
  }[];
  actionsFactory?: (context?: any) => ContextualMessageAction[];
}

export type InvocationSource =
  | 'explicit_command'
  | 'natural_language'
  | 'contextual_action'
  | 'follow_up';

export type AuthorizationLevel = 'standard' | 'elevated';

export interface CapabilityActionDefinition {
  intent: string;
  description: string;
  acceptedTargets?: string[];
  parametersSchema?: Record<string, CapabilityParameterSchema>;
  modifiers?: string[];
  requiresConfirmation?: boolean;
  supportedPolicies?: ExecutionPolicy[];
  alternativeMechanisms?: AlternativeMechanismDefinition[];
  authorizationLevel?: AuthorizationLevel;
  requiresCommandAuthorization?: boolean;
}

// ============================================================================
// 3. PLANNING SUBSYSTEM CONTRACT
// ============================================================================

export type { ActionExecutionType };

export interface CapabilityPlanningMetadata {
  supportsSequential?: boolean;
  supportsParallel?: boolean;
  supportsQueue?: boolean;
  defaultExecutionType?: ActionExecutionType;
  prerequisites?: string[];
  providesPrerequisites?: string[];
  idempotent?: boolean;
  estimatedDurationMs?: number;
}

// ============================================================================
// 4. FALLBACK & ALTERNATIVE CONTRACT
// ============================================================================

export type RouteType = 'direct' | 'composed' | 'alternative' | 'partial' | 'limitation';

export interface AlternativeResolution {
  objective: string;
  requestedMethod?: string;
  routeType: RouteType;
  targetCapabilityId?: string;
  plan?: any;
  explanation: string;
  actions?: ContextualMessageAction[];
  limitationDetails?: {
    limitation: string;
    cause: string;
    availableAlternatives: string[];
  };
}

export interface FallbackCandidateDefinition {
  capabilityId: string;
  methodId: string;
  methodName: string;
  intent?: string;
  target?: string;
  description: string;
  isSafeAutonomous: boolean;
  requiresConfirmation: boolean;
  differenceExplanation: string;
}

// ============================================================================
// 5. EXECUTION SUBSYSTEM CONTRACT
// ============================================================================

export interface CapabilityExecutionContext {
  currentScreen?: ScreenId;
  navigateTo?: (screen: ScreenId, options?: any) => void;
  settingsHandlers?: any;
  storageHandlers?: any;
  customHandlers?: Record<string, Function>;
}

export interface CapabilityExecutionResult {
  success: boolean;
  response: string;
  executed: boolean;
  purpose: ResponsePurpose;
  actions?: ContextualMessageAction[];
  targetScreen?: ScreenId;
  metadata?: Record<string, any>;
}

// ============================================================================
// 6. VERIFICATION SUBSYSTEM CONTRACT
// ============================================================================

export interface CapabilityVerificationOutcome {
  verified: boolean;
  failureCategory?: FailureCategory;
  reason?: string;
  details?: Record<string, any>;
}

export type CapabilityVerificationHandler = (
  attempt: ExecutionAttempt | { intent: string; target?: string; parameters?: Record<string, any>; result: any },
  result: any,
  context?: CapabilityExecutionContext
) => CapabilityVerificationOutcome;

// ============================================================================
// 7. UNIFIED CAPABILITY CONTRACT
// ============================================================================

/**
 * Standardized Capability Contract that allows any AXON feature to expose
 * its capabilities to the command, intent, planning, availability, fallback,
 * execution, and verification subsystems without requiring central architecture rewrites.
 */
export interface CapabilityContract {
  // Identity & Discovery
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category?: string;
  readonly version?: string;

  // Subsystem 1: Availability & Requirements
  readonly requirements?: CapabilityRequirements;
  readonly selfDescription?: CapabilitySelfDescription;
  readonly checkAvailability?: (env: EnvironmentSnapshot) => CapabilityAvailabilityStatus | null;

  // Subsystem 2: Intent & Actions
  readonly intents: CapabilityActionDefinition[];
  readonly canHandleDirectly?: (intent: string, target?: string, params?: Record<string, any>) => boolean;
  readonly matchIntent?: (text: string, currentScreen?: ScreenId) => ResolvedIntent | null;

  // Subsystem 3: Command & Direct Syntax
  readonly commands?: CapabilityCommandDefinition[];
  readonly matchesCommand?: (commandName: string, args?: string) => boolean;

  // Subsystem 4: Planning Metadata
  readonly planning?: CapabilityPlanningMetadata;

  // Subsystem 5: Fallback & Alternative Resolution
  readonly resolveAlternative?: (objective: string, requestedMethod?: string) => AlternativeResolution | null;
  readonly getFallbacksFor?: (failedMethod: string, objective: string) => FallbackCandidateDefinition[];

  // Subsystem 6: Execution Handler
  readonly execute?: (
    intent: string,
    target: string | undefined,
    params: Record<string, any>,
    context: CapabilityExecutionContext
  ) => Promise<CapabilityExecutionResult> | CapabilityExecutionResult;

  // Subsystem 7: Objective Verification Gate
  readonly verifyResult?: CapabilityVerificationHandler;
}

/**
 * Backward compatibility alias for SystemCapability.
 */
export type SystemCapability = CapabilityContract;

/**
 * Validates whether an object strictly adheres to the CapabilityContract.
 */
export function validateCapabilityContract(cap: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!cap || typeof cap !== 'object') {
    return { valid: false, errors: ['Capability must be a non-null object.'] };
  }

  if (typeof cap.id !== 'string' || !cap.id.trim()) {
    errors.push('Capability id is required and must be a non-empty string.');
  }

  if (typeof cap.name !== 'string' || !cap.name.trim()) {
    errors.push('Capability name is required and must be a non-empty string.');
  }

  if (typeof cap.description !== 'string' || !cap.description.trim()) {
    errors.push('Capability description is required and must be a non-empty string.');
  }

  if (!Array.isArray(cap.intents) || cap.intents.length === 0) {
    errors.push('Capability must define at least one action intent in intents array.');
  } else {
    for (let i = 0; i < cap.intents.length; i++) {
      const it = cap.intents[i];
      if (!it || typeof it.intent !== 'string' || !it.intent.trim()) {
        errors.push(`Intent at index ${i} must define a valid intent string.`);
      }
    }
  }

  if (cap.execute && typeof cap.execute !== 'function') {
    errors.push('If provided, execute must be a function.');
  }

  if (cap.verifyResult && typeof cap.verifyResult !== 'function') {
    errors.push('If provided, verifyResult must be a function.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Type guard for CapabilityContract.
 */
export function isCapabilityContract(obj: any): obj is CapabilityContract {
  return validateCapabilityContract(obj).valid;
}
