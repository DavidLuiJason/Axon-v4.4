/**
 * AXON Action Plan & Execution Plan Architecture Verification Suite
 */

import {
  createSingleActionPlan,
  createSequentialPlan,
  createParallelPlan,
  createQueuedPlan,
  reorderPlanActions,
  setPlanPriority,
  cancelPlan,
  createRetryPlan,
  evaluateActionDependencies,
  executeActionPlanSync,
  resolveActionPlanFromInput,
  getLastExecutionPlan,
  setLastExecutionPlan,
  clearLastExecutionPlan,
} from '../src/lib/actionPlan';
import { evaluateChatCommand } from '../src/lib/commandRouter';
import { TaskPriority } from '../src/lib/runtime/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${testName}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
  }
}

console.log('=== TEST SUITE: AXON ACTION PLAN & EXECUTION LAYER ===\n');

// ----------------------------------------------------------------------------
// TEST GROUP 1: Single Action Representation & Execution
// ----------------------------------------------------------------------------
console.log('--- Test Group 1: Single Action Plan ---');
{
  const singlePlan = createSingleActionPlan({
    capabilityId: 'math_calculator',
    intent: 'calculate',
    target: '25 * 4',
    parameters: { expression: '25 * 4' },
    description: 'Calculate 25 * 4',
  });

  assert(singlePlan.type === 'single', 'Plan type is single');
  assert(singlePlan.actions.length === 1, 'Contains exactly 1 action node');
  assert(singlePlan.status === 'created', 'Initial status is created');

  let navTarget: string | null = null;
  const mockContext = {
    currentScreen: 'chat' as any,
    navigateTo: (screen: any) => {
      navTarget = screen;
    },
  };

  const result = executeActionPlanSync(singlePlan, mockContext);
  assert(result.status === 'completed', 'Execution completes successfully');
  assert(result.executed === true, 'Plan executed flag is true');
  assert(result.completedActionIds.includes('action-1'), 'Action-1 marked as completed');
  assert(result.summary.includes('100'), 'Summary contains math calculation result');
}

// ----------------------------------------------------------------------------
// TEST GROUP 2: Sequential Execution with Dependencies
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 2: Sequential Actions & Dependencies ---');
{
  let openCount = 0;
  const openedScreens: string[] = [];
  const mockContext = {
    currentScreen: 'chat' as any,
    navigateTo: (screen: any) => {
      openCount++;
      openedScreens.push(screen);
    },
  };

  const seqPlan = createSequentialPlan('Open Settings then Tools', [
    {
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'settings',
      description: 'Open Settings',
    },
    {
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'tools',
      description: 'Open Tools',
    },
  ]);

  assert(seqPlan.type === 'sequence', 'Sequential plan has type sequence');
  assert(seqPlan.actions.length === 2, 'Sequential plan has 2 actions');
  assert(
    seqPlan.actions[1].dependencies?.[0]?.actionId === 'action-1',
    'Second action depends on first action'
  );
  assert(
    seqPlan.actions[1].dependencies?.[0]?.condition === 'on_success',
    'Default condition is on_success'
  );

  const res = executeActionPlanSync(seqPlan, mockContext);
  assert(res.status === 'completed', 'Sequential plan execution completes');
  assert(res.completedActionIds.length === 2, 'Both actions completed in sequence');
  assert(openedScreens.includes('settings') && openedScreens.includes('tools'), 'Both screens navigated');
}

// ----------------------------------------------------------------------------
// TEST GROUP 3: Failure Handling & Dependency Skipping
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 3: Failure Handling & Dependency Skipping ---');
{
  const mockContext = {
    currentScreen: 'chat' as any,
    navigateTo: () => {},
  };

  // Action 1 will fail because the math expression is unparseable gibberish
  // Action 2 depends on Action 1 on_success, so it should be skipped
  const failingSeqPlan = createSequentialPlan('Failing sequence', [
    {
      id: 'step-1',
      capabilityId: 'math_calculator',
      intent: 'calculate',
      target: 'invalid@@@syntax',
      parameters: { expression: 'invalid@@@syntax' },
      description: 'Invalid calculation',
    },
    {
      id: 'step-2',
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'settings',
      description: 'Open Settings',
      dependencies: [{ actionId: 'step-1', condition: 'on_success' }],
    },
  ]);

  const res = executeActionPlanSync(failingSeqPlan, mockContext);
  assert(res.status === 'failed', 'Overall plan status is failed');
  assert(res.failedActionIds.includes('step-1'), 'Step 1 marked failed');
  assert(res.skippedActionIds.includes('step-2'), 'Step 2 skipped due to step 1 failure');
  assert(
    res.summary.includes('failed') || res.summary.includes('Skipped'),
    'Summary explains failure and skipped status'
  );
}

