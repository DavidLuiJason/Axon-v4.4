import { evaluateChatCommand, CommandRouterActions } from '../src/lib/commandRouter';
import { evaluateSettingsCommand } from '../src/lib/chatCapabilityManifest';
import { handleStorageChatCommand, tryEvaluateMathExpression } from '../src/lib/storageChatHandler';
import { DEFAULT_ASSET_MANIFEST } from '../src/lib/storageManifest';
import { ScreenId } from '../src/types';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

// Mock actions
let navigatedScreen: ScreenId | null = null;
let navigationCount = 0;

const mockActions: CommandRouterActions = {
  navigateTo: (screen: ScreenId, options?: any) => {
    navigatedScreen = screen;
    navigationCount++;
  },
};

function resetMock() {
  navigatedScreen = null;
  navigationCount = 0;
}

console.log('====================================================');
console.log('RUNNING AXON COMMAND ROUTER VERIFICATION SUITE');
console.log('====================================================\n');

// Test 1: /open settings
resetMock();
const res1 = evaluateChatCommand('/open settings', mockActions, 'axon');
const pass1 = res1.handled === true && res1.executed === true && navigatedScreen === 'settings';
results.push({
  name: 'Test 1: "/open settings"',
  passed: pass1,
  details: `handled: ${res1.handled}, executed: ${res1.executed}, navigatedScreen: ${navigatedScreen}, response: "${res1.response}"`,
});

// Test 2: /open tools
resetMock();
const res2 = evaluateChatCommand('/open tools', mockActions, 'axon');
const pass2 = res2.handled === true && res2.executed === true && navigatedScreen === 'tools';
results.push({
  name: 'Test 2: "/open tools"',
  passed: pass2,
  details: `handled: ${res2.handled}, executed: ${res2.executed}, navigatedScreen: ${navigatedScreen}, response: "${res2.response}"`,
});

// Test 3: /open code
resetMock();
const res3 = evaluateChatCommand('/open code', mockActions, 'axon');
const pass3 = res3.handled === true && res3.executed === true && navigatedScreen === 'code';
results.push({
  name: 'Test 3: "/open code"',
  passed: pass3,
  details: `handled: ${res3.handled}, executed: ${res3.executed}, navigatedScreen: ${navigatedScreen}, response: "${res3.response}"`,
});

// Test 4: /open with no target
resetMock();
const res4 = evaluateChatCommand('/open', mockActions, 'axon');
const pass4 = res4.handled === true && res4.executed === false && navigatedScreen === null;
results.push({
  name: 'Test 4: "/open" (no target)',
  passed: pass4,
  details: `handled: ${res4.handled}, executed: ${res4.executed}, navigatedScreen: ${navigatedScreen} (no navigation), response: "${res4.response.slice(0, 45)}..."`,
});

// Test 5: /open with an invalid target
resetMock();
const res5 = evaluateChatCommand('/open nonexistent_screen_xyz123', mockActions, 'axon');
const pass5 = res5.handled === true && res5.executed === false && navigatedScreen === null;
results.push({
  name: 'Test 5: "/open" (invalid target)',
  passed: pass5,
  details: `handled: ${res5.handled}, executed: ${res5.executed}, navigatedScreen: ${navigatedScreen} (no navigation), response: "${res5.response.slice(0, 50)}..."`,
});

// Test 6: Normal conversational message containing "open"
resetMock();
const convMsg1 = 'Can we open a new topic on quantum mechanics?';
const res6a = evaluateChatCommand(convMsg1, mockActions, 'axon');
const convMsg2 = 'I want to open a file and inspect its contents';
const res6b = evaluateChatCommand(convMsg2, mockActions, 'axon');
const convMsg3 = 'open-ended questions are great for brainstorming';
const res6c = evaluateChatCommand(convMsg3, mockActions, 'axon');
const convMsg4 = 'open a discussion about neural networks';
const res6d = evaluateChatCommand(convMsg4, mockActions, 'axon');

const pass6 =
  res6a.handled === false &&
  res6b.handled === false &&
  res6c.handled === false &&
  res6d.handled === false &&
  navigatedScreen === null;

results.push({
  name: 'Test 6: Conversational message containing "open"',
  passed: pass6,
  details: `All 4 conversational queries returned handled: false and did not trigger navigation.`,
});

// Test 6.5: Ordinary natural-language navigation requests: "open settings", "open calculator", "go to tools"
// Must recognize the action, present contextual confirmation, and NOT auto-execute until authorized
resetMock();
const resNL1 = evaluateChatCommand('open settings', mockActions, 'axon');
const passNL1 =
  resNL1.handled === true &&
  resNL1.executed === false &&
  navigatedScreen === null &&
  resNL1.actions !== undefined &&
  resNL1.actions.length >= 1 &&
  resNL1.actions[0].actionText === '/open settings';

// Activating the presented action authorizes immediate execution
const resNL1Act = evaluateChatCommand(resNL1.actions![0].actionText, mockActions, 'axon');
const passNL1Act = resNL1Act.handled === true && resNL1Act.executed === true && navigatedScreen === 'settings';

