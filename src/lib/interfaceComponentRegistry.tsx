/**
 * Authoritative interface component registry for AXON.
 * Dynamically resolves interface components for both live rendering
 * and offscreen interface capture staging.
 *
 * Supports recursive staging of sub-tabs, drawers, and modal panels.
 */
import React from 'react';
import { DualPaneContainer } from '../components/DualPaneContainer';
import { ChatPane } from '../components/ChatPane';
import { WorkspacePane } from '../components/WorkspacePane';
import { ToolsMenuScreen } from '../screens/ToolsMenuScreen';
import { AxonCodeScreen } from '../screens/AxonCodeScreen';
import { CodebaseScreen } from '../screens/CodebaseScreen';
import { AutomationScreen } from '../screens/AutomationScreen';
import { VideoEditorScreen } from '../screens/VideoEditorScreen';
import { NotesScreen } from '../screens/NotesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { AccountScreen } from '../screens/AccountScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { TextToolsScreen } from '../screens/tools/TextToolsScreen';
import { CalculationToolsScreen } from '../screens/tools/CalculationToolsScreen';
import { ColorToolsScreen } from '../screens/tools/ColorToolsScreen';
import { ImageToolsScreen } from '../screens/tools/ImageToolsScreen';
import { FileConversionToolsScreen } from '../screens/tools/FileConversionToolsScreen';
import { StorageDiagnosticsScreen } from '../screens/StorageDiagnosticsScreen';
import { SpeechRateAnalysisScreen } from '../screens/tools/SpeechRateAnalysisScreen';
import { OfflineBibleScreen } from '../screens/tools/OfflineBibleScreen';
import { InterfaceCaptureScreen } from '../screens/tools/InterfaceCaptureScreen';
import { HamburgerMenu } from '../components/HamburgerMenu';
import { StorageOnboardingModal } from '../components/storage/StorageOnboardingModal';
import { ProjectSwitcherModal } from '../components/ProjectSwitcherModal';

// Wrapper components for modals/drawers when staged in isolation
const StagedNavigationMenu: React.FC = () => (
  <div className="relative w-[320px] h-[932px] bg-neutral-900 border-r border-neutral-800 flex flex-col overflow-hidden">
    <HamburgerMenu isOpen={true} onClose={() => {}} inline={true} />
  </div>
);

const StagedStorageOnboarding: React.FC = () => (
  <div className="relative w-[430px] min-h-[600px] bg-neutral-950 flex items-center justify-center p-4">
    <StorageOnboardingModal isOpen={true} onClose={() => {}} canDismiss={true} />
  </div>
);

const StagedProjectSwitcher: React.FC = () => (
  <div className="relative w-[430px] min-h-[600px] bg-neutral-950 flex items-center justify-center p-4">
    <ProjectSwitcherModal isOpen={true} onClose={() => {}} />
  </div>
);

// Internal dynamic component registry
const registry = new Map<string, React.ComponentType<any>>();

// Pre-populate with all core AXON screens and tools
registry.set('axon', DualPaneContainer);
registry.set('axon-chat', ChatPane);
registry.set('axon-workspace', WorkspacePane);
registry.set('tools', ToolsMenuScreen);

// AXON Code and Sub-views
registry.set('code', AxonCodeScreen);
registry.set('code-editor', (props: any) => <AxonCodeScreen initialTab="code" {...props} />);
registry.set('code-preview', (props: any) => <AxonCodeScreen initialTab="preview" {...props} />);
registry.set('codebase', CodebaseScreen);

// Automation and Sub-views
registry.set('automation', AutomationScreen);
registry.set('automation-rules', (props: any) => <AutomationScreen initialTab="rules" {...props} />);
registry.set('automation-simulator', (props: any) => <AutomationScreen initialTab="simulator" {...props} />);
registry.set('automation-rule-editor', (props: any) => <AutomationScreen initialModalOpen={true} {...props} />);

registry.set('video_editor', VideoEditorScreen);
registry.set('notes', NotesScreen);

// Settings and Sub-views
registry.set('settings', SettingsScreen);
registry.set('settings-ai', (props: any) => <SettingsScreen initialTab="ai" {...props} />);
registry.set('settings-appearance', (props: any) => <SettingsScreen initialTab="appearance" {...props} />);
registry.set('settings-system', (props: any) => <SettingsScreen initialTab="system" {...props} />);

registry.set('account', AccountScreen);
registry.set('notifications', NotificationsScreen);

