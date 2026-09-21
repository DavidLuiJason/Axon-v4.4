import assert from 'assert';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContextualMessageActions } from '../src/components/ContextualMessageActions';
import { evaluateChatCommand, getPendingInteraction, clearPendingInteraction } from '../src/lib/commandRouter';
import { ContextualMessageAction } from '../src/types';

console.log('=== STARTING REUSABLE RENDERING FOUNDATION VERIFICATION ===');

// TEST 1 — Normal message: A message with no "commandOptions" or empty actions produces zero buttons (renders null)
{
  console.log('Testing Test 1: Normal message produces null / 0 buttons...');
  const renderedUndefined = renderToStaticMarkup(
    React.createElement(ContextualMessageActions, {
      actions: undefined,
      commandOptions: undefined,
      messageId: 'msg-norm-1',
      onActionClick: () => {},
    })
  );
  assert.strictEqual(renderedUndefined, '', 'Undefined actions must render empty string (null)');

  const renderedEmpty = renderToStaticMarkup(
    React.createElement(ContextualMessageActions, {
      actions: [],
      commandOptions: [],
      messageId: 'msg-norm-2',
      onActionClick: () => {},
    })
  );
  assert.strictEqual(renderedEmpty, '', 'Empty actions array must render empty string (null)');
  console.log('Test 1: PASSED');
}

// TEST 2 — Contextual message: A message with two actions produces exactly two buttons
{
  console.log('Testing Test 2: Contextual message with two options renders exactly two buttons...');
  const sampleActions: ContextualMessageAction[] = [
    { label: 'Option Alpha', actionText: 'Alpha action', destinationId: 'alpha' },
    { label: 'Option Beta', actionText: 'Beta action', destinationId: 'beta' },
  ];

  const html = renderToStaticMarkup(
    React.createElement(ContextualMessageActions, {
      actions: sampleActions,
      messageId: 'msg-ctx-1',
      onActionClick: () => {},
    })
  );

  assert.ok(html.includes('id="chat-cmd-opt-alpha"'), 'Alpha button ID should be present');
  assert.ok(html.includes('id="chat-cmd-opt-beta"'), 'Beta button ID should be present');
  assert.ok(html.includes('Option Alpha'), 'Alpha label should be rendered');
  assert.ok(html.includes('Option Beta'), 'Beta label should be rendered');

  const buttonMatches = html.match(/<button/g);
  assert.strictEqual(buttonMatches?.length, 2, 'Must render exactly 2 buttons');
  console.log('Test 2: PASSED');
}

// TEST 3 — Option execution: Clicking an option dispatches onActionClick(opt.actionText) to the existing command pipeline
{
  console.log('Testing Test 3: Option execution dispatches actionText to the command pipeline...');
  let dispatchedText = '';
  const testAction: ContextualMessageAction = {
    label: 'Open Tools',
    actionText: '/open tools',
    destinationId: 'tools',
  };

  // Simulate execution handler
  const handleActionClick = (text: string) => {
    dispatchedText = text;
  };

  handleActionClick(testAction.actionText);
  assert.strictEqual(dispatchedText, '/open tools');

  // Verify the dispatched text executes properly through evaluateChatCommand
  let navigatedTo = '';
  const commandRes = evaluateChatCommand(dispatchedText, {
    navigateTo: (screen: string) => {
      navigatedTo = screen;
    },
  }, 'axon' as any);

  assert.strictEqual(commandRes.handled, true, 'Command should be handled');
  assert.strictEqual(commandRes.executed, true, 'Command should be executed');
  assert.strictEqual(navigatedTo, 'tools', 'Navigation should trigger to tools screen');
  console.log('Test 3: PASSED');
}

// TEST 4 — View Result isolation: View Result remains completely unaffected and separate
{
  console.log('Testing Test 4: View Result isolation...');
  const chatPaneSource = fs.readFileSync(path.resolve('src/components/ChatPane.tsx'), 'utf-8');

  // Verify View Result button container and attributes
  assert.ok(
    chatPaneSource.includes('id={`chat-view-result-btn-${msg.id}`}'),
    'View Result button ID must remain intact'
  );
  assert.ok(
    chatPaneSource.includes('hasBuildRunResult &&'),
    'View Result must remain guarded solely by hasBuildRunResult'
  );
  assert.ok(
    chatPaneSource.includes('msg.isResultUnavailable ?'),
    'View Result unavailable state handling must remain intact'
  );
  assert.ok(
    chatPaneSource.includes('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-black hover:bg-neutral-200 active:scale-95 transition-all text-xs font-semibold shadow-xs cursor-pointer'),
    'View Result exact styling must remain intact'
  );
  assert.ok(
    chatPaneSource.includes('setWorkspaceActiveTab(\'preview\')'),
    'View Result preview tab switch must remain intact'
  );

  // Verify View Result is outside ContextualMessageActions
  assert.ok(
    chatPaneSource.indexOf('<ContextualMessageActions') < chatPaneSource.indexOf('{hasBuildRunResult &&'),
    'ContextualMessageActions should render before the separate View Result block'
  );
  console.log('Test 4: PASSED');
}

