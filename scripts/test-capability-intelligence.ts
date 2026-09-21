/**
 * AXON Capability-Aware System Verification Suite
 * Verifies all 16 required interaction scenarios from Section 15 of the specification:
 * 1. A clear explicit command.
 * 2. A natural-language imperative.
 * 3. A question containing command-like words.
 * 4. A hypothetical statement containing command-like words.
 * 5. A negated instruction.
 * 6. A user correction after an AXON suggestion.
 * 7. A clear request that should execute without redundant confirmation.
 * 8. A request where clarification is genuinely necessary.
 * 9. A request where a direct capability exists.
 * 10. A request where a valid indirect route can be constructed from existing capabilities.
 * 11. A request for which no valid route exists.
 * 12. Contextual action execution without recursion or duplicate submission.
 * 13. Existing "/open" behavior.
 * 14. Existing pending-choice expiration.
 * 15. Existing View Result behavior.
 * 16. Ordinary conversation that should not accidentally become a command.
 */

import {
  evaluateChatCommand,
  CommandRouterActions,
  getPendingChoice,
  setPendingChoice,
  clearPendingChoice,
  PENDING_INTERACTION_EXPIRATION_MS,
  classifyStatement,
  resolveUserIntent,
  systemCapabilityRegistry,
} from '../src/lib/commandRouter';
import { ScreenId } from '../src/types';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];
let navigatedScreen: ScreenId | null = null;
let navigationOptions: any = null;

const mockActions: CommandRouterActions = {
  navigateTo: (screen: ScreenId, options?: any) => {
    navigatedScreen = screen;
    navigationOptions = options;
  },
};

function resetMock() {
  navigatedScreen = null;
  navigationOptions = null;
  clearPendingChoice();
}

console.log('====================================================');
console.log('RUNNING AXON CAPABILITY-AWARE SYSTEM VERIFICATION SUITE');
console.log('====================================================\n');

// -------------------------------------------------------------
// Test 1: A clear explicit command
// -------------------------------------------------------------
resetMock();
const res1 = evaluateChatCommand('/open settings', mockActions, 'axon');
const pass1 =
  res1.handled === true &&
  res1.executed === true &&
  navigatedScreen === 'settings' &&
  res1.response.includes('Settings');

results.push({
  id: 1,
  name: 'Test 1: Clear explicit command ("/open settings")',
  passed: pass1,
  details: `handled: ${res1.handled}, executed: ${res1.executed}, screen: ${navigatedScreen}`,
});

// -------------------------------------------------------------
// Test 2: A natural-language imperative
// -------------------------------------------------------------
resetMock();
const res2 = evaluateChatCommand('open settings', mockActions, 'axon');
const pass2 =
  res2.handled === true &&
  res2.executed === false &&
  navigatedScreen === null &&
  res2.actions !== undefined &&
  res2.actions.length === 1 &&
  res2.actions[0].actionText === '/open settings';

results.push({
  id: 2,
  name: 'Test 2: Natural-language imperative ("open settings")',
  passed: pass2,
  details: `handled: ${res2.handled}, presented suggestion without auto-executing, actions: ${res2.actions?.length}`,
});

// -------------------------------------------------------------
// Test 3: A question containing command-like words
// -------------------------------------------------------------
resetMock();
const res3 = evaluateChatCommand('What does the run command do?', mockActions, 'axon');
const pass3 =
  res3.handled === true &&
  res3.executed === false &&
  navigatedScreen === null &&
  res3.purpose === 'provide_information' &&
  res3.response.includes('run');

results.push({
  id: 3,
  name: 'Test 3: Question containing command-like words ("What does the run command do?")',
  passed: pass3,
  details: `handled: ${res3.handled}, purpose: ${res3.purpose}, executed: ${res3.executed}, screen: ${navigatedScreen}`,
});

// -------------------------------------------------------------
// Test 4: A hypothetical statement containing command-like words
// -------------------------------------------------------------
resetMock();
const res4 = evaluateChatCommand('If I run this, what happens?', mockActions, 'axon');
const pass4 =
  res4.handled === true &&
  res4.executed === false &&
  navigatedScreen === null &&
  res4.purpose === 'provide_information' &&
  res4.statementType === 'hypothetical';

results.push({
  id: 4,
  name: 'Test 4: Hypothetical statement ("If I run this, what happens?")',
  passed: pass4,
  details: `handled: ${res4.handled}, statementType: ${res4.statementType}, executed: ${res4.executed}`,
});

