import { ScreenId } from '../types';
import {
  registerInterfaceComponent,
  unregisterInterfaceComponent,
  getInterfaceComponent,
  hasInterfaceComponent,
  getAllRegisteredComponentKeys,
} from './interfaceComponentRegistry';

export {
  registerInterfaceComponent,
  unregisterInterfaceComponent,
  getInterfaceComponent,
  hasInterfaceComponent,
  getAllRegisteredComponentKeys,
};

export type InterfaceCategory =
  | 'Core'
  | 'Tools'
  | 'Workspace'
  | 'Media'
  | 'System'
  | 'Utilities';

export type InterfaceLevel = 'root' | 'sub_tool' | 'tab' | 'panel' | 'modal';

export interface InterfaceMetadata {
  id: string;
  name: string;
  route: ScreenId | string;
  category: InterfaceCategory;
  level?: InterfaceLevel;
  parent?: string;
  childrenIds?: string[];
  subState?: Record<string, any>;
  description: string;
  isAvailable: boolean;
  isScrollable: boolean;
  requiresState?: string;
  preferredDimensions: {
    width: number;
    height: number;
  };
  keywords: string[];
}

/**
 * Authoritative registry of actual AXON interfaces discovered in codebase.
 * Strictly mirrors real screens, routes, tools, and views in a complete recursive hierarchy.
 */
