/**
 * Verification test suite for AXON Unified Capability Registry & Capability Contract
 */

import {
  unifiedCapabilityRegistry,
  systemCapabilityRegistry,
} from '../src/lib/capabilitySystem';
import {
  validateCapabilityContract,
  isCapabilityContract,
  CapabilityContract,
} from '../src/lib/capabilityContract';
import { evaluateChatCommand, CommandRouterActions } from '../src/lib/commandRouter';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failed++;
  }
}

console.log('=== RUNNING UNIFIED CAPABILITY REGISTRY & CONTRACT TESTS ===\n');

// 1. Contract Validation
console.log('--- Group 1: Contract Validation ---');
const invalidContract: any = {
  id: '',
  name: '',
};
const valResult1 = validateCapabilityContract(invalidContract);
assert(!valResult1.valid, 'Invalid capability correctly rejected by validateCapabilityContract');
assert(valResult1.errors.length >= 2, 'Validation reports specific missing fields');

const validMockContract: CapabilityContract = {
  id: 'test_feature',
  name: 'Test Feature',
  description: 'A test capability contract',
  commands: [
    {
      name: 'testcmd',
      aliases: ['tcmd'],
      syntax: '/testcmd [arg]',
      description: 'Test command description',
      isExplicitSlash: true,
    },
  ],
  intents: [
    {
      intent: 'run_test',
      description: 'Runs test action',
      supportedPolicies: ['immediate'],
    },
  ],
  planning: {
    supportsSequential: true,
    supportsParallel: true,
    supportsQueue: true,
    defaultExecutionType: 'single',
    idempotent: true,
  },
  requirements: {
    offlineCapable: true,
    requiresNetwork: false,
    supportedPlatforms: ['all'],
  },
  selfDescription: {
    whatItDoes: 'Executes test routine',
    whatItRequires: 'None',
    whenAvailable: 'Always',
    whatMakesItUnavailable: 'Never',
    canRunOffline: true,
    hasKnownAlternatives: false,
    hasSideEffects: false,
    requiresConfirmation: false,
    resultType: 'Test result string',
  },
  verifyResult: (attempt, result) => {
    return { verified: Boolean(result?.success) };
  },
  execute: (intent, target) => {
    return {
      success: true,
      executed: true,
      purpose: 'report_result',
      response: `Executed test for ${target || intent}`,
    };
  },
};

const valResult2 = validateCapabilityContract(validMockContract);
assert(valResult2.valid, 'Valid capability contract passes validation');
assert(isCapabilityContract(validMockContract), 'isCapabilityContract type guard returns true');

// 2. Built-in Capabilities adhere to Unified Capability Contract
console.log('\n--- Group 2: Built-in Capabilities Contract Conformance ---');
const allBuiltIns = unifiedCapabilityRegistry.getAll();
assert(allBuiltIns.length >= 7, `Built-in capabilities registered: found ${allBuiltIns.length}`);

for (const cap of allBuiltIns) {
  const check = validateCapabilityContract(cap);
  assert(check.valid, `Built-in capability "${cap.id}" satisfies CapabilityContract: ${check.errors.join(', ') || 'OK'}`);
}

// 3. Dynamic Registration & Event Listeners
console.log('\n--- Group 3: Dynamic Registration & Listeners ---');
let registeredEventFired = false;
let unregisteredEventFired = false;

const unsubscribe = unifiedCapabilityRegistry.onRegistrationChange((event) => {
  if (event.type === 'registered' && event.capability.id === 'test_feature') {
    registeredEventFired = true;
  }
  if (event.type === 'unregistered' && event.capability.id === 'test_feature') {
    unregisteredEventFired = true;
  }
});

unifiedCapabilityRegistry.register(validMockContract);
assert(registeredEventFired, 'Registration listener triggered on register()');
assert(unifiedCapabilityRegistry.has('test_feature'), 'Registered capability is retrievable');

// 4. Command Discovery via Registry
console.log('\n--- Group 4: Dynamic Command Discovery ---');
const foundCmd = unifiedCapabilityRegistry.findCommand('testcmd');
assert(foundCmd !== undefined, 'findCommand found newly registered command');
assert(foundCmd?.command.name === 'testcmd', 'Discovered command has correct name');
assert(foundCmd?.capability.id === 'test_feature', 'Discovered command associates back to capability');

const foundAlias = unifiedCapabilityRegistry.findCommand('tcmd');
assert(foundAlias !== undefined, 'findCommand finds registered alias');

const allDiscovered = unifiedCapabilityRegistry.getDiscoveredCommands();
assert(allDiscovered.some((c) => c.name === 'testcmd'), 'getDiscoveredCommands lists newly registered command');

// 5. Execution & Verification via Contract
console.log('\n--- Group 5: Execution & Verification ---');
const execResult = await validMockContract.execute('run_test', 'sample_arg', {}, {});
assert(execResult.success === true, 'Contract execute returned success');

if (validMockContract.verifyResult) {
  const verification = validMockContract.verifyResult({} as any, execResult);
  assert(verification.verified === true, 'verifyResult hook verified execution outcome');
}

// 6. Dynamic Unregistration
console.log('\n--- Group 6: Dynamic Unregistration & Cleanup ---');
const unregSuccess = unifiedCapabilityRegistry.unregister('test_feature');
assert(unregSuccess, 'unregister() returned true');
assert(unregisteredEventFired, 'Unregistration listener triggered on unregister()');
assert(!unifiedCapabilityRegistry.has('test_feature'), 'Capability successfully removed from registry');
assert(unifiedCapabilityRegistry.findCommand('testcmd') === undefined, 'Discovered command cleanly removed after unregister');

unsubscribe();

// 7. Preservation of Existing Commands (/open) and Central Router
console.log('\n--- Group 7: Preservation of Existing Command Architecture ---');
let navigatedScreen: string | null = null;
const mockActions: CommandRouterActions = {
  navigateTo: (screen: any) => {
    navigatedScreen = screen;
  },
  settingsHandlers: {},
  storageHandlers: {},
};

const openSettingsResult = evaluateChatCommand('/open settings', mockActions);
assert(openSettingsResult.handled, '/open settings handled by router');
assert(openSettingsResult.executed, '/open settings executed');
assert(navigatedScreen === 'settings', 'Screen navigated to settings');

const openDirResult = evaluateChatCommand('/open', mockActions);
assert(openDirResult.handled, '/open (directory) handled');
assert(!openDirResult.executed, '/open (directory) does not navigate');
assert(openDirResult.response?.includes('AXON Interface Directory') ?? false, '/open returns directory markdown');

console.log(`\n====================================================`);
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed === 0) {
  console.log('SUCCESS: All Unified Capability Registry & Contract tests passed!');
  process.exit(0);
} else {
  console.error('FAILURE: Some tests failed.');
  process.exit(1);
}
