/**
 * AXON Unified Action Execution Gateway
 *
 * Single architectural handoff through which a resolved action or Action Plan step
 * proceeds toward execution:
 *
 * User Input
 *   ↓
 * Intent Resolution
 *   ↓
 * Capability Resolution
 *   ↓
 * Availability Check
 *   ↓
 * Action Plan
 *   ↓
 * Action Execution Gateway  <-- [THIS GATEWAY BOUNDARY]
 *   ↓
 * Existing Capability Implementation
 *   ↓
 * Verification
 *   ↓
 * Result
 *   ↓
 * Follow-up Context
 *
 * Controlled boundary between:
 * "AXON has determined what should happen" and "AXON is actually performing it."
 *
 * Core Responsibilities:
 * 1. Gateway Request/Contract: structured execution contract with capability, intent, target, parameters, modifiers, policy, context.
 * 2. Exactly-once execution protection: lightweight execution identity/idempotency tracking preventing double-execution or loop triggers.
 * 3. Capability-owned execution: delegates dispatch strictly to registered capability contracts without central giant switches.
 * 4. Action Plan step integration: executes single authorized steps while the plan engine retains ordering, conditions, and scheduling.
 * 5. Execution policy enforcement: respects immediate, execute, suggest, ask, clarify, confirm, queue, and verify policies.
 * 6. Availability awareness: validates capability/environment state prior to dispatch and distinguishes specific failure modes.
 * 7. Adaptive execution handoff: coordinates with fallback policies and attempt history when primary methods fail.
 * 8. Rigorous verification: preserves the distinction between dispatched, completed, obtained, and verified.
 * 9. Resource-conscious: task-first, zero speculative resource reservation.
 */

import { ScreenId, ContextualMessageAction } from '../types';
import {
  ExecutionPolicy,
  CapabilityExecutionContext,
  systemCapabilityRegistry,
} from './capabilitySystem';
import { resolveInterfaceFromQuery } from './interfaceRegistry';
import { tryEvaluateMathExpression } from './storageChatHandler';
import type {
  FailureCategory,
  ExecutionAttempt,
  AdaptiveFallbackPolicy,
} from './adaptiveExecution';
import {
  recordAttempt,
  verifyAttemptResult,
  executeAdaptiveObjectiveSync,
} from './adaptiveExecution';
import type { ActionNode, ActionExecutionPlan } from './actionPlan';

// ============================================================================
// 1. GATEWAY REQUEST & RESULT CONTRACTS
// ============================================================================

export type GatewayExecutionStatus =
  | 'dispatched'
  | 'completed'
  | 'requires_confirmation'
  | 'requires_interaction'
  | 'unavailable'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'duplicate_rejected';

export type GatewayFailureCategory =
  | 'resolution_failure'
  | 'availability_failure'
  | 'authorization_blocked'
  | 'missing_parameters'
  | 'missing_resource'
  | 'dispatch_failure'
  | 'execution_failure'
  | 'verification_failure'
  | 'user_cancellation'
  | 'plan_dependency_failure'
  | 'duplicate_rejected';

export interface ActionExecutionRequest {
  /** Unique execution or idempotency token */
  executionId?: string;
  /** Originating invocation source */
  source?: 'resolver' | 'action_plan' | 'contextual_action' | 'direct_command' | 'explicit_command' | 'natural_language' | 'follow_up';
  /** Registered Capability ID */
  capabilityId: string;
  /** Specific Action ID or Plan Step ID */
  actionId?: string;
  /** Primary intent or method to execute */
  intent: string;
  /** Target interface, route, subject, or expression */
  target?: string;
  /** Parameters to pass to capability handler */
  parameters?: Record<string, any>;
  /** Optional modifiers (formatting, options) */
  modifiers?: Record<string, any>;
  /** Execution policy produced by resolver / plan */
  executionPolicy?: ExecutionPolicy | string;
  /** Elevated authorization requirement */
  authorizationLevel?: 'standard' | 'elevated';
  /** Whether the action requires explicit command-level authorization */
  requiresCommandAuthorization?: boolean;
  /** Originating Action Plan ID if part of a multi-step plan */
  originatingPlanId?: string;
  /** Originating step metadata */
  originatingStep?: {
    id: string;
    description: string;
    status?: string;
    requiresConfirmation?: boolean;
  };
  /** User authorization or confirmation state */
  confirmationState?: {
    isConfirmed?: boolean;
    confirmedBy?: 'user_click' | 'explicit_command' | 'dialog' | 'suggestion_activation';
    confirmedAt?: number;
  };
  /** Explicit user constraints ("only use X", "don't use Y", etc.) */
  userConstraints?: {
    exclusiveMethod?: string;
    prohibitedCapabilities?: string[];
    preferredCapabilities?: string[];
  };
  /** Runtime execution context (navigation, settings handlers, storage handlers, etc.) */
  context: CapabilityExecutionContext;
  /** Optional adaptive fallback policy */
  fallbackPolicy?: AdaptiveFallbackPolicy;
}