export const AXON_INTERFACES: InterfaceMetadata[] = [
  // ==========================================
  // 1. CORE ROOT INTERFACES
  // ==========================================
  {
    id: 'axon',
    name: 'AXON Dual-Pane Workspace',
    route: 'axon',
    category: 'Core',
    level: 'root',
    childrenIds: ['axon-chat', 'axon-workspace'],
    description: 'Main dual-pane interactive chat conversation and workspace code runner',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['chat', 'conversation', 'axon', 'messages', 'home', 'main', 'assistant', 'dual pane'],
  },
  {
    id: 'axon-chat',
    name: 'AXON Chat Pane',
    route: 'axon',
    parent: 'axon',
    category: 'Core',
    level: 'tab',
    description: 'Primary conversational messaging list, quick actions, and prompt bar',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['chat pane', 'chat view', 'messages', 'prompt input', 'chat interface'],
  },
  {
    id: 'axon-workspace',
    name: 'AXON Workspace Pane',
    route: 'axon',
    parent: 'axon',
    category: 'Core',
    level: 'tab',
    description: 'Integrated secondary workspace for live scripts, logs, and preview',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['workspace pane', 'workspace view', 'live code', 'dual pane right'],
  },

  // ==========================================
  // 2. TOOLS SUITE ROOT
  // ==========================================
  {
    id: 'tools',
    name: 'Tools & Utilities',
    route: 'tools',
    category: 'Tools',
    level: 'root',
    childrenIds: [
      'tool_text',
      'tool_calc',
      'tool_units',
      'tool_colors',
      'tool_images',
      'tool_files',
      'tool_speech_rate',
      'tool_bible',
      'tool_interface_capture',
    ],
    description: 'Offline utility suites overview, category filter chips, and tool cards',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['tools', 'tools menu', 'utilities', 'tools and utilities', 'suite', 'offline tools'],
  },

  // ==========================================
  // 3. WORKSPACE & DEVELOPMENT INTERFACES
  // ==========================================
  {
    id: 'code',
    name: 'AXON Code',
    route: 'code',
    category: 'Workspace',
    level: 'root',
    childrenIds: ['code-editor', 'code-preview'],
    description: 'Interactive code editor, sandbox execution runner, and traceback debugger',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['code', 'axon code', 'workspace code', 'editor', 'sandbox', 'developer', 'script'],
  },
  {
    id: 'code-editor',
    name: 'AXON Code • Editor',
    route: 'code',
    parent: 'code',
    category: 'Workspace',
    level: 'tab',
    subState: { initialTab: 'code' },
    description: 'Direct code editing buffer, syntax selection, and execution triggers',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['code editor', 'editor tab', 'script editor', 'source code'],
  },
  {
    id: 'code-preview',
    name: 'AXON Code • Preview',
    route: 'code',
    parent: 'code',
    category: 'Workspace',
    level: 'tab',
    subState: { initialTab: 'preview' },
    description: 'Live HTML/DOM preview canvas and console log stream output',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['code preview', 'preview tab', 'html preview', 'output log'],
  },
  {
    id: 'codebase',
    name: 'AXON Source',
    route: 'codebase',
    category: 'Workspace',
    level: 'root',
    description: 'Read-only repository file tree, internal source code, and project exports',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: [
      'source',
      'axon source',
      'codebase',
      'source code',
      'repository',
      'file tree',
      'files tree',
      'internal source',
      'repo',
      'project files',
      'src',
    ],
  },

  {
    id: 'automation',
    name: 'Automation & Run Code',
    route: 'automation',
    category: 'Workspace',
    level: 'root',
    childrenIds: ['automation-rules', 'automation-simulator', 'automation-rule-editor'],
    description: 'Event-driven triggers, conditional rules engine, and live script layer',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['automation', 'run code', 'rules', 'triggers', 'scripts', 'automated'],
  },
  {
    id: 'automation-rules',
    name: 'Automation • Rules List',
    route: 'automation',
    parent: 'automation',
    category: 'Workspace',
    level: 'tab',
    subState: { initialTab: 'rules' },
    description: 'Configured trigger-action automation rules and toggle switches',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['automation rules', 'rules list', 'triggers list'],
  },
  {
    id: 'automation-simulator',
    name: 'Automation • Event Simulator',
    route: 'automation',
    parent: 'automation',
    category: 'Workspace',
    level: 'tab',
    subState: { initialTab: 'simulator' },
    description: 'Interactive test bench for simulating incoming system and user events',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['automation simulator', 'event simulator', 'trigger test bench'],
  },
  {
    id: 'automation-rule-editor',
    name: 'Automation • Rule Editor Modal',
    route: 'automation',
    parent: 'automation',
    category: 'Workspace',
    level: 'modal',
    subState: { initialModalOpen: true },
    description: 'Rule builder dialog for setting event types, conditions, and actions',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 750 },
    keywords: ['rule editor', 'create rule', 'edit rule modal', 'rule builder'],
  },

  {
    id: 'notes',
    name: 'Library & Notes',
    route: 'notes',
    category: 'Workspace',
    level: 'root',
    description: 'Context notes, chat extractions, project specifications, and library documentation',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['library', 'notes', 'docs', 'context notes', 'extracts', 'project memory'],
  },

  // ==========================================
  // 4. MEDIA INTERFACES
  // ==========================================
  {
    id: 'video_editor',
    name: 'Video Editor',
    route: 'video_editor',
    category: 'Media',
    level: 'root',
    description: 'Multi-track video timeline editor, synthesizer waveform, and media canvas',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['video', 'video editor', 'timeline', 'waveform', 'media', 'synthesizer'],
  },

  // ==========================================
  // 5. SYSTEM & DIAGNOSTICS INTERFACES
  // ==========================================
  {
    id: 'storage',
    name: 'Storage & Manifest',
    route: 'storage',
    category: 'System',
    level: 'root',
    childrenIds: [
      'storage-manifest',
      'storage-categories',
      'storage-packs',
      'storage-budget-modal',
      'storage-trim-modal',
    ],
    description: 'Storage diagnostics, device budget bar, asset manifest table, and trim optimizer',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['storage', 'manifest', 'asset manifest', 'budget', 'diagnostics', 'trim', 'disk'],
  },
  {
    id: 'storage-manifest',
    name: 'Storage • Asset Manifest',
    route: 'storage',
    parent: 'storage',
    category: 'System',
    level: 'tab',
    subState: { initialTab: 'manifest' },
    description: 'Indexed table of registered local assets, sizes, and integrity status',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['manifest tab', 'asset table', 'storage manifest'],
  },
  {
    id: 'storage-categories',
    name: 'Storage • Category Breakdown',
    route: 'storage',
    parent: 'storage',
    category: 'System',
    level: 'tab',
    subState: { initialTab: 'categories' },
    description: 'Visual category distribution chart and storage breakdown',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['storage breakdown', 'categories chart', 'storage allocation'],
  },
  {
    id: 'storage-packs',
    name: 'Storage • Knowledge Packs',
    route: 'storage',
    parent: 'storage',
    category: 'System',
    level: 'tab',
    subState: { initialTab: 'packs' },
    description: 'Pre-bundled offline knowledge packs and documentation modules',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['knowledge packs', 'download packs', 'offline bundles'],
  },
  {
    id: 'storage-budget-modal',
    name: 'Storage • Device Budget Modal',
    route: 'storage',
    parent: 'storage',
    category: 'System',
    level: 'modal',
    subState: { initialModal: 'storage-budget' },
    description: 'Device storage limit setting and warning threshold configuration',
    isAvailable: true,
    isScrollable: false,
    preferredDimensions: { width: 430, height: 600 },
    keywords: ['storage budget modal', 'storage limit', 'budget settings'],
  },
  {
    id: 'storage-trim-modal',
    name: 'Storage • Trim Optimizer Modal',
    route: 'storage',
    parent: 'storage',
    category: 'System',
    level: 'modal',
    subState: { initialModal: 'storage-trim' },
    description: 'Automatic purge and stale asset cleanup dialog',
    isAvailable: true,
    isScrollable: false,
    preferredDimensions: { width: 430, height: 600 },
    keywords: ['trim modal', 'storage trim', 'purge optimizer'],
  },

  {
    id: 'settings',
    name: 'Settings',
    route: 'settings',
    category: 'System',
    level: 'root',
    childrenIds: ['settings-ai', 'settings-appearance', 'settings-system'],
    description: 'Appearance theme switcher, custom accent colors, icon presets, and preferences',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['settings', 'preferences', 'theme', 'dark mode', 'accent color', 'config'],
  },
  {
    id: 'settings-ai',
    name: 'Settings • AI Accounts',
    route: 'settings',
    parent: 'settings',
    category: 'System',
    level: 'tab',
    subState: { initialTab: 'ai' },
    description: 'Model selection, provider keys, and intelligence parameters',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['settings ai', 'ai config', 'model parameters'],
  },
  {
    id: 'settings-appearance',
    name: 'Settings • Appearance & Themes',
    route: 'settings',
    parent: 'settings',
    category: 'System',
    level: 'tab',
    subState: { initialTab: 'appearance' },
    description: 'Visual customization, theme presets, contrast checker, and typography',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['settings appearance', 'themes', 'accent colors', 'app icons'],
  },
  {
    id: 'settings-system',
    name: 'Settings • System & Data',
    route: 'settings',
    parent: 'settings',
    category: 'System',
    level: 'tab',
    subState: { initialTab: 'system' },
    description: 'State export/import, factory reset, and memory persistence preferences',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['settings system', 'backup data', 'export json', 'reset'],
  },

  {
    id: 'account',
    name: 'AI Accounts',
    route: 'account',
    category: 'System',
    level: 'root',
    description: 'AI model provider credentials, API key settings, and cooldown monitors',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['account', 'ai accounts', 'api keys', 'credentials', 'gemini account', 'providers'],
  },
  {
    id: 'notifications',
    name: 'Notifications',
    route: 'notifications',
    category: 'System',
    level: 'root',
    description: 'System event log, timeline activity alerts, and storage warnings',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['notifications', 'alerts', 'activity', 'system log', 'events'],
  },

  // ==========================================
  // 6. TOOLS & UTILITIES SUB-SCREENS
  // ==========================================
  {
    id: 'tool_text',
    name: 'Text Tools',
    route: 'tool_text',
    parent: 'tools',
    category: 'Utilities',
    level: 'sub_tool',
    childrenIds: ['tool_text-counter', 'tool_text-case', 'tool_text-fonts', 'tool_text-dedup'],
    description: 'Word & character counter, decorative fonts, line deduplicator, and case formatting',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['text', 'text tools', 'word counter', 'case converter', 'typography'],
  },
  {
    id: 'tool_text-counter',
    name: 'Text Tools • Word Counter',
    route: 'tool_text',
    parent: 'tool_text',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'counter' },
    description: 'Character, word, line, paragraph, and reading-time counter metrics',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['word counter', 'character count', 'reading time'],
  },
  {
    id: 'tool_text-case',
    name: 'Text Tools • Case Converter',
    route: 'tool_text',
    parent: 'tool_text',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'case' },
    description: 'Uppercase, lowercase, titlecase, camelCase, kebab-case transformations',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['case converter', 'camelCase', 'uppercase', 'lowercase'],
  },
  {
    id: 'tool_text-fonts',
    name: 'Text Tools • Decorative Fonts',
    route: 'tool_text',
    parent: 'tool_text',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'fonts' },
    description: 'Unicode decorative typography, script styles, and monospace transforms',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['decorative fonts', 'unicode styles', 'fancy fonts'],
  },
  {
    id: 'tool_text-dedup',
    name: 'Text Tools • Line Deduplicator',
    route: 'tool_text',
    parent: 'tool_text',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'dedup' },
    description: 'Fast line deduplication, whitespace trimming, and list cleanup',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['dedup', 'line deduplicator', 'remove duplicate lines'],
  },

  {
    id: 'tool_calc',
    name: 'Calculation & Keypad',
    route: 'tool_calc',
    parent: 'tools',
    category: 'Utilities',
    level: 'sub_tool',
    childrenIds: ['tool_calc-calc'],
    description: 'Pocket calculator with tape memory, arithmetic history, and keypad input',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['calc', 'calculator', 'keypad', 'arithmetic', 'math tool'],
  },
  {
    id: 'tool_calc-calc',
    name: 'Calculation • Keypad View',
    route: 'tool_calc',
    parent: 'tool_calc',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'calc' },
    description: 'Interactive calculator display and arithmetic button grid',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['calculator keypad', 'arithmetic calculator'],
  },

  {
    id: 'tool_units',
    name: 'Unit Converters',
    route: 'tool_units',
    parent: 'tools',
    category: 'Utilities',
    level: 'sub_tool',
    childrenIds: ['tool_units-units'],
    description: 'Length, weight, temperature, and speed mobile unit conversions',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['units', 'unit converter', 'conversion', 'measurement', 'length', 'weight'],
  },
  {
    id: 'tool_units-units',
    name: 'Units • Converter Grid',
    route: 'tool_units',
    parent: 'tool_units',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'units' },
    description: 'Instant unit transformation sliders and numeric inputs',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['unit conversion view', 'length weight temp'],
  },

  {
    id: 'tool_colors',
    name: 'Color Tools',
    route: 'tool_colors',
    parent: 'tools',
    category: 'Utilities',
    level: 'sub_tool',
    childrenIds: ['tool_colors-picker', 'tool_colors-palette'],
    description: 'Interactive spectrum picker, HEX/RGB/HSL inspector, and harmonic palette generator',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['color', 'color tools', 'palette', 'hex', 'rgb', 'picker', 'spectrum'],
  },
  {
    id: 'tool_colors-picker',
    name: 'Color Tools • Spectrum Picker',
    route: 'tool_colors',
    parent: 'tool_colors',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'picker' },
    description: 'Interactive color wheel, sliders, and format copy buttons',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['color picker', 'spectrum picker', 'hex picker'],
  },
  {
    id: 'tool_colors-palette',
    name: 'Color Tools • Harmonic Palettes',
    route: 'tool_colors',
    parent: 'tool_colors',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'palette' },
    description: 'Harmonic color generator, complementary, triadic, and saved palettes',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['harmonic palettes', 'palette generator', 'color harmony'],
  },

  {
    id: 'tool_images',
    name: 'Image Utilities',
    route: 'tool_images',
    parent: 'tools',
    category: 'Utilities',
    level: 'sub_tool',
    childrenIds: [
      'tool_images-convert',
      'tool_images-compress',
      'tool_images-blur',
      'tool_images-collage',
    ],
    description: 'Format converter (PNG/JPG/WEBP), compressor, privacy blur, and collage grid combiner',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['image', 'image tools', 'image utilities', 'compressor', 'collage', 'blur filter'],
  },
  {
    id: 'tool_images-convert',
    name: 'Image Tools • Format Converter',
    route: 'tool_images',
    parent: 'tool_images',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'convert' },
    description: 'Client-side image format transformation (PNG, JPEG, WebP)',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['image converter', 'png to jpg', 'webp converter'],
  },
  {
    id: 'tool_images-compress',
    name: 'Image Tools • Compressor',
    route: 'tool_images',
    parent: 'tool_images',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'compress' },
    description: 'Resolution scaling and quality reduction optimization',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['image compressor', 'reduce file size', 'shrink image'],
  },
  {
    id: 'tool_images-blur',
    name: 'Image Tools • Privacy Blur',
    route: 'tool_images',
    parent: 'tool_images',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'blur' },
    description: 'Sensitive information masking and regional privacy blur filter',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['privacy blur', 'blur image', 'pixelate face'],
  },
  {
    id: 'tool_images-collage',
    name: 'Image Tools • Collage Grid',
    route: 'tool_images',
    parent: 'tool_images',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'collage' },
    description: 'Multi-image grid alignment and border layout assembler',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['image collage', 'grid maker', 'combine images'],
  },

  {
    id: 'tool_files',
    name: 'File Conversions',
    route: 'tool_files',
    parent: 'tools',
    category: 'Utilities',
    level: 'sub_tool',
    childrenIds: [
      'tool_files-png2pdf',
      'tool_files-pdf2txt',
      'tool_files-csvjson',
      'tool_files-txt2pdf',
    ],
    description: 'Image to PDF, PDF to text extractor, CSV ⇄ JSON formatter, and note exporter',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['file', 'file conversions', 'pdf converter', 'csv', 'json', 'pdf to text'],
  },
  {
    id: 'tool_files-png2pdf',
    name: 'Files • Image to PDF',
    route: 'tool_files',
    parent: 'tool_files',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'png2pdf' },
    description: 'Compile single or multiple PNG/JPEG images into formatted PDF documents',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['png to pdf', 'image to pdf converter'],
  },
  {
    id: 'tool_files-pdf2txt',
    name: 'Files • PDF to Text',
    route: 'tool_files',
    parent: 'tool_files',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'pdf2txt' },
    description: 'Extract raw textual contents from local PDF documents',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['pdf to text', 'extract text from pdf'],
  },
  {
    id: 'tool_files-csvjson',
    name: 'Files • CSV ⇄ JSON',
    route: 'tool_files',
    parent: 'tool_files',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'csvjson' },
    description: 'Bidirectional tabular CSV and structured JSON converter',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['csv to json', 'json to csv', 'tabular converter'],
  },
  {
    id: 'tool_files-txt2pdf',
    name: 'Files • Text to PDF',
    route: 'tool_files',
    parent: 'tool_files',
    category: 'Utilities',
    level: 'tab',
    subState: { initialTab: 'txt2pdf' },
    description: 'Format raw markdown and plain text notes into styled PDF documents',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['txt to pdf', 'text to pdf document'],
  },

  {
    id: 'tool_speech_rate',
    name: 'Speech-Rate Analysis',
    route: 'tool_speech_rate',
    parent: 'tools',
    category: 'Utilities',
    level: 'sub_tool',
    description: 'Acoustic cadence meter, WPM benchmark, and speech syllables velocity tracker',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['speech', 'speech rate', 'wpm', 'cadence', 'acoustic', 'voice analyzer'],
  },
  {
    id: 'tool_bible',
    name: 'Offline Bible & Scriptures',
    route: 'tool_bible',
    parent: 'tools',
    category: 'Utilities',
    level: 'sub_tool',
    description: 'Local canonical scripture reader, instant concordance search, and verse bookmarks',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['bible', 'scriptures', 'offline bible', 'verses', 'concordance', 'reading'],
  },
  {
    id: 'tool_interface_capture',
    name: 'Interface Capture',
    route: 'tool_interface_capture',
    parent: 'tools',
    category: 'Utilities',
    level: 'sub_tool',
    description: 'Recursive background DOM capture engine, long full-page stitching, and multi-page PDF exporter',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: ['capture', 'interface capture', 'screenshot', 'export ui', 'pdf export', 'ui capture'],
  },

  // ==========================================
  // 7. SYSTEM OVERLAYS & MODALS
  // ==========================================
  {
    id: 'hamburger-drawer',
    name: 'Navigation Menu',
    route: 'hamburger-drawer',
    category: 'System',
    level: 'modal',
    description: 'Slide-out navigation drawer with interface links and system stats',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 320, height: 932 },
    keywords: ['hamburger', 'menu', 'drawer', 'navigation', 'nav menu'],
  },
  {
    id: 'project-switcher-modal',
    name: 'Project Switcher',
    route: 'project-switcher-modal',
    category: 'System',
    level: 'modal',
    description: 'Active project selector and workspace switcher modal',
    isAvailable: true,
    isScrollable: false,
    preferredDimensions: { width: 430, height: 600 },
    keywords: ['project', 'switcher', 'modal', 'switch project'],
  },
  {
    id: 'storage-onboarding-modal',
    name: 'Storage Onboarding',
    route: 'storage-onboarding-modal',
    category: 'System',
    level: 'modal',
    description: 'Initial storage configuration and device capacity setup dialog',
    isAvailable: true,
    isScrollable: false,
    preferredDimensions: { width: 430, height: 600 },
    keywords: ['storage', 'onboarding', 'modal', 'setup'],
  },
];

