import assert from 'assert';
import { evaluateChatCommand } from '../src/lib/commandRouter';
import { resolveInterfaceFromQuery } from '../src/lib/interfaceRegistry';
import { ContextualMessageAction, ChatMessage, ScreenId } from '../src/types';

console.log('=== STARTING CONTEXTUAL ACTION EXECUTION VERIFICATION ===');

// Mock state container simulating AppContext execution behavior
class MockAppContext {
  public messages: ChatMessage[] = [];
  public currentScreen: ScreenId = 'axon';
  public screenState?: any;
  public llmPipelineCalledCount = 0;

  public navigateTo = (screen: ScreenId, options?: { screenState?: any }) => {
    this.currentScreen = screen;
    this.screenState = options?.screenState;
  };

  // Type A & B: Ordinary chat input / explicit commands typed by user
  public addMessage = (text: string) => {
    const trimmedInput = text.trim();
    this.messages.push({
      id: `msg-${Date.now()}-user`,
      sender: 'user',
      text: trimmedInput,
      projectId: 'default',
      timestamp: '12:00 PM',
    });

    const commandResult = evaluateChatCommand(
      trimmedInput,
      { navigateTo: this.navigateTo },
      this.currentScreen
    );

    if (commandResult.handled) {
      this.messages.push({
        id: `msg-${Date.now()}-cmd`,
        sender: 'axon',
        text: commandResult.response,
        projectId: 'default',
        timestamp: '12:00 PM',
        commandOptions: commandResult.options || commandResult.actions,
        actions: commandResult.actions || commandResult.options,
      });
      return;
    }

    // Otherwise would enter normal LLM request-generation pipeline
    this.llmPipelineCalledCount++;
    this.messages.push({
      id: `msg-${Date.now()}-llm`,
      sender: 'axon',
      text: `LLM response to: ${text}`,
      projectId: 'default',
      timestamp: '12:00 PM',
    });
  };

  // Type C: Contextual action activation (Decoupled execution path)
  public executeContextualAction = (
    actionOrText: ContextualMessageAction | string,
    actionParam?: ContextualMessageAction
  ) => {
    let action: ContextualMessageAction;
    if (actionParam && typeof actionParam === 'object') {
      action = actionParam;
    } else if (typeof actionOrText === 'object' && actionOrText !== null) {
      action = actionOrText;
    } else {
      action = {
        label: String(actionOrText || ''),
        actionText: String(actionOrText || ''),
      };
    }

    const label = (action.label || action.actionText || 'Action').trim();
    const actionText = (action.actionText || action.label || '').trim();

    // 1. Single user-side indication
    const userIndicationMsg: ChatMessage = {
      id: `msg-${Date.now()}-act-user`,
      sender: 'user',
      text: label,
      projectId: 'default',
      timestamp: '12:00 PM',
    };

    // 2. Authoritative execution through existing command & navigation router
    // Button activation is an explicit user action; if actionText lacks explicit syntax (/ or run),
    // qualify it using destinationId or run prefix so it executes immediately without redundant confirmation.
    let executableText = actionText;
    if (!executableText.startsWith('/') && !/^(?:run|execute)\b/i.test(executableText)) {
      const targetId = action.destinationId || action.targetId;
      if (targetId) {
        executableText = `/open ${targetId}`;
      } else if (/^(?:open|go\s+to|navigate\s+to)\s+/i.test(executableText)) {
        executableText = `run ${executableText}`;
      }
    }

    const commandResult = evaluateChatCommand(
      executableText,
      { navigateTo: this.navigateTo },
      this.currentScreen
    );

    if (commandResult.handled) {
      const axonResponseMsg: ChatMessage = {
        id: `msg-${Date.now()}-act-resp`,
        sender: 'axon',
        text: commandResult.response,
        projectId: 'default',
        timestamp: '12:00 PM',
        // Crucial: no re-generation of executed buttons!
        commandOptions: commandResult.executed ? undefined : commandResult.options,
        actions: commandResult.executed ? undefined : commandResult.actions,
      };

      this.messages.push(userIndicationMsg, axonResponseMsg);
      return;
    }

    // 3. Fallback direct destination resolution
    const destId = action.destinationId || action.targetId;
    if (destId) {
      const resolved = resolveInterfaceFromQuery(destId, this.currentScreen);
      if (resolved.match && resolved.match.route) {
        this.navigateTo(resolved.match.route as ScreenId, { screenState: resolved.match.subState });
        const axonResponseMsg: ChatMessage = {
          id: `msg-${Date.now()}-act-resp`,
          sender: 'axon',
          text: `Opened **${resolved.match.name}**.`,
          projectId: 'default',
          timestamp: '12:00 PM',
        };
        this.messages.push(userIndicationMsg, axonResponseMsg);
        return;
      }
    }

    // 4. Default notice
    const noticeMsg: ChatMessage = {
      id: `msg-${Date.now()}-act-resp`,
      sender: 'axon',
      text: `Action **${label}** processed.`,
      projectId: 'default',
      timestamp: '12:00 PM',
    };
    this.messages.push(userIndicationMsg, noticeMsg);
  };
}