// ----------------------------------------------------------------------------
// TEST GROUP 4: Conditional Execution (Even If Failed)
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 4: Conditional Execution (Always condition) ---');
{
  const tracker = { step2Ran: false };
  const mockContext = {
    currentScreen: 'chat' as any,
    navigateTo: (screen: any) => {
      if (screen === 'settings') tracker.step2Ran = true;
    },
  };

  const conditionalPlan = createSequentialPlan('Conditional sequence', [
    {
      id: 'step-1',
      capabilityId: 'math_calculator',
      intent: 'calculate',
      target: 'invalid@@@expression',
      parameters: { expression: 'invalid@@@expression' },
      description: 'Invalid calculation',
    },
    {
      id: 'step-2',
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'settings',
      description: 'Open Settings',
      dependencies: [{ actionId: 'step-1', condition: 'always' }],
    },
  ]);

  const res = executeActionPlanSync(conditionalPlan, mockContext);
  assert(res.failedActionIds.includes('step-1'), 'Step 1 failed');
  assert(res.completedActionIds.includes('step-2'), 'Step 2 executed because condition was always');
  assert(tracker.step2Ran === true, 'Step 2 navigation actually triggered');
}

// ----------------------------------------------------------------------------
// TEST GROUP 5: Parallel / Independent Actions
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 5: Parallel Independent Actions ---');
{
  const tracker = { navigated: false };
  const mockContext = {
    currentScreen: 'chat' as any,
    navigateTo: () => {
      tracker.navigated = true;
    },
  };

  const parallelPlan = createParallelPlan('Compute and Navigate', [
    {
      capabilityId: 'math_calculator',
      intent: 'calculate',
      target: '15 * 8',
      parameters: { expression: '15 * 8' },
      description: 'Calculate 15 * 8',
    },
    {
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'settings',
      description: 'Open Settings',
    },
  ]);

  assert(parallelPlan.type === 'parallel', 'Plan type is parallel');
  const res = executeActionPlanSync(parallelPlan, mockContext);
  assert(res.status === 'completed', 'Parallel plan completed');
  assert(res.completedActionIds.length === 2, 'Both parallel actions completed');
  assert(tracker.navigated === true, 'Navigation action occurred');
}

// ----------------------------------------------------------------------------
// TEST GROUP 6: Queued Plan (Runtime Workload Integration)
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 6: Queued Plans ---');
{
  const mockContext = {
    currentScreen: 'chat' as any,
    navigateTo: () => {},
  };

  const queuedPlan = createQueuedPlan('Queued operations', [
    {
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'settings',
      description: 'Open Settings',
    },
    {
      capabilityId: 'math_calculator',
      intent: 'calculate',
      target: '50 * 2',
      parameters: { expression: '50 * 2' },
      description: 'Calculate 50 * 2',
    },
  ]);

  assert(queuedPlan.type === 'queue', 'Plan type is queue');
  const res = executeActionPlanSync(queuedPlan, mockContext);
  assert(res.status === 'executing', 'Queued plan status is executing');
  assert(res.summary.includes('Queued'), 'Summary reports queued state');
}