// Storage and Sub-views
registry.set('storage', StorageDiagnosticsScreen);
registry.set('storage-manifest', (props: any) => <StorageDiagnosticsScreen initialTab="manifest" {...props} />);
registry.set('storage-categories', (props: any) => <StorageDiagnosticsScreen initialTab="categories" {...props} />);
registry.set('storage-packs', (props: any) => <StorageDiagnosticsScreen initialTab="packs" {...props} />);
registry.set('storage-budget-modal', (props: any) => <StorageDiagnosticsScreen initialModal="storage-budget" {...props} />);
registry.set('storage-trim-modal', (props: any) => <StorageDiagnosticsScreen initialModal="storage-trim" {...props} />);

// Sub-tools
registry.set('tool_text', TextToolsScreen);
registry.set('tool_text-counter', (props: any) => <TextToolsScreen initialTab="counter" {...props} />);
registry.set('tool_text-case', (props: any) => <TextToolsScreen initialTab="case" {...props} />);
registry.set('tool_text-fonts', (props: any) => <TextToolsScreen initialTab="fonts" {...props} />);
registry.set('tool_text-dedup', (props: any) => <TextToolsScreen initialTab="dedup" {...props} />);

registry.set('tool_calc', (props: any) => <CalculationToolsScreen initialTab="calc" {...props} />);
registry.set('tool_calc-calc', (props: any) => <CalculationToolsScreen initialTab="calc" {...props} />);

registry.set('tool_units', (props: any) => <CalculationToolsScreen initialTab="units" {...props} />);
registry.set('tool_units-units', (props: any) => <CalculationToolsScreen initialTab="units" {...props} />);

registry.set('tool_colors', ColorToolsScreen);
registry.set('tool_colors-picker', (props: any) => <ColorToolsScreen initialTab="picker" {...props} />);
registry.set('tool_colors-palette', (props: any) => <ColorToolsScreen initialTab="palette" {...props} />);

registry.set('tool_images', ImageToolsScreen);
registry.set('tool_images-convert', (props: any) => <ImageToolsScreen initialTab="convert" {...props} />);
registry.set('tool_images-compress', (props: any) => <ImageToolsScreen initialTab="compress" {...props} />);
registry.set('tool_images-blur', (props: any) => <ImageToolsScreen initialTab="blur" {...props} />);
registry.set('tool_images-collage', (props: any) => <ImageToolsScreen initialTab="collage" {...props} />);

registry.set('tool_files', FileConversionToolsScreen);
registry.set('tool_files-png2pdf', (props: any) => <FileConversionToolsScreen initialTab="png2pdf" {...props} />);
registry.set('tool_files-pdf2txt', (props: any) => <FileConversionToolsScreen initialTab="pdf2txt" {...props} />);
registry.set('tool_files-csvjson', (props: any) => <FileConversionToolsScreen initialTab="csvjson" {...props} />);
registry.set('tool_files-txt2pdf', (props: any) => <FileConversionToolsScreen initialTab="txt2pdf" {...props} />);

registry.set('tool_speech_rate', SpeechRateAnalysisScreen);
registry.set('tool_bible', OfflineBibleScreen);
registry.set('tool_interface_capture', InterfaceCaptureScreen);

// Overlay interfaces
registry.set('hamburger-drawer', StagedNavigationMenu);
registry.set('storage-onboarding-modal', StagedStorageOnboarding);
registry.set('project-switcher-modal', StagedProjectSwitcher);

/**
 * Register or update an interface component dynamically at runtime.
 * Any new tool, plugin, screen, or view added in the future can call this
 * to become immediately captureable and renderable.
 */
export function registerInterfaceComponent(
  routeOrId: string,
  component: React.ComponentType<any>
): void {
  registry.set(routeOrId, component);
}

/**
 * Unregisters an interface component.
 */
export function unregisterInterfaceComponent(routeOrId: string): void {
  registry.delete(routeOrId);
}

/**
 * Resolves the React component for a given interface route or ID.
 * Returns null if not registered.
 */
export function getInterfaceComponent(
  routeOrId: string
): React.ComponentType<any> | null {
  return registry.get(routeOrId) || null;
}

/**
 * Checks if a component is registered for a given interface route or ID.
 */
export function hasInterfaceComponent(routeOrId: string): boolean {
  return registry.has(routeOrId);
}

/**
 * Returns all registered interface routes/IDs.
 */
export function getAllRegisteredComponentKeys(): string[] {
  return Array.from(registry.keys());
}