resetMock();
const resNL2 = evaluateChatCommand('go to tools', mockActions, 'axon');
const passNL2 =
  resNL2.handled === true &&
  resNL2.executed === false &&
  navigatedScreen === null &&
  resNL2.actions !== undefined &&
  resNL2.actions.length >= 1 &&
  resNL2.actions[0].actionText === '/open tools';

const resNL2Act = evaluateChatCommand(resNL2.actions![0].actionText, mockActions, 'axon');
const passNL2Act = resNL2Act.handled === true && resNL2Act.executed === true && navigatedScreen === 'tools';

resetMock();
const resNL3 = evaluateChatCommand('open calculator', mockActions, 'axon');
const passNL3 =
  resNL3.handled === true &&
  resNL3.executed === false &&
  navigatedScreen === null &&
  resNL3.actions !== undefined &&
  resNL3.actions.length >= 1 &&
  resNL3.actions[0].actionText === '/open tool_calc';

results.push({
  name: 'Test 6b: Ordinary natural language navigation requires confirmation ("open settings", "go to tools", "open calculator")',
  passed: passNL1 && passNL1Act && passNL2 && passNL2Act && passNL3,
  details: `"open settings" presented confirmation, activated to ${navigatedScreen}; "open calculator" presented confirmation without auto-executing`,
});

// Test 6b.2: Contextual suggestions do NOT display a "Cancel" button, whereas genuine confirmations / selections retain it
resetMock();
const resSuggSettings = evaluateChatCommand('open settings', mockActions, 'axon');
const suggHasNoCancel =
  resSuggSettings.handled === true &&
  resSuggSettings.actions !== undefined &&
  resSuggSettings.actions.length === 1 &&
  !resSuggSettings.actions.some((a) => a.intent === 'cancel' || a.label.toLowerCase() === 'cancel');

// Disambiguation / ambiguous open retains Cancel
resetMock();
const resAmbiguous = evaluateChatCommand('/open note', mockActions, 'axon');
const ambigHasCancel =
  resAmbiguous.handled === true &&
  resAmbiguous.actions !== undefined &&
  resAmbiguous.actions.some((a) => a.intent === 'cancel' || a.label.toLowerCase() === 'cancel');

// Natural rejection follow-up: "No, not this" or "not this" or "no, open tools"
resetMock();
evaluateChatCommand('open calculator', mockActions, 'axon');
const resReject1 = evaluateChatCommand('No, not this', mockActions, 'axon');
const passReject1 =
  resReject1.handled === true &&
  resReject1.executed === false &&
  navigatedScreen === null &&
  resReject1.response.includes('cancelled');

resetMock();
evaluateChatCommand('open calculator', mockActions, 'axon');
const resReject2 = evaluateChatCommand('not this', mockActions, 'axon');
const passReject2 =
  resReject2.handled === true &&
  resReject2.executed === false &&
  navigatedScreen === null;

resetMock();
evaluateChatCommand('open calculator', mockActions, 'axon');
const resRejectRedirect = evaluateChatCommand('no, open tools', mockActions, 'axon');
const passRejectRedirect =
  resRejectRedirect.handled === true &&
  resRejectRedirect.executed === true &&
  navigatedScreen === 'tools';

results.push({
  name: 'Test 6b.2: Suggestions omit Cancel button & natural follow-up understanding ("No, not this", "no, open tools")',
  passed: suggHasNoCancel && ambigHasCancel && passReject1 && passReject2 && passRejectRedirect,
  details: `Suggestion has no cancel: ${suggHasNoCancel}, Ambiguous has cancel: ${ambigHasCancel}, "No, not this" cancels: ${passReject1}, Redirection works: ${passRejectRedirect}`,
});

// Test 6.6: Explicit "run" execution instructions: "run open calculator", "run command open settings", "run /open code", "run calculator"
resetMock();
const resRun1 = evaluateChatCommand('run open calculator', mockActions, 'axon');
const passRun1 = resRun1.handled === true && resRun1.executed === true && navigatedScreen === 'tool_calc';

resetMock();
const resRun2 = evaluateChatCommand('run command open settings', mockActions, 'axon');
const passRun2 = resRun2.handled === true && resRun2.executed === true && navigatedScreen === 'settings';

resetMock();
const resRun3 = evaluateChatCommand('run /open code', mockActions, 'axon');
const passRun3 = resRun3.handled === true && resRun3.executed === true && navigatedScreen === 'code';

resetMock();
const resRun4 = evaluateChatCommand('run calculator', mockActions, 'axon');
const passRun4 = resRun4.handled === true && resRun4.executed === true && navigatedScreen === 'tool_calc';

results.push({
  name: 'Test 6c: Explicit "run" execution instructions ("run open calculator", "run command open settings", etc.) execute immediately',
  passed: passRun1 && passRun2 && passRun3 && passRun4,
  details: `"run open calculator" -> tool_calc, "run command open settings" -> settings, "run /open code" -> code, "run calculator" -> tool_calc`,
});

