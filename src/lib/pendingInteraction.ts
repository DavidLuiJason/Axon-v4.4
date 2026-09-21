import {
  ContextualMessageAction,
  PendingInteraction,
  PendingInteractionType,
  ExpectedResponseType,
} from '../types';

export const PENDING_INTERACTION_EXPIRATION_MS = 60000;
export const PENDING_CHOICE_EXPIRATION_MS = PENDING_INTERACTION_EXPIRATION_MS;

// In-memory active pending interaction
let activePendingInteraction: PendingInteraction | null = null;

/**
 * Checks if a pending interaction has exceeded its time-to-live.
 */
export function isInteractionExpired(interaction: PendingInteraction): boolean {
  if (typeof interaction.expiresAt === 'number' && Date.now() >= interaction.expiresAt) {
    return true;
  }
  const refTime =
    typeof interaction.timestamp === 'number'
      ? interaction.timestamp
      : typeof interaction.createdAt === 'number'
      ? interaction.createdAt
      : undefined;

  if (typeof refTime !== 'number') {
    return true;
  }
  const maxLifetime = interaction.ttlMs || PENDING_INTERACTION_EXPIRATION_MS;
  return Date.now() - refTime >= maxLifetime;
}

/**
 * Retrieves the current active pending interaction.
 * Lazily expires interactions older than their TTL (default 60 seconds).
 */
export function getPendingInteraction(): PendingInteraction | null {
  if (activePendingInteraction && isInteractionExpired(activePendingInteraction)) {
    activePendingInteraction = null;
  }
  return activePendingInteraction;
}

/**
 * Sets or updates the active pending interaction.
 * Automatically ensures unique ID, timestamps, expiration, and compatibility fields.
 */
export function setPendingInteraction(
  interaction: Partial<PendingInteraction> | null
): PendingInteraction | null {
  if (!interaction) {
    activePendingInteraction = null;
    return null;
  }

  const timestamp = interaction.timestamp || Date.now();
  const ttlMs = interaction.ttlMs || PENDING_INTERACTION_EXPIRATION_MS;
  const type: PendingInteractionType =
    interaction.type ||
    (interaction.promptType === 'confirm' ? 'confirmation' : 'selection');
  const originatingIntent = interaction.originatingIntent || interaction.command || '/open';

  activePendingInteraction = {
    id: interaction.id || `pi-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    originatingIntent,
    command: interaction.command || originatingIntent,
    promptType: interaction.promptType || (type === 'confirmation' ? 'confirm' : 'select'),
    prompt: interaction.prompt,
    expectedResponseType:
      interaction.expectedResponseType || (type === 'confirmation' ? 'confirmation' : 'selection'),
    target: interaction.target,
    candidates: interaction.candidates,
    actions: interaction.actions,
    metadata: interaction.metadata || interaction.data,
    data: interaction.data || interaction.metadata,
    timestamp,
    ttlMs,
    expiresAt: interaction.expiresAt || timestamp + ttlMs,
    precedingInteractionId: interaction.precedingInteractionId,
  };

  return activePendingInteraction;
}

/**
 * Clears the active pending interaction.
 */
export function clearPendingInteraction(): void {
  activePendingInteraction = null;
}

export interface AmbiguityResolutionParams<TTarget = any> {
  originalInteraction: PendingInteraction;
  userInput: string;
  matchedTarget: TTarget;
  matchedLabel: string;
  matchedActionText?: string;
  newRequestActionText?: string;
  prompt?: string;
}

/**
 * Creates a structured ambiguity resolution interaction when an incoming user message
 * might either answer an earlier pending interaction or start an independent new request.
 */
export function createAmbiguityResolutionInteraction<TTarget = any>(
  params: AmbiguityResolutionParams<TTarget>
): PendingInteraction<TTarget> {
  const timestamp = Date.now();
  const ttlMs = PENDING_INTERACTION_EXPIRATION_MS;
  const actions: ContextualMessageAction[] = [
    {
      label: `Open ${params.matchedLabel}`,
      actionText: params.matchedActionText || `/open ${params.matchedLabel.toLowerCase()}`,
      description: `Confirm opening ${params.matchedLabel}`,
    },
    {
      label: 'New Request',
      actionText: params.newRequestActionText || params.userInput,
      description: 'Treat this input as a new request',
    },
  ];

  return {
    id: `pi-ambiguity-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'ambiguity_resolution',
    originatingIntent: params.originalInteraction.originatingIntent,
    prompt:
      params.prompt ||
      `I think you may be referring to your earlier ${params.originalInteraction.originatingIntent} request. You mentioned "${params.matchedLabel}". Do you want me to continue with that request?`,
    promptType: 'confirm',
    command: params.originalInteraction.command,
    expectedResponseType: 'confirmation',
    target: params.matchedTarget,
    actions,
    timestamp,
    ttlMs,
    expiresAt: timestamp + ttlMs,
    precedingInteractionId: params.originalInteraction.id,
    metadata: {
      originalInteractionId: params.originalInteraction.id,
      rawInput: params.userInput,
      matchedLabel: params.matchedLabel,
    },
  };
}

export type { PendingInteraction, PendingInteractionType, ExpectedResponseType };
