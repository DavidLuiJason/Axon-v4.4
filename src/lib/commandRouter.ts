import {
  ScreenId,
  ChatCommandOption,
  ContextualMessageAction,
  PendingInteraction,
  PendingInteractionType,
  ExpectedResponseType,
} from '../types';
import {
  resolveInterfaceFromQuery,
  discoverAvailableInterfaces,
  InterfaceMetadata,
} from './interfaceRegistry';
import { tryEvaluateMathExpression } from './storageChatHandler';
import {
  getPendingInteraction,
  setPendingInteraction,
  clearPendingInteraction,
  createAmbiguityResolutionInteraction,
  PENDING_INTERACTION_EXPIRATION_MS,
} from './pendingInteraction';
import {
  classifyStatement,
  resolveUserIntent,
  evaluateMeaningfulInteraction,
  systemCapabilityRegistry,
  StatementType,
  ResponsePurpose,
  ExecutionPolicy,
  ResolvedIntent,
  ActionNode,
  ActionExecutionPlan,
  ActionExecutionType,
  ActionDependency,
  ActionDependencyCondition,
  AlternativeResolution,
  RouteType,
  SystemCapability,
  CapabilityActionDefinition,
  resolveActionPlanFromInput,
  executeActionPlanSync,
  queryAttemptHistory,
  resolveCapabilityInput,
  resolveMultiStepCapabilityPlan,
  CapabilityResolution,
} from './capabilitySystem';
import type { InvocationSource } from './capabilityContract';
import {
  actionExecutionGateway,
  ActionExecutionResult,
  getLastExecutionOutcome,
  setLastExecutionOutcome,
} from './actionExecutionGateway';

export interface CommandRouterActions {
  navigateTo: (
    screen: ScreenId,
    options?: {
      panel?: string | null;
      payload?: any;
      preserveMenu?: boolean;
      screenState?: Record<string, any>;
    }
  ) => void;
  settingsHandlers?: any;
  storageHandlers?: any;
}

export interface CommandExecutionResult {
  handled: boolean;
  executed?: boolean;
  response: string;
  targetScreen?: ScreenId;
  commandName?: string;
  modelUsed?: string;
  options?: ContextualMessageAction[];
  actions?: ContextualMessageAction[];
  purpose?: ResponsePurpose;
  statementType?: StatementType;
  plan?: ActionExecutionPlan;
}

export interface PendingChoiceState
  extends Partial<PendingInteraction<InterfaceMetadata, InterfaceMetadata>> {
  command: string;
  promptType: 'confirm' | 'select';
  target?: InterfaceMetadata;
  candidates?: InterfaceMetadata[];
  timestamp: number;
}

export const PENDING_CHOICE_EXPIRATION_MS = PENDING_INTERACTION_EXPIRATION_MS;

export function getPendingChoice(): PendingChoiceState | null {
  return getPendingInteraction() as PendingChoiceState | null;
}

export function setPendingChoice(choice: PendingChoiceState | null): void {
  setPendingInteraction(choice);
}

export function clearPendingChoice(): void {
  clearPendingInteraction();
}

export {
  getPendingInteraction,
  setPendingInteraction,
  clearPendingInteraction,
  createAmbiguityResolutionInteraction,
  PENDING_INTERACTION_EXPIRATION_MS,
  classifyStatement,
  resolveUserIntent,
  evaluateMeaningfulInteraction,
  systemCapabilityRegistry,
};
export type {
  PendingInteraction,
  PendingInteractionType,
  ExpectedResponseType,
  ContextualMessageAction,
  StatementType,
  ResponsePurpose,
  ExecutionPolicy,
  ResolvedIntent,
  ActionNode,
  ActionExecutionPlan,
  ActionExecutionType,
  ActionDependency,
  ActionDependencyCondition,
  AlternativeResolution,
  RouteType,
  SystemCapability,
  CapabilityActionDefinition,
};

/**
 * Checks if input represents confirmation intent relative to a pending target.
 */