export interface ActionExecutionResult {
  /** Unique execution identifier */
  executionId: string;
  /** Capability ID executed */
  capabilityId: string;
  /** Action / Step ID if provided */
  actionId?: string;
  /** Intent executed */
  intent: string;
  /** Overall gateway execution status */
  status: GatewayExecutionStatus;
  /** Whether the underlying implementation actually executed */
  executed: boolean;
  /** Whether the result was verified */
  verified: boolean;
  /** Success boolean convenience flag */
  success: boolean;
  /** Structured output payload returned by the capability */
  result?: any;
  /** Human-readable response / narrative */
  response: string;
  /** Target screen if navigation occurred */
  targetScreen?: ScreenId;
  /** Structured failure category if unsuccessful */
  failureCategory?: GatewayFailureCategory;
  /** Descriptive reason if execution was blocked or failed */
  failureReason?: string;
  /** Error object if an exception occurred */
  error?: { message: string; code?: string; details?: any };
  /** Execution attempt history */
  attempts?: ExecutionAttempt[];
  /** Actual method or capability that succeeded (supports transparent reporting) */
  actualMethodUsed?: string;
  /** Whether an adaptive fallback was utilized */
  adapted?: boolean;
  /** Contextual actions or forward alternatives offered */
  actions?: ContextualMessageAction[];
  /** Originating step ID if from an ActionPlan */
  originatingStepId?: string;
  /** Timestamp when execution completed */
  completedAt: number;
  /** Idempotency flag indicating result was served from cache to prevent double-execution */
  isDuplicate?: boolean;

  /** Requested objective */
  objective?: string;
  /** Target interface, route, subject, or expression */
  target?: string;
  /** Parameters passed to capability handler */
  parameters?: Record<string, any>;
  /** Optional modifiers */
  modifiers?: Record<string, any>;
  /** Execution policy evaluated */
  executionPolicy?: string;
  /** Primary / preferred method requested */
  selectedMethod?: string;
  /** List of alternative methods attempted */
  alternativeMethodsAttempted?: string[];
  /** Previous screen before navigation occurred */
  previousScreen?: ScreenId;
  /** Whether this action changed application state */
  stateChanged?: boolean;
  /** Whether a real reversible operation exists for this capability action */
  reversalSupported?: boolean;
  /** Specific reversible action definition if reversalSupported is true */
  reversalAction?: {
    capabilityId: string;
    intent: string;
    target?: string;
    parameters?: Record<string, any>;
    description: string;
  };
}

// ============================================================================
// 1.5. GLOBAL VERIFIED EXECUTION OUTCOME RETENTION
// ============================================================================

let globalLastExecutionOutcome: ActionExecutionResult | null = null;

/**
 * Returns the most recent verified execution outcome across all capability dispatches.
 */
export function getLastExecutionOutcome(): ActionExecutionResult | null {
  return globalLastExecutionOutcome;
}

/**
 * Updates the most recent verified execution outcome context.
 */
export function setLastExecutionOutcome(outcome: ActionExecutionResult | null): void {
  globalLastExecutionOutcome = outcome;
}

/**
 * Clears the most recent execution outcome context (used in test resets).
 */
export function clearLastExecutionOutcome(): void {
  globalLastExecutionOutcome = null;
}

// ============================================================================
// 2. LIGHTWEIGHT IDEMPOTENCY & EXACTLY-ONCE EXECUTION STORE
// ============================================================================

interface ExecutionCacheEntry {
  result: ActionExecutionResult;
  timestamp: number;
}

const EXECUTION_TTL_MS = 5 * 60 * 1000; // 5 minutes retention
const MAX_CACHE_SIZE = 250;

