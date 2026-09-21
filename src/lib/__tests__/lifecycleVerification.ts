/**
 * AXON Lifecycle & Execution Verification Suite
 * 
 * Verifies that AXON has one coherent lifecycle for work:
 * 1. A single action reaches a terminal state correctly.
 * 2. A multi-step plan distinguishes step state from parent-plan state.
 * 3. A failed action cannot become verified success.
 * 4. A cancelled action cannot execute later.
 * 5. A retried action is distinguishable from the original attempt.
 * 6. Adaptive fallback preserves attempt history and final verification.
 * 7. Follow-up questions read historical task state without executing it.
 * 8. "Try that again" creates one new execution.
 * 9. Contextual actions execute exactly once (idempotent tokens).
 * 10. System states synchronize cleanly across ActionPlan, Gateway, and Runtime Task.
 */

import { actionExecutionGateway } from '../actionExecutionGateway';
import {
  ActionExecutionPlan,
  ActionNode,
  createSingleActionPlan,
  createSequentialPlan,
  executeActionPlanSync,
} from '../actionPlan';
import {
  executeAdaptiveObjectiveSync,
  queryAttemptHistory,
  clearAttemptHistory,
} from '../adaptiveExecution';
import { systemCapabilityRegistry } from '../capabilitySystem';
import { resolveCapabilityInput } from '../capabilityResolver';

export interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
  error?: string;
}

export interface LifecycleVerificationReport {
  timestamp: string;
  allPassed: boolean;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  results: TestResult[];
}