// ----------------------------------------------------------------------------
// TEST GROUP 7: Priority, Reordering, Cancellation, and Retries
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 7: Priority, Reordering, Cancellation, Retries ---');
{
  const seqPlan = createSequentialPlan('Test Reorder and Priority', [
    {
      id: 'act-a',
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'settings',
      description: 'Open Settings',
    },
    {
      id: 'act-b',
      capabilityId: 'workspace_navigation',
      intent: 'open',
      target: 'tools',
      description: 'Open Tools',
    },
  ]);

  // Reorder
  reorderPlanActions(seqPlan, 'act-b', 0);
  assert(seqPlan.actions[0].id === 'act-b', 'act-b moved to front');
  assert(seqPlan.actions[1].dependencies?.[0]?.actionId === 'act-b', 'Dependency updated after reordering');

  // Set Priority
  setPlanPriority(seqPlan, TaskPriority.INTERACTIVE);
  assert(seqPlan.priority === TaskPriority.INTERACTIVE, 'Plan priority updated');
  assert(seqPlan.actions[0].priority === TaskPriority.INTERACTIVE, 'Action priority propagated');

  // Cancellation
  cancelPlan(seqPlan, 'User stopped flow');
  assert(seqPlan.status === 'cancelled', 'Plan status is cancelled');
  assert(seqPlan.actions[0].status === 'cancelled', 'Action status marked cancelled');

  // Retries
  const failedPlan = createSequentialPlan('Failed test', [
    {
      id: 'f-1',
      capabilityId: 'math_calculator',
      intent: 'calculate',
      target: 'bad',
      description: 'Bad math',
    },
  ]);
  failedPlan.actions[0].status = 'failed';
  const retryPlan = createRetryPlan(failedPlan);
  assert(retryPlan !== null, 'Retry plan generated');
  assert(retryPlan!.actions[0].id.includes('retry_f-1'), 'Retry action ID formulated');
}

// ----------------------------------------------------------------------------
// TEST GROUP 8: Natural Language to Action Plan Resolution
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 8: Natural Language Plan Resolution ---');
{
  // 1. Sequential instruction
  const plan1 = resolveActionPlanFromInput('open settings, then open tools');
  assert(plan1 !== null, 'Resolved sequential instruction');
  assert(plan1?.type === 'sequence', 'Sequential type detected');
  assert(plan1?.actions.length === 2, '2 actions parsed in sequence');

  // 2. Parallel instruction
  const plan2 = resolveActionPlanFromInput('calculate 15 * 8 and open settings');
  assert(plan2 !== null, 'Resolved parallel instruction');
  assert(plan2?.type === 'parallel', 'Parallel type detected');
  assert(plan2?.actions.length === 2, '2 independent actions parsed');

  // 3. Queued instruction
  const plan3 = resolveActionPlanFromInput('queue open settings, open tools, calculate 10 * 10');
  assert(plan3 !== null, 'Resolved queue instruction');
  assert(plan3?.type === 'queue', 'Queue type detected');
  assert(plan3?.actions.length === 3, '3 queued actions parsed');

  // 4. Conditional instruction
  const plan4 = resolveActionPlanFromInput('run open settings then run calculate 100 * 2 even if it fails');
  assert(plan4 !== null, 'Resolved conditional instruction');
  assert(plan4?.actions[1].dependencies?.[0]?.condition === 'always', 'Condition is always');
}

// ----------------------------------------------------------------------------
// TEST GROUP 9: End-to-End Chat Command Integration
// ----------------------------------------------------------------------------
console.log('\n--- Test Group 9: Command Router Integration ---');
{
  const opened: string[] = [];
  const mockActions = {
    navigateTo: (screen: any) => {
      opened.push(screen);
    },
    settingsHandlers: {
      setThemeMode: () => {},
      setAccentColor: () => {},
    },
  };

  // Sequential command via evaluateChatCommand
  const cmdRes = evaluateChatCommand(
    'open settings, then open tools',
    mockActions,
    'chat' as any
  );

  assert(cmdRes.handled === true, 'Command was handled');
  assert(cmdRes.executed === true, 'Command was executed');
  assert(cmdRes.plan !== undefined, 'Command returned execution plan');
  assert(cmdRes.plan?.type === 'sequence', 'Returned plan is sequence');
  assert(opened.includes('settings') && opened.includes('tools'), 'Both screens navigated in router');

  // Queue command via evaluateChatCommand
  const queueCmdRes = evaluateChatCommand(
    'queue open settings and open tools',
    mockActions,
    'chat' as any
  );
  assert(queueCmdRes.handled === true, 'Queue command was handled');
  assert(queueCmdRes.plan?.type === 'queue', 'Queue plan created and dispatched');
}

console.log('\n====================================================');
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed === 0) {
  console.log('SUCCESS: All Action Plan architecture tests passed flawlessly!\n');
  process.exit(0);
} else {
  console.error(`FAILURE: ${failed} tests failed!\n`);
  process.exit(1);
}