class IdempotencyStore {
  private history = new Map<string, ExecutionCacheEntry>();
  private inFlight = new Set<string>();

  public generateExecutionId(prefix = 'exec'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  public isInFlight(id: string): boolean {
    return this.inFlight.has(id);
  }

  public markInFlight(id: string): void {
    this.inFlight.add(id);
  }

  public clearInFlight(id: string): void {
    this.inFlight.delete(id);
  }

  public getCached(id: string): ActionExecutionResult | null {
    this.prune();
    const entry = this.history.get(id);
    if (!entry) return null;
    return {
      ...entry.result,
      isDuplicate: true,
    };
  }

  public recordResult(id: string, result: ActionExecutionResult): void {
    this.clearInFlight(id);
    this.history.set(id, {
      result,
      timestamp: Date.now(),
    });
    if (this.history.size > MAX_CACHE_SIZE) {
      const oldestKey = this.history.keys().next().value;
      if (oldestKey) this.history.delete(oldestKey);
    }
  }

  public clear(): void {
    this.history.clear();
    this.inFlight.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.history.entries()) {
      if (now - entry.timestamp > EXECUTION_TTL_MS) {
        this.history.delete(key);
      }
    }
  }
}

// ============================================================================
// 3. UNIFIED ACTION EXECUTION GATEWAY
// ============================================================================

export class UnifiedActionExecutionGateway {
  private idempotencyStore = new IdempotencyStore();

  /**
   * Reset the internal idempotency cache (used by test suites).
   */
  public resetIdempotencyStore(): void {
    this.idempotencyStore.clear();
  }

  /**
   * Dispatches an already-resolved action safely through the unified gateway.
   * Enforces availability, execution policy, idempotency, capability-owned execution,
   * verification, and transparent result packaging.
   */
  public dispatch(request: ActionExecutionRequest): ActionExecutionResult {
    const execId = request.executionId || this.idempotencyStore.generateExecutionId(request.capabilityId);

    // 1. Exactly-once execution / Idempotency Check
    if (request.executionId) {
      if (this.idempotencyStore.isInFlight(execId)) {
        return {
          executionId: execId,
          capabilityId: request.capabilityId,
          actionId: request.actionId,
          intent: request.intent,
          status: 'duplicate_rejected',
          executed: false,
          verified: false,
          success: false,
          failureCategory: 'duplicate_rejected',
          failureReason: `Action execution "${execId}" is already in flight.`,
          response: 'This action is currently executing. Duplicate request rejected.',
          completedAt: Date.now(),
          isDuplicate: true,
        };
      }

      const cached = this.idempotencyStore.getCached(execId);
      if (cached) {
        return cached;
      }
    }

    this.idempotencyStore.markInFlight(execId);

    try {
      const result = this.performDispatch(execId, request);

      // Populate structured context fields on the outcome
      if (!result.objective && request.originatingStep?.description) {
        result.objective = request.originatingStep.description;
      }
      if (!result.target && request.target) {
        result.target = request.target;
      }
      if (!result.parameters && request.parameters) {
        result.parameters = request.parameters;
      }
      if (!result.executionPolicy && request.executionPolicy) {
        result.executionPolicy = String(request.executionPolicy);
      }
      if (!result.selectedMethod) {
        result.selectedMethod = request.intent;
      }
      if (!result.alternativeMethodsAttempted && result.attempts) {
        result.alternativeMethodsAttempted = result.attempts
          .filter((a) => !a.isPreferredMethod)
          .map((a) => a.methodName);
      }

      // State change & reversal capability detection
      if (result.executed && result.success) {
        if (result.capabilityId === 'workspace_navigation' && result.targetScreen) {
          result.stateChanged = true;
          const prev = request.context.currentScreen;
          result.previousScreen = prev;
          if (prev && prev !== result.targetScreen) {
            result.reversalSupported = true;
            result.reversalAction = {
              capabilityId: 'workspace_navigation',
              intent: 'open',
              target: prev,
              parameters: { target: prev },
              description: `Navigate back to ${prev}`,
            };
          }
        } else if (result.capabilityId === 'settings_controller') {
          result.stateChanged = true;
          if (request.intent === 'set_theme' && request.parameters?.mode) {
            result.reversalSupported = true;
            const revMode = request.parameters.mode === 'dark' ? 'light' : 'dark';
            result.reversalAction = {
              capabilityId: 'settings_controller',
              intent: 'set_theme',
              target: revMode,
              parameters: { mode: revMode },
              description: `Revert theme to ${revMode}`,
            };
          }
        } else {
          result.stateChanged = false;
          result.reversalSupported = false;
        }
      } else {
        result.stateChanged = false;
        result.reversalSupported = false;
      }

      this.idempotencyStore.recordResult(execId, result);
      setLastExecutionOutcome(result);
      return result;
    } catch (err: any) {
      this.idempotencyStore.clearInFlight(execId);
      const errorResult: ActionExecutionResult = {
        executionId: execId,
        capabilityId: request.capabilityId,
        actionId: request.actionId,
        intent: request.intent,
        target: request.target,
        parameters: request.parameters,
        status: 'failed',
        executed: false,
        verified: false,
        success: false,
        stateChanged: false,
        reversalSupported: false,
        failureCategory: 'execution_failure',
        failureReason: err?.message || String(err),
        error: { message: err?.message || String(err) },
        response: `Execution error: ${err?.message || 'An unexpected error occurred.'}`,
        completedAt: Date.now(),
      };
      this.idempotencyStore.recordResult(execId, errorResult);
      setLastExecutionOutcome(errorResult);
      return errorResult;
    }
  }

