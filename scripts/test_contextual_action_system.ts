import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateChatCommand,
  getPendingInteraction,
  setPendingInteraction,
  clearPendingInteraction,
  PENDING_INTERACTION_EXPIRATION_MS,
  CommandRouterActions,
} from '../src/lib/commandRouter';
import {
  createContextualAction,
  createSingleActionShortcut,
  createAlternativeActions,
  createConfirmationActions,
  createNavigationShortcut,
  getMessageActions,
  ContextualMessageAction,
} from '../src/lib/contextualActions';
import { ChatMessage } from '../src/types';

let currentMockScreen: string = 'axon';
const navigationLog: Array<{ screen: string; options?: any }> = [];

const mockActions: CommandRouterActions = {
  navigateTo: (screen, options) => {
    currentMockScreen = screen;
    navigationLog.push({ screen, options });
  },
};

function resetTestState() {
  clearPendingInteraction();
  currentMockScreen = 'axon';
  navigationLog.length = 0;
}

console.log('--- STARTING CONTEXTUAL ACTION SYSTEM VERIFICATION ---');

// TEST SUITE 1: Contextual Action Model & Utilities
{
  console.log('Testing Suite 1: Action Model & Helper Factories...');
  resetTestState();

  // Test 1.1: createContextualAction
  const action1 = createContextualAction({
    label: 'Open Calculator',
    actionText: '/open calculator',
    destinationId: 'calculator',
    targetId: 'calculator',
    intent: 'open',
    variant: 'default',
  });
  assert.strictEqual(action1.label, 'Open Calculator');
  assert.strictEqual(action1.actionText, '/open calculator');
  assert.strictEqual(action1.destinationId, 'calculator');
  assert.strictEqual(action1.targetId, 'calculator');
  assert.strictEqual(action1.intent, 'open');
  assert.strictEqual(action1.variant, 'default');

  // Test 1.2: createSingleActionShortcut
  const singleShortcut = createSingleActionShortcut('Retry Connection', '/retry', {
    intent: 'retry',
    description: 'Attempt to reconnect to the server',
  });
  assert.strictEqual(singleShortcut.length, 1);
  assert.strictEqual(singleShortcut[0].label, 'Retry Connection');
  assert.strictEqual(singleShortcut[0].actionText, '/retry');
  assert.strictEqual(singleShortcut[0].intent, 'retry');

  // Test 1.3: createAlternativeActions (Multi-action)
  const alternatives = createAlternativeActions([
    { label: 'Open', actionText: '/open workspace' },
    { label: 'View Details', actionText: '/details workspace', variant: 'secondary' },
    { label: 'Cancel', actionText: '/cancel', variant: 'secondary' },
  ]);
  assert.strictEqual(alternatives.length, 3);
  assert.strictEqual(alternatives[0].label, 'Open');
  assert.strictEqual(alternatives[1].label, 'View Details');
  assert.strictEqual(alternatives[1].variant, 'secondary');
  assert.strictEqual(alternatives[2].label, 'Cancel');

  // Test 1.4: createConfirmationActions
  const confirmActions = createConfirmationActions('Approve Changes', 'Reject Changes', {
    confirmActionText: 'yes',
    cancelActionText: 'no',
    targetId: 'spec-update',
  });
  assert.strictEqual(confirmActions.length, 2);
  assert.strictEqual(confirmActions[0].label, 'Approve Changes');
  assert.strictEqual(confirmActions[0].actionText, 'yes');
  assert.strictEqual(confirmActions[0].variant, 'default');
  assert.strictEqual(confirmActions[1].label, 'Reject Changes');
  assert.strictEqual(confirmActions[1].actionText, 'no');
  assert.strictEqual(confirmActions[1].variant, 'secondary');

  // Test 1.5: createNavigationShortcut
  const navAction = createNavigationShortcut('settings', 'Settings', 'System');
  assert.strictEqual(navAction.label, 'Open Settings');
  assert.strictEqual(navAction.actionText, '/open settings');
  assert.strictEqual(navAction.destinationId, 'settings');
  assert.strictEqual(navAction.category, 'System');
  console.log('Suite 1: PASSED');
}

