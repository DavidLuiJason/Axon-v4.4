/**
 * AXON Capability Resolution Engine
 *
 * Runtime bridge that resolves user input into:
 *   Capability → Intent → Target → Parameters → Modifiers → Execution Policy
 *
 * Source of Truth: UnifiedCapabilityRegistry & CapabilityContract
 * Execution Handoff: Action Plan / Execution Subsystem
 *
 * Supports:
 * - Slash-style commands (e.g. /open settings, /calculate 10*5, /capture)
 * - Explicit command language (e.g. run open settings, execute calculation)
 * - Imperative natural language (e.g. open settings, set theme to dark, capture this view)
 * - Conversational requests with actionable objectives (e.g. "I'd like to switch to dark mode")
 * - Contextual follow-ups and selections (active pending interactions)
 * - Ambiguous requests with candidate capabilities
 * - Generalized modifier extraction (priority, mode, exclusivity, authorization)
 */

import { ScreenId, ContextualMessageAction, PendingInteraction } from '../types';
import { TaskPriority } from './runtime/types';
import {
  CapabilityContract,
  CapabilityActionDefinition,
  StatementType,
  ExecutionPolicy,
  AlternativeResolution,
  CapabilityExecutionContext,
  CapabilityExecutionResult,
  InvocationSource,
  AuthorizationLevel,
} from './capabilityContract';
import {
  unifiedCapabilityRegistry,
  classifyStatement,
} from './capabilitySystem';
import {
  ActionNode,
  ActionExecutionPlan,
  createSingleActionPlan,
  createSequentialPlan,
  createParallelPlan,
  createQueuedPlan,
  executeActionPlanSync,
  setPlanPriority,
} from './actionPlan';
import {
  resolveInterfaceFromQuery,
  discoverAvailableInterfaces,
  InterfaceMetadata,
} from './interfaceRegistry';
import {
  getPendingInteraction,
  clearPendingInteraction,
} from './pendingInteraction';
import { tryEvaluateMathExpression } from './storageChatHandler';
import {
  ActionExecutionResult,
  getLastExecutionOutcome,
} from './actionExecutionGateway';

// ============================================================================
// 1. CAPABILITY RESOLUTION TYPES
// ============================================================================

export type ResolutionStatus =
  | 'resolved'
  | 'ambiguous'
  | 'unsupported'
  | 'refusal'
  | 'hypothetical'
  | 'question'
  | 'conversational';

export interface ResolutionModifier {
  name: string;
  value: any;
  rawToken?: string;
}

export interface AmbiguityCandidate {
  capability: CapabilityContract;
  intent: string;
  target?: string;
  parameters?: Record<string, any>;
  description: string;
  score: number;
}

export interface CapabilityResolutionContext {
  currentScreen?: ScreenId;
  pendingInteraction?: PendingInteraction | null;
  recentContext?: string[];
  activeAccounts?: any[];
  customHandlers?: Record<string, Function>;
  lastExecutionOutcome?: ActionExecutionResult | null;
  invocationSource?: InvocationSource;
  authorizedBy?: 'user_click' | 'explicit_command' | 'dialog' | 'suggestion_activation';
}

export interface CapabilityResolution {
  status: ResolutionStatus;
  rawInput: string;
  normalizedInput: string;
  statementType: StatementType;

  // The 6-Stage Resolution Chain
  capability?: CapabilityContract;
  capabilityId?: string;
  intent?: string;
  target?: string;
  parameters: Record<string, any>;
  modifiers: ResolutionModifier[];
  executionPolicy: ExecutionPolicy;

  // Metadata & Metrics
  confidence: number;
  underlyingObjective: string;
  isExplicit: boolean;
  invocationSource?: InvocationSource;
  authorizationLevel?: AuthorizationLevel;

  // Execution & Action Plan Bridge
  plan?: ActionExecutionPlan;
  alternativeResolution?: AlternativeResolution;
  ambiguityCandidates?: AmbiguityCandidate[];
  contextualActions?: ContextualMessageAction[];
  responseMessage?: string;
  targetScreen?: ScreenId;
  modelUsed?: string;
}

// ============================================================================
// 2. GENERALIZED MODIFIER EXTRACTION
// ============================================================================

/**
 * Extracts modifiers universally without hardcoding per-command branching.
 * Normalizes tokens into structured modifiers for execution policies,
 * priorities, scheduling modes, and fallback rules.
 */