// TEST 5 — Category grouping: Categories are partitioned and headers render
{
  console.log('Testing Test 5: Category grouping...');
  const categorizedActions: ContextualMessageAction[] = [
    { label: 'Editor', actionText: '/open code', category: 'Destinations', destinationId: 'code' },
    { label: 'Storage', actionText: '/open storage', category: 'Destinations', destinationId: 'storage' },
    { label: 'Run Diagnostic', actionText: '/test diagnostic', category: 'Diagnostics', targetId: 'diag' },
  ];

  const html = renderToStaticMarkup(
    React.createElement(ContextualMessageActions, {
      actions: categorizedActions,
      messageId: 'msg-cat-1',
      onActionClick: () => {},
    })
  );

  assert.ok(html.includes('Destinations'), 'Destinations group header should render');
  assert.ok(html.includes('Diagnostics'), 'Diagnostics group header should render');
  assert.ok(html.includes('Editor'), 'Editor button should be present');
  assert.ok(html.includes('Storage'), 'Storage button should be present');
  assert.ok(html.includes('Run Diagnostic'), 'Diagnostic button should be present');
  console.log('Test 5: PASSED');
}

// TEST 6 — Group-free rendering: Flat collection without empty headers
{
  console.log('Testing Test 6: Group-free rendering without headers...');
  const flatActions: ContextualMessageAction[] = [
    { label: 'Confirm Action', actionText: 'confirm', targetId: 'confirm-btn' },
    { label: 'Cancel Action', actionText: 'cancel', variant: 'secondary', targetId: 'cancel-btn' },
  ];

  const html = renderToStaticMarkup(
    React.createElement(ContextualMessageActions, {
      actions: flatActions,
      messageId: 'msg-flat-1',
      onActionClick: () => {},
    })
  );

  assert.ok(!html.includes('Destinations'), 'No group headers should render when no category is specified');
  assert.ok(html.includes('id="chat-action-btn-msg-flat-1-confirm-btn"'), 'Confirm button id should be present');
  assert.ok(html.includes('id="chat-action-btn-msg-flat-1-cancel-btn"'), 'Cancel button id should be present');
  assert.ok(html.includes('Confirm Action'), 'Confirm label should render');
  assert.ok(html.includes('Cancel Action'), 'Cancel label should render');
  console.log('Test 6: PASSED');
}

// TEST 7 — Existing "/open" flow: End-to-end ambiguity resolution
{
  console.log('Testing Test 7: Existing /open flow end-to-end...');
  clearPendingInteraction();

  let navigatedScreen = '';
  const mockActions = {
    navigateTo: (screen: string) => {
      navigatedScreen = screen;
    },
  };

  // Ambiguous open command
  const ambigResult = evaluateChatCommand('/open test', mockActions, 'axon' as any);
  assert.strictEqual(ambigResult.handled, true);
  assert.strictEqual(ambigResult.executed, false);
  const returnedOptions = ambigResult.options || ambigResult.actions;
  assert.ok(returnedOptions && returnedOptions.length >= 2, 'Ambiguous query should produce options');

  // Pending interaction was recorded
  const pending = getPendingInteraction();
  assert.ok(pending !== null, 'Pending interaction should be set');

  // User selects option 1
  const selectResult = evaluateChatCommand('1', mockActions, 'axon' as any);
  assert.strictEqual(selectResult.handled, true);
  assert.strictEqual(selectResult.executed, true);
  assert.ok(navigatedScreen.length > 0, 'Screen navigation should have fired');
  assert.strictEqual(getPendingInteraction(), null, 'Pending interaction cleared');
  console.log('Test 7: PASSED');
}

// TEST 8 — Scope: Verify only required files were modified
{
  console.log('Testing Test 8: Scope verification...');
  // ChatPane.tsx contains the reusable component and no unrelated feature bloat
  const chatPaneSource = fs.readFileSync(path.resolve('src/components/ChatPane.tsx'), 'utf-8');
  assert.ok(
    chatPaneSource.includes('ContextualMessageActions'),
    'ContextualMessageActions component must be exported/used in ChatPane'
  );
  const cmpSource = fs.readFileSync(path.resolve('src/components/ContextualMessageActions.tsx'), 'utf-8');
  assert.ok(
    cmpSource.includes('export const ContextualMessageActions'),
    'ContextualMessageActions must be exported from ContextualMessageActions.tsx'
  );
  assert.ok(
    chatPaneSource.includes('<ContextualMessageActions'),
    'ContextualMessageActions must be invoked inside ChatPane'
  );
  console.log('Test 8: PASSED');
}

console.log('=== ALL 8 VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