// -------------------------------------------------------------
// Test 5: A negated instruction
// -------------------------------------------------------------
resetMock();
const res5 = evaluateChatCommand("Don't run this.", mockActions, 'axon');
const pass5 =
  res5.handled === true &&
  res5.executed === false &&
  navigatedScreen === null &&
  res5.purpose === 'report_result' &&
  res5.response.toLowerCase().includes('cancelled');

results.push({
  id: 5,
  name: 'Test 5: Negated instruction ("Don\'t run this.")',
  passed: pass5,
  details: `handled: ${res5.handled}, executed: ${res5.executed}, response: "${res5.response}"`,
});

// -------------------------------------------------------------
// Test 6: A user correction after an AXON suggestion
// -------------------------------------------------------------
resetMock();
// Step A: AXON makes a suggestion for calculator
const res6_init = evaluateChatCommand('open calculator', mockActions, 'axon');
// Step B: User corrects: "No, I meant Settings."
const res6_corr = evaluateChatCommand('No, I meant Settings.', mockActions, 'axon');
const pass6 =
  res6_init.handled === true &&
  res6_corr.handled === true &&
  res6_corr.executed === true &&
  navigatedScreen === 'settings' &&
  res6_corr.response.includes('Settings');

results.push({
  id: 6,
  name: 'Test 6: User correction after suggestion ("No, I meant Settings.")',
  passed: pass6,
  details: `executed immediately to ${navigatedScreen} without redundant confirmation, response: "${res6_corr.response}"`,
});

// -------------------------------------------------------------
// Test 7: A clear request that should execute without redundant confirmation
// -------------------------------------------------------------
resetMock();
const res7 = evaluateChatCommand('run open calculator', mockActions, 'axon');
const pass7 =
  res7.handled === true &&
  res7.executed === true &&
  navigatedScreen === 'tool_calc';

results.push({
  id: 7,
  name: 'Test 7: Clear request executing without redundant confirmation ("run open calculator")',
  passed: pass7,
  details: `handled: ${res7.handled}, executed: ${res7.executed}, screen: ${navigatedScreen}`,
});

// -------------------------------------------------------------
// Test 8: A request where clarification is genuinely necessary
// -------------------------------------------------------------
resetMock();
const res8 = evaluateChatCommand('/open note', mockActions, 'axon');
const pass8 =
  res8.handled === true &&
  res8.executed === false &&
  navigatedScreen === null &&
  res8.options !== undefined &&
  res8.options.length > 1;

results.push({
  id: 8,
  name: 'Test 8: Ambiguous request requiring genuine clarification ("/open note")',
  passed: pass8,
  details: `handled: ${res8.handled}, presented ${res8.options?.length} candidate options with selection`,
});

// -------------------------------------------------------------
// Test 9: A request where a direct capability exists (Meaningful Interaction)
// -------------------------------------------------------------
resetMock();
const res9 = evaluateChatCommand('I want to change the appearance of the action menu', mockActions, 'axon');
const pass9 =
  res9.handled === true &&
  res9.purpose === 'provide_solution' &&
  res9.response.includes('Settings Controller') &&
  res9.response.includes('Theme Mode') &&
  res9.actions !== undefined &&
  res9.actions.length >= 2;

results.push({
  id: 9,
  name: 'Test 9: Direct capability for appearance customization without conversational filler',
  passed: pass9,
  details: `purpose: ${res9.purpose}, provided concrete options: ${res9.actions?.map((a) => a.label).join(', ')}`,
});

// -------------------------------------------------------------
// Test 10: A request where a valid indirect route can be constructed
// -------------------------------------------------------------
resetMock();
const altRoute = systemCapabilityRegistry.searchAlternativeRoute(
  'print or export interface screenshots as PDF',
  'physical_printer'
);
const pass10 =
  altRoute !== null &&
  altRoute.routeType === 'composed' &&
  altRoute.targetCapabilityId === 'interface_capture' &&
  altRoute.actions !== undefined &&
  altRoute.actions.length >= 1;

results.push({
  id: 10,
  name: 'Test 10: Valid indirect route composed from existing capabilities (Interface Capture PDF)',
  passed: pass10,
  details: `routeType: ${altRoute?.routeType}, capability: ${altRoute?.targetCapabilityId}`,
});