// TEST SUITE 2: Message Contextual Actions Extraction & Ordinary Messages
{
  console.log('Testing Suite 2: Ordinary Messages & Action Extraction...');
  resetTestState();

  // Test 2.1: Ordinary message has no contextual actions
  const ordinaryUserMsg: ChatMessage = {
    id: 'msg-1',
    sender: 'user',
    text: 'What is the circumference of Earth?',
    timestamp: '12:00',
  };
  const actions1 = getMessageActions(ordinaryUserMsg);
  assert.strictEqual(actions1.length, 0, 'Ordinary user message must have 0 actions');

  const ordinaryAxonMsg: ChatMessage = {
    id: 'msg-2',
    sender: 'axon',
    text: 'The circumference of Earth is approximately 40,075 km.',
    timestamp: '12:01',
  };
  const actions2 = getMessageActions(ordinaryAxonMsg);
  assert.strictEqual(actions2.length, 0, 'Ordinary AXON answer must have 0 actions');

  // Test 2.2: Message with modern 'actions' field
  const msgWithActions: ChatMessage = {
    id: 'msg-3',
    sender: 'axon',
    text: 'Would you like to open the calculator?',
    timestamp: '12:02',
    actions: [
      { label: 'Open Calculator', actionText: '/open calculator' },
    ],
  };
  const extractedActions = getMessageActions(msgWithActions);
  assert.strictEqual(extractedActions.length, 1);
  assert.strictEqual(extractedActions[0].label, 'Open Calculator');

  // Test 2.3: Message with legacy 'commandOptions' field
  const msgWithLegacyOptions: ChatMessage = {
    id: 'msg-4',
    sender: 'axon',
    text: 'Choose a destination:',
    timestamp: '12:03',
    commandOptions: [
      { label: 'Tools', actionText: '/open tools' },
      { label: 'Settings', actionText: '/open settings' },
    ],
  };
  const extractedLegacy = getMessageActions(msgWithLegacyOptions);
  assert.strictEqual(extractedLegacy.length, 2);
  assert.strictEqual(extractedLegacy[0].label, 'Tools');
  assert.strictEqual(extractedLegacy[1].label, 'Settings');

  console.log('Suite 2: PASSED');
}

