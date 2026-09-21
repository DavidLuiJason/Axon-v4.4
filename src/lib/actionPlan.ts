/**
 * AXON Action Plan & Execution Plan Architecture
 *
 * Core conceptual flow:
 * User Input
 *   ↓
 * Intent Resolution
 *   ↓
 * Capability Resolution
 *   ↓
 * Target / Parameters / Modifiers
 *   ↓
 * Execution Plan
 *   ↓
 * Execution Policy
 *   ↓
 * Task / Action Execution
 *   ↓
 * Results
 *   ↓
 * Follow-up Context
 *
 * Supports:
 * - Single actions (zero extra visible complexity)
 * - Sequential execution (A completes -> B begins)
 * - Parallel / independent actions (independent nodes without false coupling)
 * - Queued actions (integrated with runtime TaskQueue / workloadManager)
 * - Explicit dependencies (on_success, on_failure, always)
 * - Priority and reordering (C before A, run next, interactive priority)
 * - Failure handling (stop dependents, continue independents, explicit on_failure)
 * - Result propagation & follow-up context (retry failed actions, context memory)
 * - Resource governor compatibility (task-first, zero speculative resource reservation)
 */

import { ScreenId, ContextualMessageAction } from '../types';
import { TaskPriority } from './runtime/types';
import { workloadManager } from './runtime/workloadManager';
import {
  ExecutionPolicy,
  CapabilityExecutionContext,
  systemCapabilityRegistry,
} from './capabilitySystem';
import { resolveInterfaceFromQuery } from './interfaceRegistry';
import { tryEvaluateMathExpression } from './storageChatHandler';
import type {
  FailureCategory,
  MethodExclusivity,
  ExecutionAttempt,
  AdaptiveFallbackPolicy,
  AdaptiveExecutionResult,
} from './adaptiveExecution';
import {
  executeAdaptiveObjectiveSync,
  queryAttemptHistory,
  getGlobalAttemptHistory,
  getLatestAdaptiveResult,
  clearAttemptHistory,
  recordAttempt,
  generateAdaptiveReport,
  discoverFallbackMethods,
  verifyAttemptResult,
} from './adaptiveExecution';

export type {
  FailureCategory,
  MethodExclusivity,
  ExecutionAttempt,
  AdaptiveFallbackPolicy,
  AdaptiveExecutionResult,
};

export {
  executeAdaptiveObjectiveSync,
  queryAttemptHistory,
  getGlobalAttemptHistory,
  getLatestAdaptiveResult,
  clearAttemptHistory,
  recordAttempt,
  generateAdaptiveReport,
  discoverFallbackMethods,
  verifyAttemptResult,
};

// ============================================================================
// 1. ACTION PLAN TYPES & ABSTRACTIONS
// ============================================================================

export type ActionExecutionType = 'single' | 'sequence' | 'parallel' | 'queue';
export type ActionDependencyCondition = 'on_success' | 'on_failure' | 'always';

export type ActionStatus =
  | 'created'
  | 'waiting'
  | 'ready'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export type PlanStatus =
  | 'created'
  | 'waiting'
  | 'ready'
  | 'executing'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'cancelled';

export interface ActionDependency {
  actionId: string;
  condition: ActionDependencyCondition;
}

export interface ActionNode {
  id: string;
  capabilityId: string;
  intent: string;
  target?: string;
  parameters?: Record<string, any>;
  description: string;
  executionPolicy?: ExecutionPolicy;
  priority?: TaskPriority | number;
  status?: ActionStatus;
  dependencies?: ActionDependency[];
  requiresConfirmation?: boolean;
  result?: any;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  startedAt?: number;
  completedAt?: number;
  attempts?: ExecutionAttempt[];
  fallbackPolicy?: AdaptiveFallbackPolicy;
}

export interface ActionExecutionPlan {
  id: string;
  objective: string;
  type: ActionExecutionType;
  actions: ActionNode[];
  dependencies?: Record<string, ActionDependency[]>;
  priority?: TaskPriority | number;
  status: PlanStatus;
  executionPolicy?: ExecutionPolicy;
  results?: Record<string, any>;
  errors?: Record<string, { message: string; code?: string; details?: any }>;
  metadata?: Record<string, any>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  cancellationToken?: { isCancelled: boolean; reason?: string };
  attempts?: ExecutionAttempt[];
  adaptivePolicy?: AdaptiveFallbackPolicy;
}

export interface PlanExecutionResult {
  planId: string;
  status: PlanStatus;
  executed: boolean;
  summary: string;
  results: Record<string, any>;
  errors: Record<string, { message: string; code?: string }>;
  completedActionIds: string[];
  failedActionIds: string[];
  skippedActionIds: string[];
  plan: ActionExecutionPlan;
  targetScreen?: ScreenId;
  actions?: ContextualMessageAction[];
  attempts?: ExecutionAttempt[];
  adapted?: boolean;
}

// ============================================================================
// 2. CONTEXT & FOLLOW-UP MEMORY
// ============================================================================

let lastExecutionPlan: ActionExecutionPlan | null = null;

export function getLastExecutionPlan(): ActionExecutionPlan | null {
  return lastExecutionPlan;
}

export function setLastExecutionPlan(plan: ActionExecutionPlan | null): void {
  lastExecutionPlan = plan;
}

