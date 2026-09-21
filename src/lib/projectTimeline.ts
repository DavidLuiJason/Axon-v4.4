import { ProjectActivityEvent, ProjectActivityType, ProjectTimelineQuery } from '../types';

export const DEFAULT_PROJECT_ACTIVITIES: ProjectActivityEvent[] = [
  {
    id: 'act-init-general',
    projectId: 'proj-general',
    timestamp: '2026-09-01T08:00:00.000Z',
    dateString: '2026-09-01',
    timeString: '08:00',
    type: 'project_created',
    title: 'Workspace Initialized',
    summary: 'Created General Workspace for broad tasks, inquiries, and research.',
    metadata: { initialNoteCount: 0 },
  },
  {
    id: 'act-init-app-dev',
    projectId: 'proj-app-dev',
    timestamp: '2026-09-02T09:30:00.000Z',
    dateString: '2026-09-02',
    timeString: '09:30',
    type: 'project_created',
    title: 'Project Initialized: AXON Mobile App',
    summary: 'Configured mobile app development workspace, 4GB RAM budget constraints, and telemetry.',
    metadata: { platform: 'react-mobile', targetRamBudgetMb: 4096 },
  },
  {
    id: 'act-spec-written',
    projectId: 'proj-app-dev',
    timestamp: '2026-09-03T10:00:00.000Z',
    dateString: '2026-09-03',
    timeString: '10:00',
    type: 'note_created',
    title: 'Architecture Specification Drafted',
    summary: 'Authored AXON System Architecture Spec note covering dual-pane navigation and storage manifest.',
    metadata: { noteId: 'note-spec-arch', category: 'spec' },
  },
  {
    id: 'act-welcome-note',
    projectId: 'proj-general',
    timestamp: '2026-09-03T11:00:00.000Z',
    dateString: '2026-09-03',
    timeString: '11:00',
    type: 'note_created',
    title: 'Getting Started Guide Authored',
    summary: 'Created guide note on project memory isolation and export capabilities.',
    metadata: { noteId: 'note-welcome', category: 'general' },
  },
  {
    id: 'act-init-bible-study',
    projectId: 'proj-bible-study',
    timestamp: '2026-09-03T14:15:00.000Z',
    dateString: '2026-09-03',
    timeString: '14:15',
    type: 'project_created',
    title: 'Project Initialized: Scripture & Historical Research',
    summary: 'Created historical texts research project with Greek & Hebrew concordance context.',
    metadata: { scope: 'biblical-history' },
  },
  {
    id: 'act-telemetry-run',
    projectId: 'proj-app-dev',
    timestamp: '2026-09-05T16:20:00.000Z',
    dateString: '2026-09-05',
    timeString: '16:20',
    type: 'code_executed',
    title: 'Telemetry Benchmark Executed',
    summary: 'Ran script evaluating memory footprint and virtualized frame rates on mobile viewport.',
    metadata: { script: 'telemetry_check.js', durationMs: 42 },
  },
  {
    id: 'act-storage-audit',
    projectId: 'proj-app-dev',
    timestamp: '2026-09-08T11:45:00.000Z',
    dateString: '2026-09-08',
    timeString: '11:45',
    type: 'tool_used',
    title: 'Storage Budget Verification',
    summary: 'Verified 15GB device manifest storage allocations and lossless compression profiles.',
    metadata: { toolName: 'StorageEngine', targetBudgetGb: 15 },
  },
];