function isConfirmationIntent(input: string, target?: InterfaceMetadata): boolean {
  const norm = input.trim().toLowerCase();

  // Affirmation words and short phrases
  const affirmationRegex =
    /^(?:yes|yeah|yep|yup|yea|sure|okay|ok|correct|right|that'?s\s+right|that'?s\s+the\s+one|that\s+one|this\s+one|open\s+it|go\s+there|take\s+me\s+there|do\s+it|proceed|confirm|sounds\s+good|affirmative|please|the\s+first\s+one|first\s+one|number\s+1|1)(?:[!.?,]|\s+.*)?$/i;

  if (affirmationRegex.test(norm)) {
    return true;
  }

  // Compound affirmations like "yes, source", "yeah open it", "sure, take me there"
  if (/^(?:yes|yeah|sure|okay|ok)[,\s]+.+/i.test(norm)) {
    return true;
  }

  if (target) {
    const targetName = target.name.toLowerCase();
    const cleanName = targetName.replace(/^axon\s+/i, '').trim();
    const targetId = target.id.toLowerCase();

    // Direct reference to the target or its clean name
    if (
      norm === targetName ||
      norm === cleanName ||
      norm === targetId ||
      norm === `open ${cleanName}` ||
      norm === `open ${targetName}` ||
      norm === `go to ${cleanName}` ||
      norm === `go to ${targetName}` ||
      norm === `i mean ${targetName}` ||
      norm === `i mean ${cleanName}`
    ) {
      return true;
    }

    // Matching any of the target's distinctive keywords
    for (const kw of target.keywords) {
      const kwLower = kw.toLowerCase();
      if (norm === kwLower || norm === `open ${kwLower}` || norm === `go to ${kwLower}`) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks if input represents rejection or cancellation intent.
 * Recognizes corrections ("no, I meant Settings", "actually Settings"), contextual dismissals ("no, not that"),
 * and standard cancellations.
 */
function isRejectionIntent(input: string): {
  isRejection: boolean;
  newTarget?: string;
  isContextualDismissal?: boolean;
} {
  const norm = input.trim().toLowerCase();

  // Correction with "i meant": "no, I meant Settings", "I meant Settings", "no, meant tools", "meant settings"
  const meantMatch = norm.match(/^(?:no|nope|nah)?[,\s]*(?:i\s+meant|meant)[,\s]+(.+)$/i);
  if (meantMatch && meantMatch[1]) {
    const rawTarget = meantMatch[1].trim();
    if (!/^(?:not\s+this|not\s+that|this|that)$/i.test(rawTarget)) {
      return { isRejection: true, newTarget: rawTarget };
    }
  }

  // Check for rejection followed by new command: "no, Tools", "no, open Tools", "actually open Code", "instead open settings", "no, not this, open tools"
  const correctionMatch = norm.match(
    /^(?:no|nope|nah)[,\s]+(?:actually\s+|instead\s+|not\s+this[,\s]+|not\s+that[,\s]+)?(?:open\s+|go\s+to\s+)?(.+)$/i
  );
  if (correctionMatch && correctionMatch[1]) {
    const rawTarget = correctionMatch[1].trim();
    // Guard against "not this" / "not that" being captured as target
    if (!/^(?:not\s+this|not\s+that|this|that)$/i.test(rawTarget)) {
      return { isRejection: true, newTarget: rawTarget };
    }
  }

  const actuallyMatch = norm.match(/^(?:actually|instead)[,\s]+(?:open\s+|go\s+to\s+)?(.+)$/i);
  if (actuallyMatch && actuallyMatch[1]) {
    return { isRejection: true, newTarget: actuallyMatch[1].trim() };
  }

  // Specific "no, not that" / "not that" contextual dismissal
  if (/^(?:no[,\s]+)?not\s+that[!.?,]*$/i.test(norm)) {
    return { isRejection: true, isContextualDismissal: true };
  }

  // Pure rejection (including natural responses to suggestions like "no, not this", "not this", "no thanks", "no, don't open")
  if (
    /^(?:no|nope|nah|cancel|nevermind|never\s+mind|stop|neither|none|none\s+of\s+these|not\s+this|no[,\s]+not\s+this|no\s+thanks|no\s+thank\s+you|don'?t|do\s+not|no[,\s]+don'?t(?:\s+open(?:\s+this)?)?)[!.?,]*$/i.test(
      norm
    )
  ) {
    return { isRejection: true };
  }

  return { isRejection: false };
}

/**
 * Evaluates chat input for supported AXON application commands.
 * Resolves targets via existing registries and invokes supplied application actions.
 */
export interface CommandEvaluationOptions {
  invocationSource?: InvocationSource;
  confirmedBy?: 'user_click' | 'explicit_command' | 'dialog' | 'suggestion_activation';
  isConfirmed?: boolean;
}

let directCmdCounter = 0;

export function evaluateChatCommand(
  input: string,
  actions: CommandRouterActions,
  currentScreen?: ScreenId,
  options?: CommandEvaluationOptions
): CommandExecutionResult {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return { handled: false, response: '' };
  }

  // Guard against result/status messages re-entering command execution
  if (
    /^(?:### Execution Attempt History|### AXON Interface Directory|Opened \*\*|Action \*\*|Execution error:|The method that succeeded was|Confirmed: the previous action|Understood\. The previous action|The previous action \()/i.test(
      trimmed
    )
  ) {
    return { handled: true, executed: false, response: '' };
  }

  // -------------------------------------------------------------
  // 0. Check Pending Choice State (Awaiting Confirmation or Selection)
  // -------------------------------------------------------------
  const pending = getPendingChoice();
  if (pending) {
    // Check if user is issuing a rejection or redirection
    const rejectionCheck = isRejectionIntent(trimmed);
    if (rejectionCheck.isRejection) {
      const priorTargetName = pending.target?.name;
      clearPendingChoice();
      if (rejectionCheck.newTarget) {
        // User supplied a correction: "No, I meant Settings"
        // This updates the existing interpretation and executes immediately without redundant asking!
        return handleOpenCommand(rejectionCheck.newTarget, actions, currentScreen, true);
      }
      if (rejectionCheck.isContextualDismissal && priorTargetName) {
        return {
          handled: true,
          executed: false,
          response: `Dismissed suggestion to open **${priorTargetName}**. What destination or task would you like to pursue instead?`,
          commandName: '/open',
        };
      }
      return {
        handled: true,
        executed: false,
        response: 'Navigation cancelled.',
        commandName: '/open',
      };
    }

    // Check if user is resolving an ambiguity interaction
    if (pending.type === 'ambiguity_resolution') {
      const target = pending.target as InterfaceMetadata | undefined;
      if (target && isConfirmationIntent(trimmed, target)) {
        clearPendingChoice();
        actions.navigateTo(target.route as ScreenId, {
          screenState: target.subState,
        });
        const shortcutAction: ContextualMessageAction = {
          label: `Open ${target.name}`,
          actionText: `/open ${target.id}`,
          destinationId: target.id,
          targetId: target.id,
          description: `Navigate to ${target.name}`,
          intent: 'open',
          variant: 'default',
        };
        return {
          handled: true,
          executed: true,
          response: `Opened **${target.name}**.`,
          targetScreen: target.route as ScreenId,
          commandName: '/open',
          options: [shortcutAction],
          actions: [shortcutAction],
        };
      }

      if (/^(?:new|new\s+request|different|neither)$/i.test(trimmed)) {
        clearPendingChoice();
        return {
          handled: true,
          executed: false,
          response: 'Starting new request.',
          commandName: '/open',
        };
      }
    }

    // Check if user is confirming a pending single target
    if (pending.promptType === 'confirm' && pending.target) {
      if (isConfirmationIntent(trimmed, pending.target)) {
        const target = pending.target;
        clearPendingChoice();
        actions.navigateTo(target.route as ScreenId, {
          screenState: target.subState,
        });
        const shortcutAction: ContextualMessageAction = {
          label: `Open ${target.name}`,
          actionText: `/open ${target.id}`,
          destinationId: target.id,
          targetId: target.id,
          description: `Navigate to ${target.name}`,
          intent: 'open',
          variant: 'default',
        };
        return {
          handled: true,
          executed: true,
          response: `Opened **${target.name}**.`,
          targetScreen: target.route as ScreenId,
          commandName: '/open',
          options: [shortcutAction],
          actions: [shortcutAction],
        };
      }
    }

    // Check if user is selecting from multiple candidates
    if (pending.promptType === 'select' && pending.candidates && pending.candidates.length > 0) {
      const candidates = pending.candidates;

      // Check numeric selection: "1", "first one", "the first one", "2", etc.
      let selectedIdx = -1;
      const numMatch = trimmed.match(/^(?:the\s+)?(?:number\s+)?([1-9])(?:st|nd|rd|th)?(?:\s+one)?$/i);
      if (numMatch) {
        const n = parseInt(numMatch[1], 10);
        if (n >= 1 && n <= candidates.length) {
          selectedIdx = n - 1;
        }
      } else if (/^first(?:\s+one)?$/i.test(trimmed)) {
        selectedIdx = 0;
      } else if (/^second(?:\s+one)?$/i.test(trimmed) && candidates.length > 1) {
        selectedIdx = 1;
      } else if (/^third(?:\s+one)?$/i.test(trimmed) && candidates.length > 2) {
        selectedIdx = 2;
      }

      if (selectedIdx >= 0) {
        const chosen = candidates[selectedIdx];
        clearPendingChoice();
        actions.navigateTo(chosen.route as ScreenId, {
          screenState: chosen.subState,
        });
        const shortcutAction: ContextualMessageAction = {
          label: `Open ${chosen.name}`,
          actionText: `/open ${chosen.id}`,
          destinationId: chosen.id,
          targetId: chosen.id,
          description: `Navigate to ${chosen.name}`,
          intent: 'open',
          variant: 'default',
        };
        return {
          handled: true,
          executed: true,
          response: `Opened **${chosen.name}**.`,
          targetScreen: chosen.route as ScreenId,
          commandName: '/open',
          options: [shortcutAction],
          actions: [shortcutAction],
        };
      }

      // Check if user typed the name or keyword of one of the candidates
      const normTrimmed = trimmed.toLowerCase();
      const matchedCand = candidates.find((c) => {
        const cName = c.name.toLowerCase();
        const cClean = cName.replace(/^axon\s+/i, '').trim();
        return (
          normTrimmed === cName ||
          normTrimmed === cClean ||
          normTrimmed === c.id.toLowerCase() ||
          normTrimmed === `open ${cClean}` ||
          normTrimmed === `open ${cName}` ||
          c.keywords.some((k) => k.toLowerCase() === normTrimmed)
        );
      });

      if (matchedCand) {
        clearPendingChoice();
        actions.navigateTo(matchedCand.route as ScreenId, {
          screenState: matchedCand.subState,
        });
        const shortcutAction: ContextualMessageAction = {
          label: `Open ${matchedCand.name}`,
          actionText: `/open ${matchedCand.id}`,
          destinationId: matchedCand.id,
          targetId: matchedCand.id,
          description: `Navigate to ${matchedCand.name}`,
          intent: 'open',
          variant: 'default',
        };
        return {
          handled: true,
          executed: true,
          response: `Opened **${matchedCand.name}**.`,
          targetScreen: matchedCand.route as ScreenId,
          commandName: '/open',
          options: [shortcutAction],
          actions: [shortcutAction],
        };
      }

      // If user typed generic affirmation like "yes" when multiple choices were offered
      if (/^(?:yes|yeah|sure|okay|ok)$/i.test(trimmed)) {
        return {
          handled: true,
          executed: false,
          response: `Which destination would you like to open? (Enter the number 1-${candidates.length} or type the destination name).`,
          commandName: '/open',
          options: candidates.map((c) => ({
            label: c.name,
            actionText: `/open ${c.id}`,
            destinationId: c.id,
            description: c.description,
          })),
        };
      }
    }

    // If input is an explicit slash command or fast-path math, clear pending choice and proceed
    if (trimmed.startsWith('/') || tryEvaluateMathExpression(trimmed)) {
      clearPendingChoice();
    } else {
      // Unrelated input: clear pending choice and let it fall through to normal processing
      clearPendingChoice();
    }
  }

  // -------------------------------------------------------------
  // 0.5. Purpose-Driven Capability & Statement Intent Evaluation
  // -------------------------------------------------------------
  // Evaluates statement classification (question, hypothetical, refusal, exceeds_capability, etc.)
  // and checks if a meaningful interaction or alternative capability resolution applies.
  const resolvedIntent = resolveUserIntent(trimmed, currentScreen, false);
  const meaningfulResult = evaluateMeaningfulInteraction(resolvedIntent, {
    currentScreen,
    navigateTo: actions.navigateTo,
    settingsHandlers: actions.settingsHandlers,
    storageHandlers: actions.storageHandlers,
  });

  if (meaningfulResult) {
    return {
      handled: meaningfulResult.handled,
      executed: meaningfulResult.executed,
      purpose: meaningfulResult.purpose,
      statementType: resolvedIntent.statementType,
      response: meaningfulResult.response,
      commandName: meaningfulResult.commandName,
      modelUsed: meaningfulResult.modelUsed,
      actions: meaningfulResult.actions,
      options: meaningfulResult.actions,
      targetScreen: meaningfulResult.targetScreen,
    };
  }

  // -------------------------------------------------------------
  // 0.7. Follow-up Attempt History Queries
  // (Answers "what did you try?", "why didn't method X work?", "which method succeeded?", etc.)
  // -------------------------------------------------------------
  const attemptHistoryAnswer = queryAttemptHistory(trimmed);
  if (attemptHistoryAnswer) {
    return {
      handled: true,
      executed: false,
      response: attemptHistoryAnswer,
      purpose: 'report_result',
      statementType: 'question',
    };
  }

  // -------------------------------------------------------------
  // 0.75. Capability Availability & Environment Self-Awareness Queries
  // (Truthfully reports offline capabilities, active availability, and reasons for unavailability)
  // -------------------------------------------------------------
  const capabilityAwarenessAnswer = systemCapabilityRegistry.querySelfAwareness(trimmed);
  if (capabilityAwarenessAnswer) {
    return {
      handled: true,
      executed: false,
      response: capabilityAwarenessAnswer,
      purpose: 'provide_information',
      statementType: 'question',
    };
  }

  // -------------------------------------------------------------
  // 0.8. Action Plan / Execution Plan Resolution
  // (Multi-step sequential, parallel, queued, conditional, retry, adaptive policy, and priority plans)
  // -------------------------------------------------------------
  const multiPlan =
    resolveMultiStepCapabilityPlan(trimmed, {
      currentScreen,
      pendingInteraction: getPendingInteraction(),
    }) || resolveActionPlanFromInput(trimmed, currentScreen);
  if (
    multiPlan &&
    (multiPlan.actions.length > 1 ||
      multiPlan.type === 'queue' ||
      multiPlan.status === 'cancelled' ||
      Boolean(multiPlan.adaptivePolicy) ||
      /^(?:try\s+it\s+again|try\s+again|retry)/i.test(trimmed) ||
      trimmed.toLowerCase().includes('high priority') ||
      trimmed.toLowerCase().includes('run next') ||
      /^(?:put|move)\s+.+?\s+before\s+/i.test(trimmed))
  ) {
    const execResult = executeActionPlanSync(multiPlan, {
      currentScreen,
      navigateTo: actions.navigateTo,
      settingsHandlers: actions.settingsHandlers,
      storageHandlers: actions.storageHandlers,
    });

    return {
      handled: true,
      executed: execResult.executed,
      response: execResult.summary,
      targetScreen: execResult.targetScreen,
      purpose: execResult.status === 'completed' ? 'report_result' : 'explain_limitation',
      statementType: 'explicit_instruction',
      plan: execResult.plan,
    };
  }

  // -------------------------------------------------------------
  // 1. Explicit slash command: /open [target] or "open command [target]"
  // -------------------------------------------------------------
  if (/^\/open(?:\s|$)/i.test(trimmed)) {
    const rawTarget = trimmed.replace(/^\/open/i, '').trim();
    return handleOpenCommand(rawTarget, actions, currentScreen, true);
  }

  if (/^open\s+command(?:\s|$)/i.test(trimmed)) {
    const rawTarget = trimmed.replace(/^open\s+command/i, '').trim();
    return handleOpenCommand(rawTarget, actions, currentScreen, true);
  }

  // -------------------------------------------------------------
  // 0.9. Capability Resolution Engine
  // (Resolves input into: Capability → Intent → Target → Parameters → Modifiers → Execution Policy)
  // -------------------------------------------------------------
  const capResolution = resolveCapabilityInput(trimmed, {
    currentScreen,
    pendingInteraction: getPendingInteraction(),
    lastExecutionOutcome: getLastExecutionOutcome(),
    invocationSource: options?.invocationSource,
    authorizedBy: options?.confirmedBy,
  });

  if (capResolution.status === 'conversational' && capResolution.responseMessage) {
    return {
      handled: true,
      executed: false,
      response: capResolution.responseMessage,
      statementType: 'conversational',
      purpose: 'provide_information',
      modelUsed: 'AXON Contextual Resolution',
    };
  }

  if (capResolution.status === 'refusal') {
    return {
      handled: true,
      executed: false,
      response: capResolution.responseMessage || 'Execution cancelled.',
      purpose: 'explain_limitation',
      statementType: 'refusal',
      modelUsed: capResolution.modelUsed || 'AXON Capability Intelligence',
    };
  }

  if (capResolution.status === 'hypothetical') {
    return {
      handled: true,
      executed: false,
      response: capResolution.responseMessage || 'Executing commands directly modifies interface state.',
      purpose: 'explain_limitation',
      statementType: 'hypothetical',
      modelUsed: capResolution.modelUsed || 'AXON Capability Intelligence',
    };
  }

  if (capResolution.status === 'unsupported') {
    return {
      handled: true,
      executed: false,
      response: capResolution.responseMessage || 'AXON operates in a secure client environment.',
      purpose: 'explain_limitation',
      statementType: 'exceeds_capability',
      actions: capResolution.contextualActions,
      options: capResolution.contextualActions,
      modelUsed: capResolution.modelUsed || 'AXON Problem Solver',
    };
  }

  if (capResolution.status === 'resolved') {
    const { capabilityId, intent, target, parameters, executionPolicy } = capResolution;

    // A. Workspace Navigation: Preserve existing /open command behaviors and adaptive routing
    if (capabilityId === 'workspace_navigation' && target) {
      const isImmediate = executionPolicy === 'immediate' || options?.isConfirmed === true;
      return handleOpenCommand(target, actions, currentScreen, isImmediate);
    }

    // B. Interactive Settings Options
    if (capabilityId === 'settings_controller') {
      const isExplicitSettings = /^\/settings/i.test(trimmed);
      if (isExplicitSettings && intent === 'configure_appearance') {
        return {
          handled: true,
          executed: false,
          response: capResolution.responseMessage || 'Interface appearance settings available:',
          commandName: '/settings',
          options: capResolution.contextualActions,
          actions: capResolution.contextualActions,
          modelUsed: 'AXON Settings Controller',
        };
      }
    }

    // C. Storage Diagnostics: Guard conversational questions for downstream chat reporter
    if (capabilityId === 'storage_diagnostics') {
      const isExplicitStorage = /^\/storage/i.test(trimmed);
      if (!isExplicitStorage) {
        // Conversational storage queries (e.g. "how much storage do I have left") should be handled downstream by handleStorageChatCommand
        return { handled: false, response: '' };
      }
    }

    // F. Direct Capability Execution via Gateway
    const registeredCap = systemCapabilityRegistry.get(capabilityId);
    if (registeredCap && registeredCap.execute && (executionPolicy === 'immediate' || (executionPolicy as string) === 'execute' || options?.isConfirmed === true)) {
      const effectiveSource =
        options?.invocationSource ||
        capResolution.invocationSource ||
        (options?.isConfirmed ? 'contextual_action' : 'direct_command');

      const gatewayRes = actionExecutionGateway.dispatch({
        executionId: `cmd_${capabilityId}_${Date.now()}_${++directCmdCounter}`,
        source: effectiveSource,
        capabilityId,
        intent,
        target,
        parameters,
        executionPolicy,
        authorizationLevel: capResolution.authorizationLevel,
        confirmationState: options?.isConfirmed
          ? { isConfirmed: true, confirmedBy: options.confirmedBy, confirmedAt: Date.now() }
          : undefined,
        context: {
          currentScreen,
          navigateTo: actions.navigateTo,
          settingsHandlers: actions.settingsHandlers,
          storageHandlers: actions.storageHandlers,
        },
      });

      if (gatewayRes.executed || gatewayRes.status === 'completed') {
        return {
          handled: true,
          executed: gatewayRes.success,
          response: gatewayRes.response,
          targetScreen: gatewayRes.targetScreen,
          commandName: capabilityId === 'math_calculator' ? 'math' : (registeredCap.commands[0] ? `/${registeredCap.commands[0]}` : `/${capabilityId}`),
          modelUsed: capabilityId === 'math_calculator' ? 'AXON Offline Calculator Engine' : `AXON ${registeredCap.name}`,
          actions: gatewayRes.actions,
        };
      }
    }

    // G. Execution through Action Plan
    if (capResolution.plan) {
      if (options?.isConfirmed && capResolution.plan.actions.length > 0) {
        capResolution.plan.actions[0].requiresConfirmation = false;
      }
      const execResult = executeActionPlanSync(capResolution.plan, {
        currentScreen,
        navigateTo: actions.navigateTo,
        settingsHandlers: actions.settingsHandlers,
        storageHandlers: actions.storageHandlers,
      });
      if (execResult.executed) {
        return {
          handled: true,
          executed: true,
          response: execResult.summary,
          targetScreen: execResult.targetScreen,
          purpose: 'report_result',
          statementType: 'explicit_instruction',
          plan: execResult.plan,
        };
      }
    }
  }

  // -------------------------------------------------------------
  // 1.5. Explicit "run" execution instruction:
  // e.g. "run open calculator", "run /open calculator", "run command open calculator", "/run open calculator", "run calculator"
  // The user explicitly authorizes immediate execution.
  // -------------------------------------------------------------
  const runInstructionMatch = trimmed.match(
    /^(?:\/run\b|run\s+command\b|run\b|execute\s+command\b|execute\b)(?::|\s+)\s*(.+)$/i
  );
  if (runInstructionMatch && runInstructionMatch[1]) {
    const candidatePayload = runInstructionMatch[1].trim();

    // Form A: explicit slash command payload (e.g. "run /open calculator")
    if (/^\/open(?:\s|$)/i.test(candidatePayload)) {
      const target = candidatePayload.replace(/^\/open/i, '').trim();
      return handleOpenCommand(target, actions, currentScreen, true);
    }

    // Form B: explicit lead-in payload (e.g. "run open calculator", "run command open calculator", "run go to tools")
    const innerNavMatch = candidatePayload.match(
      /^(?:please\s+)?(?:open(?:\s+up)?(?:\s+the)?|go\s+(?:to|into)(?:\s+the)?|navigate\s+to(?:\s+the)?|show(?:\s+me)?(?:\s+the)?)\s+(.+)$/i
    );
    if (innerNavMatch && innerNavMatch[1]) {
      const innerTarget = innerNavMatch[1].trim();
      if (
        !/^(?:how|why|what|who|where|when)\b/i.test(innerTarget) &&
        !innerTarget.endsWith('?')
      ) {
        return handleOpenCommand(innerTarget, actions, currentScreen, true);
      }
    }

    // Form C: direct interface name following explicit run instruction (e.g. "run calculator", "run settings")
    if (
      !candidatePayload.endsWith('?') &&
      !/^(?:how|why|what|who|where|when|can|could|would|is|are|do|does|explain|tell\s+me)\b/i.test(candidatePayload)
    ) {
      const wordCount = candidatePayload.split(/\s+/).length;
      if (wordCount <= 4) {
        const directResolution = resolveInterfaceFromQuery(candidatePayload, currentScreen);
        if (directResolution.isExact && directResolution.match) {
          return handleOpenCommand(candidatePayload, actions, currentScreen, true);
        }
      }
    }
  }

  // -------------------------------------------------------------
  // 2. Natural language navigation lead-in forms:
  // "open <target>", "go to <target>", "take me to <target>", "navigate to <target>", "show <target>"
  // -------------------------------------------------------------
  const naturalMatch = trimmed.match(
    /^(?:please\s+)?(?:open(?:\s+up)?(?:\s+the)?|go\s+(?:to|into)(?:\s+the)?|take\s+me\s+to(?:\s+the)?|navigate\s+to(?:\s+the)?|show(?:\s+me)?(?:\s+the)?)\s+(.+)$/i
  );
  if (naturalMatch && naturalMatch[1]) {
    const candidateTarget = naturalMatch[1].trim();

    // Guard: Do not intercept questions or natural conversation
    if (
      !/^(?:how|why|what|who|where|when|can\s+you|could\s+you|tell\s+me)\b/i.test(candidateTarget) &&
      !candidateTarget.endsWith('?')
    ) {
      return handleOpenCommand(candidateTarget, actions, currentScreen, false);
    }
  }

  // -------------------------------------------------------------
  // 2.2. Polite navigation requests:
  // "can you open <target>", "could you open <target>", "would you open <target>"
  // -------------------------------------------------------------
  const politeMatch = trimmed.match(
    /^(?:can\s+you|could\s+you|would\s+you(?:\s+mind)?)\s+(?:please\s+)?(?:open(?:\s+up)?|launch|show(?:\s+me)?|navigate\s+to|take\s+me\s+to)\s+(?:the\s+)?(.+?)[?!.]*$/i
  );
  if (politeMatch && politeMatch[1]) {
    const politeTarget = politeMatch[1].trim();
    if (!politeTarget.endsWith('?')) {
      return handleOpenCommand(politeTarget, actions, currentScreen, false);
    }
  }

  // -------------------------------------------------------------
  // 2.5. Single-action contextual navigation inquiries:
  // e.g. "how do I open the calculator?", "how to open calculator", "where can I find settings"
  // AXON provides a direct explanation and presents a single contextual shortcut [ Open <Target> ].
  // -------------------------------------------------------------
  const helpMatch = trimmed.match(
    /^(?:how\s+(?:do\s+i|can\s+i|to)|how\s+would\s+i|where\s+can\s+i\s+find|where\s+do\s+i\s+find|where\s+(?:is|are))\s*(?:open|access|find|navigate\s+to|reach|launch)?\s+(?:the\s+)?(.+?)[?!.]*$/i
  );
  if (helpMatch && helpMatch[1]) {
    const rawTarget = helpMatch[1].trim();
    const resolution = resolveInterfaceFromQuery(rawTarget, currentScreen);
    if (resolution.isExact && resolution.match) {
      const target = resolution.match;
      const categoryHint = target.category ? ` from **${target.category}**` : '';
      const contextualAction: ContextualMessageAction = {
        label: `Open ${target.name}`,
        actionText: `/open ${target.id}`,
        destinationId: target.id,
        targetId: target.id,
        description: `Open ${target.name}`,
        intent: 'open',
      };
      return {
        handled: true,
        executed: false,
        response: `You can open **${target.name}**${categoryHint} or by using the command \`/open ${target.id}\`.`,
        commandName: '/open',
        options: [contextualAction],
        actions: [contextualAction],
      };
    }
  }

  // -------------------------------------------------------------
  // 3. Direct interface name inputs (e.g. "Axon source", "AXON source", "tools", "settings")
  // -------------------------------------------------------------
  if (
    !trimmed.endsWith('?') &&
    !/^(?:how|why|what|who|where|when|can|could|would|is|are|do|does|explain|tell\s+me)\b/i.test(trimmed)
  ) {
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount <= 4) {
      const directResolution = resolveInterfaceFromQuery(trimmed, currentScreen);
      if (directResolution.isExact && directResolution.match) {
        return handleOpenCommand(trimmed, actions, currentScreen, false);
      }
    }
  }

  // -------------------------------------------------------------
  // 4. Fast-path offline arithmetic calculation
  // -------------------------------------------------------------
  const mathResult = tryEvaluateMathExpression(trimmed);
  if (mathResult) {
    return {
      handled: true,
      executed: true,
      response: mathResult,
      commandName: 'math',
      modelUsed: 'AXON Offline Calculator Engine',
    };
  }

  return { handled: false, response: '' };
}

/**
 * Handles the "/open <target>" navigation command using AXON's interface registry.
 */
function handleOpenCommand(
  rawTarget: string,
  actions: CommandRouterActions,
  currentScreen?: ScreenId,
  isExplicit: boolean = true
): CommandExecutionResult {
  // Case A: Missing target (e.g. "/open" with no target)
  if (!rawTarget) {
    if (!isExplicit) {
      return { handled: false, response: '' };
    }

    const interfaces = discoverAvailableInterfaces();
    const rootInterfaces = interfaces.filter((i) => i.level === 'root' && i.isAvailable !== false);
    const subToolInterfaces = interfaces.filter((i) => i.level === 'sub_tool' && i.isAvailable !== false);

    const rootOptions: ChatCommandOption[] = rootInterfaces.map((i) => ({
      label: i.name,
      actionText: `/open ${i.id}`,
      destinationId: i.id,
      description: i.description,
      category: 'Core Workspace Screens',
    }));

    const toolOptions: ChatCommandOption[] = subToolInterfaces.map((i) => ({
      label: i.name,
      actionText: `/open ${i.id}`,
      destinationId: i.id,
      description: i.description,
      category: 'Specialized Utility Suites',
    }));

    // Set pending choice so typing any listed destination resolves immediately
    setPendingChoice({
      command: '/open',
      promptType: 'select',
      candidates: [...rootInterfaces, ...subToolInterfaces],
      timestamp: Date.now(),
    });

    return {
      handled: true,
      executed: false,
      response: `### AXON Interface Directory\n\nChoose a destination:`,
      commandName: '/open',
      options: [...rootOptions, ...toolOptions],
    };
  }

  // Case B: Resolve target using existing interfaceRegistry
  const resolution = resolveInterfaceFromQuery(rawTarget, currentScreen);

  // Intent to open all screens at once cannot map to a single navigation screen
  if (resolution.isAll) {
    if (!isExplicit) {
      return { handled: false, response: '' };
    }
    return {
      handled: true,
      executed: false,
      response:
        'Cannot navigate to multiple interfaces simultaneously. Please specify a single destination (e.g. `/open settings` or `/open tools`).',
      commandName: '/open',
    };
  }

  // Case C: Exact match found -> Navigate immediately (if explicit) OR present contextual confirmation (if natural language)
  if (resolution.match && resolution.isExact) {
    if (isExplicit) {
      clearPendingChoice();
      const targetRoute = resolution.match.route as ScreenId;
      if (targetRoute) {
        actions.navigateTo(targetRoute, {
          screenState: resolution.match.subState,
        });

        const navResult: ActionExecutionResult = {
          executionId: `nav_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          capabilityId: 'workspace_navigation',
          intent: 'open',
          target: resolution.match.name,
          objective: `Open ${resolution.match.name}`,
          parameters: { target: resolution.match.id, route: targetRoute, subState: resolution.match.subState },
          status: 'completed',
          executed: true,
          verified: true,
          success: true,
          response: `Opened **${resolution.match.name}**.`,
          targetScreen: targetRoute,
          previousScreen: currentScreen,
          stateChanged: Boolean(currentScreen && currentScreen !== targetRoute),
          reversalSupported: Boolean(currentScreen && currentScreen !== targetRoute),
          reversalAction:
            currentScreen && currentScreen !== targetRoute
              ? {
                  capabilityId: 'workspace_navigation',
                  intent: 'open',
                  target: currentScreen,
                  parameters: { target: currentScreen },
                  description: `Navigate back to ${currentScreen}`,
                }
              : undefined,
          completedAt: Date.now(),
        };
        setLastExecutionOutcome(navResult);

        const shortcutAction: ContextualMessageAction = {
          label: `Open ${resolution.match.name}`,
          actionText: `/open ${resolution.match.id}`,
          destinationId: resolution.match.id,
          targetId: resolution.match.id,
          description: `Navigate to ${resolution.match.name}`,
          intent: 'open',
          variant: 'default',
        };

        return {
          handled: true,
          executed: true,
          response: `Opened **${resolution.match.name}**.`,
          targetScreen: targetRoute,
          commandName: '/open',
          options: [shortcutAction],
          actions: [shortcutAction],
        };
      }
    } else {
      // Natural-language action request: DO NOT immediately execute.
      // Distinguish contextual suggestions from actual confirmation/decision interactions.
      // Suggestion-style navigation actions do not unnecessarily display a "Cancel" button.
      // Navigation is authorized only upon explicit user activation.
      setPendingChoice({
        command: '/open',
        promptType: 'confirm',
        type: 'suggestion',
        originatingIntent: '/open',
        target: resolution.match,
        timestamp: Date.now(),
        ttlMs: 60000,
        expiresAt: Date.now() + 60000,
      });

      const confirmAction: ContextualMessageAction = {
        label: `Open ${resolution.match.name}`,
        actionText: `/open ${resolution.match.id}`,
        destinationId: resolution.match.id,
        targetId: resolution.match.id,
        description: `Open ${resolution.match.name}`,
        intent: 'open',
        variant: 'default',
      };

      return {
        handled: true,
        executed: false,
        response: `Would you like to open **${resolution.match.name}**?`,
        commandName: '/open',
        options: [confirmAction],
        actions: [confirmAction],
      };
    }
  }

  // Case D: Strong unique inferred match (e.g. "/open axon sou") -> Ask for confirmation with clickable button
  if (resolution.match && resolution.isInferred && !resolution.isAmbiguous) {
    setPendingChoice({
      command: '/open',
      promptType: 'confirm',
      type: 'confirmation',
      originatingIntent: '/open',
      target: resolution.match,
      timestamp: Date.now(),
      ttlMs: 60000,
      expiresAt: Date.now() + 60000,
    });

    const confirmAction: ContextualMessageAction = {
      label: `Open ${resolution.match.name}`,
      actionText: `/open ${resolution.match.id}`,
      destinationId: resolution.match.id,
      targetId: resolution.match.id,
      description: `Open ${resolution.match.name}`,
      intent: 'open',
      variant: 'default',
    };

    const cancelAction: ContextualMessageAction = {
      label: 'Cancel',
      actionText: 'cancel',
      targetId: 'cancel',
      description: 'Cancel navigation',
      intent: 'cancel',
      variant: 'secondary',
    };

    return {
      handled: true,
      executed: false,
      response: `Did you mean **${resolution.match.name}**?`,
      commandName: '/open',
      options: [confirmAction, cancelAction],
      actions: [confirmAction, cancelAction],
    };
  }

  // If this is natural language and not an explicit /open command or confident match, do NOT hijack conversation
  if (!isExplicit) {
    return { handled: false, response: '' };
  }

  // Case E: Explicit /open was used, but resolution was ambiguous
  if (resolution.candidates && resolution.candidates.length > 0) {
    const candidates = resolution.candidates.slice(0, 5);
    setPendingChoice({
      command: '/open',
      promptType: 'select',
      type: 'selection',
      originatingIntent: '/open',
      candidates,
      timestamp: Date.now(),
      ttlMs: 60000,
      expiresAt: Date.now() + 60000,
    });

    const candidateActions: ContextualMessageAction[] = candidates.map((c) => ({
      label: c.name,
      actionText: `/open ${c.id}`,
      destinationId: c.id,
      targetId: c.id,
      description: c.description,
      intent: 'open',
    }));

    const cancelAction: ContextualMessageAction = {
      label: 'Cancel',
      actionText: 'cancel',
      targetId: 'cancel',
      description: 'Cancel navigation',
      intent: 'cancel',
      variant: 'secondary',
    };

    const allActions = [...candidateActions, cancelAction];

    return {
      handled: true,
      executed: false,
      response: `Could not uniquely identify an interface for "${rawTarget}".\n\nDid you mean one of these?`,
      commandName: '/open',
      options: allActions,
      actions: allActions,
    };
  }

  // Case F: Completely unrecognized target
  return {
    handled: true,
    executed: false,
    response: `Unrecognized interface "${rawTarget}".\n\nSupported destinations include: AXON Source (\`/open source\`), Settings (\`/open settings\`), Tools (\`/open tools\`), Code Editor (\`/open code\`), Project Notes (\`/open notes\`), Storage (\`/open storage\`), Automation (\`/open automation\`).`,
    commandName: '/open',
  };
}
