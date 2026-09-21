/**
 * AXON Adaptive Execution & Attempt History Architecture
 *
 * Core Principles:
 * 1. Distinguishes Objective (what the user wants) from Preferred Method (how they asked for it).
 * 2. Adaptive Attempt Chain: Attempt preferred method -> Verify -> If failed, record attempt -> Discover valid alternative -> Attempt alternative -> Verify -> Final transparent report.
 * 3. Structured Attempt History: Records capability, status, failure category/reason, verification status, timestamps, and whether it was preferred or alternative.
 * 4. Grounded Fallbacks: Discovers valid alternatives strictly from actual available capabilities without inventing non-existent functionality.
 * 5. Method Exclusivity: Distinguishes "preferred method" (allows safe fallback) from "exclusive method" ("only use X" forbids fallback).
 * 6. Semi-Silent Adaptation with Transparent Final Reporting: Solves low-risk fallbacks without intermediate chat spam, while never concealing the actual execution path.
 * 7. Verification Gate: Prevents "fake success" by verifying that the objective was truly achieved.
 * 8. Infinite Loop & Resource Protection: Bounded attempts, deduplication of tried methods, and resource awareness.
 * 9. Follow-Up Querying: Structured query interface to answer "What did you try?", "Why didn't X work?", "Which method succeeded?", etc.
 */

import { ScreenId, ContextualMessageAction } from '../types';
import {
  systemCapabilityRegistry,
  CapabilityExecutionContext,
} from './capabilitySystem';
import { resolveInterfaceFromQuery } from './interfaceRegistry';
import { tryEvaluateMathExpression } from './storageChatHandler';

// ============================================================================
// 1. TYPE DEFINITIONS
// ============================================================================

export type FailureCategory =
  | 'unavailable_capability'
  | 'permission_denied'
  | 'invalid_input'
  | 'resource_constraint'
  | 'network_unavailable'
  | 'execution_error'
  | 'verification_failure'
  | 'timeout'
  | 'user_cancellation'
  | 'unsupported_operation';

export type MethodExclusivity = 'preferred' | 'exclusive';

export interface ExecutionAttempt {
  id: string;
  attemptIndex: number;
  objective: string;
  methodId: string;
  capabilityId: string;
  methodName: string;
  intent?: string;
  target?: string;
  parameters?: Record<string, any>;
  isPreferredMethod: boolean;
  status: 'attempting' | 'succeeded' | 'failed' | 'verification_failed' | 'skipped';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  failureCategory?: FailureCategory;
  failureReason?: string;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  result?: any;
  verified: boolean;
  verificationDetails?: string;
  requiresConfirmation?: boolean;
}

export interface AdaptiveFallbackPolicy {
  exclusivity: MethodExclusivity;
  maxAttempts: number;
  allowedMethods?: string[];
  disallowedMethods?: string[];
  allowAutonomousFallback: boolean;
  requireConfirmationOnAlternative?: boolean;
}

export interface AdaptiveExecutionResult {
  objective: string;
  preferredMethod: string;
  successfulMethod?: string;
  status: 'succeeded' | 'failed' | 'requires_confirmation' | 'cancelled';
  attempts: ExecutionAttempt[];
  finalResult?: any;
  response: string;
  targetScreen?: ScreenId;
  actions?: ContextualMessageAction[];
  isVerified: boolean;
  adapted: boolean;
  limitation?: string;
}

// ============================================================================
// 2. ATTEMPT HISTORY STORE & FOLLOW-UP QUERYING
// ============================================================================

const globalAttemptHistory: ExecutionAttempt[] = [];
let latestAdaptiveResult: AdaptiveExecutionResult | null = null;

export function recordAttempt(attempt: ExecutionAttempt): void {
  globalAttemptHistory.push({ ...attempt });
}

export function getGlobalAttemptHistory(): ExecutionAttempt[] {
  return [...globalAttemptHistory];
}

export function getLatestAdaptiveResult(): AdaptiveExecutionResult | null {
  return latestAdaptiveResult;
}

export function setLatestAdaptiveResult(res: AdaptiveExecutionResult | null): void {
  latestAdaptiveResult = res;
}

