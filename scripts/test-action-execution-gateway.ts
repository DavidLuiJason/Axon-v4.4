/**
 * Comprehensive Test Suite for Unified Action Execution Gateway
 *
 * Verifies:
 * 1. Gateway execution request / contract structure
 * 2. Exactly-once execution protection (idempotency, in-flight, cached return)
 * 3. Execution policy enforcement (immediate, confirm, suggest, ask)
 * 4. User confirmation & authorization preservation
 * 5. Capability availability & environment awareness pre-check
 * 6. Capability-owned execution dispatch (no central switch statement)
 * 7. Verification preservation (dispatched vs completed vs obtained vs verified)
 * 8. Action Plan step-level execution integration
 * 9. Adaptive execution fallback integration and attempt history
 * 10. User constraint enforcement ("don't use Y", prohibited capabilities)
 */

import {
  actionExecutionGateway,
  UnifiedActionExecutionGateway,
  ActionExecutionRequest,
  ActionExecutionResult,
} from '../src/lib/actionExecutionGateway';
import {
  systemCapabilityRegistry,
  CapabilityExecutionContext,
  ActionExecutionPlan,
  ActionNode,
} from '../src/lib/capabilitySystem';
import { executeActionPlanSync, createSequentialPlan } from '../src/lib/actionPlan';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ ${testName}${detail ? ` - ${detail}` : ''}`);
    failed++;
  }
}

console.log('\n=== AXON UNIFIED ACTION EXECUTION GATEWAY TEST SUITE ===\n');

// Mock execution context
let navigatedToScreen: string | null = null;
let themeApplied: string | null = null;
let accentApplied: string | null = null;

const mockContext: CapabilityExecutionContext = {
  currentScreen: 'axon',
  navigateTo: (screen, options) => {
    navigatedToScreen = screen;
  },
  settingsHandlers: {
    setThemeMode: (mode: string) => {
      themeApplied = mode;
    },
    setAccentColor: (color: string) => {
      accentApplied = color;
    },
  },
};

// --------------------------------------------------------------------------
// 1. GATEWAY REQUEST CONTRACT & CAPABILITY-OWNED EXECUTION
// --------------------------------------------------------------------------
console.log('--- Suite 1: Capability-Owned Execution Dispatch ---');

// Test A: Math calculation capability execution through gateway
actionExecutionGateway.resetIdempotencyStore();
const mathReq: ActionExecutionRequest = {
  executionId: 'test_math_1',
  capabilityId: 'math_calculator',
  intent: 'calculate',
  parameters: { expression: '42 * 2' },
  context: mockContext,
};
const mathRes = actionExecutionGateway.dispatch(mathReq);

assert(mathRes.status === 'completed', 'Math calculation status is completed');
assert(mathRes.executed === true, 'Math calculation is marked as executed');
assert(mathRes.verified === true, 'Math calculation is verified');
assert(mathRes.result?.calculation?.includes('84'), 'Math calculation produced expected result (84)');
assert(mathRes.attempts?.length === 1, 'Math calculation has 1 execution attempt recorded');

// Test B: Workspace navigation capability execution through gateway
navigatedToScreen = null;
const navReq: ActionExecutionRequest = {
  executionId: 'test_nav_1',
  capabilityId: 'workspace_navigation',
  intent: 'open',
  target: 'storage',
  context: mockContext,
};
const navRes = actionExecutionGateway.dispatch(navReq);

assert(navRes.status === 'completed', 'Workspace navigation status is completed');
assert(navRes.executed === true, 'Workspace navigation executed');
assert(navRes.verified === true, 'Workspace navigation verified');
assert(navRes.targetScreen === 'storage', 'Target screen is storage');
assert(navigatedToScreen === 'storage', 'Context navigateTo called with storage');

// Test C: Registered Color Intelligence execution through gateway
const colorReq: ActionExecutionRequest = {
  executionId: 'test_color_1',
  capabilityId: 'color_intelligence',
  intent: 'evaluate_contrast',
  parameters: { foreground: '#ffffff', background: '#000000' },
  context: mockContext,
};
const colorRes = actionExecutionGateway.dispatch(colorReq);

assert(colorRes.status === 'completed', 'Color Intelligence status is completed');
assert(colorRes.executed === true, 'Color Intelligence executed');
assert(colorRes.verified === true, 'Color Intelligence verified');
assert(colorRes.result?.ratio === 21, 'Color Intelligence returned contrast ratio 21');

// --------------------------------------------------------------------------
// 2. EXACTLY-ONCE EXECUTION PROTECTION (IDEMPOTENCY)
// --------------------------------------------------------------------------
console.log('\n--- Suite 2: Exactly-Once Execution Protection ---');

// Duplicate request with same executionId
const duplicateRes = actionExecutionGateway.dispatch(colorReq);
assert(duplicateRes.isDuplicate === true, 'Duplicate request flagged with isDuplicate = true');
assert(duplicateRes.status === 'completed', 'Duplicate request returns cached completed status');
assert(duplicateRes.result?.ratio === 21, 'Duplicate request returned cached result without re-executing');

// --------------------------------------------------------------------------
// 3. EXECUTION POLICY ENFORCEMENT & CONFIRMATION
// --------------------------------------------------------------------------
console.log('\n--- Suite 3: Execution Policy Enforcement & Confirmation ---');

// Test A: Policy = 'confirm' without user confirmation
const confirmReq: ActionExecutionRequest = {
  executionId: 'test_confirm_unauth',
  capabilityId: 'settings_controller',
  intent: 'set_theme',
  parameters: { mode: 'dark' },
  executionPolicy: 'confirm',
  confirmationState: { isConfirmed: false },
  context: mockContext,
};
const unauthRes = actionExecutionGateway.dispatch(confirmReq);

assert(unauthRes.status === 'requires_confirmation', 'Unconfirmed action returns requires_confirmation');
assert(unauthRes.executed === false, 'Unconfirmed action is not executed');
assert(unauthRes.actions !== undefined && unauthRes.actions.length > 0, 'Confirmation actions provided to user');

// Test B: Policy = 'confirm' WITH user authorization
const authReq: ActionExecutionRequest = {
  executionId: 'test_confirm_auth',
  capabilityId: 'settings_controller',
  intent: 'set_theme',
  parameters: { mode: 'dark' },
  executionPolicy: 'confirm',
  confirmationState: { isConfirmed: true, confirmedBy: 'user_click' },
  context: mockContext,
};
const authRes = actionExecutionGateway.dispatch(authReq);

assert(authRes.status === 'completed', 'Authorized action executed to completion');
assert(authRes.executed === true, 'Authorized action executed = true');
assert(themeApplied === 'dark', 'Settings handler applied dark theme mode');

// Test C: Policy = 'suggest'
const suggestReq: ActionExecutionRequest = {
  executionId: 'test_suggest_1',
  capabilityId: 'workspace_navigation',
  intent: 'open',
  target: 'storage',
  executionPolicy: 'suggest',
  context: mockContext,
};
const suggestRes = actionExecutionGateway.dispatch(suggestReq);

assert(suggestRes.status === 'requires_interaction', 'Suggest policy returns requires_interaction');
assert(suggestRes.executed === false, 'Suggest policy is not auto-executed');
assert(suggestRes.actions?.length === 1, 'Suggested contextual action is provided');

// --------------------------------------------------------------------------
// 4. AVAILABILITY PRE-CHECK & FAILURE CATEGORIZATION
// --------------------------------------------------------------------------
console.log('\n--- Suite 4: Availability Pre-Check & Failure Modes ---');

// Test A: Web research service offline / mock network check
const originalAvail = systemCapabilityRegistry.checkAvailability('web_research_service');
const webReq: ActionExecutionRequest = {
  executionId: 'test_web_offline',
  capabilityId: 'web_research_service',
  intent: 'research_web',
  target: 'quantum computing',
  context: mockContext,
};
const webRes = actionExecutionGateway.dispatch(webReq);

if (!originalAvail.isAvailable) {
  assert(webRes.status === 'unavailable', 'Offline capability returns status: unavailable');
  assert(webRes.executed === false, 'Unavailable capability does not execute');
  assert(webRes.failureCategory === 'availability_failure', 'Failure category is availability_failure');
} else {
  assert(webRes.status === 'completed', 'Web research service executed if available in environment');
}

// Test B: Non-existent capability
const nonExistentReq: ActionExecutionRequest = {
  executionId: 'test_nonexistent',
  capabilityId: 'quantum_teleportation_system',
  intent: 'teleport',
  context: mockContext,
};
const nonExistentRes = actionExecutionGateway.dispatch(nonExistentReq);

assert(nonExistentRes.status === 'unavailable', 'Non-existent capability returns unavailable');
assert(nonExistentRes.executed === false, 'Non-existent capability does not execute');

// --------------------------------------------------------------------------
// 5. USER CONSTRAINT ENFORCEMENT
// --------------------------------------------------------------------------
console.log('\n--- Suite 5: User Constraint Enforcement ---');

const constrainedReq: ActionExecutionRequest = {
  executionId: 'test_constrained',
  capabilityId: 'math_calculator',
  intent: 'calculate',
  parameters: { expression: '10 + 10' },
  userConstraints: {
    prohibitedCapabilities: ['math_calculator'],
  },
  context: mockContext,
};
const constrainedRes = actionExecutionGateway.dispatch(constrainedReq);

assert(constrainedRes.status === 'blocked', 'Constrained capability is blocked');
assert(constrainedRes.failureCategory === 'authorization_blocked', 'Category is authorization_blocked');
assert(constrainedRes.executed === false, 'Constrained capability does not execute');

// --------------------------------------------------------------------------
// 6. ACTION PLAN STEP-LEVEL INTEGRATION
// --------------------------------------------------------------------------
console.log('\n--- Suite 6: Action Plan Step-Level Integration ---');

const mockPlan = createSequentialPlan('Calculate 15 + 25 then open notes', [
  {
    id: 'step_1',
    capabilityId: 'math_calculator',
    intent: 'calculate',
    description: 'Calculate 15 + 25',
    parameters: { expression: '15 + 25' },
  },
  {
    id: 'step_2',
    capabilityId: 'workspace_navigation',
    intent: 'open',
    target: 'notes',
    description: 'Open Notes interface',
    dependencies: [
      {
        actionId: 'step_1',
        condition: 'on_success',
      },
    ],
  },
]);

// Execute single step through gateway executePlanStep
const step1Res = actionExecutionGateway.executePlanStep(mockPlan.actions[0], mockPlan, mockContext);
assert(step1Res.status === 'completed', 'Step 1 executed through executePlanStep completed');
assert(step1Res.result?.calculation?.includes('40'), 'Step 1 calculation verified (40)');
assert(step1Res.originatingStepId === 'step_1', 'Originating step ID is preserved');

// Full Plan Execution via executeActionPlanSync (verifying end-to-end gateway orchestration)
navigatedToScreen = null;
const planResult = executeActionPlanSync(mockPlan, mockContext);

assert(planResult.executed === true, 'Full action plan executed successfully through gateway');
assert(planResult.plan.status === 'completed', 'Action plan marked completed');
assert(planResult.completedActionIds.length === 2, 'Both plan steps completed through gateway');
assert(navigatedToScreen === 'notes', 'Step 2 navigation successfully routed to notes');

// --------------------------------------------------------------------------
// 7. ADAPTIVE EXECUTION FALLBACK VIA GATEWAY
// --------------------------------------------------------------------------
console.log('\n--- Suite 7: Adaptive Execution Fallback via Gateway ---');

const adaptiveReq: ActionExecutionRequest = {
  executionId: 'test_adaptive_gateway',
  capabilityId: 'non_existent_or_offline_tool',
  intent: 'open_canvas',
  target: 'canvas',
  context: mockContext,
  fallbackPolicy: {
    exclusivity: 'preferred',
    maxAttempts: 2,
    allowAutonomousFallback: true,
  },
};

const adaptiveRes = actionExecutionGateway.dispatch(adaptiveReq);
assert(adaptiveRes.attempts !== undefined && adaptiveRes.attempts.length > 0, 'Adaptive attempts recorded');
if (adaptiveRes.status === 'completed') {
  assert(adaptiveRes.adapted === true, 'Adaptive execution marked as adapted');
  assert(adaptiveRes.actualMethodUsed !== undefined, 'Actual method used is recorded');
}

// --------------------------------------------------------------------------
// SUMMARY
// --------------------------------------------------------------------------
console.log('\n=== TEST SUMMARY ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.error(`\nTest suite failed with ${failed} failure(s).`);
  process.exit(1);
} else {
  console.log('\nAll Unified Action Execution Gateway tests passed successfully!\n');
  process.exit(0);
}