export function extractGeneralizedModifiers(text: string): {
  modifiers: ResolutionModifier[];
  cleanedText: string;
} {
  const modifiers: ResolutionModifier[] = [];
  let workingText = text.trim();

  // 1. Explicit Run / Authorization Modifiers:
  // "run", "execute", "/run", "open command", "immediately", "now", "force"
  if (/^open\s+command$/i.test(workingText)) {
    modifiers.push({ name: 'run_authorized', value: true, rawToken: 'open command' });
    workingText = '/open';
  } else {
    const runMatch = workingText.match(/^(?:\/run\b|run\s+command\b|open\s+command\b|run\b|execute\s+command\b|execute\b)(?::|\s+)\s*(.+)$/i);
    if (runMatch && runMatch[1]) {
      modifiers.push({ name: 'run_authorized', value: true, rawToken: workingText.slice(0, workingText.length - runMatch[1].length) });
      workingText = runMatch[1].trim();
    } else if (/\b(?:immediately|right\s+now|now)\b/i.test(workingText)) {
      modifiers.push({ name: 'run_authorized', value: true, rawToken: 'immediately' });
      workingText = workingText.replace(/\b(?:immediately|right\s+now|now)\b/gi, '').trim();
    }
  }

  // 2. Priority Modifiers:
  // "with high priority", "run next", "urgent", "low priority", "in background"
  if (/\b(?:with\s+high\s+priority|high\s+priority|run\s+next|urgent)\b/i.test(workingText)) {
    modifiers.push({ name: 'priority', value: TaskPriority.INTERACTIVE, rawToken: 'high_priority' });
    workingText = workingText.replace(/\b(?:with\s+high\s+priority|high\s+priority|run\s+next|urgent)\b/gi, '').trim();
  } else if (/\b(?:low\s+priority|in\s+background|background\s+priority)\b/i.test(workingText)) {
    modifiers.push({ name: 'priority', value: TaskPriority.NORMAL_BACKGROUND, rawToken: 'low_priority' });
    workingText = workingText.replace(/\b(?:low\s+priority|in\s+background|background\s+priority)\b/gi, '').trim();
  }

  // 3. Execution Mode / Scheduling Modifiers:
  // "queue", "enqueue", "in sequence", "sequentially", "in parallel", "simultaneously"
  if (/^(?:queue|enqueue)\b/i.test(workingText)) {
    modifiers.push({ name: 'execution_mode', value: 'queue', rawToken: 'queue' });
    workingText = workingText.replace(/^(?:queue|enqueue)\s*/i, '').trim();
  } else if (/\b(?:in\s+sequence|sequentially)\b/i.test(workingText)) {
    modifiers.push({ name: 'execution_mode', value: 'sequence', rawToken: 'sequence' });
    workingText = workingText.replace(/\b(?:in\s+sequence|sequentially)\b/gi, '').trim();
  } else if (/\b(?:in\s+parallel|simultaneously)\b/i.test(workingText)) {
    modifiers.push({ name: 'execution_mode', value: 'parallel', rawToken: 'parallel' });
    workingText = workingText.replace(/\b(?:in\s+parallel|simultaneously)\b/gi, '').trim();
  }

  // 4. Fallback Exclusivity / Adaptive Modifiers:
  // "only using X", "only with X", "use X first, but use another method if necessary"
  const exclusiveMatch = workingText.match(/\b(?:only\s+using|only\s+with|only\s+use|use\s+only|do\s+this\s+only)\s+([a-zA-Z0-9_-]+)\b/i);
  if (exclusiveMatch) {
    modifiers.push({ name: 'fallback_exclusivity', value: 'exclusive', rawToken: exclusiveMatch[0] });
    workingText = workingText.replace(exclusiveMatch[0], '').trim();
  } else if (/use\s+.+?\s+first,\s*but\s+use\s+another\s+method\s+if\s+necessary|try\s+whatever\s+method\s+works/i.test(workingText)) {
    modifiers.push({ name: 'fallback_exclusivity', value: 'adaptive', rawToken: 'adaptive' });
  }

  // 5. Confirmation / Preview Modifiers:
  // "ask first", "confirm first", "preview", "dry run"
  if (/\b(?:ask\s+first|confirm\s+first|require\s+confirmation)\b/i.test(workingText)) {
    modifiers.push({ name: 'require_confirmation', value: true, rawToken: 'confirm_first' });
    workingText = workingText.replace(/\b(?:ask\s+first|confirm\s+first|require\s+confirmation)\b/gi, '').trim();
  } else if (/\b(?:dry\s+run|preview|test\s+run)\b/i.test(workingText)) {
    modifiers.push({ name: 'dry_run', value: true, rawToken: 'dry_run' });
    workingText = workingText.replace(/\b(?:dry\s+run|preview|test\s+run)\b/gi, '').trim();
  }

  // 6. Network / Offline Modifiers:
  // "offline", "local only", "on device"
  if (/\b(?:offline|local\s+only|on\s+device)\b/i.test(workingText)) {
    modifiers.push({ name: 'offline_only', value: true, rawToken: 'offline' });
    workingText = workingText.replace(/\b(?:offline|local\s+only|on\s+device)\b/gi, '').trim();
  }

  return {
    modifiers,
    cleanedText: workingText.replace(/\s{2,}/g, ' ').trim(),
  };
}

// ============================================================================
// 3. TARGET & CONTEXTUAL INTENT NORMALIZATION
// ============================================================================

/**
 * Normalizes contextual affirmation, selection, correction, undo, retry, and follow-up inputs
 * using active pending interaction state and the most recent verified execution outcome.
 */
function resolveContextualTarget(
  text: string,
  pending: PendingInteraction | null | undefined,
  lastOutcome?: ActionExecutionResult | null
): {
  isContextual: boolean;
  target?: any;
  isCorrection?: boolean;
  isRejection?: boolean;
  isUndo?: boolean;
  isRepeat?: boolean;
  isAlternative?: boolean;
  alternativeIndex?: number;
  isModifyRecent?: boolean;
  isOutcomeQuery?: boolean;
} {
  const norm = text.trim().toLowerCase();

  // 1. Reversal / Undo intent ("undo that", "revert that", "undo the last action", "go back")
  if (
    /^(?:undo(?:\s+that|\s+this|\s+it)?|revert(?:\s+that|\s+this|\s+it)?|undo\s+the\s+last\s+(?:action|change|step)|revert\s+(?:the\s+)?last\s+action|go\s+back)[!.?,]*$/i.test(
      norm
    )
  ) {
    return { isContextual: true, isUndo: true };
  }

  // 2. Repeat intent ("try that again", "try it again", "repeat that", "run it again", "retry that")
  if (
    /^(?:try\s+(?:it|that|this)\s+again|try\s+again|retry(?:\s+that|\s+this|\s+it)?|repeat(?:\s+that|\s+this|\s+it)?|run\s+(?:it|that|this)\s+again|do\s+(?:it|that|this)\s+again)[!.?,]*$/i.test(
      norm
    )
  ) {
    return { isContextual: true, isRepeat: true };
  }

  // 3. Alternative intent ("do the other one", "use the alternative", "use the method you tried second")
  const ordinalMatch = norm.match(/(?:use|try|do)\s+(?:the\s+)?(?:method\s+you\s+tried\s+)?(second|third|2nd|3rd)(?:\s+method|\s+one)?/i);
  if (ordinalMatch) {
    const ord = ordinalMatch[1].toLowerCase();
    const idx = ord.includes('second') || ord === '2nd' ? 1 : 2;
    return { isContextual: true, isAlternative: true, alternativeIndex: idx };
  }

  if (
    /^(?:use\s+(?:the\s+)?alternative|do\s+the\s+other\s+one|try\s+the\s+other\s+one|use\s+the\s+other\s+(?:one|method)|try\s+the\s+alternative)[!.?,]*$/i.test(
      norm
    )
  ) {
    return { isContextual: true, isAlternative: true };
  }

  // 4. Modify Recent Target ("change the thing you just opened", "change that")
  if (
    /^(?:change|modify|update)\s+(?:the\s+thing\s+you\s+just\s+opened|what\s+you\s+just\s+opened|that|this)[!.?,]*$/i.test(
      norm
    )
  ) {
    return { isContextual: true, isModifyRecent: true };
  }

  // 5. Outcome acknowledgment / Verification query ("that worked", "it worked")
  if (/^(?:that\s+worked|it\s+worked|that\s+succeeded|it\s+succeeded)[!.?,]*$/i.test(norm)) {
    return { isContextual: true, isOutcomeQuery: true };
  }

  // 6. Direct Rejection ("no, not that", "cancel", "neither")
  if (
    /^(?:no|nope|nah|cancel|nevermind|never\s+mind|stop|neither|none|not\s+this|not\s+that)[!.?,]*$/i.test(
      norm
    )
  ) {
    return { isContextual: true, isRejection: true };
  }

  // 7. Correction ("no, I meant Settings", "actually open tools", "instead go to code")
  const meantMatch = norm.match(/(?:i\s+meant|meant|actually|instead)\s+([a-zA-Z0-9_\s-]+)/i);
  if (meantMatch && meantMatch[1]) {
    return { isContextual: true, isCorrection: true, target: meantMatch[1].trim() };
  }

  if (!pending) {
    return { isContextual: false };
  }

  // 8. Selection of Candidates (Numbers: 1, 2, 3, etc.)
  const numMatch = norm.match(/^(?:number\s+|#)?([1-9][0-9]?)(?:st|nd|rd|th)?(?:\s+one)?$/i);
  if (numMatch && Array.isArray(pending.candidates) && pending.candidates.length > 0) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < pending.candidates.length) {
      return { isContextual: true, target: pending.candidates[idx] };
    }
  }

  // 9. Affirmation ("yes", "sure", "proceed", "that one", "do it")
  const isAffirm = /^(?:yes|yeah|yep|yup|sure|okay|ok|correct|right|that'?s\s+right|that\s+one|this\s+one|proceed|do\s+it|confirm|open\s+it)[!.?,]*$/i.test(
    norm
  );
  if (isAffirm) {
    if (pending.target) {
      return { isContextual: true, target: pending.target };
    }
    if (Array.isArray(pending.candidates) && pending.candidates.length > 0) {
      return { isContextual: true, target: pending.candidates[0] };
    }
  }

  // 10. Candidate Name Match
  if (Array.isArray(pending.candidates)) {
    const matched = pending.candidates.find((cand: any) => {
      const name = (cand.name || cand.id || '').toLowerCase();
      const id = (cand.id || '').toLowerCase();
      return norm === name || norm === id || norm === `open ${name}` || norm === `open ${id}`;
    });
    if (matched) {
      return { isContextual: true, target: matched };
    }
  }

  return { isContextual: false };
}