export function clearAttemptHistory(): void {
  globalAttemptHistory.length = 0;
  latestAdaptiveResult = null;
}

import { getLastExecutionOutcome } from './actionExecutionGateway';

/**
 * Answers user follow-up questions about past execution attempts directly from structured history.
 */
export function queryAttemptHistory(query: string): string | null {
  const norm = query.trim().toLowerCase();
  const res = latestAdaptiveResult;
  const lastOutcome = getLastExecutionOutcome();

  // If no adaptive result exists, fall back to lastExecutionOutcome if available
  if (!res || res.attempts.length === 0) {
    if (!lastOutcome) {
      return null;
    }

    // 1. "What did you try?"
    if (
      norm.includes('what did you try') ||
      norm.includes('what were the attempts') ||
      norm.includes('show attempts') ||
      norm.includes('list attempts')
    ) {
      if (lastOutcome.attempts && lastOutcome.attempts.length > 0) {
        const lines = lastOutcome.attempts.map((att, idx) => {
          const role = att.isPreferredMethod ? 'Requested Method' : 'Alternative';
          const statusStr =
            att.status === 'succeeded'
              ? 'succeeded'
              : `failed (${att.failureReason || att.failureCategory || 'error'})`;
          return `${idx + 1}. **${att.methodName}** [${role}]: ${statusStr}`;
        });
        return `### Execution Attempt History\n**Objective:** ${lastOutcome.objective || lastOutcome.intent}\n\n${lines.join('\n')}`;
      }
      return `### Execution Outcome\n**Action:** ${lastOutcome.intent} (${lastOutcome.capabilityId})\n**Status:** ${lastOutcome.status} (${lastOutcome.success ? 'verified' : lastOutcome.failureReason || 'failed'})`;
    }

    // 2. "Why did that fail?" / "Why didn't that work?"
    if (
      /why\s+(?:didn't|did\s+not|did)\s+(?:that|it|this)\s+(?:work|fail)/i.test(norm) ||
      norm.includes('why did that fail') ||
      norm.includes('why did it fail') ||
      norm.includes('why failed')
    ) {
      if (lastOutcome.success) {
        return `The previous action (**${lastOutcome.intent}** via **${lastOutcome.capabilityId}**) did not fail; it completed and was verified successfully.`;
      }
      return `**${lastOutcome.intent}** (${lastOutcome.capabilityId}) failed because: ${lastOutcome.failureReason || lastOutcome.error?.message || 'Execution error'}.\n• Category: \`${lastOutcome.failureCategory || 'execution_failure'}\``;
    }

    // 3. "That worked" / "It worked"
    if (/^(?:that\s+worked|it\s+worked|that\s+succeeded|it\s+succeeded)[!.?,]*$/i.test(norm)) {
      if (lastOutcome.success) {
        return `Confirmed: the previous action (**${lastOutcome.intent}** via **${lastOutcome.actualMethodUsed || lastOutcome.capabilityId}**) completed and was verified successfully.`;
      }
      return `The previous action (**${lastOutcome.intent}**) recorded status "${lastOutcome.status}".`;
    }

    return null;
  }

  // 1. "What did you try?" / "What attempts were made?"
  if (
    norm.includes('what did you try') ||
    norm.includes('what were the attempts') ||
    norm.includes('show attempts') ||
    norm.includes('list attempts')
  ) {
    const lines = res.attempts.map((att, idx) => {
      const role = att.isPreferredMethod ? 'Requested Method' : 'Alternative';
      const statusStr =
        att.status === 'succeeded'
          ? 'succeeded'
          : `failed (${att.failureReason || att.failureCategory || 'error'})`;
      return `${idx + 1}. **${att.methodName}** [${role}]: ${statusStr}`;
    });
    return `### Execution Attempt History\n**Objective:** ${res.objective}\n\n${lines.join('\n')}`;
  }

  // 2. "Why didn't method X work?" / "Why did X fail?" / "Why did that fail?"
  const failQueryMatch = norm.match(/why\s+(?:didn't|did\s+not|did)\s+([a-zA-Z0-9_\s-]+?)\s+(?:work|fail)/i);
  if (
    failQueryMatch ||
    norm.includes('why did it fail') ||
    norm.includes('why did that fail') ||
    norm.includes('why failed')
  ) {
    const rawTarget = failQueryMatch ? failQueryMatch[1].toLowerCase().trim() : '';
    const isPronoun = !rawTarget || /^(?:that|it|this|that\s+one|this\s+one)$/i.test(rawTarget);
    const isFirst = /^(?:the\s+first\s+one|the\s+first|first)$/i.test(rawTarget);

    const matchingAttempt = res.attempts.find((a, idx) => {
      if (isFirst) return idx === 0;
      if (isPronoun) return a.status !== 'succeeded';
      return a.methodName.toLowerCase().includes(rawTarget) || a.methodId.toLowerCase().includes(rawTarget);
    });

    if (matchingAttempt) {
      return `**${matchingAttempt.methodName}** failed because: ${matchingAttempt.failureReason || matchingAttempt.error?.message || 'Execution error encountered'}.\n• Category: \`${matchingAttempt.failureCategory || 'execution_error'}\``;
    }
  }

  // 3. "Which method actually succeeded?" / "What succeeded?" / "That worked"
  if (
    norm.includes('which method') && (norm.includes('succeeded') || norm.includes('worked')) ||
    norm.includes('what succeeded') ||
    norm.includes('what worked') ||
    /^(?:that\s+worked|it\s+worked|that\s+succeeded|it\s+succeeded)[!.?,]*$/i.test(norm)
  ) {
    if (res.status === 'succeeded' && res.successfulMethod) {
      const succAttempt = res.attempts.find((a) => a.methodName === res.successfulMethod || a.methodId === res.successfulMethod);
      const isAlt = succAttempt && !succAttempt.isPreferredMethod;
      return `The method that succeeded was **${res.successfulMethod}**${isAlt ? ' (which was an adaptive alternative after the requested method failed)' : ' (the requested method)'}.`;
    }
    return `None of the attempted methods succeeded for the objective "${res.objective}".`;
  }

  // 4. "Why did you use C instead?" / "Why use alternative?"
  if (norm.includes('why did you use') || norm.includes('why use')) {
    if (res.adapted && res.successfulMethod) {
      const firstFailed = res.attempts.find((a) => a.isPreferredMethod);
      const firstReason = firstFailed ? firstFailed.failureReason : 'it failed';
      return `I used **${res.successfulMethod}** as a safe alternative because the requested method (**${res.preferredMethod}**) failed (${firstReason}).`;
    }
  }

  // 5. "What method did you try second?" / "Second method attempted"
  if (
    norm.includes('method did you try second') ||
    norm.includes('method tried second') ||
    norm.includes('what did you try second') ||
    norm.includes('second method')
  ) {
    if (res.attempts.length > 1) {
      return `The second method attempted was **${res.attempts[1].methodName}** (${res.attempts[1].status}).`;
    }
  }

  // 6. Question inquiry about retrying: e.g. "can you try again?", "should we try again?"
  if (
    (/^(?:can|could|how|should|what\s+if)\b/i.test(norm) || norm.endsWith('?')) &&
    norm.includes('try') &&
    norm.includes('again') &&
    res.attempts.length > 0
  ) {
    const firstMethod = res.attempts[0].methodName;
    return `The previous attempt for **${firstMethod}** recorded failure reason: "${res.attempts[0].failureReason}". To try it again, you may explicitly issue the instruction.`;
  }

  return null;
}

// ============================================================================
// 3. FALLBACK DISCOVERY ENGINE
// ============================================================================

export interface FallbackCandidate {
  capabilityId: string;
  methodId: string;
  methodName: string;
  intent: string;
  target?: string;
  parameters?: Record<string, any>;
  description: string;
  isSafeAutonomous: boolean;
  requiresConfirmation: boolean;
  differenceExplanation: string;
}

/**
 * Discovers valid alternative methods grounded strictly in actual registered capabilities.
 */
export function discoverFallbackMethods(
  objective: string,
  currentTarget: string | undefined,
  failedAttempt: ExecutionAttempt,
  previousAttempts: ExecutionAttempt[],
  policy: AdaptiveFallbackPolicy,
  context: CapabilityExecutionContext
): FallbackCandidate[] {
  // 1. If method is exclusive, NO fallback is permitted
  if (policy.exclusivity === 'exclusive' || !policy.allowAutonomousFallback) {
    return [];
  }

  // 2. Bounded attempt limit: prevent infinite loops
  if (previousAttempts.length >= policy.maxAttempts) {
    return [];
  }

  // Set of already attempted signature keys to prevent duplicate attempts
  const attemptedKeys = new Set(
    previousAttempts.map((a) => `${a.capabilityId}:${a.target || ''}:${a.intent || ''}`)
  );
  attemptedKeys.add(`${failedAttempt.capabilityId}:${failedAttempt.target || ''}`);

  const candidates: FallbackCandidate[] = [];
  const normObj = objective.toLowerCase();
  const targetLower = (currentTarget || '').toLowerCase();

  // 3. Math calculation fallbacks
  if (
    failedAttempt.capabilityId === 'math_calculator' ||
    normObj.includes('calculate') ||
    normObj.includes('compute') ||
    normObj.includes('math')
  ) {
    // If direct expression evaluation failed, fallback to opening the Calculator tool interface
    const key = `workspace_navigation:tool_calc:open`;
    if (!attemptedKeys.has(key)) {
      candidates.push({
        capabilityId: 'workspace_navigation',
        methodId: 'open_calculator_tool',
        methodName: 'Interactive Calculator Tool',
        intent: 'open',
        target: 'calculator',
        parameters: { initialExpression: currentTarget },
        description: 'Open the interactive Calculator tool interface',
        isSafeAutonomous: true,
        requiresConfirmation: false,
        differenceExplanation:
          'Opens the interactive graphical Calculator interface instead of inline text evaluation.',
      });
    }
  }

  // 4. Workspace navigation fallbacks
  if (failedAttempt.capabilityId === 'workspace_navigation') {
    // If target interface lookup failed, check related registered interfaces
    if (targetLower.includes('calc') && !attemptedKeys.has('workspace_navigation:tool_calc:open')) {
      candidates.push({
        capabilityId: 'workspace_navigation',
        methodId: 'open_tool_calc',
        methodName: 'Calculator Utility',
        intent: 'open',
        target: 'tool_calc',
        description: 'Open Calculator Tool',
        isSafeAutonomous: true,
        requiresConfirmation: false,
        differenceExplanation: 'Navigates directly to the calculator tool route.',
      });
    } else if (
      (targetLower.includes('setting') || targetLower.includes('appearance') || targetLower.includes('theme')) &&
      !attemptedKeys.has('settings_controller:settings:configure_appearance')
    ) {
      candidates.push({
        capabilityId: 'settings_controller',
        methodId: 'settings_appearance_controller',
        methodName: 'Settings Controller',
        intent: 'configure_appearance',
        target: 'settings',
        description: 'Configure appearance directly via Settings Controller',
        isSafeAutonomous: true,
        requiresConfirmation: false,
        differenceExplanation: 'Uses Settings Controller to update visual settings directly.',
      });
    } else if (!attemptedKeys.has('workspace_navigation:tools:open')) {
      // Fallback to Tools & Utilities overview
      candidates.push({
        capabilityId: 'workspace_navigation',
        methodId: 'open_tools_overview',
        methodName: 'Tools & Utilities Directory',
        intent: 'open',
        target: 'tools',
        description: 'Open Tools & Utilities Directory',
        isSafeAutonomous: true,
        requiresConfirmation: false,
        differenceExplanation: 'Opens the main Tools directory to locate available utilities.',
      });
    }
  }

  // 5. Capability alternative mechanisms
  for (const cap of systemCapabilityRegistry.getAll()) {
    if (cap.resolveAlternative) {
      const altRoute = cap.resolveAlternative(objective, failedAttempt.methodId);
      if (altRoute && altRoute.targetCapabilityId) {
        const key = `${altRoute.targetCapabilityId}:${currentTarget || ''}:alternative`;
        if (!attemptedKeys.has(key)) {
          candidates.push({
            capabilityId: altRoute.targetCapabilityId,
            methodId: `alt_${altRoute.targetCapabilityId}`,
            methodName: cap.name,
            intent: 'alternative',
            target: currentTarget,
            description: altRoute.explanation,
            isSafeAutonomous: true,
            requiresConfirmation: false,
            differenceExplanation: altRoute.explanation,
          });
        }
      }
    }
  }

  // Filter against capability availability in current environment
  const availableCandidates = candidates.filter((cand) => {
    const status = systemCapabilityRegistry.checkAvailability(cand.capabilityId);
    return status.isAvailable;
  });

  // Filter against user-specified allowed/disallowed methods
  return availableCandidates.filter((cand) => {
    if (policy.disallowedMethods && policy.disallowedMethods.includes(cand.methodId)) {
      return false;
    }
    if (
      policy.allowedMethods &&
      policy.allowedMethods.length > 0 &&
      !policy.allowedMethods.some(
        (m) => cand.methodId.includes(m) || cand.capabilityId.includes(m) || cand.methodName.toLowerCase().includes(m.toLowerCase())
      )
    ) {
      return false;
    }
    return true;
  });
}

// ============================================================================
// 4. RESULT VERIFICATION ENGINE
// ============================================================================

export interface VerificationOutcome {
  verified: boolean;
  failureCategory?: FailureCategory;
  reason?: string;
}

/**
 * Verifies that the user's actual objective was achieved, preventing "fake success".
 */
export function verifyAttemptResult(
  attempt: ExecutionAttempt,
  result: any,
  context: CapabilityExecutionContext
): VerificationOutcome {
  // 1. Math calculation verification
  if (attempt.capabilityId === 'math_calculator' || attempt.intent === 'calculate') {
    const calcOutput = result?.calculation || result?.response || result;
    if (typeof calcOutput === 'string' && calcOutput.includes('=')) {
      const parts = calcOutput.split('=');
      const val = parts[1]?.trim();
      if (val && !isNaN(Number(val))) {
        return { verified: true };
      }
    }
    return {
      verified: false,
      failureCategory: 'verification_failure',
      reason: 'Calculation result was missing or mathematically indeterminate.',
    };
  }

  // 2. Navigation verification
  if (attempt.capabilityId === 'workspace_navigation' || attempt.intent === 'open') {
    const targetScreen = result?.targetScreen || result?.screen;
    if (targetScreen) {
      return { verified: true };
    }
    return {
      verified: false,
      failureCategory: 'verification_failure',
      reason: 'Navigation target did not resolve to an active interface screen.',
    };
  }

  // 3. Settings controller verification
  if (attempt.capabilityId === 'settings_controller') {
    if (result && result.success !== false) {
      return { verified: true };
    }
    return {
      verified: false,
      failureCategory: 'verification_failure',
      reason: 'Settings controller could not apply requested configuration.',
    };
  }

  // 4. General verification
  if (result && result.success !== false) {
    return { verified: true };
  }

  return {
    verified: false,
    failureCategory: 'verification_failure',
    reason: 'Operation returned without valid outcome payload.',
  };
}

// ============================================================================
// 5. TRANSPARENT FINAL REPORT GENERATOR
// ============================================================================

/**
 * Builds an honest, transparent outcome report generated directly from actual attempt history.
 * Never claims a failed method succeeded.
 */
export function generateAdaptiveReport(result: AdaptiveExecutionResult): string {
  // Case 1: Preferred method succeeded directly without fallback
  if (result.status === 'succeeded' && !result.adapted) {
    return result.response;
  }

  // Case 2: Adaptive fallback succeeded after initial failure(s)
  if (result.status === 'succeeded' && result.adapted) {
    const preferred = result.attempts.find((a) => a.isPreferredMethod);
    const successful = result.attempts.find((a) => a.status === 'succeeded');

    const failedAttempts = result.attempts.filter((a) => a.status !== 'succeeded');
    const failureBulletPoints = failedAttempts
      .map((fa) => `• **${fa.methodName}** failed: ${fa.failureReason || 'Execution error'}.`)
      .join('\n');

    return (
      `Completed: **${result.objective}**\n\n` +
      `*Execution Path:*\n` +
      `${failureBulletPoints}\n` +
      `• Successfully resolved via **${successful?.methodName || result.successfulMethod}**.\n\n` +
      `${result.response}`
    );
  }

  // Case 3: Exclusive method restricted fallback
  if (result.status === 'failed' && result.attempts.some((a) => a.isPreferredMethod)) {
    const failedPref = result.attempts.find((a) => a.isPreferredMethod);
    if (result.attempts.length === 1 && result.limitation?.includes('restricted exclusively')) {
      return (
        `Could not complete **${result.objective}**.\n\n` +
        `The requested method (**${failedPref?.methodName}**) failed: ${failedPref?.failureReason || 'Error'}.\n` +
        `Because execution was restricted exclusively to this method, no alternative methods were attempted.`
      );
    }

    // Case 4: Multiple attempts failed
    const allFailures = result.attempts
      .map((a, i) => `• Attempt ${i + 1} (**${a.methodName}**): ${a.failureReason || 'Failed'}`)
      .join('\n');

    return (
      `Could not complete **${result.objective}** after multiple attempts:\n\n` +
      `${allFailures}\n\n` +
      `Limitation: ${result.limitation || 'No valid alternative method remains in the current environment.'}`
    );
  }

  return result.response || `Execution ended with status: ${result.status}`;
}

// ============================================================================
// 6. ADAPTIVE EXECUTION ORCHESTRATOR
// ============================================================================

/**
 * Synchronously executes an objective with adaptive fallback capability.
 */
export function executeAdaptiveObjectiveSync(
  objective: string,
  preferredMethod: {
    capabilityId: string;
    methodId: string;
    methodName: string;
    intent: string;
    target?: string;
    parameters?: Record<string, any>;
  },
  policy: AdaptiveFallbackPolicy,
  context: CapabilityExecutionContext
): AdaptiveExecutionResult {
  const attempts: ExecutionAttempt[] = [];
  let isObjectiveAchieved = false;
  let finalResultPayload: any = null;
  let successfulMethodName: string | undefined;
  let targetScreen: ScreenId | undefined;
  let finalResponse = '';

  // Initial Attempt (Preferred Method)
  let currentMethod = { ...preferredMethod, isPreferred: true };
  let attemptIdx = 1;

  while (!isObjectiveAchieved && attemptIdx <= policy.maxAttempts) {
    if (context.cancellationToken?.isCancelled) {
      break;
    }

    const attemptId = `att_${Date.now()}_${attemptIdx}`;
    const startedAt = Date.now();

    const attempt: ExecutionAttempt = {
      id: attemptId,
      attemptIndex: attemptIdx,
      objective,
      methodId: currentMethod.methodId,
      capabilityId: currentMethod.capabilityId,
      methodName: currentMethod.methodName,
      intent: currentMethod.intent,
      target: currentMethod.target,
      parameters: currentMethod.parameters,
      isPreferredMethod: currentMethod.isPreferred,
      status: 'attempting',
      startedAt,
      verified: false,
    };

    // 0. Capability Availability & Environment Awareness Pre-Check
    const capStatus = systemCapabilityRegistry.checkAvailability(currentMethod.capabilityId);
    if (!capStatus.isAvailable) {
      attempt.completedAt = Date.now();
      attempt.durationMs = 0;
      attempt.status = 'failed';
      attempt.verified = false;
      if (capStatus.state === 'network_required') {
        attempt.failureCategory = 'network_unavailable';
      } else if (capStatus.state === 'permission_denied' || capStatus.state === 'permission_required') {
        attempt.failureCategory = 'permission_denied';
      } else if (capStatus.state === 'resource_constrained') {
        attempt.failureCategory = 'resource_constraint';
      } else if (capStatus.state === 'unsupported_platform') {
        attempt.failureCategory = 'unsupported_operation';
      } else {
        attempt.failureCategory = 'unavailable_capability';
      }
      attempt.failureReason =
        capStatus.reason?.userFriendlyReason ||
        capStatus.reason?.message ||
        `Capability "${currentMethod.capabilityId}" is unavailable in this environment.`;
      attempt.error = {
        message: capStatus.reason?.message || 'Capability unavailable',
        code: capStatus.reason?.code,
      };
      recordAttempt(attempt);
      attempts.push(attempt);

      if (policy.exclusivity === 'exclusive' || !policy.allowAutonomousFallback) {
        break;
      }

      const fallbacks = discoverFallbackMethods(
        objective,
        currentMethod.target,
        attempt,
        attempts,
        policy,
        context
      );

      if (fallbacks.length === 0) {
        break;
      }

      const nextCandidate = fallbacks[0];
      if (nextCandidate.requiresConfirmation || policy.requireConfirmationOnAlternative) {
        const pausedResult: AdaptiveExecutionResult = {
          objective,
          preferredMethod: preferredMethod.methodName,
          status: 'requires_confirmation',
          attempts,
          response: `The requested method **${preferredMethod.methodName}** is unavailable in this environment (${attempt.failureReason}). A valid alternative (**${nextCandidate.methodName}**) is available, but requires confirmation before proceeding.`,
          isVerified: false,
          adapted: false,
          actions: [
            {
              label: `Proceed with ${nextCandidate.methodName}`,
              actionText: `run ${nextCandidate.intent} ${nextCandidate.target || ''}`.trim(),
              description: nextCandidate.description,
              variant: 'default',
            },
          ],
        };
        setLatestAdaptiveResult(pausedResult);
        return pausedResult;
      }

      currentMethod = {
        capabilityId: nextCandidate.capabilityId,
        methodId: nextCandidate.methodId,
        methodName: nextCandidate.methodName,
        intent: nextCandidate.intent,
        target: nextCandidate.target,
        parameters: nextCandidate.parameters,
        isPreferred: false,
      };
      attemptIdx++;
      continue;
    }

    // Execute through registered system capability or direct route
    let execSuccess = false;
    let execError: any = null;
    let execResult: any = null;
    let responseText = '';

    try {
      const cap = systemCapabilityRegistry.get(currentMethod.capabilityId);
      if (cap && cap.execute) {
        const res = cap.execute(
          currentMethod.intent,
          currentMethod.target,
          currentMethod.parameters || {},
          context
        );
        const syncRes = res as any;
        if (syncRes && syncRes.success !== false) {
          execSuccess = true;
          execResult = syncRes;
          responseText = syncRes.response || '';
          if (syncRes.targetScreen) targetScreen = syncRes.targetScreen;
        } else {
          execSuccess = false;
          execError = { message: syncRes?.response || 'Capability failed.' };
        }
      } else if (currentMethod.capabilityId === 'workspace_navigation') {
        const navTarget = currentMethod.target || '';
        const resolution = resolveInterfaceFromQuery(navTarget, context.currentScreen);
        if (resolution.match && resolution.match.route && context.navigateTo) {
          context.navigateTo(resolution.match.route as ScreenId, {
            screenState: resolution.match.subState,
          });
          execSuccess = true;
          targetScreen = resolution.match.route as ScreenId;
          responseText = `Opened **${resolution.match.name}**.`;
          execResult = { targetScreen, screen: resolution.match.route };
        } else {
          execSuccess = false;
          execError = { message: `Interface "${navTarget}" not found.` };
        }
      } else if (currentMethod.capabilityId === 'math_calculator') {
        const expr = currentMethod.parameters?.expression || currentMethod.target || '';
        const calcRes = tryEvaluateMathExpression(expr);
        if (calcRes) {
          execSuccess = true;
          execResult = { calculation: calcRes };
          responseText = calcRes;
        } else {
          execSuccess = false;
          execError = { message: `Could not evaluate math expression "${expr}".` };
        }
      } else {
        execSuccess = false;
        execError = { message: `Unsupported capability "${currentMethod.capabilityId}".` };
      }
    } catch (err: any) {
      execSuccess = false;
      execError = { message: err?.message || String(err) };
    }

    // Step 2 & 8: Verify result to avoid "fake success"
    attempt.completedAt = Date.now();
    attempt.durationMs = attempt.completedAt - attempt.startedAt;

    if (execSuccess) {
      const verifyCheck = verifyAttemptResult(attempt, execResult, context);
      if (verifyCheck.verified) {
        attempt.status = 'succeeded';
        attempt.verified = true;
        attempt.result = execResult;
        recordAttempt(attempt);
        attempts.push(attempt);

        isObjectiveAchieved = true;
        finalResultPayload = execResult;
        successfulMethodName = currentMethod.methodName;
        finalResponse = responseText;
        break;
      } else {
        attempt.status = 'verification_failed';
        attempt.verified = false;
        attempt.failureCategory = verifyCheck.failureCategory || 'verification_failure';
        attempt.failureReason = verifyCheck.reason || 'Verification failed.';
        attempt.error = { message: attempt.failureReason };
        recordAttempt(attempt);
        attempts.push(attempt);
      }
    } else {
      attempt.status = 'failed';
      attempt.verified = false;
      attempt.failureCategory =
        execError?.message?.includes('not found') || execError?.message?.includes('Unsupported')
          ? 'unavailable_capability'
          : 'execution_error';
      attempt.failureReason = execError?.message || 'Execution error';
      attempt.error = execError;
      recordAttempt(attempt);
      attempts.push(attempt);
    }

    // Step 4: Method failed -> determine whether a valid alternative exists
    if (policy.exclusivity === 'exclusive') {
      // Exclusive mode prohibits fallback
      break;
    }

    const fallbacks = discoverFallbackMethods(
      objective,
      currentMethod.target,
      attempt,
      attempts,
      policy,
      context
    );

    if (fallbacks.length === 0) {
      // No alternative remains
      break;
    }

    const nextCandidate = fallbacks[0];

    // Check safety boundary: does it require confirmation?
    if (nextCandidate.requiresConfirmation || policy.requireConfirmationOnAlternative) {
      const pausedResult: AdaptiveExecutionResult = {
        objective,
        preferredMethod: preferredMethod.methodName,
        status: 'requires_confirmation',
        attempts,
        response: `The requested method **${preferredMethod.methodName}** failed (${attempt.failureReason}). A valid alternative (**${nextCandidate.methodName}**) is available, but requires confirmation before proceeding.`,
        isVerified: false,
        adapted: false,
        actions: [
          {
            label: `Proceed with ${nextCandidate.methodName}`,
            actionText: `run ${nextCandidate.intent} ${nextCandidate.target || ''}`.trim(),
            description: nextCandidate.description,
            variant: 'default',
          },
        ],
      };
      setLatestAdaptiveResult(pausedResult);
      return pausedResult;
    }

    // Switch to alternative method
    currentMethod = {
      capabilityId: nextCandidate.capabilityId,
      methodId: nextCandidate.methodId,
      methodName: nextCandidate.methodName,
      intent: nextCandidate.intent,
      target: nextCandidate.target,
      parameters: nextCandidate.parameters,
      isPreferred: false,
    };
    attemptIdx++;
  }

  const isAdapted = isObjectiveAchieved && successfulMethodName !== preferredMethod.methodName;
  const outcomeStatus = isObjectiveAchieved ? 'succeeded' : 'failed';

  let limitationText: string | undefined;
  if (!isObjectiveAchieved) {
    if (context.cancellationToken?.isCancelled) {
      limitationText = context.cancellationToken.reason || 'Execution cancelled by user.';
    } else if (policy.exclusivity === 'exclusive') {
      limitationText = `Execution restricted exclusively to ${preferredMethod.methodName}.`;
    } else {
      limitationText = `All ${attempts.length} attempted methods failed to accomplish "${objective}".`;
    }
  }

  const adaptiveResult: AdaptiveExecutionResult = {
    objective,
    preferredMethod: preferredMethod.methodName,
    successfulMethod: successfulMethodName,
    status: outcomeStatus,
    attempts,
    finalResult: finalResultPayload,
    response: finalResponse,
    targetScreen,
    isVerified: isObjectiveAchieved,
    adapted: isAdapted,
    limitation: limitationText,
  };

  adaptiveResult.response = generateAdaptiveReport(adaptiveResult);
  setLatestAdaptiveResult(adaptiveResult);
  return adaptiveResult;
}