  /**
   * Core dispatch pipeline.
   */
  private performDispatch(
    execId: string,
    request: ActionExecutionRequest
  ): ActionExecutionResult {
    const {
      capabilityId,
      intent,
      target,
      parameters = {},
      modifiers = {},
      executionPolicy = 'execute',
      confirmationState,
      userConstraints,
      context,
      fallbackPolicy,
    } = request;

    // 2. User Constraint Enforcement (e.g. "don't use Y", "only use X")
    if (userConstraints?.prohibitedCapabilities?.includes(capabilityId)) {
      return {
        executionId: execId,
        capabilityId,
        actionId: request.actionId,
        intent,
        status: 'blocked',
        executed: false,
        verified: false,
        success: false,
        failureCategory: 'authorization_blocked',
        failureReason: `Capability "${capabilityId}" is restricted by user constraint.`,
        response: `Cannot execute "${capabilityId}": capability is restricted by your active constraints.`,
        completedAt: Date.now(),
      };
    }

    // 3. Execution Policy Enforcement
    // Check if policy requires confirmation or user interaction before execution
    const isConfirmed = confirmationState?.isConfirmed === true;

    if ((executionPolicy === 'confirm' || executionPolicy === 'confirmation' || executionPolicy === 'ask') && !isConfirmed) {
      const confirmActions: ContextualMessageAction[] = [
        {
          label: `Confirm ${intent.replace(/_/g, ' ')}`,
          actionText: `run ${intent} ${target || ''}`.trim(),
          variant: 'default',
          intent: 'action',
        },
        {
          label: 'Cancel',
          actionText: 'cancel',
          variant: 'secondary',
          intent: 'action',
        },
      ];

      return {
        executionId: execId,
        capabilityId,
        actionId: request.actionId,
        intent,
        status: 'requires_confirmation',
        executed: false,
        verified: false,
        success: false,
        failureCategory: 'authorization_blocked',
        failureReason: 'Action requires user confirmation before proceeding.',
        response: `Execution requires confirmation: "${intent.replace(/_/g, ' ')}${target ? ` on ${target}` : ''}".`,
        actions: confirmActions,
        completedAt: Date.now(),
      };
    }

    // 3.5. Elevated / Command-Level Authorization Gate
    const requiresElevated =
      request.authorizationLevel === 'elevated' ||
      request.requiresCommandAuthorization === true;

    if (requiresElevated && !isConfirmed) {
      const authActions: ContextualMessageAction[] = [
        {
          label: `Authorize ${intent.replace(/_/g, ' ')}`,
          actionText: `run ${intent} ${target || ''}`.trim(),
          variant: 'default',
          intent: 'action',
        },
        {
          label: 'Cancel',
          actionText: 'cancel',
          variant: 'secondary',
          intent: 'action',
        },
      ];

      return {
        executionId: execId,
        capabilityId,
        actionId: request.actionId,
        intent,
        status: 'requires_confirmation',
        executed: false,
        verified: false,
        success: false,
        failureCategory: 'authorization_blocked',
        failureReason: 'Action requires elevated authorization before proceeding.',
        response: `Execution requires elevated authorization: "${intent.replace(/_/g, ' ')}${target ? ` on ${target}` : ''}".`,
        actions: authActions,
        completedAt: Date.now(),
      };
    }

    if ((executionPolicy === 'suggest' || executionPolicy === 'suggestion' || executionPolicy === 'clarify') && !isConfirmed) {
      const suggestActions: ContextualMessageAction[] = [
        {
          label: `Proceed with ${intent.replace(/_/g, ' ')}`,
          actionText: `run ${intent} ${target || ''}`.trim(),
          variant: 'default',
          intent: 'action',
        },
      ];

      return {
        executionId: execId,
        capabilityId,
        actionId: request.actionId,
        intent,
        status: 'requires_interaction',
        executed: false,
        verified: false,
        success: false,
        response: `Suggested action: "${intent.replace(/_/g, ' ')}${target ? ` on ${target}` : ''}".`,
        actions: suggestActions,
        completedAt: Date.now(),
      };
    }

    // 4. Availability Check & Environment Awareness
    const availability = systemCapabilityRegistry.checkAvailability(capabilityId);
    if (!availability.isAvailable) {
      // If an adaptive fallback policy is present and allowed, hand off to adaptive execution
      if (
        fallbackPolicy &&
        fallbackPolicy.allowAutonomousFallback &&
        fallbackPolicy.exclusivity !== 'exclusive'
      ) {
        return this.dispatchAdaptiveFallback(execId, request, {
          category: this.mapAvailabilityToFailureCategory(availability.state),
          reason: availability.reason?.userFriendlyReason || availability.reason?.message || 'Capability unavailable.',
        });
      }

      const failureCat = this.mapAvailabilityToFailureCategory(availability.state);
      const friendlyReason =
        availability.reason?.userFriendlyReason ||
        availability.reason?.message ||
        `Capability "${capabilityId}" is unavailable in this environment.`;

      return {
        executionId: execId,
        capabilityId,
        actionId: request.actionId,
        intent,
        status: 'unavailable',
        executed: false,
        verified: false,
        success: false,
        failureCategory: failureCat,
        failureReason: friendlyReason,
        response: friendlyReason,
        completedAt: Date.now(),
      };
    }

    // 5. If an explicit fallbackPolicy is attached, route through adaptive execution engine
    if (fallbackPolicy) {
      const adaptiveRes = executeAdaptiveObjectiveSync(
        request.originatingStep?.description || `${intent} ${target || ''}`.trim(),
        {
          capabilityId,
          methodId: intent || capabilityId,
          methodName: request.originatingStep?.description || intent,
          intent,
          target,
          parameters,
        },
        fallbackPolicy,
        context
      );

      const isSucceeded = adaptiveRes.status === 'succeeded';
      return {
        executionId: execId,
        capabilityId,
        actionId: request.actionId,
        intent,
        status: isSucceeded ? 'completed' : 'failed',
        executed: true,
        verified: adaptiveRes.isVerified,
        success: isSucceeded && adaptiveRes.isVerified,
        result: adaptiveRes.finalResult,
        response: adaptiveRes.response,
        targetScreen: adaptiveRes.targetScreen,
        attempts: adaptiveRes.attempts,
        actualMethodUsed: adaptiveRes.attempts.find((a) => a.status === 'succeeded')?.methodName || capabilityId,
        adapted: adaptiveRes.adapted,
        actions: adaptiveRes.actions,
        originatingStepId: request.originatingStep?.id,
        completedAt: Date.now(),
      };
    }

    // 6. Capability-Owned Execution Dispatch
    const startedAt = Date.now();
    const singleAttempt: ExecutionAttempt = {
      id: `att_${execId}`,
      attemptIndex: 1,
      objective: request.originatingStep?.description || `${intent} ${target || ''}`.trim(),
      methodId: intent || capabilityId,
      capabilityId,
      methodName: request.originatingStep?.description || intent,
      target,
      parameters,
      isPreferredMethod: true,
      status: 'attempting',
      startedAt,
      verified: false,
    };

    let rawOutput: any = null;
    let execSuccess = false;
    let execError: any = null;
    let responseText = '';
    let targetScreen: ScreenId | undefined;

    const cap = systemCapabilityRegistry.get(capabilityId);

    if (cap && cap.execute) {
      // Direct registered capability execution
      try {
        const out = cap.execute(intent, target, parameters, context);
        rawOutput = out;
        if (out && (out as any).success === false) {
          execSuccess = false;
          execError = { message: (out as any).response || 'Capability execution returned failure.' };
          responseText = (out as any).response || 'Capability execution failed.';
        } else {
          execSuccess = true;
          responseText = (out as any)?.response || `Action "${intent}" completed successfully.`;
          targetScreen = (out as any)?.targetScreen;
        }
      } catch (err: any) {
        execSuccess = false;
        execError = { message: err?.message || String(err) };
        responseText = `Execution error: ${err?.message || 'Error occurred'}`;
      }
    } else if (capabilityId === 'workspace_navigation' || intent === 'open') {
      // Workspace Navigation
      if (!context.navigateTo) {
        execSuccess = false;
        execError = { message: 'Navigation context is not available.' };
        responseText = 'Navigation is unavailable in current context.';
      } else {
        const navTarget = target || parameters.target || '';
        const res = resolveInterfaceFromQuery(navTarget, context.currentScreen);
        if (res.match && res.match.route) {
          context.navigateTo(res.match.route as ScreenId, { screenState: res.match.subState });
          execSuccess = true;
          targetScreen = res.match.route as ScreenId;
          responseText = `Opened **${res.match.name}**.`;
          rawOutput = { screen: targetScreen, match: res.match };
        } else {
          execSuccess = false;
          execError = { message: `Could not uniquely identify an interface for "${navTarget}".` };
          responseText = `Could not uniquely identify an interface for "${navTarget}".`;
        }
      }
    } else if (capabilityId === 'math_calculator' || intent === 'calculate') {
      // Math Calculation
      const expr = parameters.expression || target || '';
      const calcResult = tryEvaluateMathExpression(expr);
      if (calcResult) {
        execSuccess = true;
        responseText = calcResult;
        rawOutput = { calculation: calcResult };
      } else {
        execSuccess = false;
        execError = { message: `Could not evaluate math expression "${expr}".` };
        responseText = `Could not evaluate math expression "${expr}".`;
      }
    } else {
      execSuccess = false;
      execError = { message: `Capability "${capabilityId}" does not expose an execution handler.` };
      responseText = `Capability "${capabilityId}" cannot be dispatched directly.`;
    }

    const completedAt = Date.now();
    singleAttempt.completedAt = completedAt;
    singleAttempt.durationMs = completedAt - startedAt;

    // 7. Verification Phase
    let verified = false;
    let verifyFailureReason: string | undefined;

    if (execSuccess) {
      if (cap && cap.verifyResult) {
        const outcome = cap.verifyResult(singleAttempt, rawOutput, context);
        verified = outcome.verified;
        if (!verified) {
          verifyFailureReason = outcome.reason || 'Capability verification hook rejected execution result.';
        }
      } else {
        const outcome = verifyAttemptResult(singleAttempt, rawOutput, context);
        verified = outcome.verified;
        if (!verified) {
          verifyFailureReason = outcome.reason || 'Result verification failed.';
        }
      }
    }

    if (execSuccess && verified) {
      singleAttempt.status = 'succeeded';
      singleAttempt.verified = true;
      singleAttempt.result = rawOutput;
      recordAttempt(singleAttempt);

      const finalResultPayload = (rawOutput as any)?.metadata
        ? { ...(rawOutput as any).metadata, ...(rawOutput as any) }
        : rawOutput;

      return {
        executionId: execId,
        capabilityId,
        actionId: request.actionId,
        intent,
        status: 'completed',
        executed: true,
        verified: true,
        success: true,
        result: finalResultPayload,
        response: responseText,
        targetScreen,
        actualMethodUsed: capabilityId,
        attempts: [singleAttempt],
        originatingStepId: request.originatingStep?.id,
        completedAt,
      };
    }

    // Execution or Verification Failure
    singleAttempt.status = 'failed';
    singleAttempt.verified = false;
    singleAttempt.failureReason = verifyFailureReason || execError?.message || 'Execution failed';
    singleAttempt.failureCategory = !execSuccess ? 'execution_error' : 'verification_failure';
    recordAttempt(singleAttempt);

    return {
      executionId: execId,
      capabilityId,
      actionId: request.actionId,
      intent,
      status: 'failed',
      executed: execSuccess,
      verified: false,
      success: false,
      failureCategory: singleAttempt.failureCategory as GatewayFailureCategory,
      failureReason: singleAttempt.failureReason,
      error: execError,
      response: responseText || verifyFailureReason || 'Execution failed.',
      attempts: [singleAttempt],
      originatingStepId: request.originatingStep?.id,
      completedAt,
    };
  }