// ============================================================================
// 4. CORE CAPABILITY RESOLUTION ENGINE
// ============================================================================

/**
 * Resolves raw user input through the 6-stage resolution chain:
 * Capability → Intent → Target → Parameters → Modifiers → Execution Policy
 *
 * Uses UnifiedCapabilityRegistry as the single source of truth.
 */
export function resolveCapabilityInput(
  rawInput: string,
  context: CapabilityResolutionContext = {}
): CapabilityResolution {
  const norm = (rawInput || '').trim();
  if (!norm) {
    return {
      status: 'conversational',
      rawInput,
      normalizedInput: '',
      statementType: 'conversational',
      parameters: {},
      modifiers: [],
      executionPolicy: 'immediate',
      confidence: 0,
      underlyingObjective: '',
      isExplicit: false,
    };
  }

  // 1. Extract Universal Modifiers
  const { modifiers, cleanedText } = extractGeneralizedModifiers(norm);
  const isRunAuthorized = modifiers.some((m) => m.name === 'run_authorized');
  const lowerClean = cleanedText.toLowerCase();

  // 2. Classify Statement
  const statementType = classifyStatement(cleanedText);

  // 3. Contextual Follow-Up / Selection Check (via pendingInteraction & lastExecutionOutcome)
  const pending = context.pendingInteraction ?? getPendingInteraction();
  const lastOutcome = context.lastExecutionOutcome ?? getLastExecutionOutcome();
  const contextualRes = resolveContextualTarget(cleanedText, pending, lastOutcome);

  if (contextualRes.isContextual) {
    // 3a. Undo / Reversal
    if (contextualRes.isUndo) {
      if (!lastOutcome) {
        return {
          status: 'conversational',
          rawInput,
          normalizedInput: cleanedText,
          statementType: 'conversational',
          parameters: {},
          modifiers,
          executionPolicy: 'immediate',
          confidence: 0.9,
          underlyingObjective: 'Undo recent action',
          isExplicit: true,
          responseMessage: 'There is no recent executed action to undo.',
        };
      }

      if (lastOutcome.reversalSupported && lastOutcome.reversalAction) {
        const rev = lastOutcome.reversalAction;
        const actionNode: ActionNode = {
          id: `action-revert-${Date.now()}`,
          capabilityId: rev.capabilityId,
          intent: rev.intent,
          target: rev.target,
          parameters: rev.parameters || {},
          description: rev.description,
          executionPolicy: 'immediate',
        };

        const plan = createSingleActionPlan(actionNode, 'immediate');
        return {
          status: 'resolved',
          rawInput,
          normalizedInput: cleanedText,
          statementType: 'explicit_instruction',
          capabilityId: rev.capabilityId,
          intent: rev.intent,
          target: rev.target,
          parameters: rev.parameters || {},
          modifiers,
          executionPolicy: 'immediate',
          confidence: 0.98,
          underlyingObjective: rev.description,
          isExplicit: true,
          plan,
          responseMessage: rev.description,
        };
      }

      return {
        status: 'unsupported',
        rawInput,
        normalizedInput: cleanedText,
        statementType: 'exceeds_capability',
        parameters: {},
        modifiers,
        executionPolicy: 'immediate',
        confidence: 0.95,
        underlyingObjective: 'Undo previous action',
        isExplicit: true,
        responseMessage: `The previous action (**${lastOutcome.intent}** on **${lastOutcome.target || lastOutcome.capabilityId}**) cannot be reversed through available capabilities because it does not modify application state or support rollback.`,
      };
    }

    // 3b. Repeat / Retry
    if (contextualRes.isRepeat) {
      if (!lastOutcome) {
        return {
          status: 'conversational',
          rawInput,
          normalizedInput: cleanedText,
          statementType: 'conversational',
          parameters: {},
          modifiers,
          executionPolicy: 'immediate',
          confidence: 0.9,
          underlyingObjective: 'Repeat previous action',
          isExplicit: true,
          responseMessage: 'There is no previous executed action to repeat.',
        };
      }

      const actionNode: ActionNode = {
        id: `action-repeat-${Date.now()}`,
        capabilityId: lastOutcome.capabilityId,
        intent: lastOutcome.intent,
        target: lastOutcome.target,
        parameters: lastOutcome.parameters || {},
        description: `Repeat: ${lastOutcome.objective || lastOutcome.intent}`,
        executionPolicy: 'immediate',
      };

      const plan = createSingleActionPlan(actionNode, 'immediate');
      return {
        status: 'resolved',
        rawInput,
        normalizedInput: cleanedText,
        statementType: 'explicit_instruction',
        capabilityId: lastOutcome.capabilityId,
        intent: lastOutcome.intent,
        target: lastOutcome.target,
        parameters: lastOutcome.parameters || {},
        modifiers,
        executionPolicy: 'immediate',
        confidence: 0.98,
        underlyingObjective: actionNode.description,
        isExplicit: true,
        plan,
      };
    }

    // 3c. Alternative / Second Method
    if (contextualRes.isAlternative) {
      let targetAltName: string | undefined;
      if (
        contextualRes.alternativeIndex !== undefined &&
        lastOutcome?.attempts &&
        lastOutcome.attempts.length > contextualRes.alternativeIndex
      ) {
        targetAltName = lastOutcome.attempts[contextualRes.alternativeIndex].methodName;
      } else if (lastOutcome?.alternativeMethodsAttempted && lastOutcome.alternativeMethodsAttempted.length > 0) {
        targetAltName = lastOutcome.alternativeMethodsAttempted[0];
      }

      if (targetAltName) {
        const clean = `run ${targetAltName}`;
        return resolveCapabilityInput(clean, { ...context, pendingInteraction: null });
      }

      return {
        status: 'unsupported',
        rawInput,
        normalizedInput: cleanedText,
        statementType: 'exceeds_capability',
        parameters: {},
        modifiers,
        executionPolicy: 'immediate',
        confidence: 0.9,
        underlyingObjective: 'Use alternative method',
        isExplicit: true,
        responseMessage: `No alternative method was recorded or available for "${lastOutcome ? lastOutcome.intent : 'the previous action'}".`,
      };
    }

    // 3d. Modify Recent Target
    if (contextualRes.isModifyRecent) {
      if (lastOutcome?.target) {
        return {
          status: 'conversational',
          rawInput,
          normalizedInput: cleanedText,
          statementType: 'conversational',
          parameters: {},
          modifiers,
          executionPolicy: 'immediate',
          confidence: 0.95,
          underlyingObjective: 'Modify recently opened target',
          isExplicit: true,
          responseMessage: `You recently ${lastOutcome.intent === 'open' ? 'opened' : 'configured'} **${lastOutcome.target}**. What changes or settings would you like to apply?`,
        };
      }

      return {
        status: 'conversational',
        rawInput,
        normalizedInput: cleanedText,
        statementType: 'conversational',
        parameters: {},
        modifiers,
        executionPolicy: 'immediate',
        confidence: 0.9,
        underlyingObjective: 'Modify recent target',
        isExplicit: true,
        responseMessage: 'No recent action was recorded to modify. Please specify what you would like to change.',
      };
    }

    // 3e. Outcome Query
    if (contextualRes.isOutcomeQuery) {
      if (lastOutcome && lastOutcome.success) {
        return {
          status: 'conversational',
          rawInput,
          normalizedInput: cleanedText,
          statementType: 'conversational',
          parameters: {},
          modifiers,
          executionPolicy: 'immediate',
          confidence: 0.95,
          underlyingObjective: 'Confirm outcome',
          isExplicit: true,
          responseMessage: `Confirmed: the previous action (**${lastOutcome.intent}** via **${lastOutcome.actualMethodUsed || lastOutcome.capabilityId}**) completed and was verified successfully.`,
        };
      }
      return {
        status: 'conversational',
        rawInput,
        normalizedInput: cleanedText,
        statementType: 'conversational',
        parameters: {},
        modifiers,
        executionPolicy: 'immediate',
        confidence: 0.9,
        underlyingObjective: 'Confirm outcome',
        isExplicit: true,
        responseMessage: 'Acknowledged.',
      };
    }

    // 3f. Rejection / Dismissal
    if (contextualRes.isRejection) {
      if (pending) {
        clearPendingInteraction();
        return {
          status: 'refusal',
          rawInput,
          normalizedInput: cleanedText,
          statementType: 'refusal',
          intent: 'cancel',
          parameters: {},
          modifiers,
          executionPolicy: 'immediate',
          confidence: 0.98,
          underlyingObjective: 'Cancel pending action',
          isExplicit: true,
          responseMessage: 'Cancelled. No action will be taken.',
        };
      }

      return {
        status: 'refusal',
        rawInput,
        normalizedInput: cleanedText,
        statementType: 'refusal',
        intent: 'reject',
        parameters: {},
        modifiers,
        executionPolicy: 'immediate',
        confidence: 0.95,
        underlyingObjective: 'Reject previous outcome',
        isExplicit: true,
        responseMessage: `Understood. The previous action (${lastOutcome ? lastOutcome.intent + (lastOutcome.target ? ` on ${lastOutcome.target}` : '') : 'previous operation'}) has been noted as rejected. What would you like to do instead?`,
      };
    }

    // 3g. Correction
    if (contextualRes.isCorrection && contextualRes.target) {
      if (pending) {
        clearPendingInteraction();
      }
      if (lastOutcome && lastOutcome.capabilityId === 'settings_controller') {
        return resolveCapabilityInput(`set ${contextualRes.target}`, { ...context, pendingInteraction: null });
      }
      // Re-resolve the corrected target directly
      const reClean = `open ${contextualRes.target}`;
      return resolveCapabilityInput(reClean, { ...context, pendingInteraction: null });
    }

    // 3h. Candidate Target Selected
    if (contextualRes.target) {
      clearPendingInteraction();
      const targetObj = contextualRes.target;
      const navCap = unifiedCapabilityRegistry.get('workspace_navigation');
      const targetScreen = (targetObj.route || targetObj.id) as ScreenId;

      const actionNode: ActionNode = {
        id: `action-ctx-${Date.now()}`,
        capabilityId: 'workspace_navigation',
        intent: 'open',
        target: targetObj.id || targetObj.name,
        parameters: { target: targetObj.id, screenState: targetObj.subState },
        description: `Open ${targetObj.name || targetObj.id}`,
        executionPolicy: 'immediate',
      };

      const plan = createSingleActionPlan(actionNode, 'immediate');

      return {
        status: 'resolved',
        rawInput,
        normalizedInput: cleanedText,
        statementType: 'confirmation',
        capability: navCap,
        capabilityId: 'workspace_navigation',
        intent: 'open',
        target: targetObj.id || targetObj.name,
        parameters: { target: targetObj.id, screenState: targetObj.subState },
        modifiers,
        executionPolicy: 'immediate',
        confidence: 1.0,
        underlyingObjective: `Open ${targetObj.name || targetObj.id}`,
        isExplicit: true,
        plan,
        targetScreen,
        responseMessage: `Opened **${targetObj.name || targetObj.id}**.`,
      };
    }
  }

  // 4. Check for Refusal / Prohibition ("Don't run this", "Cancel")
  if (statementType === 'refusal') {
    return {
      status: 'refusal',
      rawInput,
      normalizedInput: cleanedText,
      statementType: 'refusal',
      intent: 'prohibit_action',
      parameters: {},
      modifiers,
      executionPolicy: 'immediate',
      confidence: 0.95,
      underlyingObjective: 'Prevent command execution',
      isExplicit: true,
      responseMessage: 'Understood. Execution cancelled and no action will be taken.',
      modelUsed: 'AXON Capability Intelligence',
    };
  }

  // 5. Check for Hypothetical Inquiry ("If I run this, what happens?")
  if (statementType === 'hypothetical') {
    return {
      status: 'hypothetical',
      rawInput,
      normalizedInput: cleanedText,
      statementType: 'hypothetical',
      intent: 'evaluate_hypothetical',
      parameters: {},
      modifiers,
      executionPolicy: 'immediate',
      confidence: 0.9,
      underlyingObjective: 'Understand consequences of potential action',
      isExplicit: false,
      responseMessage:
        'Executing a command directly switches active workspace views or applies configured parameters immediately. No destructive actions are performed without explicit confirmation.',
      modelUsed: 'AXON Capability Intelligence',
    };
  }

  // 6. Check for Unsupported / Exceeds Capability
  if (statementType === 'exceeds_capability') {
    const alt = unifiedCapabilityRegistry.searchAlternativeRoute(cleanedText);
    return {
      status: 'unsupported',
      rawInput,
      normalizedInput: cleanedText,
      statementType: 'exceeds_capability',
      intent: 'unsupported_operation',
      parameters: {},
      modifiers,
      executionPolicy: 'immediate',
      confidence: 0.95,
      underlyingObjective: cleanedText,
      isExplicit: true,
      alternativeResolution: alt || undefined,
      contextualActions: alt?.actions,
      responseMessage: alt?.explanation ||
        'AXON operates in a secure, local client-side sandbox and cannot invoke external services directly.\n\nHowever, you can compile and export workspace layouts via Interface Capture (`/open capture`) or view local notes.',
      modelUsed: 'AXON Problem Solver',
    };
  }

  // ==========================================================================
  // STAGE 1 & 2: DISCOVER CAPABILITY & INTENT VIA REGISTRY
  // ==========================================================================

  let matchedCapability: CapabilityContract | undefined;
  let matchedIntent: string | undefined;
  let matchedTarget: string | undefined;
  let matchedParameters: Record<string, any> = {};
  let confidence = 0.5;
  let isExplicit = false;

  // Pattern A: Explicit Slash Command (e.g. /open, /calc, /capture, /settings, /storage)
  const slashMatch = cleanedText.match(/^\/([a-z0-9_-]+)(?:\s+(.*))?$/i);
  if (slashMatch) {
    const cmdName = slashMatch[1].toLowerCase();
    const cmdArg = (slashMatch[2] || '').trim();

    // Look up in registry
    const commandDef = unifiedCapabilityRegistry.findCommand(cmdName);
    if (commandDef) {
      matchedCapability = commandDef.capability;
      // Default to first intent or matching command intent
      matchedIntent = matchedCapability.intents[0]?.intent || cmdName;
      matchedTarget = cmdArg;
      matchedParameters = { argument: cmdArg };
      confidence = 1.0;
      isExplicit = true;
    } else if (cmdName === 'open') {
      matchedCapability = unifiedCapabilityRegistry.get('workspace_navigation');
      matchedIntent = 'open';
      matchedTarget = cmdArg;
      matchedParameters = { target: cmdArg };
      confidence = 1.0;
      isExplicit = true;
    }
  }

  // Pattern B: Fast-Path Offline Math Evaluation
  if (!matchedCapability) {
    // Normalize conversational math expressions: "divided by" -> "/", "times" -> "*", "plus" -> "+", "minus" -> "-"
    const mathCandidate = cleanedText
      .replace(/^(?:could\s+you\s+|can\s+you\s+|would\s+you\s+|please\s+)?(?:calculate|compute|solve|what\s+is)\s+/i, '')
      .replace(/\s+divided\s+by\s+/gi, ' / ')
      .replace(/\s+(?:times|multiplied\s+by)\s+/gi, ' * ')
      .replace(/\s+plus\s+/gi, ' + ')
      .replace(/\s+minus\s+/gi, ' - ')
      .replace(/[?!=]+$/, '')
      .trim();

    const mathResult = tryEvaluateMathExpression(mathCandidate) || tryEvaluateMathExpression(cleanedText);
    if (mathResult || /^(?:calculate|calc|compute)\b/i.test(lowerClean)) {
      matchedCapability = unifiedCapabilityRegistry.get('math_calculator');
      matchedIntent = 'calculate';
      const expr = mathCandidate || cleanedText.replace(/^(?:calculate|calc|compute)\s*/i, '').trim();
      matchedTarget = expr;
      matchedParameters = { expression: expr, calculation: mathResult };
      confidence = mathResult ? 1.0 : 0.95;
      isExplicit = isRunAuthorized || /^(?:calculate|calc|compute)\b/i.test(lowerClean);
    }
  }

  // Pattern C: Natural Language Settings Configuration
  // "set theme to dark", "switch to light mode", "set accent color to emerald", "change appearance"
  if (!matchedCapability) {
    if (lowerClean.includes('theme') || lowerClean.includes('dark mode') || lowerClean.includes('light mode')) {
      matchedCapability = unifiedCapabilityRegistry.get('settings_controller');
      matchedIntent = 'set_theme';
      const mode = lowerClean.includes('dark') ? 'dark' : 'light';
      matchedTarget = mode;
      matchedParameters = { mode };
      confidence = 0.95;
      isExplicit = isRunAuthorized || /^set\s+theme\b/i.test(lowerClean);
    } else if (lowerClean.includes('accent') || (lowerClean.includes('color') && !lowerClean.includes('calculator'))) {
      const colors = ['blue', 'emerald', 'purple', 'amber', 'orange', 'red', 'rose', 'cyan', 'monochrome'];
      const foundColor = colors.find((c) => lowerClean.includes(c));
      if (foundColor || lowerClean.includes('accent color')) {
        matchedCapability = unifiedCapabilityRegistry.get('settings_controller');
        matchedIntent = 'set_accent_color';
        matchedTarget = foundColor || 'emerald';
        matchedParameters = { color: foundColor || 'emerald' };
        confidence = 0.95;
        isExplicit = isRunAuthorized || /^set\s+accent\b/i.test(lowerClean);
      }
    } else if (
      lowerClean.includes('change appearance') ||
      lowerClean.includes('customize appearance') ||
      lowerClean.includes('change look')
    ) {
      matchedCapability = unifiedCapabilityRegistry.get('settings_controller');
      matchedIntent = 'configure_appearance';
      matchedTarget = 'appearance';
      confidence = 0.92;
      isExplicit = false;
    }
  }

  // Pattern D: Natural Language Navigation Lead-In Forms (imperative, polite, and conversational)
  // "open <target>", "go to <target>", "can you open <target>", "could you open <target>", "let's open <target>", "i'd like to open <target>"
  if (!matchedCapability) {
    const navLeadMatch = cleanedText.match(
      /^(?:(?:can|could|would)\s+(?:you|we)(?:\s+please)?\s+|let'?s\s+|i(?:'d|\s+would)?\s+like\s+to\s+|i\s+want\s+to\s+|i\s+need\s+to\s+|please\s+)?(?:open(?:\s+up)?(?:\s+the)?|go\s+(?:to|into)(?:\s+the)?|take\s+me\s+to(?:\s+the)?|navigate\s+to(?:\s+the)?|show(?:\s+me)?(?:\s+the)?|switch\s+to(?:\s+the)?|launch(?:\s+the)?|bring\s+up(?:\s+the)?)\s+(.+?)[?!.]*$/i
    );
    if (
      navLeadMatch &&
      navLeadMatch[1] &&
      !/^(?:how|why|what|who|where|when|tell\s+me)\b/i.test(navLeadMatch[1])
    ) {
      const rawTarget = navLeadMatch[1].trim();
      matchedCapability = unifiedCapabilityRegistry.get('workspace_navigation');
      matchedIntent = 'open';
      matchedTarget = rawTarget;
      matchedParameters = { target: rawTarget };
      confidence = isRunAuthorized ? 0.98 : 0.9;
      isExplicit = isRunAuthorized;
    }
  }

  // Pattern E: Direct Interface Name Query
  // e.g. "settings", "tools", "calculator", "notes", "axon source"
  if (
    !matchedCapability &&
    !cleanedText.endsWith('?') &&
    !/^(?:how|why|what|who|where|when|can|could|would|is|are|do|does|explain|tell\s+me)\b/i.test(cleanedText)
  ) {
    const wordCount = cleanedText.split(/\s+/).length;
    if (wordCount <= 4) {
      const ifaceRes = resolveInterfaceFromQuery(cleanedText, context.currentScreen);
      if (ifaceRes.isExact && ifaceRes.match) {
        matchedCapability = unifiedCapabilityRegistry.get('workspace_navigation');
        matchedIntent = 'open';
        matchedTarget = cleanedText;
        matchedParameters = { target: cleanedText };
        confidence = isRunAuthorized ? 0.95 : 0.85;
        isExplicit = isRunAuthorized;
      }
    }
  }

  // Pattern F: Interface Capture / Document Export
  // "capture interface", "export pdf", "save screenshot", "download pdf"
  if (!matchedCapability) {
    if (
      lowerClean.includes('capture') ||
      lowerClean.includes('export pdf') ||
      lowerClean.includes('print view') ||
      lowerClean.includes('screenshot')
    ) {
      matchedCapability = unifiedCapabilityRegistry.get('interface_capture');
      matchedIntent = lowerClean.includes('pdf') ? 'export_pdf' : 'capture_interface';
      matchedTarget = 'interface';
      confidence = 0.9;
      isExplicit = isRunAuthorized;
    }
  }

  // Pattern G: Storage Diagnostics
  // "check storage", "clear cache", "disk quota", "inspect storage"
  if (!matchedCapability) {
    if (
      lowerClean.includes('storage') ||
      lowerClean.includes('disk quota') ||
      lowerClean.includes('clear cache') ||
      lowerClean.includes('storage manifest')
    ) {
      matchedCapability = unifiedCapabilityRegistry.get('storage_diagnostics');
      matchedIntent = lowerClean.includes('reallocate') ? 'reallocate_storage' : 'inspect_storage';
      matchedTarget = 'storage';
      confidence = 0.9;
      isExplicit = isRunAuthorized;
    }
  }

  // Pattern H: Local File Intelligence Search
  // "search for <term> in files", "find in local documents"
  if (!matchedCapability) {
    const fileSearchMatch = cleanedText.match(/^(?:search(?:\s+for)?|find)\s+(.+?)(?:\s+in\s+(?:local\s+)?files|\s+in\s+notes|\s+in\s+workspace)?$/i);
    if (fileSearchMatch && fileSearchMatch[1]) {
      matchedCapability = unifiedCapabilityRegistry.get('file_intelligence');
      matchedIntent = 'search_files';
      matchedTarget = fileSearchMatch[1].trim();
      matchedParameters = { query: matchedTarget };
      confidence = 0.9;
      isExplicit = isRunAuthorized;
    }
  }

  // Pattern I: Remote Web Research (Online)
  if (!matchedCapability) {
    const webMatch = cleanedText.match(/^(?:research|google|search\s+web\s+for|search\s+online\s+for)\s+(.+)$/i);
    if (webMatch && webMatch[1]) {
      matchedCapability = unifiedCapabilityRegistry.get('web_research_service');
      matchedIntent = 'research_web';
      matchedTarget = webMatch[1].trim();
      matchedParameters = { query: matchedTarget };
      confidence = 0.88;
      isExplicit = isRunAuthorized;
    }
  }

  // Pattern J: Dynamic Multi-Capability Matcher / Ambiguity Resolution
  // (Detects when input matches multiple candidate capabilities in the Unified Capability Registry)
  if (!matchedCapability && lowerClean.length >= 3 && !cleanedText.endsWith('?')) {
    const allCaps = unifiedCapabilityRegistry.getAll();
    const candidateMatches: AmbiguityCandidate[] = [];

    for (const cap of allCaps) {
      const hasCommandMatch = (cap.commands || []).some((c) =>
        c.name.toLowerCase() === lowerClean || (c.aliases || []).some((a) => a.toLowerCase() === lowerClean)
      );
      const hasIntentMatch = cap.intents.some((i) =>
        i.intent.toLowerCase().includes(lowerClean) || i.description.toLowerCase().includes(lowerClean)
      );
      const hasNameMatch =
        cap.name.toLowerCase().includes(lowerClean) ||
        cap.description.toLowerCase().includes(lowerClean);

      if (hasCommandMatch || hasIntentMatch || hasNameMatch) {
        candidateMatches.push({
          capability: cap,
          intent: cap.intents[0]?.intent || 'execute',
          description: cap.name,
          score: hasCommandMatch ? 0.95 : hasIntentMatch ? 0.85 : 0.7,
        });
      }
    }

    if (candidateMatches.length > 1) {
      const actions: ContextualMessageAction[] = candidateMatches.slice(0, 4).map((c) => ({
        label: c.description,
        actionText: c.capability.commands[0]?.syntax || `/open ${c.capability.id}`,
        destinationId: c.capability.id,
        targetId: c.capability.id,
        description: `Use ${c.description}`,
        intent: c.intent,
        variant: 'default',
      }));

      return {
        status: 'ambiguous',
        rawInput,
        normalizedInput: cleanedText,
        statementType: 'ambiguous',
        parameters: {},
        modifiers,
        executionPolicy: 'confirmation',
        confidence: 0.6,
        underlyingObjective: cleanedText,
        isExplicit: false,
        ambiguityCandidates: candidateMatches,
        contextualActions: actions,
        responseMessage: `Multiple capabilities match "${cleanedText}". Please select an option:`,
      };
    } else if (candidateMatches.length === 1) {
      matchedCapability = candidateMatches[0].capability;
      matchedIntent = candidateMatches[0].intent;
      confidence = candidateMatches[0].score;
    }
  }

  // ==========================================================================
  // UNRESOLVED / CONVERSATIONAL FALLBACK
  // ==========================================================================
  if (!matchedCapability || !matchedIntent) {
    return {
      status: 'conversational',
      rawInput,
      normalizedInput: cleanedText,
      statementType,
      parameters: {},
      modifiers,
      executionPolicy: 'immediate',
      confidence: 0.4,
      underlyingObjective: cleanedText,
      isExplicit: false,
    };
  }

  // ==========================================================================
  // STAGE 3 & 4: TARGET VALIDATION & PARAMETER SCHEMA NORMALIZATION
  // ==========================================================================

  let validatedTargetScreen: ScreenId | undefined;
  let isAmbiguous = false;
  let ambiguityCandidates: AmbiguityCandidate[] = [];

  // If capability is workspace_navigation, perform interface validation
  if (matchedCapability.id === 'workspace_navigation') {
    if (!matchedTarget) {
      // Empty navigation target: e.g. "/open"
      isAmbiguous = true;
      const allInterfaces = discoverAvailableInterfaces();
      ambiguityCandidates = allInterfaces.slice(0, 8).map((iface) => ({
        capability: matchedCapability!,
        intent: 'open',
        target: iface.id,
        description: iface.name,
        score: 0.8,
      }));
    } else {
      const ifaceResolution = resolveInterfaceFromQuery(matchedTarget, context.currentScreen);
      if (ifaceResolution.isAll) {
        return {
          status: 'ambiguous',
          rawInput,
          normalizedInput: cleanedText,
          statementType,
          capability: matchedCapability,
          capabilityId: matchedCapability.id,
          intent: matchedIntent,
          target: matchedTarget,
          parameters: matchedParameters,
          modifiers,
          executionPolicy: 'suggestion',
          confidence: 0.7,
          underlyingObjective: 'Open all screens',
          isExplicit,
          responseMessage: 'Cannot navigate to multiple interfaces simultaneously. Please specify a single destination (e.g. `/open settings` or `/open tools`).',
        };
      }

      if (ifaceResolution.match) {
        validatedTargetScreen = ifaceResolution.match.route as ScreenId;
        matchedParameters = {
          target: ifaceResolution.match.id,
          name: ifaceResolution.match.name,
          route: ifaceResolution.match.route,
          subState: ifaceResolution.match.subState,
        };
        matchedTarget = ifaceResolution.match.id;

        if (ifaceResolution.isAmbiguous || (!ifaceResolution.isExact && !isExplicit)) {
          isAmbiguous = true;
        }
      } else {
        // Target not found in interface registry
        isAmbiguous = true;
      }
    }
  }

  // Align parameters with schema if defined
  const intentDef = matchedCapability.intents.find((i) => i.intent === matchedIntent);
  if (intentDef?.parametersSchema) {
    for (const [key, schema] of Object.entries(intentDef.parametersSchema)) {
      if (matchedParameters[key] === undefined && schema.defaultValue !== undefined) {
        matchedParameters[key] = schema.defaultValue;
      }
    }
  }

  // ==========================================================================
  // STAGE 5 & 6: DETERMINE INVOCATION SOURCE & EXECUTION POLICY
  // ==========================================================================

  // Determine invocationSource
  let invocationSource: InvocationSource;
  if (context.invocationSource) {
    invocationSource = context.invocationSource;
  } else if (contextualRes && (contextualRes.isContextual || contextualRes.isCorrection || contextualRes.isAlternative)) {
    invocationSource = 'follow_up';
  } else if (statementType === 'command' || isExplicit || isRunAuthorized) {
    invocationSource = 'explicit_command';
  } else {
    invocationSource = 'natural_language';
  }

  const authorizationLevel = intentDef?.authorizationLevel || 'standard';
  const requiresCommandAuth = intentDef?.requiresCommandAuthorization || false;

  let executionPolicy: ExecutionPolicy = 'immediate';

  if (isAmbiguous) {
    executionPolicy = 'confirmation';
  } else if (modifiers.some((m) => m.name === 'require_confirmation')) {
    executionPolicy = 'confirmation';
  } else if (intentDef?.requiresConfirmation || matchedCapability.selfDescription?.requiresConfirmation) {
    executionPolicy = 'confirmation';
  } else if (authorizationLevel === 'elevated' || requiresCommandAuth) {
    // Elevated / command-level authorization:
    // Natural-language requests cannot execute directly.
    // Explicit commands require confirmation unless already authorized by the user.
    if (context.authorizedBy === 'user_click' || context.authorizedBy === 'dialog') {
      executionPolicy = 'immediate';
    } else {
      executionPolicy = 'confirmation';
    }
  } else if (isExplicit || isRunAuthorized) {
    executionPolicy = 'immediate';
  } else if (matchedCapability.id === 'workspace_navigation') {
    // Natural language navigation request without explicit "run":
    // Present contextual action for user authorization
    executionPolicy = 'suggestion';
  } else {
    executionPolicy = intentDef?.supportedPolicies?.[0] || 'immediate';
  }

  // ==========================================================================
  // STAGE 7: ASSEMBLE ACTION PLAN HANDOFF
  // ==========================================================================

  const priorityMod = modifiers.find((m) => m.name === 'priority');
  const actionNode: ActionNode = {
    id: `action-1`,
    capabilityId: matchedCapability.id,
    intent: matchedIntent,
    target: matchedTarget,
    parameters: matchedParameters,
    description: `${matchedIntent.replace(/_/g, ' ')}: ${matchedTarget || matchedCapability.name}`,
    executionPolicy,
    priority: priorityMod ? priorityMod.value : undefined,
    requiresConfirmation: executionPolicy === 'confirmation',
    authorizationLevel,
    requiresCommandAuthorization: requiresCommandAuth,
    invocationSource,
  };

  const plan = createSingleActionPlan(actionNode, executionPolicy);

  // Formulate Contextual Message Actions
  let contextualActions: ContextualMessageAction[] | undefined;
  let responseMessage: string | undefined;

  if (matchedCapability.id === 'workspace_navigation' && matchedTarget) {
    const targetName = matchedParameters.name || matchedTarget;
    const shortcutAction: ContextualMessageAction = {
      label: `Open ${targetName}`,
      actionText: `/open ${matchedTarget}`,
      destinationId: matchedTarget,
      targetId: matchedTarget,
      description: `Navigate to ${targetName}`,
      intent: 'open',
      variant: 'default',
    };
    contextualActions = [shortcutAction];

    if (executionPolicy === 'immediate') {
      responseMessage = `Opened **${targetName}**.`;
    } else if (executionPolicy === 'suggestion') {
      responseMessage = `Would you like to open **${targetName}**?`;
    } else {
      responseMessage = `Did you mean to open **${targetName}**?`;
    }
  } else if (matchedCapability.id === 'settings_controller' && matchedIntent === 'configure_appearance') {
    responseMessage =
      `AXON interface appearance is customized through the **Settings Controller**.\n\n` +
      `Available options:\n` +
      `• **Theme Mode**: Dark Mode or Light Mode\n` +
      `• **Accent Colors**: Blue, Emerald, Purple, Amber, Orange, Red, Rose, Cyan, Monochrome\n` +
      `• **Interface Styling**: App icon presets, avatar presets, and typography case`;
    contextualActions = [
      {
        label: 'Set Dark Theme',
        actionText: 'set theme to dark',
        description: 'Apply Dark Mode',
        intent: 'set_theme',
        variant: 'default',
      },
      {
        label: 'Set Emerald Accent',
        actionText: 'set accent color to emerald',
        description: 'Apply Emerald accent',
        intent: 'set_accent_color',
        variant: 'secondary',
      },
      {
        label: 'Open Settings',
        actionText: '/open settings',
        destinationId: 'settings',
        targetId: 'settings',
        description: 'Open visual settings panel',
        intent: 'open',
        variant: 'default',
      },
    ];
  } else if (matchedCapability.id === 'math_calculator') {
    if (matchedParameters.calculation) {
      responseMessage = matchedParameters.calculation;
    }
  }

  return {
    status: isAmbiguous ? 'ambiguous' : 'resolved',
    rawInput,
    normalizedInput: cleanedText,
    statementType,
    capability: matchedCapability,
    capabilityId: matchedCapability.id,
    intent: matchedIntent,
    target: matchedTarget,
    parameters: matchedParameters,
    modifiers,
    executionPolicy,
    confidence,
    underlyingObjective: matchedTarget ? `${matchedIntent} ${matchedTarget}` : matchedIntent,
    isExplicit,
    invocationSource,
    authorizationLevel,
    plan,
    ambiguityCandidates: ambiguityCandidates.length > 0 ? ambiguityCandidates : undefined,
    contextualActions,
    responseMessage,
    targetScreen: validatedTargetScreen,
  };
}