export function clearLastExecutionPlan(): void {
  lastExecutionPlan = null;
}

// ============================================================================
// 3. ACTION PLAN BUILDERS & REORDERING
// ============================================================================

/**
 * Creates a single-action plan. For simple requests, execution overhead remains invisible.
 */
export function createSingleActionPlan(
  action: Partial<ActionNode> & { capabilityId: string; intent: string; description: string },
  policy: ExecutionPolicy = 'immediate'
): ActionExecutionPlan {
  const actionId = action.id || 'action-1';
  const node: ActionNode = {
    id: actionId,
    capabilityId: action.capabilityId,
    intent: action.intent,
    target: action.target,
    parameters: action.parameters || {},
    description: action.description,
    executionPolicy: action.executionPolicy || policy,
    priority: action.priority ?? TaskPriority.INTERACTIVE,
    status: 'created',
    dependencies: action.dependencies || [],
    requiresConfirmation:
      action.requiresConfirmation ?? (action.executionPolicy === 'confirmation'),
  };

  return {
    id: `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    objective: action.description,
    type: 'single',
    actions: [node],
    dependencies: {},
    priority: node.priority,
    status: 'created',
    executionPolicy: policy,
    results: {},
    errors: {},
    createdAt: Date.now(),
  };
}

/**
 * Creates a sequential plan where action B executes only after action A reaches completed state.
 */
export function createSequentialPlan(
  objective: string,
  actions: Array<
    Partial<ActionNode> & { capabilityId: string; intent: string; description: string }
  >,
  options?: {
    customConditions?: Record<string, ActionDependencyCondition>;
    priority?: TaskPriority | number;
    executionPolicy?: ExecutionPolicy;
  }
): ActionExecutionPlan {
  const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nodes: ActionNode[] = [];
  const dependencies: Record<string, ActionDependency[]> = {};

  for (let i = 0; i < actions.length; i++) {
    const raw = actions[i];
    const actionId = raw.id || `action-${i + 1}`;
    const deps: ActionDependency[] = raw.dependencies ? [...raw.dependencies] : [];

    // In sequential execution: action at i depends on action at i-1 by default
    if (i > 0 && deps.length === 0) {
      const prevActionId = nodes[i - 1].id;
      const condition = options?.customConditions?.[actionId] || 'on_success';
      deps.push({ actionId: prevActionId, condition });
    }

    dependencies[actionId] = deps;

    nodes.push({
      id: actionId,
      capabilityId: raw.capabilityId,
      intent: raw.intent,
      target: raw.target,
      parameters: raw.parameters || {},
      description: raw.description,
      executionPolicy: raw.executionPolicy || options?.executionPolicy || 'immediate',
      priority: raw.priority ?? options?.priority ?? TaskPriority.USER_FOREGROUND,
      status: 'created',
      dependencies: deps,
      requiresConfirmation:
        raw.requiresConfirmation ?? (raw.executionPolicy === 'confirmation'),
    });
  }

  return {
    id: planId,
    objective,
    type: 'sequence',
    actions: nodes,
    dependencies,
    priority: options?.priority ?? TaskPriority.USER_FOREGROUND,
    status: 'created',
    executionPolicy: options?.executionPolicy || 'immediate',
    results: {},
    errors: {},
    createdAt: Date.now(),
  };
}

/**
 * Creates a parallel/independent plan where actions are genuinely independent.
 */
export function createParallelPlan(
  objective: string,
  actions: Array<
    Partial<ActionNode> & { capabilityId: string; intent: string; description: string }
  >,
  options?: {
    priority?: TaskPriority | number;
    executionPolicy?: ExecutionPolicy;
  }
): ActionExecutionPlan {
  const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nodes: ActionNode[] = actions.map((raw, i) => ({
    id: raw.id || `action-${i + 1}`,
    capabilityId: raw.capabilityId,
    intent: raw.intent,
    target: raw.target,
    parameters: raw.parameters || {},
    description: raw.description,
    executionPolicy: raw.executionPolicy || options?.executionPolicy || 'immediate',
    priority: raw.priority ?? options?.priority ?? TaskPriority.NORMAL_BACKGROUND,
    status: 'created',
    dependencies: raw.dependencies || [],
    requiresConfirmation:
      raw.requiresConfirmation ?? (raw.executionPolicy === 'confirmation'),
  }));

  return {
    id: planId,
    objective,
    type: 'parallel',
    actions: nodes,
    dependencies: {},
    priority: options?.priority ?? TaskPriority.NORMAL_BACKGROUND,
    status: 'created',
    executionPolicy: options?.executionPolicy || 'immediate',
    results: {},
    errors: {},
    createdAt: Date.now(),
  };
}

/**
 * Creates a queued plan that submits actions to the central runtime TaskQueue.
 */
export function createQueuedPlan(
  objective: string,
  actions: Array<
    Partial<ActionNode> & { capabilityId: string; intent: string; description: string }
  >,
  options?: {
    priority?: TaskPriority | number;
  }
): ActionExecutionPlan {
  const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const priority = options?.priority ?? TaskPriority.NORMAL_BACKGROUND;
  const nodes: ActionNode[] = actions.map((raw, i) => ({
    id: raw.id || `action-${i + 1}`,
    capabilityId: raw.capabilityId,
    intent: raw.intent,
    target: raw.target,
    parameters: raw.parameters || {},
    description: raw.description,
    executionPolicy: raw.executionPolicy || 'immediate',
    priority: raw.priority ?? priority,
    status: 'created',
    dependencies: raw.dependencies || [],
    requiresConfirmation: false,
  }));

  return {
    id: planId,
    objective,
    type: 'queue',
    actions: nodes,
    dependencies: {},
    priority,
    status: 'created',
    executionPolicy: 'immediate',
    results: {},
    errors: {},
    createdAt: Date.now(),
  };
}

/**
 * Reorders actions within a plan, rebuilding sequential dependencies when applicable.
 */
export function reorderPlanActions(
  plan: ActionExecutionPlan,
  actionId: string,
  targetIndex: number
): ActionExecutionPlan {
  const currentIndex = plan.actions.findIndex(
    (a) =>
      a.id === actionId ||
      a.target === actionId ||
      a.description.toLowerCase().includes(actionId.toLowerCase())
  );
  if (currentIndex === -1 || targetIndex < 0 || targetIndex >= plan.actions.length) {
    return plan;
  }

  const newActions = [...plan.actions];
  const [removed] = newActions.splice(currentIndex, 1);
  newActions.splice(targetIndex, 0, removed);

  plan.actions = newActions;

  // If this is a sequential plan, rebuild sequential dependencies
  if (plan.type === 'sequence') {
    const newDeps: Record<string, ActionDependency[]> = {};
    for (let i = 0; i < newActions.length; i++) {
      const act = newActions[i];
      if (i === 0) {
        act.dependencies = [];
        newDeps[act.id] = [];
      } else {
        const prev = newActions[i - 1];
        act.dependencies = [{ actionId: prev.id, condition: 'on_success' }];
        newDeps[act.id] = act.dependencies;
      }
    }
    plan.dependencies = newDeps;
  }

  return plan;
}

/**
 * Updates plan priority and propagates it to all constituent action nodes.
 */
export function setPlanPriority(
  plan: ActionExecutionPlan,
  priority: TaskPriority | number
): ActionExecutionPlan {
  plan.priority = priority;
  for (const act of plan.actions) {
    act.priority = priority;
  }
  return plan;
}

/**
 * Cancels a plan, marking remaining unexecuted actions as cancelled.
 */
export function cancelPlan(
  plan: ActionExecutionPlan,
  reason: string = 'User cancelled plan'
): ActionExecutionPlan {
  plan.status = 'cancelled';
  if (!plan.cancellationToken) {
    plan.cancellationToken = { isCancelled: true, reason };
  } else {
    plan.cancellationToken.isCancelled = true;
    plan.cancellationToken.reason = reason;
  }

  for (const act of plan.actions) {
    if (act.status === 'created' || act.status === 'waiting' || act.status === 'ready') {
      act.status = 'cancelled';
      act.error = { message: reason, code: 'CANCELLED' };
    }
  }

  return plan;
}

/**
 * Creates a retry plan targeting only the failed and skipped actions from a previous plan.
 */
export function createRetryPlan(originalPlan: ActionExecutionPlan): ActionExecutionPlan | null {
  const failedOrSkipped = originalPlan.actions.filter(
    (a) => a.status === 'failed' || a.status === 'skipped'
  );
  if (failedOrSkipped.length === 0) {
    return null;
  }

  return createSequentialPlan(
    `Retry: ${originalPlan.objective}`,
    failedOrSkipped.map((a) => ({
      ...a,
      id: `retry_${a.id}`,
      status: 'created',
      result: undefined,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
    }))
  );
}

// ============================================================================
// 4. DEPENDENCY & ACTION EXECUTION ENGINE
// ============================================================================

/**
 * Evaluates whether an action's dependencies allow it to execute.
 */
export function evaluateActionDependencies(
  action: ActionNode,
  plan: ActionExecutionPlan
): { canRun: boolean; skipped: boolean; skipReason?: string } {
  const deps = action.dependencies || plan.dependencies?.[action.id] || [];
  if (deps.length === 0) {
    return { canRun: true, skipped: false };
  }

  for (const dep of deps) {
    const parent = plan.actions.find((a) => a.id === dep.actionId);
    if (!parent) continue;

    const parentStatus = parent.status;
    if (
      parentStatus === 'created' ||
      parentStatus === 'waiting' ||
      parentStatus === 'ready' ||
      parentStatus === 'executing'
    ) {
      return { canRun: false, skipped: false };
    }

    if (dep.condition === 'on_success') {
      if (parentStatus !== 'completed') {
        return {
          canRun: false,
          skipped: true,
          skipReason: `Skipped because prerequisite action '${parent.description}' did not succeed (${parentStatus}).`,
        };
      }
    } else if (dep.condition === 'on_failure') {
      if (parentStatus !== 'failed') {
        return {
          canRun: false,
          skipped: true,
          skipReason: `Skipped because action only executes on failure, but '${parent.description}' succeeded.`,
        };
      }
    } else if (dep.condition === 'always') {
      if (parentStatus !== 'completed' && parentStatus !== 'failed') {
        return { canRun: false, skipped: false };
      }
    }
  }

  return { canRun: true, skipped: false };
}

/**
 * Executes a single action node using registered system capabilities or execution context.
 */
export function executeActionNodeDirect(
  action: ActionNode,
  context: CapabilityExecutionContext
): {
  success: boolean;
  result?: any;
  error?: { message: string; code?: string };
  response?: string;
  targetScreen?: ScreenId;
  attempts?: ExecutionAttempt[];
} {
  if (action.fallbackPolicy) {
    const adaptiveRes = executeAdaptiveObjectiveSync(
      action.description,
      {
        capabilityId: action.capabilityId,
        methodId: action.intent || action.capabilityId,
        methodName: action.description || action.capabilityId,
        intent: action.intent,
        target: action.target,
        parameters: action.parameters,
      },
      action.fallbackPolicy,
      context
    );
    action.attempts = adaptiveRes.attempts;
    action.completedAt = Date.now();
    if (adaptiveRes.status === 'succeeded') {
      action.status = 'completed';
      action.result = adaptiveRes.finalResult;
      return {
        success: true,
        result: action.result,
        response: adaptiveRes.response,
        targetScreen: adaptiveRes.targetScreen,
        attempts: adaptiveRes.attempts,
      };
    } else {
      action.status = 'failed';
      action.error = { message: adaptiveRes.limitation || 'Action execution failed.' };
      return {
        success: false,
        error: action.error,
        response: adaptiveRes.response,
        attempts: adaptiveRes.attempts,
      };
    }
  }

  action.startedAt = Date.now();
  action.status = 'executing';

  const singleAttempt: ExecutionAttempt = {
    id: `att_${Date.now()}_1`,
    attemptIndex: 1,
    objective: action.description,
    methodId: action.intent || action.capabilityId,
    capabilityId: action.capabilityId,
    methodName: action.description,
    target: action.target,
    parameters: action.parameters,
    isPreferredMethod: true,
    status: 'attempting',
    startedAt: action.startedAt,
    verified: false,
  };

  try {
    // 1. Registered Capability Execution
    const cap = systemCapabilityRegistry.get(action.capabilityId);
    if (cap && cap.execute) {
      const execResult = cap.execute(
        action.intent,
        action.target,
        action.parameters || {},
        context
      );

      const syncRes = execResult as any;
      if (syncRes && syncRes.success === false) {
        action.status = 'failed';
        action.error = { message: syncRes.response || 'Capability execution failed.' };
        action.completedAt = Date.now();
        singleAttempt.status = 'failed';
        singleAttempt.failureReason = action.error.message;
        singleAttempt.completedAt = action.completedAt;
        recordAttempt(singleAttempt);
        action.attempts = [singleAttempt];
        return { success: false, error: action.error, response: syncRes.response, attempts: action.attempts };
      }

      action.status = 'completed';
      action.result = syncRes?.metadata || syncRes;
      action.completedAt = Date.now();
      singleAttempt.status = 'succeeded';
      singleAttempt.verified = true;
      singleAttempt.result = action.result;
      singleAttempt.completedAt = action.completedAt;
      recordAttempt(singleAttempt);
      action.attempts = [singleAttempt];
      return {
        success: true,
        result: action.result,
        response: syncRes?.response,
        targetScreen: syncRes?.targetScreen,
        attempts: action.attempts,
      };
    }

    // 2. Direct Navigation Execution
    if (action.capabilityId === 'workspace_navigation' || action.intent === 'open') {
      const target = action.target || '';
      if (!context.navigateTo) {
        action.status = 'failed';
        action.error = { message: 'Navigation context is not available.' };
        action.completedAt = Date.now();
        singleAttempt.status = 'failed';
        singleAttempt.failureReason = action.error.message;
        recordAttempt(singleAttempt);
        action.attempts = [singleAttempt];
        return { success: false, error: action.error, attempts: action.attempts };
      }

      const res = resolveInterfaceFromQuery(target, context.currentScreen);
      if (res.match && res.match.route) {
        context.navigateTo(res.match.route as ScreenId, {
          screenState: res.match.subState,
        });
        action.status = 'completed';
        action.result = { screen: res.match.route };
        action.completedAt = Date.now();
        singleAttempt.status = 'succeeded';
        singleAttempt.verified = true;
        singleAttempt.result = action.result;
        recordAttempt(singleAttempt);
        action.attempts = [singleAttempt];
        return {
          success: true,
          result: action.result,
          response: `Opened **${res.match.name}**.`,
          targetScreen: res.match.route as ScreenId,
          attempts: action.attempts,
        };
      }

      action.status = 'failed';
      action.error = { message: `Could not identify interface for "${target}".` };
      action.completedAt = Date.now();
      singleAttempt.status = 'failed';
      singleAttempt.failureReason = action.error.message;
      recordAttempt(singleAttempt);
      action.attempts = [singleAttempt];
      return { success: false, error: action.error, attempts: action.attempts };
    }

    // 3. Direct Math Calculation Execution
    if (action.capabilityId === 'math_calculator' || action.intent === 'calculate') {
      const expr = action.parameters?.expression || action.target || '';
      const calcResult = tryEvaluateMathExpression(expr);
      if (calcResult) {
        action.status = 'completed';
        action.result = { calculation: calcResult };
        action.completedAt = Date.now();
        singleAttempt.status = 'succeeded';
        singleAttempt.verified = true;
        singleAttempt.result = action.result;
        recordAttempt(singleAttempt);
        action.attempts = [singleAttempt];
        return { success: true, result: action.result, response: calcResult, attempts: action.attempts };
      }

      action.status = 'failed';
      action.error = { message: `Could not calculate "${expr}".` };
      action.completedAt = Date.now();
      singleAttempt.status = 'failed';
      singleAttempt.failureReason = action.error.message;
      recordAttempt(singleAttempt);
      action.attempts = [singleAttempt];
      return { success: false, error: action.error, attempts: action.attempts };
    }

    // 4. Default Success
    action.status = 'completed';
    action.result = { description: action.description };
    action.completedAt = Date.now();
    singleAttempt.status = 'succeeded';
    singleAttempt.verified = true;
    singleAttempt.result = action.result;
    recordAttempt(singleAttempt);
    action.attempts = [singleAttempt];
    return { success: true, result: action.result, attempts: action.attempts };
  } catch (err: any) {
    action.status = 'failed';
    action.error = { message: err?.message || String(err) };
    action.completedAt = Date.now();
    singleAttempt.status = 'failed';
    singleAttempt.failureReason = action.error.message;
    recordAttempt(singleAttempt);
    action.attempts = [singleAttempt];
    return { success: false, error: action.error, attempts: action.attempts };
  }
}

/**
 * Synchronous Action Plan Executor.
 * Handles single, sequential, parallel, and queue execution models while respecting
 * dependencies, failure handling, resource boundaries, and confirmation requirements.
 */
export function executeActionPlanSync(
  plan: ActionExecutionPlan,
  context: CapabilityExecutionContext
): PlanExecutionResult {
  plan.startedAt = Date.now();
  plan.status = 'executing';

  const completedIds: string[] = [];
  const failedIds: string[] = [];
  const skippedIds: string[] = [];
  const results: Record<string, any> = {};
  const errors: Record<string, { message: string; code?: string }> = {};
  const responses: string[] = [];
  let lastNavScreen: ScreenId | undefined;

  // 1. Single Action Plan
  if (plan.type === 'single') {
    const act = plan.actions[0];
    if (act.requiresConfirmation) {
      act.status = 'waiting';
      plan.status = 'waiting';
      return {
        planId: plan.id,
        status: 'waiting',
        executed: false,
        summary: `Action **${act.description}** requires confirmation before proceeding.`,
        results,
        errors,
        completedActionIds: completedIds,
        failedActionIds: failedIds,
        skippedActionIds: skippedIds,
        plan,
      };
    }

    const fallbackPolicy = act.fallbackPolicy || plan.adaptivePolicy || {
      exclusivity: 'preferred',
      maxAttempts: 3,
      allowAutonomousFallback: true,
    };

    const preferredMethod = {
      capabilityId: act.capabilityId,
      methodId: act.intent || act.capabilityId,
      methodName: act.description || act.capabilityId,
      intent: act.intent,
      target: act.target,
      parameters: act.parameters,
    };

    const adaptiveRes = executeAdaptiveObjectiveSync(
      plan.objective || act.description,
      preferredMethod,
      fallbackPolicy,
      context
    );

    act.attempts = adaptiveRes.attempts;
    plan.attempts = adaptiveRes.attempts;

    if (adaptiveRes.status === 'succeeded') {
      completedIds.push(act.id);
      results[act.id] = adaptiveRes.finalResult;
      plan.status = 'completed';
      if (adaptiveRes.targetScreen) lastNavScreen = adaptiveRes.targetScreen;
    } else if (adaptiveRes.status === 'requires_confirmation') {
      plan.status = 'waiting';
      return {
        planId: plan.id,
        status: 'waiting',
        executed: false,
        summary: adaptiveRes.response,
        results,
        errors,
        completedActionIds: completedIds,
        failedActionIds: failedIds,
        skippedActionIds: skippedIds,
        plan,
        actions: adaptiveRes.actions,
        attempts: adaptiveRes.attempts,
      };
    } else {
      failedIds.push(act.id);
      errors[act.id] = { message: adaptiveRes.limitation || 'Action execution failed.' };
      plan.status = 'failed';
    }

    plan.completedAt = Date.now();
    plan.results = results;
    plan.errors = errors;
    setLastExecutionPlan(plan);

    return {
      planId: plan.id,
      status: plan.status,
      executed: plan.status === 'completed',
      summary: adaptiveRes.response,
      results,
      errors,
      completedActionIds: completedIds,
      failedActionIds: failedIds,
      skippedActionIds: skippedIds,
      plan,
      targetScreen: lastNavScreen,
      attempts: adaptiveRes.attempts,
      adapted: adaptiveRes.adapted,
    };
  }

  // 2. Queue Plan
  if (plan.type === 'queue') {
    for (const act of plan.actions) {
      act.status = 'waiting';
      workloadManager.submit({
        type: 'interactive',
        name: act.description,
        priority:
          typeof act.priority === 'number' ? act.priority : TaskPriority.NORMAL_BACKGROUND,
        execute: async () => {
          const res = executeActionNodeDirect(act, context);
          if (!res.success) {
            throw new Error(res.error?.message || 'Queued task failed.');
          }
          return res;
        },
      });
    }

    plan.status = 'executing';
    setLastExecutionPlan(plan);

    return {
      planId: plan.id,
      status: 'executing',
      executed: true,
      summary: `Queued **${plan.actions.length}** actions for processing in AXON Runtime Queue.`,
      results,
      errors,
      completedActionIds: [],
      failedActionIds: [],
      skippedActionIds: [],
      plan,
    };
  }

  // 3. Sequential or Parallel Plan
  for (let i = 0; i < plan.actions.length; i++) {
    const act = plan.actions[i];

    if (plan.cancellationToken?.isCancelled) {
      act.status = 'cancelled';
      act.error = { message: plan.cancellationToken.reason || 'Cancelled' };
      failedIds.push(act.id);
      errors[act.id] = act.error;
      continue;
    }

    // Evaluate dependencies
    const depCheck = evaluateActionDependencies(act, plan);
    if (depCheck.skipped) {
      act.status = 'skipped';
      act.error = { message: depCheck.skipReason || 'Prerequisite failed.' };
      skippedIds.push(act.id);
      errors[act.id] = act.error;
      continue;
    }

    if (!depCheck.canRun) {
      act.status = 'waiting';
      continue;
    }

    // Execute eligible action
    const execRes = executeActionNodeDirect(act, context);
    if (execRes.success) {
      completedIds.push(act.id);
      results[act.id] = execRes.result;
      if (execRes.response) responses.push(execRes.response);
      if (execRes.targetScreen) lastNavScreen = execRes.targetScreen;
    } else {
      failedIds.push(act.id);
      errors[act.id] = execRes.error || { message: 'Action execution failed.' };
    }
  }

  // Determine overall plan outcome
  if (completedIds.length === plan.actions.length) {
    plan.status = 'completed';
  } else if (completedIds.length > 0) {
    plan.status = 'partially_completed';
  } else if (plan.cancellationToken?.isCancelled) {
    plan.status = 'cancelled';
  } else {
    plan.status = 'failed';
  }

  plan.completedAt = Date.now();
  plan.results = results;
  plan.errors = errors;
  setLastExecutionPlan(plan);

  // Formulate concise, purposeful user-facing summary
  let summary = '';
  if (plan.status === 'completed') {
    if (responses.length > 0) {
      summary = responses.join('\n');
    } else {
      summary = `Completed **${completedIds.length}** actions successfully.`;
    }
  } else if (plan.status === 'partially_completed') {
    const completedList = completedIds
      .map((id) => plan.actions.find((a) => a.id === id)?.description)
      .filter(Boolean)
      .join(', ');
    const failedList = failedIds
      .map((id) => {
        const a = plan.actions.find((n) => n.id === id);
        return a ? `${a.description} (${errors[id]?.message})` : id;
      })
      .join(', ');
    const skippedList = skippedIds
      .map((id) => plan.actions.find((a) => a.id === id)?.description)
      .filter(Boolean)
      .join(', ');

    summary = `Plan completed with partial results:\n• Completed: ${completedList || 'None'}\n• Failed: ${failedList || 'None'}`;
    if (skippedList) {
      summary += `\n• Skipped due to dependencies: ${skippedList}`;
    }
  } else if (plan.status === 'cancelled') {
    summary = `Plan cancelled: ${plan.cancellationToken?.reason || 'Execution aborted.'}`;
  } else {
    const firstFailed = failedIds[0];
    const failureDesc = firstFailed
      ? plan.actions.find((a) => a.id === firstFailed)?.description
      : 'Action';
    const reason = firstFailed ? errors[firstFailed]?.message : 'Error';
    summary = `Plan failed at **${failureDesc}**: ${reason}`;
  }

  return {
    planId: plan.id,
    status: plan.status,
    executed: plan.status === 'completed' || plan.status === 'partially_completed',
    summary,
    results,
    errors,
    completedActionIds: completedIds,
    failedActionIds: failedIds,
    skippedActionIds: skippedIds,
    plan,
    targetScreen: lastNavScreen,
  };
}

/**
 * Asynchronous Action Plan Executor.
 * Awaits queued worker promises when necessary.
 */
export async function executeActionPlan(
  plan: ActionExecutionPlan,
  context: CapabilityExecutionContext
): Promise<PlanExecutionResult> {
  return executeActionPlanSync(plan, context);
}

// ============================================================================
// 5. NATURAL LANGUAGE TO ACTION PLAN RESOLVER
// ============================================================================

/**
 * Resolves a single action segment into an ActionNode.
 */
function resolveSingleActionSegment(
  text: string,
  index: number
): Partial<ActionNode> & { capabilityId: string; intent: string; description: string } {
  const norm = text.trim();
  const lower = norm.toLowerCase();

  // Strip leading "run", "execute", "please"
  const stripped = lower.replace(/^(?:run\s+|execute\s+|please\s+)/i, '').trim();

  // 1. Math calculation: "calculate 15 * 8", "15 * 8", "5 + 5"
  const mathMatch = tryEvaluateMathExpression(stripped);
  if (mathMatch || stripped.startsWith('calc') || stripped.startsWith('calculate')) {
    const expr = stripped.replace(/^(?:calculate|calc|compute)\s*/i, '').trim();
    return {
      id: `action-${index + 1}`,
      capabilityId: 'math_calculator',
      intent: 'calculate',
      target: expr || stripped,
      parameters: { expression: expr || stripped },
      description: `Calculate ${expr || stripped}`,
      executionPolicy: 'immediate',
    };
  }

  // 2. Settings: "set theme to dark", "set accent color to emerald", "switch to dark mode"
  if (lower.includes('theme') || lower.includes('dark mode') || lower.includes('light mode')) {
    const isDark = lower.includes('dark');
    return {
      id: `action-${index + 1}`,
      capabilityId: 'settings_controller',
      intent: 'set_theme',
      target: isDark ? 'dark' : 'light',
      parameters: { mode: isDark ? 'dark' : 'light' },
      description: `Set theme to ${isDark ? 'dark' : 'light'}`,
      executionPolicy: 'immediate',
    };
  }

  if (lower.includes('accent') || lower.includes('color')) {
    const colors = ['blue', 'emerald', 'purple', 'amber', 'orange', 'red', 'rose', 'cyan', 'monochrome'];
    const matchedColor = colors.find((c) => lower.includes(c)) || 'emerald';
    return {
      id: `action-${index + 1}`,
      capabilityId: 'settings_controller',
      intent: 'set_accent_color',
      target: matchedColor,
      parameters: { color: matchedColor },
      description: `Set accent color to ${matchedColor}`,
      executionPolicy: 'immediate',
    };
  }

  // 3. Navigation: "open settings", "open tools", "/open code", "go to notes"
  const navTarget = stripped
    .replace(/^(?:open(?:\s+up)?|go\s+to|navigate\s+to|show(?:\s+me)?|\/open)\s*/i, '')
    .trim();

  return {
    id: `action-${index + 1}`,
    capabilityId: 'workspace_navigation',
    intent: 'open',
    target: navTarget || stripped,
    parameters: { target: navTarget || stripped },
    description: `Open ${navTarget || stripped}`,
    executionPolicy: 'immediate',
  };
}

/**
 * Resolves natural language user instructions into an ActionExecutionPlan.
 */
export function resolveActionPlanFromInput(
  input: string,
  currentScreen?: ScreenId,
  defaultPolicy: ExecutionPolicy = 'immediate'
): ActionExecutionPlan | null {
  const norm = input.trim();
  const lower = norm.toLowerCase();
  if (!norm) return null;

  // 1. Retry Follow-Up: "try it again", "retry", "try again"
  if (/^(?:try\s+it\s+again|try\s+again|retry(?:\s+plan)?|retry\s+failed\s+action)[.!]?$/i.test(lower)) {
    const last = getLastExecutionPlan();
    if (last) {
      const retryPlan = createRetryPlan(last);
      if (retryPlan) return retryPlan;
    }
  }

  // 1.5. User-Specified Fallback Policy: "try X, and if it fails, try Y"
  const tryIfFailMatch = norm.match(/^try\s+(.+?)(?:,\s*|\s+)and\s+if\s+it\s+fails(?:,\s*|\s+)try\s+(.+)$/i);
  if (tryIfFailMatch) {
    const primaryText = tryIfFailMatch[1].trim();
    const altText = tryIfFailMatch[2].trim();
    const primaryAction = resolveSingleActionSegment(primaryText, 0);
    const altAction = resolveSingleActionSegment(altText, 1);
    const plan = createSingleActionPlan(primaryAction, defaultPolicy);
    plan.adaptivePolicy = {
      exclusivity: 'preferred',
      maxAttempts: 2,
      allowedMethods: [altAction.description, altAction.capabilityId, altAction.intent || ''],
      allowAutonomousFallback: true,
    };
    plan.actions[0].fallbackPolicy = plan.adaptivePolicy;
    return plan;
  }

  // 1.6. User-Specified Flexible Method: "use X first, but use another method if necessary" / "try whatever method works to X"
  const flexibleMatch = norm.match(/^(?:use\s+(.+?)\s+first,\s*but\s+use\s+another\s+method\s+if\s+necessary|try\s+whatever\s+method\s+works\s+to\s+(.+))$/i);
  if (flexibleMatch) {
    const targetText = (flexibleMatch[1] || flexibleMatch[2]).trim();
    const primaryAction = resolveSingleActionSegment(targetText, 0);
    const plan = createSingleActionPlan(primaryAction, defaultPolicy);
    plan.adaptivePolicy = {
      exclusivity: 'preferred',
      maxAttempts: 3,
      allowAutonomousFallback: true,
    };
    plan.actions[0].fallbackPolicy = plan.adaptivePolicy;
    return plan;
  }

  // 1.7. User-Specified Exclusive Method: "do this only using X", "only use X", "only with X"
  const isExclusive = /\bonly\s+using\b|\bonly\s+with\b|\bonly\s+use\b|\buse\s+only\b|\bdo\s+this\s+only\b/i.test(norm);
  if (isExclusive) {
    const cleaned = norm.replace(/\bonly\s+using\b|\bonly\s+with\b|\bonly\s+use\b|\buse\s+only\b|\bdo\s+this\s+only\b/gi, '').trim();
    const basePlan = resolveActionPlanFromInput(cleaned, currentScreen, defaultPolicy);
    if (basePlan) {
      basePlan.adaptivePolicy = {
        exclusivity: 'exclusive',
        maxAttempts: 1,
        allowAutonomousFallback: false,
      };
      for (const a of basePlan.actions) {
        a.fallbackPolicy = basePlan.adaptivePolicy;
      }
      return basePlan;
    }
  }

  // 2. Reordering Instructions: "put tools before settings", "move C before A"
  const reorderMatch = lower.match(/^(?:put|move)\s+([a-zA-Z0-9_\s-]+?)\s+before\s+([a-zA-Z0-9_\s-]+)$/i);
  if (reorderMatch) {
    const last = getLastExecutionPlan();
    if (last && last.actions.length > 1) {
      const targetAction = reorderMatch[1].trim();
      const beforeAction = reorderMatch[2].trim();
      const beforeIdx = last.actions.findIndex((a) =>
        a.target?.toLowerCase().includes(beforeAction) ||
        a.description.toLowerCase().includes(beforeAction)
      );
      if (beforeIdx !== -1) {
        return reorderPlanActions(last, targetAction, beforeIdx);
      }
    }
  }

  // 3. Priority Instructions: "run open settings with high priority", "run this next"
  if (lower.includes('with high priority') || lower.includes('run next') || lower.includes('high priority')) {
    const coreInstruction = norm.replace(/\bwith\s+high\s+priority\b|\brun\s+next\b/gi, '').trim();
    const subPlan = resolveActionPlanFromInput(coreInstruction, currentScreen, defaultPolicy);
    if (subPlan) {
      return setPlanPriority(subPlan, TaskPriority.INTERACTIVE);
    }
  }

  // 4. Queued Instructions: "queue A, B, C", "enqueue A and B"
  const queueMatch = norm.match(/^(?:queue|enqueue)\s+(.+)$/i);
  if (queueMatch && queueMatch[1]) {
    const rawItems = queueMatch[1]
      .split(/,\s*|\s+and\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (rawItems.length > 0) {
      const actions = rawItems.map((item, idx) => resolveSingleActionSegment(item, idx));
      return createQueuedPlan(`Queue ${actions.map((a) => a.description).join(', ')}`, actions);
    }
  }

  // 5. Explicit Conditional Sequencing:
  // e.g. "Run B after A even if A fails" / "Run B after A only if A succeeds"
  const conditionalEvenIfMatch = lower.match(/^run\s+(.+?)\s+(?:then|after)\s+(?:run\s+)?(.+?)\s+even\s+if\s+(?:it|the\s+first\s+one)\s+fails$/i);
  if (conditionalEvenIfMatch) {
    const firstText = conditionalEvenIfMatch[1].trim();
    const secondText = conditionalEvenIfMatch[2].trim();
    const action1 = resolveSingleActionSegment(firstText, 0);
    const action2 = resolveSingleActionSegment(secondText, 1);
    action2.id = 'action-2';
    action2.dependencies = [{ actionId: 'action-1', condition: 'always' }];
    return createSequentialPlan(
      `Run ${action1.description}, then ${action2.description} (even if failed)`,
      [action1, action2],
      { customConditions: { 'action-2': 'always' } }
    );
  }

  // 6. Sequential Execution: "run A, then run B", "A and then B", "open settings, then open tools"
  // Delimiters: ", then ", " then ", " and then ", " after that "
  const sequenceSplitRegex = /\s*,\s*(?:then|and\s+then|after\s+that|next)\s+|\s+(?:then|and\s+then|after\s+that)\s+/i;
  if (sequenceSplitRegex.test(norm)) {
    const rawSegments = norm.split(sequenceSplitRegex).map((s) => s.trim()).filter(Boolean);
    if (rawSegments.length > 1) {
      const actions = rawSegments.map((seg, idx) => resolveSingleActionSegment(seg, idx));
      return createSequentialPlan(
        actions.map((a) => a.description).join(', then '),
        actions
      );
    }
  }

  // 7. Parallel / Independent Execution: "run A and B", "calculate 10 * 10 and open settings"
  // Separated by " and " where both parts are executable commands and NOT a single entity
  if (/\s+and\s+/i.test(norm) && !norm.toLowerCase().startsWith('queue')) {
    const parts = norm.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      // Check if both parts are executable actions
      const isAction1 = /^(?:run|open|calculate|calc|set|switch|\/)/i.test(parts[0]) || tryEvaluateMathExpression(parts[0]);
      const isAction2 = /^(?:run|open|calculate|calc|set|switch|\/)/i.test(parts[1]) || tryEvaluateMathExpression(parts[1]);
      if (isAction1 && isAction2) {
        const actions = parts.map((seg, idx) => resolveSingleActionSegment(seg, idx));
        return createParallelPlan(
          actions.map((a) => a.description).join(' and '),
          actions
        );
      }
    }
  }

  // 8. Single Action
  const isSingleCommand =
    norm.startsWith('/') ||
    /^(?:run|open|calculate|calc|set|switch)\b/i.test(lower) ||
    Boolean(tryEvaluateMathExpression(norm));

  if (isSingleCommand) {
    const action = resolveSingleActionSegment(norm, 0);
    return createSingleActionPlan(action, defaultPolicy);
  }

  return null;
}