// Test 7: Math expression routing via commandRouter
resetMock();
const math1 = evaluateChatCommand('15 * 8', mockActions, 'axon');
const passMath1 =
  math1.handled === true &&
  math1.executed === true &&
  math1.response === '15 * 8 = 120' &&
  math1.commandName === 'math' &&
  math1.modelUsed === 'AXON Offline Calculator Engine' &&
  navigatedScreen === null;

const math2 = evaluateChatCommand('15% of 80', mockActions, 'axon');
const passMath2 =
  math2.handled === true &&
  math2.executed === true &&
  math2.response === '15% of 80 = 12' &&
  math2.commandName === 'math' &&
  navigatedScreen === null;

const math3 = evaluateChatCommand('sqrt(144)', mockActions, 'axon');
const passMath3 =
  math3.handled === true &&
  math3.executed === true &&
  math3.response === 'sqrt(144) = 12' &&
  math3.commandName === 'math' &&
  navigatedScreen === null;

const math4 = evaluateChatCommand('what is 1 + 1', mockActions, 'axon');
const passMath4 =
  math4.handled === true &&
  math4.executed === true &&
  math4.response === '1 + 1 = 2' &&
  math4.commandName === 'math' &&
  navigatedScreen === null;

results.push({
  name: 'Test 7: Math commands routed via Command Router ("15 * 8", "15% of 80", "sqrt(144)", "what is 1 + 1")',
  passed: passMath1 && passMath2 && passMath3 && passMath4,
  details: `15 * 8: "${math1.response}", 15% of 80: "${math2.response}", sqrt(144): "${math3.response}", what is 1 + 1: "${math4.response}"`,
});

// Test 8: Non-math conversational messages are NOT intercepted as math
resetMock();
const nonMath1 = evaluateChatCommand('I have 15 apples and 8 oranges', mockActions, 'axon');
const nonMath2 = evaluateChatCommand('what is the meaning of life', mockActions, 'axon');
const nonMath3 = evaluateChatCommand('100 reasons to code', mockActions, 'axon');
const passNonMath =
  nonMath1.handled === false &&
  nonMath2.handled === false &&
  nonMath3.handled === false &&
  navigatedScreen === null;

results.push({
  name: 'Test 8: Non-math conversational text is NOT intercepted as math',
  passed: passNonMath,
  details: `Conversational phrases correctly returned handled: false.`,
});

// Test 9: Existing command non-interference (Settings, Storage)
resetMock();
const cmdRouterForDark = evaluateChatCommand('switch to dark', mockActions, 'axon');
let themeModeSet = '';
const settingsRes = evaluateSettingsCommand('switch to dark', {
  theme: { mode: 'light', accentColor: '#3B82F6', functionColors: {} as any },
  setThemeMode: (mode) => {
    themeModeSet = mode;
  },
  setAccentColor: () => {},
  setFunctionColor: () => {},
  resetThemeToDefault: () => {},
  icons: {} as any,
  setAppIconPreset: () => {},
  setAvatarPreset: () => {},
  setAppNameTextCase: () => {},
  codeSkillLevel: 'standard',
  setCodeSkillLevel: () => {},
  workspaceCodeLoadMode: 'manual',
  setWorkspaceCodeLoadMode: () => {},
  soundEnabled: true,
  setSoundEnabled: () => {},
  notificationsEnabled: true,
  setNotificationsEnabled: () => {},
});

const cmdRouterForStorage = evaluateChatCommand('how much storage do I have left', mockActions, 'axon');
let storageReallocated = false;
let packAdded = false;
const storageRes = handleStorageChatCommand(
  'how much storage do I have left',
  DEFAULT_ASSET_MANIFEST,
  (assetId: string, bytesToFree: number) => {
    storageReallocated = true;
    return { success: true, message: 'Reallocated space' };
  },
  () => {
    packAdded = true;
  }
);

const pass9 =
  cmdRouterForDark.handled === false && // Command router does not intercept settings command
  settingsRes.handled === true &&
  settingsRes.executed === true &&
  themeModeSet === 'dark' &&
  cmdRouterForStorage.handled === false && // Command router does not intercept storage command
  storageRes !== null &&
  storageRes.includes('Storage Manifest Report');

results.push({
  name: 'Test 9: Existing command non-interference (Settings, Storage)',
  passed: pass9,
  details: `Settings command handled: ${settingsRes.handled} (theme: ${themeModeSet}), Storage command handled: ${storageRes !== null}`,
});

// Print summary
console.log('RESULTS:\n');
let allPassed = true;
for (const r of results) {
  const mark = r.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${mark} - ${r.name}`);
  console.log(`       ${r.details}`);
  if (!r.passed) allPassed = false;
}

console.log('\n====================================================');
console.log(`OVERALL: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
console.log('====================================================');

if (!allPassed) {
  process.exit(1);
} else {
  process.exit(0);
}