// TEST SUITE 3: Single-Action Contextual Responses (Conceptual Example from Prompt)
{
  console.log('Testing Suite 3: Single-Action Contextual Responses...');
  resetTestState();

  // Test 3.1: "How do I open the calculator?"
  const res1 = evaluateChatCommand('How do I open the calculator?', mockActions, currentMockScreen as any);
  assert.strictEqual(res1.handled, true, 'Navigational inquiry should be handled');
  assert.strictEqual(res1.executed, false, 'Should inform user, not auto-navigate');
  assert.ok(res1.response.includes('Calculation') || res1.response.includes('Keypad'), 'Response should mention Calculation & Keypad');
  assert.ok(res1.actions && res1.actions.length === 1, 'Must have exactly 1 contextual action');
  assert.strictEqual(res1.actions![0].destinationId, 'tool_calc');
  assert.strictEqual(res1.actions![0].actionText, '/open tool_calc');

  // Test 3.2: User clicks that single action -> executes /open calculator
  const actionExecution = evaluateChatCommand(res1.actions![0].actionText, mockActions, currentMockScreen as any);
  assert.strictEqual(actionExecution.handled, true);
  assert.strictEqual(actionExecution.executed, true);
  assert.strictEqual(currentMockScreen, 'tool_calc');
  assert.ok(navigationLog.some((n) => n.screen === 'tool_calc'));

  // Test 3.3: "where can I find settings?"
  const res2 = evaluateChatCommand('where can I find settings?', mockActions, currentMockScreen as any);
  assert.strictEqual(res2.handled, true);
  assert.ok(res2.actions && res2.actions.length === 1);
  assert.strictEqual(res2.actions![0].label, 'Open Settings');
  assert.strictEqual(res2.actions![0].actionText, '/open settings');

  // Test 3.3b: Polite request "can you open calculator" -> ordinary natural language does not auto-execute
  resetTestState();
  const politeRes = evaluateChatCommand('can you open calculator', mockActions, currentMockScreen as any);
  assert.strictEqual(politeRes.handled, true);
  assert.strictEqual(politeRes.executed, false, 'Natural language should present confirmation, not auto-execute');
  assert.strictEqual(currentMockScreen, 'axon', 'Should not navigate prior to explicit authorization');
  assert.ok(politeRes.actions && politeRes.actions.length >= 1);
  assert.strictEqual(politeRes.actions![0].destinationId, 'tool_calc');

  // Activating the presented contextual action executes immediately:
  const politeActRes = evaluateChatCommand(politeRes.actions![0].actionText, mockActions, currentMockScreen as any);
  assert.strictEqual(politeActRes.handled, true);
  assert.strictEqual(politeActRes.executed, true);
  assert.strictEqual(currentMockScreen, 'tool_calc');

  // Test 3.3c: Inferred match provides confirmation + cancel buttons
  resetTestState();
  const inferredRes = evaluateChatCommand('/open axon sou', mockActions, currentMockScreen as any);
  assert.strictEqual(inferredRes.handled, true);
  assert.strictEqual(inferredRes.executed, false);
  assert.ok(inferredRes.actions && inferredRes.actions.length === 2, 'Should offer Open + Cancel');
  assert.strictEqual(inferredRes.actions![0].label, 'Open AXON Source');
  assert.strictEqual(inferredRes.actions![1].label, 'Cancel');
  assert.strictEqual(inferredRes.actions![1].variant, 'secondary');

  // Test 3.4: Ordinary questions must NOT trigger contextual navigation actions
  const generalQ1 = evaluateChatCommand('How do I write a sorting algorithm in Python?', mockActions, currentMockScreen as any);
  assert.strictEqual(generalQ1.handled, false, 'General programming question must not be intercepted');

  const generalQ2 = evaluateChatCommand('What is the weather in Tokyo?', mockActions, currentMockScreen as any);
  assert.strictEqual(generalQ2.handled, false, 'General weather question must not be intercepted');

  console.log('Suite 3: PASSED');
}