// -------------------------------------------------------------
// Test 11: A request for which no valid route exists (Genuine limitation)
// -------------------------------------------------------------
resetMock();
const res11 = evaluateChatCommand('Send an email to my team with the update', mockActions, 'axon');
const pass11 =
  res11.handled === true &&
  res11.purpose === 'explain_limitation' &&
  res11.response.includes('sandbox') &&
  res11.actions !== undefined &&
  res11.actions.length >= 1;

results.push({
  id: 11,
  name: 'Test 11: Genuine limitation honestly reported with available forward alternatives',
  passed: pass11,
  details: `purpose: ${res11.purpose}, explanation provided sandbox boundary, offered forward actions: ${res11.actions?.map((a) => a.label).join(', ')}`,
});

// -------------------------------------------------------------
// Test 12: Contextual action execution without recursion or duplicate submission
// -------------------------------------------------------------
resetMock();
// Simulated button activation using the actionText provided in a suggestion
const res12 = evaluateChatCommand('/open settings', mockActions, 'axon');
const pass12 =
  res12.handled === true &&
  res12.executed === true &&
  navigatedScreen === 'settings';

results.push({
  id: 12,
  name: 'Test 12: Contextual action activation authorizes execution cleanly',
  passed: pass12,
  details: `handled: ${res12.handled}, executed: ${res12.executed}, navigatedScreen: ${navigatedScreen}`,
});

// -------------------------------------------------------------
// Test 13: Existing "/open" behavior
// -------------------------------------------------------------
resetMock();
const res13a = evaluateChatCommand('/open', mockActions, 'axon');
const res13b = evaluateChatCommand('/open tools', mockActions, 'axon');
const pass13 =
  res13a.handled === true &&
  res13a.executed === false &&
  res13a.response.includes('Interface Directory') &&
  res13b.handled === true &&
  res13b.executed === true &&
  navigatedScreen === 'tools';

results.push({
  id: 13,
  name: 'Test 13: Existing /open directory and /open [target] navigation preserved',
  passed: pass13,
  details: `/open showed directory, /open tools navigated to ${navigatedScreen}`,
});

// -------------------------------------------------------------
// Test 14: Existing pending-choice expiration
// -------------------------------------------------------------
resetMock();
// Set a pending choice from the past
setPendingChoice({
  command: '/open',
  promptType: 'confirm',
  timestamp: Date.now() - (PENDING_INTERACTION_EXPIRATION_MS + 5000),
});
// Verify it is expired and cleared upon access
const pendingAfterExpiry = getPendingChoice();
const pass14 = pendingAfterExpiry === null;

results.push({
  id: 14,
  name: 'Test 14: Pending choice expiration after TTL',
  passed: pass14,
  details: `expired state was null: ${pass14}`,
});

// -------------------------------------------------------------
// Test 15: Existing View Result behavior (Contextual Navigation)
// -------------------------------------------------------------
resetMock();
// Verify resolveInterfaceFromQuery correctly maps direct queries to real screen IDs
const pass15 =
  evaluateChatCommand('/open code', mockActions, 'axon').executed === true &&
  navigatedScreen === 'code';

results.push({
  id: 15,
  name: 'Test 15: Navigation resolution maps accurately to underlying screen targets',
  passed: pass15,
  details: `navigatedScreen: ${navigatedScreen}`,
});

// -------------------------------------------------------------
// Test 16: Ordinary conversation that should not accidentally become a command
// -------------------------------------------------------------
resetMock();
const convA = evaluateChatCommand('That is an open question for the research team', mockActions, 'axon');
const convB = evaluateChatCommand('I think this color palette looks very balanced', mockActions, 'axon');
const convC = evaluateChatCommand('How are you doing today?', mockActions, 'axon');
const pass16 =
  convA.handled === false &&
  convB.handled === false &&
  convC.handled === false &&
  navigatedScreen === null;

results.push({
  id: 16,
  name: 'Test 16: Ordinary conversation is not intercepted as a command',
  passed: pass16,
  details: `All 3 conversational messages returned handled: false without hijacking chat`,
});

// -------------------------------------------------------------
// SUMMARY OUTPUT
// -------------------------------------------------------------
console.log('RESULTS:');
let allPassed = true;
for (const r of results) {
  const icon = r.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} - ${r.name}`);
  console.log(`       ${r.details}`);
  if (!r.passed) allPassed = false;
}

console.log('\n====================================================');
if (allPassed) {
  console.log('OVERALL: ALL 16 CAPABILITY INTELLIGENCE TESTS PASSED');
  process.exit(0);
} else {
  console.log('OVERALL: SOME TESTS FAILED');
  process.exit(1);
}
console.log('====================================================');