  /**
   * Dispatches adaptive execution fallback when primary capability fails or is unavailable.
   */
  private dispatchAdaptiveFallback(
    execId: string,
    request: ActionExecutionRequest,
    initialFailure: { category: GatewayFailureCategory; reason: string }
  ): ActionExecutionResult {
    const { capabilityId, intent, target, parameters = {}, fallbackPolicy, context } = request;

    if (!fallbackPolicy) {
      return {
        executionId: execId,
        capabilityId,
        actionId: request.actionId,
        intent,
        status: 'unavailable',
        executed: false,
        verified: false,
        success: false,
        failureCategory: initialFailure.category,
        failureReason: initialFailure.reason,
        response: initialFailure.reason,
        completedAt: Date.now(),
      };
    }

    const adaptiveRes = executeAdaptiveObjectiveSync(
      request.originatingStep?.description || `${intent} ${target || ''}`.trim(),
      {
        capabilityId,
        methodId: intent || capabilityId,
        methodName: request.originatingStep?.description || intent,
        intent,
        target,
        parameters,
      },
      fallbackPolicy,
      context
    );

    const isSucceeded = adaptiveRes.status === 'succeeded';
    return {
      executionId: execId,
      capabilityId,
      actionId: request.actionId,
      intent,
      status: isSucceeded ? 'completed' : 'failed',
      executed: true,
      verified: adaptiveRes.isVerified,
      success: isSucceeded && adaptiveRes.isVerified,
      result: adaptiveRes.finalResult,
      response: adaptiveRes.response,
      targetScreen: adaptiveRes.targetScreen,
      attempts: adaptiveRes.attempts,
      actualMethodUsed: adaptiveRes.attempts.find((a) => a.status === 'succeeded')?.methodName || capabilityId,
      adapted: adaptiveRes.adapted,
      actions: adaptiveRes.actions,
      originatingStepId: request.originatingStep?.id,
      completedAt: Date.now(),
    };
  }