// TEST 1: Input Type A (Ordinary natural-language navigation requires explicit confirmation)
{
  console.log('Testing Test 1: Input Type A (Ordinary natural-language navigation requires explicit confirmation)...');
  const ctx = new MockAppContext();
  ctx.addMessage('open calculator');

  // Must NOT auto-execute navigation prior to explicit confirmation
  assert.strictEqual(ctx.currentScreen, 'axon', 'Should NOT navigate to calculator on natural language input');
  assert.strictEqual(ctx.llmPipelineCalledCount, 0, 'Should not invoke LLM pipeline for handled command');
  assert.strictEqual(ctx.messages.length, 2, 'Should have user message and AXON response');
  assert.strictEqual(ctx.messages[0].text, 'open calculator');
  assert.ok(ctx.messages[1].text.includes('Would you like to open **Calculation & Keypad**?'));
  assert.ok(ctx.messages[1].actions && ctx.messages[1].actions.length >= 1, 'Should attach contextual confirmation action');
  assert.strictEqual(ctx.messages[1].actions![0].destinationId, 'tool_calc');

  // Now user explicitly activates the presented contextual action
  const confirmAction = ctx.messages[1].actions![0];
  ctx.executeContextualAction(confirmAction);

  // Now navigation executes cleanly
  assert.strictEqual(ctx.currentScreen, 'tool_calc', 'Should navigate to calculator upon explicit activation');
  assert.strictEqual(ctx.llmPipelineCalledCount, 0, 'LLM pipeline must not be called');
  assert.strictEqual(ctx.messages.length, 4, 'Should have initial 2 messages + user indication + completion response');
  assert.strictEqual(ctx.messages[2].text, confirmAction.label);
  assert.ok(ctx.messages[3].text.includes('Opened **Calculation & Keypad**'));
  assert.strictEqual(ctx.messages[3].actions, undefined, 'Completion response must not re-attach actions');
  console.log('Test 1: PASSED');
}

// TEST 1b: Input Type B2 (Explicit "run" instruction executes immediately)
{
  console.log('Testing Test 1b: Input Type B2 (Explicit "run" instruction executes immediately)...');
  const ctx = new MockAppContext();
  ctx.addMessage('run open calculator');

  assert.strictEqual(ctx.currentScreen, 'tool_calc', 'Explicit "run" instruction should navigate immediately');
  assert.strictEqual(ctx.llmPipelineCalledCount, 0, 'Should not invoke LLM pipeline');
  assert.strictEqual(ctx.messages.length, 2, 'Should have user message and AXON response');
  assert.strictEqual(ctx.messages[0].text, 'run open calculator');
  assert.ok(ctx.messages[1].text.includes('Opened **Calculation & Keypad**'));
  console.log('Test 1b: PASSED');
}