// ============================================================================
// 5. MULTI-STEP CAPABILITY RESOLUTION
// ============================================================================

/**
 * Resolves compound or multi-action input strings into sequential, parallel,
 * or queued ActionExecutionPlans by resolving each segment through the
 * Unified Capability Resolution Engine.
 */
export function resolveMultiStepCapabilityPlan(
  input: string,
  context: CapabilityResolutionContext = {}
): ActionExecutionPlan | null {
  const norm = input.trim();
  if (!norm) return null;

  // 1. Sequential Execution ("run A, then run B", "open settings, then open tools")
  const sequenceSplitRegex = /\s*,\s*(?:then|and\s+then|after\s+that|next)\s+|\s+(?:then|and\s+then|after\s+that)\s+/i;
  if (sequenceSplitRegex.test(norm)) {
    const rawSegments = norm.split(sequenceSplitRegex).map((s) => s.trim()).filter(Boolean);
    if (rawSegments.length > 1) {
      const actions: ActionNode[] = [];
      for (let i = 0; i < rawSegments.length; i++) {
        const res = resolveCapabilityInput(rawSegments[i], context);
        if (res.status === 'resolved' && res.capability && res.intent) {
          actions.push({
            id: `action-${i + 1}`,
            capabilityId: res.capability.id,
            intent: res.intent,
            target: res.target,
            parameters: res.parameters,
            description: `${res.intent}: ${res.target || res.capability.name}`,
            executionPolicy: 'immediate',
          });
        }
      }
      if (actions.length > 1) {
        return createSequentialPlan(actions.map((a) => a.description).join(', then '), actions);
      }
    }
  }

  // 2. Parallel / Independent Execution ("run A and B", "calculate 10*10 and open settings")
  if (/\s+and\s+/i.test(norm) && !norm.toLowerCase().startsWith('queue')) {
    const parts = norm.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      const actions: ActionNode[] = [];
      for (let i = 0; i < parts.length; i++) {
        const res = resolveCapabilityInput(parts[i], context);
        if (res.status === 'resolved' && res.capability && res.intent) {
          actions.push({
            id: `action-${i + 1}`,
            capabilityId: res.capability.id,
            intent: res.intent,
            target: res.target,
            parameters: res.parameters,
            description: `${res.intent}: ${res.target || res.capability.name}`,
            executionPolicy: 'immediate',
          });
        }
      }
      if (actions.length > 1) {
        return createParallelPlan(actions.map((a) => a.description).join(' and '), actions);
      }
    }
  }

  // 3. Queued Execution ("queue A, B, C")
  const queueMatch = norm.match(/^(?:queue|enqueue)\s+(.+)$/i);
  if (queueMatch && queueMatch[1]) {
    const rawItems = queueMatch[1].split(/,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
    if (rawItems.length > 0) {
      const actions: ActionNode[] = [];
      for (let i = 0; i < rawItems.length; i++) {
        const res = resolveCapabilityInput(rawItems[i], context);
        if (res.status === 'resolved' && res.capability && res.intent) {
          actions.push({
            id: `action-${i + 1}`,
            capabilityId: res.capability.id,
            intent: res.intent,
            target: res.target,
            parameters: res.parameters,
            description: `${res.intent}: ${res.target || res.capability.name}`,
            executionPolicy: 'immediate',
          });
        }
      }
      if (actions.length > 0) {
        return createQueuedPlan(`Queue ${actions.map((a) => a.description).join(', ')}`, actions);
      }
    }
  }

  return null;
}