  /**
   * Maps capability availability state to structured GatewayFailureCategory.
   */
  private mapAvailabilityToFailureCategory(state: string): GatewayFailureCategory {
    switch (state) {
      case 'network_required':
        return 'availability_failure';
      case 'permission_required':
      case 'permission_denied':
        return 'authorization_blocked';
      case 'resource_constrained':
        return 'missing_resource';
      case 'unsupported_platform':
      case 'unavailable':
      default:
        return 'availability_failure';
    }
  }

  /**
   * Executes a single Action Plan step through the gateway.
   * Enables Action Plans to hand steps to the gateway without duplicating plan orchestration.
   */
  public executePlanStep(
    step: ActionNode,
    plan: ActionExecutionPlan,
    context: CapabilityExecutionContext,
    options?: {
      isConfirmed?: boolean;
      confirmedBy?: 'user_click' | 'explicit_command' | 'dialog' | 'suggestion_activation';
    }
  ): ActionExecutionResult {
    const request: ActionExecutionRequest = {
      executionId: `step_${plan.id}_${step.id}`,
      source: 'action_plan',
      capabilityId: step.capabilityId,
      actionId: step.id,
      intent: step.intent,
      target: step.target,
      parameters: step.parameters,
      executionPolicy: step.executionPolicy || plan.executionPolicy || 'execute',
      authorizationLevel: step.authorizationLevel,
      requiresCommandAuthorization: step.requiresCommandAuthorization,
      originatingPlanId: plan.id,
      originatingStep: {
        id: step.id,
        description: step.description,
        status: step.status,
        requiresConfirmation: step.requiresConfirmation,
      },
      confirmationState: {
        isConfirmed: options?.isConfirmed ?? (!step.requiresConfirmation),
        confirmedBy: options?.confirmedBy,
      },
      fallbackPolicy: step.fallbackPolicy || plan.adaptivePolicy,
      context,
    };

    return this.dispatch(request);
  }
}

export const actionExecutionGateway = new UnifiedActionExecutionGateway();