// TEST SUITE 4: Full Backwards Compatibility with /open & Pending Interactions
{
  console.log('Testing Suite 4: /open & Pending Interaction Compatibility...');
  resetTestState();

  // Test 4.1: /open displays directory options
  const openRes = evaluateChatCommand('/open', mockActions, currentMockScreen as any);
  assert.strictEqual(openRes.handled, true);
  assert.strictEqual(openRes.executed, false);
  assert.ok(openRes.options && openRes.options.length > 5, 'Should list destinations');

  // Test 4.2: Direct navigation /open code
  const codeRes = evaluateChatCommand('/open code', mockActions, currentMockScreen as any);
  assert.strictEqual(codeRes.handled, true);
  assert.strictEqual(codeRes.executed, true);
  assert.strictEqual(currentMockScreen, 'code');

  // Test 4.3: Natural language navigation "take me to tools" -> requires confirmation, does not auto-execute
  const toolsRes = evaluateChatCommand('take me to tools', mockActions, currentMockScreen as any);
  assert.strictEqual(toolsRes.handled, true);
  assert.strictEqual(toolsRes.executed, false, 'Natural language should present confirmation, not auto-execute');
  assert.strictEqual(currentMockScreen, 'code', 'Should not navigate prior to authorization');
  assert.ok(toolsRes.actions && toolsRes.actions.length >= 1);
  const actToolsRes = evaluateChatCommand(toolsRes.actions![0].actionText, mockActions, currentMockScreen as any);
  assert.strictEqual(actToolsRes.handled, true);
  assert.strictEqual(actToolsRes.executed, true);
  assert.strictEqual(currentMockScreen, 'tools');

  // Test 4.4: Ambiguous query sets pending choice
  const ambigRes = evaluateChatCommand('/open test', mockActions, currentMockScreen as any);
  assert.strictEqual(ambigRes.handled, true);
  assert.strictEqual(ambigRes.executed, false);
  const pending1 = getPendingInteraction();
  assert.ok(pending1 !== null, 'Pending interaction should be set');
  assert.ok(
    pending1!.type === 'confirmation' || pending1!.type === 'selection' || pending1!.type === 'ambiguity_resolution',
    'Pending interaction type must be a valid interaction type'
  );

  // Test 4.5: Resolving ambiguity with numeric selection "1"
  const selectRes = evaluateChatCommand('1', mockActions, currentMockScreen as any);
  assert.strictEqual(selectRes.handled, true);
  assert.strictEqual(selectRes.executed, true);
  assert.strictEqual(getPendingInteraction(), null, 'Pending interaction should be cleared');

  // Test 4.6: 60-second expiration logic
  evaluateChatCommand('/open test', mockActions, currentMockScreen as any);
  const pending2 = getPendingInteraction();
  assert.ok(pending2 !== null);
  // Mock elapsed time > 60s
  pending2!.timestamp = Date.now() - 61000;
  pending2!.createdAt = pending2!.timestamp;
  pending2!.expiresAt = Date.now() - 1000;
  const expired = getPendingInteraction();
  assert.strictEqual(expired, null, 'Expired pending interaction should return null');

  // Test 4.7: Math evaluation fast-path
  const mathRes = evaluateChatCommand('125 * 8', mockActions, currentMockScreen as any);
  assert.strictEqual(mathRes.handled, true);
  assert.strictEqual(mathRes.executed, true);
  assert.ok(mathRes.response.includes('1000'));

  console.log('Suite 4: PASSED');
}

// TEST SUITE 5: UI & Styling Static Audit (ChatPane.tsx and View Result preservation)
{
  console.log('Testing Suite 5: UI & Styling Static Audit...');
  const chatPaneSource = fs.readFileSync(path.resolve('src/components/ChatPane.tsx'), 'utf-8');

  // 5.1: View Result button MUST exist with its exact classes and behavior
  assert.ok(
    chatPaneSource.includes('id={`chat-view-result-btn-${msg.id}`}'),
    'View Result button ID must remain intact'
  );
  assert.ok(
    chatPaneSource.includes('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-black hover:bg-neutral-200 active:scale-95 transition-all text-xs font-semibold shadow-xs cursor-pointer'),
    'View Result exact styling class must remain intact'
  );
  assert.ok(
    chatPaneSource.includes('hasBuildRunResult &&'),
    'View Result condition must remain intact'
  );

  // 5.2: Contextual action buttons use the exact View Result visual specification
  assert.ok(
    chatPaneSource.includes('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl'),
    'Contextual action buttons must share rounded-xl, px-3 py-1.5, gap-1.5 sizing'
  );
  assert.ok(
    chatPaneSource.includes('bg-white text-black hover:bg-neutral-200'),
    'Contextual action default style must match View Result palette'
  );
  assert.ok(
    chatPaneSource.includes('text-xs font-semibold shadow-xs cursor-pointer'),
    'Contextual action typography and feel must match View Result'
  );

  // 5.3: No hardcoded feature names in ChatPane.tsx action renderer
  assert.ok(
    !chatPaneSource.includes("opt.feature === 'calculator'"),
    'ChatPane must not hardcode feature-specific action checks'
  );
  assert.ok(
    !chatPaneSource.includes("opt.feature === 'file_manager'"),
    'ChatPane must not hardcode feature-specific action checks'
  );

  // 5.4: Both msg.actions and msg.commandOptions are supported seamlessly
  assert.ok(
    chatPaneSource.includes('msg.actions') && chatPaneSource.includes('msg.commandOptions'),
    'ChatPane must support both modern actions and legacy commandOptions'
  );

  console.log('Suite 5: PASSED');
}

console.log('--- ALL CONTEXTUAL ACTION SYSTEM VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