// ============================================================================
// 6. EXECUTION HANDOFF BRIDGE
// ============================================================================

/**
 * Hands off a resolved capability instruction to the existing Action Plan
 * and capability execution architecture.
 */
export function executeCapabilityResolution(
  resolution: CapabilityResolution,
  context: CapabilityExecutionContext
): CapabilityExecutionResult {
  // If resolution produced an Action Plan, execute via Action Plan engine
  if (resolution.plan) {
    const planResult = executeActionPlanSync(resolution.plan, context);
    return {
      success: planResult.executed,
      executed: planResult.executed,
      response: planResult.summary || resolution.responseMessage || 'Action completed.',
      purpose: planResult.status === 'completed' ? 'report_result' : 'explain_limitation',
      targetScreen: planResult.targetScreen || resolution.targetScreen,
      actions: resolution.contextualActions,
      metadata: { planId: planResult.planId, results: planResult.results },
    };
  }

  // If a direct capability is available, execute its execute() handler
  if (resolution.capability && resolution.capability.execute && resolution.intent) {
    try {
      const directResult = resolution.capability.execute(
        resolution.intent,
        resolution.target,
        resolution.parameters,
        context
      );
      if (directResult instanceof Promise) {
        // Return synchronous placeholder or handle async
        return {
          success: true,
          executed: true,
          purpose: 'report_result',
          response: resolution.responseMessage || 'Operation initiated.',
          targetScreen: resolution.targetScreen,
          actions: resolution.contextualActions,
        };
      }
      return directResult;
    } catch (err: any) {
      return {
        success: false,
        executed: false,
        purpose: 'explain_limitation',
        response: `Capability execution error: ${err?.message || 'Unknown error'}`,
      };
    }
  }

  return {
    success: false,
    executed: false,
    purpose: 'explain_limitation',
    response: resolution.responseMessage || 'Unable to execute capability.',
  };
}