// Dynamic interface store for runtime discovery and future screens
const dynamicInterfacesMap = new Map<string, InterfaceMetadata>();

/**
 * Registers an interface dynamically at runtime.
 */
export function registerInterface(item: InterfaceMetadata): void {
  dynamicInterfacesMap.set(item.id, item);
}

/**
 * Registers both interface metadata and its component dynamically in one call.
 * Ensures any newly introduced screen, tool, dialog, or view becomes immediately discoverable and captureable.
 */
export function registerDynamicInterface(
  meta: InterfaceMetadata,
  component?: React.ComponentType<any>
): void {
  dynamicInterfacesMap.set(meta.id, meta);
  if (component) {
    registerInterfaceComponent(meta.id, component);
    if (meta.route && meta.route !== meta.id) {
      registerInterfaceComponent(meta.route, component);
    }
  }
}

/**
 * Unregisters a dynamically added interface.
 */
export function unregisterInterface(id: string): void {
  dynamicInterfacesMap.delete(id);
}

/**
 * Discovers all available interfaces in AXON, guaranteed to be deduplicated.
 * Dynamically queries both static registrations and runtime component registries.
 */
export function discoverAvailableInterfaces(options?: {
  rootOnly?: boolean;
}): InterfaceMetadata[] {
  const map = new Map<string, InterfaceMetadata>();

  // 1. Authoritative base interfaces
  for (const item of AXON_INTERFACES) {
    if (options?.rootOnly && item.level && item.level !== 'root' && item.level !== 'sub_tool') {
      continue;
    }
    map.set(item.id, item);
  }

  // 2. Dynamically registered interfaces
  for (const [id, item] of dynamicInterfacesMap.entries()) {
    if (options?.rootOnly && item.level && item.level !== 'root' && item.level !== 'sub_tool') {
      continue;
    }
    map.set(id, item);
  }

  // 3. Dynamically discover any newly registered components in interfaceComponentRegistry
  try {
    const allCompKeys = getAllRegisteredComponentKeys();
    for (const key of allCompKeys) {
      if (!map.has(key)) {
        const formattedName = key
          .split(/[-_]/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

        const isTool = key.startsWith('tool_') || key.includes('tool');
        const isModal = key.includes('modal') || key.includes('drawer');
        const cat: InterfaceCategory = isTool ? 'Tools' : isModal ? 'System' : 'Workspace';

        map.set(key, {
          id: key,
          name: formattedName.startsWith('AXON') ? formattedName : `AXON • ${formattedName}`,
          route: key,
          category: cat,
          level: isModal ? 'modal' : isTool ? 'sub_tool' : 'root',
          description: `Dynamically discovered AXON interface (${key})`,
          isAvailable: true,
          isScrollable: true,
          preferredDimensions: { width: 430, height: 932 },
          keywords: [key.replace(/[-_]/g, ' ')],
        });
      }
    }
  } catch {
    // Graceful fallback if component registry is not yet initialized
  }

  return Array.from(map.values());
}

/**
 * Returns all top-level root interfaces (main screens and primary utility sub-tools).
 */
export function getTopLevelInterfaces(): InterfaceMetadata[] {
  return discoverAvailableInterfaces({ rootOnly: true });
}

/**
 * Returns child interfaces for a given parent interface ID.
 */
export function getChildInterfaces(parentId: string): InterfaceMetadata[] {
  const all = discoverAvailableInterfaces();
  return all.filter((item) => item.parent === parentId);
}

/**
 * Returns all available interfaces (both root and nested) in deterministic order.
 */
export function getAllInterfaces(options?: { rootOnly?: boolean }): InterfaceMetadata[] {
  return discoverAvailableInterfaces(options);
}

/**
 * Retrieves a specific interface by ID or Route.
 */
export function getInterfaceById(idOrRoute: string): InterfaceMetadata | undefined {
  const all = discoverAvailableInterfaces();
  return all.find((item) => item.id === idOrRoute || item.route === idOrRoute);
}

export interface InterfaceQueryResolution {
  match?: InterfaceMetadata;
  isExact?: boolean;
  isInferred?: boolean;
  isAll?: boolean;
  isCurrent?: boolean;
  isLongImage?: boolean;
  isPdf?: boolean;
  isAmbiguous?: boolean;
  candidates?: InterfaceMetadata[];
  unrecognizedName?: string;
  confidenceScore?: number;
}

/**
 * Resolves a natural language query against registered interfaces.
 * Uses a robust 6-tier ranking strategy:
 * 1. Exact interface ID, route, or full name
 * 2. Exact unique keyword / alias
 * 3. Highly specific multi-word match
 * 4. Strong unique partial / prefix match on distinctive words
 * 5. Meaningful token match
 * 6. Weak fuzzy match
 * Generic parent containers (e.g. 'AXON Dual-Pane Workspace') do NOT
 * outrank specific destinations merely because they share the generic token 'axon'.
 */
export function resolveInterfaceFromQuery(query: string, currentScreen?: ScreenId): InterfaceQueryResolution {
  const normalized = query.trim().toLowerCase();
  const interfaces = discoverAvailableInterfaces();

  // Check for "All interfaces" intent
  if (
    normalized.includes('all interfaces') ||
    normalized.includes('every interface') ||
    normalized.includes('all of axon') ||
    normalized.includes('all screens') ||
    normalized.includes('every screen') ||
    normalized.includes('whole app')
  ) {
    return {
      isAll: true,
      isLongImage: normalized.includes('long image') || normalized.includes('one long image') || normalized.includes('stitch'),
      isPdf: normalized.includes('pdf') || normalized.includes('document'),
    };
  }

  // Check for "Current interface" intent
  if (
    normalized.includes('current interface') ||
    normalized.includes('this interface') ||
    normalized.includes('current screen') ||
    normalized.includes('this screen') ||
    normalized.includes('where i am') ||
    normalized.includes('what i am looking at')
  ) {
    const currentMeta = currentScreen ? getInterfaceById(currentScreen) : interfaces[0];
    return {
      isCurrent: true,
      match: currentMeta,
      isExact: true,
      isLongImage: normalized.includes('long image'),
      isPdf: normalized.includes('pdf'),
    };
  }

  // Tier 1: Exact ID or route match
  const exactIdOrRoute = interfaces.find(
    (item) => item.id.toLowerCase() === normalized || item.route.toLowerCase() === normalized
  );
  if (exactIdOrRoute) {
    return {
      match: exactIdOrRoute,
      isExact: true,
      isLongImage: normalized.includes('long image'),
      isPdf: normalized.includes('pdf'),
    };
  }

  // Tier 1: Exact Name match (case-insensitive)
  const exactName = interfaces.find(
    (item) => item.name.toLowerCase() === normalized
  );
  if (exactName) {
    return {
      match: exactName,
      isExact: true,
      isLongImage: normalized.includes('long image'),
      isPdf: normalized.includes('pdf'),
    };
  }

  // Tier 1.5: Exact Name without generic "AXON " prefix
  // e.g. query "source" matches "AXON Source", "code" matches "AXON Code", "workspace" matches "AXON Workspace Pane"
  const exactWithoutAxon = interfaces.filter(
    (item) => item.name.toLowerCase().replace(/^axon\s+/i, '').trim() === normalized
  );
  if (exactWithoutAxon.length === 1) {
    return {
      match: exactWithoutAxon[0],
      isExact: true,
      isLongImage: normalized.includes('long image'),
      isPdf: normalized.includes('pdf'),
    };
  }

  // Extract query tokens and separate distinctive tokens from generic tokens
  const GENERIC_TOKENS = new Set(['axon', 'the', 'a', 'an', 'screen', 'interface', 'view', 'pane', 'page', 'app']);
  const queryTokens = normalized
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const distinctiveQueryTokens = queryTokens.filter((t) => !GENERIC_TOKENS.has(t));

  // Score matches based on multi-tier semantic specificity
  const scores: Array<{ item: InterfaceMetadata; score: number; isExactMatch?: boolean; isPrefixMatch?: boolean }> = [];

  for (const item of interfaces) {
    const itemName = item.name.toLowerCase();
    const cleanItemName = itemName.replace(/^axon\s+/i, '').trim();
    const nameTokens = itemName
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const distinctiveNameTokens = nameTokens.filter((t) => !GENERIC_TOKENS.has(t));

    let score = 0;
    let isExactMatch = false;
    let isPrefixMatch = false;

    // Check if item has any match on distinctive query tokens
    let matchedDistinctiveCount = 0;
    for (const qToken of distinctiveQueryTokens) {
      const matchesName = distinctiveNameTokens.some((nt) => nt === qToken);
      const prefixesName = qToken.length >= 2 && distinctiveNameTokens.some((nt) => nt.startsWith(qToken));
      const matchesKeyword = item.keywords.some((kw) => {
        const kwLower = kw.toLowerCase();
        const kwTokens = kwLower.split(/\s+/);
        return kwTokens.includes(qToken) || (qToken.length >= 2 && kwTokens.some((kt) => kt.startsWith(qToken)));
      });

      if (matchesName) {
        matchedDistinctiveCount++;
        score += 2500;
      } else if (prefixesName) {
        matchedDistinctiveCount++;
        score += 2000 + qToken.length * 100;
        isPrefixMatch = true;
      } else if (matchesKeyword) {
        matchedDistinctiveCount++;
        score += 800;
      }
    }

    // Crucial rule: If the user provided distinctive tokens (e.g. 'source', 'sou', 'collage', 'tools'),
    // an interface that matched NONE of them (e.g. generic 'axon' workspace) must NOT qualify!
    if (distinctiveQueryTokens.length > 0 && matchedDistinctiveCount === 0) {
      continue;
    }

    // Tier 2: Exact keyword match
    for (const kw of item.keywords) {
      const kwLower = kw.toLowerCase().trim();
      const cleanKw = kwLower.replace(/^axon\s+/i, '').trim();
      if (normalized === kwLower) {
        score += 5000 + kwLower.length * 20;
        isExactMatch = true;
      } else if (normalized === cleanKw) {
        score += 4500 + cleanKw.length * 20;
        isExactMatch = true;
      } else if (distinctiveQueryTokens.length > 0 && distinctiveQueryTokens.join(' ') === cleanKw) {
        score += 4000;
        isExactMatch = true;
      }
    }

    // Tier 3: All distinctive tokens match
    if (distinctiveQueryTokens.length > 0 && matchedDistinctiveCount === distinctiveQueryTokens.length) {
      score += 3000 + distinctiveQueryTokens.length * 500;
    }

    // Phrase containment on clean name
    if (normalized.includes(cleanItemName) && cleanItemName.length > 3) {
      score += 2500;
    } else if (cleanItemName.includes(normalized) && normalized.length > 2) {
      score += 1800;
      if (cleanItemName.startsWith(normalized)) {
        score += 500;
        isPrefixMatch = true;
      }
    }

    // Generic token contribution (tiny, only relevant if distinctive tokens also matched or if query is purely generic)
    if (queryTokens.some((t) => t === 'axon') && nameTokens.includes('axon')) {
      score += 50;
    }

    // Favor root and sub_tool destinations over deeply nested internal modals unless specifically queried
    if (item.level === 'root') {
      score += 200;
    } else if (item.level === 'sub_tool') {
      score += 150;
    }

    // Sub-tool specific keyword bonus (e.g. 'collage' for Image Tools • Collage Grid)
    if (item.subState && distinctiveQueryTokens.some((t) => itemName.includes(t))) {
      score += 250;
    }

    if (score > 0) {
      scores.push({ item, score, isExactMatch, isPrefixMatch });
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  if (scores.length === 0) {
    // Check if it looks like a capture or navigation attempt with unrecognized name
    const capturedNameMatch = normalized.match(/(?:capture|show\s+me|image\s+of|open)\s+(?:the\s+)?([^.?!,]+)/i);
    const candidateName = capturedNameMatch ? capturedNameMatch[1].trim() : normalized;
    return {
      isAmbiguous: true,
      candidates: interfaces.filter((i) => i.level === 'root').slice(0, 5),
      unrecognizedName: candidateName,
    };
  }

  const top = scores[0];
  const second = scores[1];

  // If top candidate is exact or decisively dominant
  const isDominant = !second || top.score >= second.score * 1.6 || top.score - second.score >= 1500;

  if (isDominant) {
    // If it was an exact match on name, clean name, or keyword
    const isExact = Boolean(top.isExactMatch);
    const isInferred = !isExact;

    return {
      match: top.item,
      isExact,
      isInferred,
      confidenceScore: top.score,
      isLongImage: normalized.includes('long image'),
      isPdf: normalized.includes('pdf'),
    };
  }

  // Multiple plausible matches with comparable scores
  const plausibleCandidates = scores
    .filter((s) => s.score >= top.score * 0.7)
    .slice(0, 4)
    .map((s) => s.item);

  return {
    isAmbiguous: true,
    candidates: plausibleCandidates,
    isLongImage: normalized.includes('long image'),
    isPdf: normalized.includes('pdf'),
  };
}

/**
 * Generates a clean, sanitized, standard filename for an interface capture.
 * Example: AXON_Settings.png, AXON_All_Interfaces.png, AXON_Interface_Documentation.pdf
 */
export function getSafeInterfaceFileName(
  interfaceName: string,
  format: 'png' | 'jpg' | 'pdf' = 'png',
  isLongImage: boolean = false
): string {
  if (interfaceName.toLowerCase().includes('all') && isLongImage) {
    return `AXON_All_Interfaces.${format}`;
  }
  if (format === 'pdf') {
    return `AXON_Interface_Documentation.pdf`;
  }

  const clean = interfaceName
    .trim()
    .replace(/[•&]/g, '_')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');

  const base = clean.startsWith('AXON_') ? clean : `AXON_${clean}`;
  return `${base}.${format}`;
}