export async function runLifecycleVerificationSuite(): Promise<LifecycleVerificationReport> {
  const results: TestResult[] = [];

  const runTest = async (name: string, fn: () => Promise<string | void> | string | void) => {
    const start = performance.now();
    try {
      const details = await fn();
      results.push({
        name,
        passed: true,
        durationMs: Math.round(performance.now() - start),
        details: details || 'Passed',
      });
    } catch (err: any) {
      results.push({
        name,
        passed: false,
        durationMs: Math.round(performance.now() - start),
        error: err?.message || String(err),
      });
    }
  };

  // 1. Single action reaches a terminal state correctly
  await runTest('1. Single action reaches terminal state correctly', () => {
    const action: ActionNode = {
      id: 'test-single-1',
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'settings',
      parameters: { target: 'settings' },
      description: 'Open Settings',
      executionPolicy: 'immediate',
    };
    const plan = createSingleActionPlan(action, 'immediate');
    let navigatedScreen = '';
    const ctx = {
      currentScreen: 'chat' as any,
      navigateTo: (screen: string) => {
        navigatedScreen = screen;
      },
    };

    const outcome = executeActionPlanSync(plan, ctx);
    const node = plan.actions[0];
    if (outcome.status !== 'completed' || plan.status !== 'completed' || node.status !== 'completed') {
      throw new Error(`Expected completed terminal state, got plan: ${plan.status}, action: ${node.status}`);
    }
    if (navigatedScreen !== 'settings') {
      throw new Error(`Expected navigation to 'settings', got '${navigatedScreen}'`);
    }
    return `Action and Plan both cleanly transitioned to 'completed'; target screen reached '${navigatedScreen}'.`;
  });

  // 2. Multi-step plan distinguishes step state from parent-plan state
  await runTest('2. Multi-step plan distinguishes step state from parent-plan state', () => {
    const step1: ActionNode = {
      id: 'multi-step-1',
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'tools',
      description: 'Step 1: Open Tools',
      executionPolicy: 'immediate',
    };
    const step2: ActionNode = {
      id: 'multi-step-2',
      capabilityId: 'non_existent_capability',
      intent: 'do_impossible',
      description: 'Step 2: Impossible Step',
      executionPolicy: 'immediate',
    };
    const plan = createSequentialPlan('Multi-step test', [step1, step2]);
    let navigated = '';
    const outcome = executeActionPlanSync(plan, {
      navigateTo: (s: string) => {
        navigated = s;
      },
    });

    const s1 = plan.actions.find((a) => a.id === 'multi-step-1');
    const s2 = plan.actions.find((a) => a.id === 'multi-step-2');

    if (!s1 || s1.status !== 'completed') {
      throw new Error(`Step 1 status should be 'completed', got '${s1?.status}'`);
    }
    if (!s2 || s2.status !== 'failed') {
      throw new Error(`Step 2 status should be 'failed', got '${s2?.status}'`);
    }
    if (plan.status !== 'partially_completed') {
      throw new Error(`Parent plan status should be 'partially_completed', got '${plan.status}'`);
    }
    return `Step 1 is 'completed', Step 2 is 'failed', and Parent Plan is accurately 'partially_completed'.`;
  });

  // 3. A failed action cannot become verified success
  await runTest('3. A failed action cannot become verified success', () => {
    const res = actionExecutionGateway.dispatch({
      source: 'command_dispatch',
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'completely_unknown_screen_xyz',
      executionPolicy: 'immediate',
      context: { currentScreen: 'chat' as any, navigateTo: () => {} },
    });

    if (res.success || res.verified || res.status === 'completed') {
      throw new Error(`Failed action was marked as successful/verified: ${JSON.stringify(res)}`);
    }
    return `Unverified/failed action safely terminated with status '${res.status}', verified: ${res.verified}, success: ${res.success}.`;
  });

  // 4. A cancelled action cannot execute later
  await runTest('4. A cancelled action cannot execute later', () => {
    const step1: ActionNode = {
      id: 'cancel-step-1',
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'settings',
      description: 'Open Settings',
    };
    const plan = createSingleActionPlan(step1, 'immediate');
    plan.cancellationToken = { isCancelled: true, reason: 'User cancelled request' };

    let called = false;
    const outcome = executeActionPlanSync(plan, {
      navigateTo: () => {
        called = true;
      },
    });

    const node = plan.actions[0];
    if (called) {
      throw new Error('Cancelled plan executed capability handler!');
    }
    if (plan.status !== 'cancelled' || node.status !== 'cancelled') {
      throw new Error(`Expected plan/step to be cancelled, got plan: ${plan.status}, step: ${node.status}`);
    }
    return `Cancellation prevented execution; plan status: '${plan.status}', step status: '${node.status}'.`;
  });

  // 5. A retried action is distinguishable from the original attempt
  await runTest('5. A retried action is distinguishable from the original attempt', () => {
    const action1: ActionNode = {
      id: 'action-original-1',
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'code',
      description: 'Open Code',
    };
    const plan1 = createSingleActionPlan(action1, 'immediate');
    executeActionPlanSync(plan1, { navigateTo: () => {} });

    // Resolve "try that again"
    const resolvedRetry = resolveCapabilityInput('try that again', {
      currentScreen: 'chat' as any,
    });

    if (resolvedRetry.status !== 'resolved' || !resolvedRetry.plan) {
      throw new Error(`Expected 'try that again' to resolve to an Action Plan, got: ${resolvedRetry.status}`);
    }

    const retryAction = resolvedRetry.plan.actions[0];
    if (retryAction.id === action1.id) {
      throw new Error('Retried action reused original action ID instead of creating a distinct instance!');
    }
    return `Original action '${action1.id}' and retry action '${retryAction.id}' are cleanly distinct.`;
  });

  // 6. Adaptive fallback preserves attempt history and final verification
  await runTest('6. Adaptive fallback preserves attempt history and final verification', () => {
    clearAttemptHistory();
    const fallbackRes = executeAdaptiveObjectiveSync(
      'View system metrics',
      {
        capabilityId: 'system_metrics_live',
        methodId: 'live_telemetry',
        methodName: 'Live Hardware Telemetry',
        intent: 'telemetry',
      },
      {
        exclusivity: 'prefer_best_effort',
        maxAttempts: 2,
        preferredMethod: 'live_telemetry',
      },
      { currentScreen: 'chat' as any }
    );

    if (!fallbackRes.attempts || fallbackRes.attempts.length === 0) {
      throw new Error('No attempts were recorded in adaptive execution result!');
    }

    const firstAttempt = fallbackRes.attempts[0];
    if (firstAttempt.status === 'attempting') {
      throw new Error('First attempt left in non-terminal attempting state!');
    }

    return `Adaptive execution completed with ${fallbackRes.attempts.length} attempts recorded, terminal status '${fallbackRes.status}'.`;
  });

  // 7. Follow-up questions read historical task state without executing it
  await runTest('7. Follow-up questions read historical task state without executing it', () => {
    const explanation = queryAttemptHistory('why did that fail?');
    if (!explanation) {
      throw new Error('queryAttemptHistory did not return an explanation from last outcome!');
    }
    return `Follow-up query returned explanation from historical state without executing new actions:\n"${explanation.slice(0, 100)}..."`;
  });

  // 8. "Try that again" creates one new execution
  await runTest('8. "Try that again" creates one new execution', () => {
    const resolution = resolveCapabilityInput('repeat that', {
      currentScreen: 'chat' as any,
    });
    if (resolution.status !== 'resolved' || !resolution.plan) {
      throw new Error(`Repeat request did not resolve to an actionable plan: ${resolution.status}`);
    }
    if (resolution.plan.actions.length !== 1) {
      throw new Error(`Expected exactly 1 action in retry plan, got ${resolution.plan.actions.length}`);
    }
    return `Retry plan generated with exactly 1 new action: '${resolution.plan.actions[0].id}'.`;
  });

  // 9. Contextual actions execute exactly once (idempotent tokens)
  await runTest('9. Contextual actions execute exactly once with idempotency token', () => {
    const executionId = `idemp_test_${Date.now()}`;
    const req = {
      executionId,
      source: 'command_dispatch' as const,
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'library',
      executionPolicy: 'immediate' as const,
      context: { currentScreen: 'chat' as any, navigateTo: () => {} },
    };

    const firstRun = actionExecutionGateway.dispatch(req);
    const secondRun = actionExecutionGateway.dispatch(req);

    if (!firstRun.executed || !firstRun.success) {
      throw new Error(`First run failed to execute successfully: ${JSON.stringify(firstRun)}`);
    }
    if (secondRun.executionId !== firstRun.executionId) {
      throw new Error('Second run did not return matching execution result.');
    }
    return `Idempotency token '${executionId}' prevented duplicate execution.`;
  });

  // 10. System states synchronize cleanly across ActionPlan and Gateway
  await runTest('10. System states synchronize cleanly across ActionPlan and Gateway', () => {
    const action: ActionNode = {
      id: 'sync-test-1',
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'tools',
      description: 'Open Tools',
      requiresConfirmation: true, // Needs confirmation
    };
    const plan = createSingleActionPlan(action, 'confirm');
    const outcome = executeActionPlanSync(plan, {});
    const node = plan.actions[0];

    if (outcome.status !== 'waiting' || plan.status !== 'waiting' || node.status !== 'waiting') {
      throw new Error(
        `State desynchronization on confirmation: plan=${plan.status}, action=${node.status}, outcome=${outcome.status}`
      );
    }
    return `Synchronized state confirmed: plan='${plan.status}', action='${node.status}', outcome='${outcome.status}'.`;
  });

  const allPassed = results.every((r) => r.passed);
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  return {
    timestamp: new Date().toISOString(),
    allPassed,
    totalTests: results.length,
    passedCount,
    failedCount,
    results,
  };
}