// TEST 2: Input Type B (Explicit command navigation)
{
  console.log('Testing Test 2: Input Type B (Explicit command navigation)...');
  const ctx = new MockAppContext();
  ctx.addMessage('/open settings');

  assert.strictEqual(ctx.currentScreen, 'settings', 'Should navigate to settings');
  assert.strictEqual(ctx.llmPipelineCalledCount, 0, 'Should not invoke LLM pipeline');
  assert.strictEqual(ctx.messages.length, 2, 'Should have user message and AXON response');
  assert.strictEqual(ctx.messages[0].text, '/open settings');
  assert.ok(ctx.messages[1].text.includes('Opened **Settings**'));
  console.log('Test 2: PASSED');
}

// TEST 3: Input Type C (Contextual Action activation does NOT recurse)
{
  console.log('Testing Test 3: Input Type C (Contextual Action activation does NOT recurse)...');
  const ctx = new MockAppContext();

  // Suppose an earlier message provided an action:
  const actionToClick: ContextualMessageAction = {
    label: 'Open AXON Calculator',
    actionText: '/open tool_calc',
    destinationId: 'tool_calc',
  };

  // User clicks the contextual action button
  ctx.executeContextualAction(actionToClick);

  // Verification 3.1: LLM pipeline is NEVER called
  assert.strictEqual(ctx.llmPipelineCalledCount, 0, 'LLM pipeline must NOT be called on action activation');

  // Verification 3.2: Navigation executed exactly once
  assert.strictEqual(ctx.currentScreen, 'tool_calc', 'Should navigate to tool_calc exactly once');

  // Verification 3.3: Exactly one user indication and one AXON response produced
  assert.strictEqual(ctx.messages.length, 2, 'Must produce exactly 2 messages (1 user indication, 1 response)');
  assert.strictEqual(ctx.messages[0].sender, 'user');
  assert.strictEqual(ctx.messages[0].text, 'Open AXON Calculator', 'User indication displays button label');
  assert.strictEqual(ctx.messages[1].sender, 'axon');
  assert.ok(ctx.messages[1].text.includes('Opened **Calculation & Keypad**'));

  // Verification 3.4: The AXON response has NO actions attached (prevents recursive button generation)
  assert.strictEqual(ctx.messages[1].actions, undefined, 'Executed action response must not attach duplicate actions');
  assert.strictEqual(ctx.messages[1].commandOptions, undefined, 'Executed action response must not attach duplicate commandOptions');
  console.log('Test 3: PASSED');
}

// TEST 4: Non-recursive re-activation verification
{
  console.log('Testing Test 4: Re-activating an action executes cleanly without creating loops...');
  const ctx = new MockAppContext();
  const actionToClick: ContextualMessageAction = {
    label: 'Open Tools',
    actionText: '/open tools',
    destinationId: 'tools',
  };

  // First activation
  ctx.executeContextualAction(actionToClick);
  assert.strictEqual(ctx.currentScreen, 'tools');
  assert.strictEqual(ctx.messages.length, 2);

  // Return to chat (screen change)
  ctx.navigateTo('axon');
  assert.strictEqual(ctx.currentScreen, 'axon');
  assert.strictEqual(ctx.messages.length, 2, 'Returning to chat does not trigger extra executions');

  // Second activation later in session
  ctx.executeContextualAction(actionToClick);
  assert.strictEqual(ctx.currentScreen, 'tools');
  assert.strictEqual(ctx.messages.length, 4, 'Second activation adds 1 user indication and 1 response (total 4)');
  assert.strictEqual(ctx.llmPipelineCalledCount, 0, 'Zero LLM calls');
  console.log('Test 4: PASSED');
}

// TEST 5: Fallback destination resolution when action has destinationId without slash command
{
  console.log('Testing Test 5: Fallback destination resolution...');
  const ctx = new MockAppContext();
  const directAction: ContextualMessageAction = {
    label: 'Storage',
    actionText: 'storage',
    destinationId: 'storage',
  };

  ctx.executeContextualAction(directAction);
  assert.strictEqual(ctx.currentScreen, 'storage');
  assert.strictEqual(ctx.messages.length, 2);
  assert.ok(ctx.messages[1].text.includes('Opened **Storage & Manifest**'));
  console.log('Test 5: PASSED');
}

console.log('=== ALL CONTEXTUAL ACTION EXECUTION VERIFICATIONS PASSED SUCCESSFULLY! ===');