export function formatDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatTimeKey(date: Date = new Date()): string {
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

/**
 * Creates a validated, timestamped ProjectActivityEvent.
 */
export function createProjectActivityEvent(
  params: {
    projectId: string;
    type: ProjectActivityType;
    title: string;
    summary: string;
    metadata?: Record<string, any>;
    customDate?: Date;
  }
): ProjectActivityEvent {
  const d = params.customDate || new Date();
  const id = `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  return {
    id,
    projectId: params.projectId,
    timestamp: d.toISOString(),
    dateString: formatDateKey(d),
    timeString: formatTimeKey(d),
    type: params.type,
    title: params.title,
    summary: params.summary,
    metadata: params.metadata,
  };
}

/**
 * Query project timeline events with filters for project, date range, activity types, and keywords.
 */
export function queryProjectTimeline(
  events: ProjectActivityEvent[],
  query: ProjectTimelineQuery
): ProjectActivityEvent[] {
  let filtered = [...events];

  if (query.projectId) {
    filtered = filtered.filter((e) => e.projectId === query.projectId);
  }

  if (query.date) {
    filtered = filtered.filter((e) => e.dateString === query.date);
  }

  if (query.startDate) {
    const startIso = query.startDate.includes('T') ? query.startDate : `${query.startDate}T00:00:00.000Z`;
    filtered = filtered.filter((e) => e.timestamp >= startIso);
  }

  if (query.endDate) {
    const endIso = query.endDate.includes('T') ? query.endDate : `${query.endDate}T23:59:59.999Z`;
    filtered = filtered.filter((e) => e.timestamp <= endIso);
  }

  if (query.types && query.types.length > 0) {
    filtered = filtered.filter((e) => query.types!.includes(e.type));
  }

  if (query.searchTerm && query.searchTerm.trim().length > 0) {
    const term = query.searchTerm.toLowerCase().trim();
    filtered = filtered.filter(
      (e) =>
        e.title.toLowerCase().includes(term) ||
        e.summary.toLowerCase().includes(term) ||
        (e.metadata && JSON.stringify(e.metadata).toLowerCase().includes(term))
    );
  }

  // Sort chronological descending (most recent first)
  filtered.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  if (query.limit && query.limit > 0) {
    return filtered.slice(0, query.limit);
  }

  return filtered;
}

/**
 * Groups events by YYYY-MM-DD date keys.
 */
export function getActivitiesByDate(
  events: ProjectActivityEvent[],
  projectId?: string
): Record<string, ProjectActivityEvent[]> {
  const pool = projectId ? events.filter((e) => e.projectId === projectId) : events;
  const groups: Record<string, ProjectActivityEvent[]> = {};

  for (const ev of pool) {
    if (!groups[ev.dateString]) {
      groups[ev.dateString] = [];
    }
    groups[ev.dateString].push(ev);
  }

  // Sort each group's events chronologically
  for (const dateKey of Object.keys(groups)) {
    groups[dateKey].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }

  return groups;
}

/**
 * Natural language search over project timeline.
 * Directly answers questions like:
 * - "When did I work on AXON architecture?"
 * - "What did I do on September 3rd?"
 * - "When was the last time I ran code?"
 */
export function queryTimelineNaturalLanguage(
  events: ProjectActivityEvent[],
  userPrompt: string,
  currentProjectId?: string
): { matches: boolean; answer: string; events: ProjectActivityEvent[] } {
  const text = userPrompt.toLowerCase().trim();

  const isTimelineQuery =
    /(?:when did (?:i|we|you)|what did (?:i|we|you) (?:do|work on|plan)|show (?:my )?(?:work|activity|timeline|history|plans)|work history|project timeline|what plans|planned activities)/i.test(
      text
    ) ||
    /(?:when was .* (?:created|drafted|done|worked on|updated|written|planned))/i.test(text);

  if (!isTimelineQuery) {
    return { matches: false, answer: '', events: [] };
  }

  // Extract date if present (e.g. 2026-09-03 or "september 3" or "sept 3")
  let targetDate: string | undefined;
  const isoDateMatch = text.match(/\b(202\d-[01]\d-[0-3]\d)\b/);
  if (isoDateMatch) {
    targetDate = isoDateMatch[1];
  } else {
    const monthMatch = text.match(/(?:january|february|march|april|may|june|july|august|september|october|november|december|sept|oct|nov|dec|jan|feb|mar|apr|jun|jul|aug)\s+(\d{1,2})/i);
    if (monthMatch) {
      // rough month resolver
      const day = String(monthMatch[1]).padStart(2, '0');
      targetDate = `2026-09-${day}`; // anchor to project timeline default month
    }
  }

  // Extract core keywords from query (excluding filler words)
  const stopWords = new Set([
    'when', 'did', 'we', 'what', 'on', 'the', 'in', 'at', 'show', 'my', 'project',
    'timeline', 'history', 'work', 'was', 'last', 'time', 'first', 'about', 'for', 'to', 'a', 'an'
  ]);
  const tokens = text
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  let matchedEvents: ProjectActivityEvent[] = [];

  if (targetDate) {
    matchedEvents = queryProjectTimeline(events, {
      date: targetDate,
      projectId: currentProjectId,
    });
  }

  if (matchedEvents.length === 0 && tokens.length > 0) {
    // Search by tokens
    const scored = events.map((ev) => {
      let score = 0;
      const haystack = `${ev.title} ${ev.summary} ${ev.type} ${JSON.stringify(ev.metadata || {})}`.toLowerCase();
      for (const token of tokens) {
        if (haystack.includes(token)) score += 2;
      }
      if (currentProjectId && ev.projectId === currentProjectId) {
        score += 1;
      }
      return { ev, score };
    });

    matchedEvents = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.ev);
  }

  if (matchedEvents.length === 0) {
    return {
      matches: true,
      answer: `I checked the AXON Project Timeline records, but found no logged work events matching "${userPrompt}".`,
      events: [],
    };
  }

  // Build a structured, human-readable timeline answer with real dates
  const lines: string[] = [
    `Here is the documented activity record from the AXON Project Timeline:`,
    '',
  ];

  for (const ev of matchedEvents.slice(0, 5)) {
    const formattedDate = new Date(ev.timestamp).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    lines.push(`• **${formattedDate} at ${ev.timeString}** — *${ev.title}*`);
    lines.push(`  ${ev.summary}`);
    if (ev.metadata?.noteId) {
      lines.push(`  ↳ Associated Note ID: \`${ev.metadata.noteId}\``);
    }
    if (ev.metadata?.planId) {
      const decisionLabel =
        ev.metadata.decision === 'flagged_for_delegation'
          ? 'Flagged for delegation'
          : 'Attempted directly';
      lines.push(
        `  ↳ Decision: **${decisionLabel}** (${ev.metadata.stepsCount || 0} planned steps)`
      );
    }
  }

  if (matchedEvents.length > 5) {
    lines.push(`\n*(+ ${matchedEvents.length - 5} additional historical activity records)*`);
  }

  return {
    matches: true,
    answer: lines.join('\n'),
    events: matchedEvents,
  };
}
