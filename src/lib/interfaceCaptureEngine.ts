import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { ScreenId } from '../types';
import {
  AXON_INTERFACES,
  InterfaceMetadata,
  getInterfaceById,
  getSafeInterfaceFileName,
  discoverAvailableInterfaces,
} from './interfaceRegistry';
import { sanitizeClonedTreeForCapture, wrapWindowGetComputedStyle } from './colorConverter';
import {
  captureMetrics,
  InterfacePerformanceLog,
  BatchCaptureMetrics,
} from './interfaceCaptureMetrics';

export type { InterfacePerformanceLog, BatchCaptureMetrics };

export interface GeneratedResultFile {
  id: string;
  interfaceName: string;
  category: string;
  route: string;
  status: 'success' | 'failed';
  errorMessage?: string;
  fileName: string;
  fileFormat: 'PNG' | 'JPG' | 'PDF';
  fileType: string;
  fileSize: string;
  dimensions?: string;
  dataUrl?: string;
  capturedAt: string;
}

export interface CapturedInterfaceResult {
  id: string;
  name: string;
  category: string;
  route: ScreenId | string;
  canvas: HTMLCanvasElement;
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  formattedSize: string;
  capturedAt: string;
  format: 'png' | 'jpeg';
  isSuccess: boolean;
  error?: string;
  panelResults?: CapturedInterfaceResult[];
}

export interface CaptureEngineOptions {
  scale?: number;
  fullHeight?: boolean;
  format?: 'png' | 'jpeg';
  quality?: number;
  includePanels?: boolean;
  recursive?: boolean;
  concurrency?: number;
  forceRefresh?: boolean;
  priority?: number;
  onProgress?: (progress: { current: number; total: number; interfaceName: string; percent: number }) => void;
  onResult?: (result: CapturedInterfaceResult, completedCount: number, totalCount: number) => void;
}

export interface MultiCaptureReport {
  results: CapturedInterfaceResult[];
  successfulCount: number;
  failedCount: number;
  skippedCount?: number;
  failures: Array<{ name: string; route: string; error: string }>;
  totalDurationMs: number;
  metrics?: BatchCaptureMetrics;
  combinedLongImage?: {
    canvas: HTMLCanvasElement;
    dataUrl: string;
    width: number;
    height: number;
    filename: string;
  };
  pdfDocument?: {
    blob: Blob;
    dataUrl: string;
    filename: string;
  };
}

// Stage controller types for offscreen rendering
export interface StageHandle {
  element: HTMLElement;
  slotId?: number;
  release: () => void;
}

export type StageRenderRequester = (
  route: ScreenId | string,
  isFull: boolean,
  interfaceId?: string,
  priority?: number
) => Promise<HTMLElement | StageHandle | null>;

let globalStageRequester: StageRenderRequester | null = null;

export function registerOffscreenStageRequester(requester: StageRenderRequester | null): void {
  globalStageRequester = requester;
}

/**
 * Ensures the offscreen stage requester is available and mounted before background staging.
 */
export async function waitForStageRequester(timeoutMs = 1500): Promise<StageRenderRequester | null> {
  if (globalStageRequester) return globalStageRequester;
  const start = Date.now();
  while (!globalStageRequester && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 30));
  }
  return globalStageRequester;
}

/**
 * Calculates optimal capture worker concurrency dynamically based on hardware resources.
 * Requirement 3: Adapts to CPU cores and available device memory.
 */
export function getOptimalConcurrency(): number {
  if (typeof navigator === 'undefined') return 4;
  const cores = navigator.hardwareConcurrency || 4;
  const memoryGb = (navigator as any).deviceMemory || 4;

  if (cores <= 2 || memoryGb <= 2) {
    return 2;
  }
  if (cores >= 8 && memoryGb >= 6) {
    return 6;
  }
  if (cores >= 6) {
    return 5;
  }
  return 4;
}

/**
 * In-memory cache for captured interface results.
 * Requirement 14: Change detection / avoid unnecessary recapture.
 */
interface CacheRecord {
  key: string;
  results: CapturedInterfaceResult[];
  timestamp: number;
}

const captureCache = new Map<string, CacheRecord>();

export function getCachedInterfaceResults(
  interfaceId: string,
  optionsKey: string
): CapturedInterfaceResult[] | null {
  const entry = captureCache.get(`${interfaceId}::${optionsKey}`);
  if (!entry) return null;
  return entry.results;
}

export function setCachedInterfaceResults(
  interfaceId: string,
  optionsKey: string,
  results: CapturedInterfaceResult[]
): void {
  captureCache.set(`${interfaceId}::${optionsKey}`, {
    key: `${interfaceId}::${optionsKey}`,
    results,
    timestamp: Date.now(),
  });
}

export function clearCaptureCache(): void {
  captureCache.clear();
}

/**
 * Formats byte size into human readable string.
 */
function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Smart readiness detection: waits only until critical content, layout, and images are settled.
 * Requirement 8: Smallest safe readiness timeout, avoids arbitrary 5-10s delays.
 */
export async function waitForElementReady(element: HTMLElement, maxWaitMs = 600): Promise<void> {
  const startTime = Date.now();

  const isReady = () => {
    if (!element.isConnected) return false;
    if (element.offsetWidth <= 0 && element.offsetHeight <= 0) return false;
    if (element.childElementCount === 0 && (!element.textContent || element.textContent.trim().length === 0)) {
      return false;
    }
    const images = Array.from(element.querySelectorAll<HTMLImageElement>('img'));
    const pendingImages = images.filter((img) => !img.complete && img.src);
    return pendingImages.length === 0;
  };

  if (isReady()) {
    await new Promise((r) => requestAnimationFrame(r));
    return;
  }

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 25));
    if (isReady()) {
      await new Promise((r) => requestAnimationFrame(r));
      return;
    }
  }

  await new Promise((r) => requestAnimationFrame(r));
}

/**
 * Captures an HTMLElement using html2canvas with retina scaling and crisp typography rendering.
 * Optimized with imageTimeout to eliminate 15s hangs and injects zero-animation styles into clone.
 */
export async function captureDomElement(
  element: HTMLElement,
  options: {
    scale?: number;
    fullHeight?: boolean;
    format?: 'png' | 'jpeg';
    quality?: number;
    windowWidth?: number;
  } = {}
): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? 2;
  const isFull = options.fullHeight ?? false;

  // If full interface is requested, locate scrollable child and expand height temporarily
  let restoreStyles: (() => void) | null = null;
  if (isFull) {
    const scrollContainer =
      (element.querySelector('.overflow-y-auto, [id$="-screen"]') as HTMLElement) ||
      (element.scrollHeight > element.clientHeight ? element : null);

    if (scrollContainer) {
      const prevOverflow = scrollContainer.style.overflow;
      const prevHeight = scrollContainer.style.height;
      const prevMaxHeight = scrollContainer.style.maxHeight;

      scrollContainer.style.overflow = 'visible';
      scrollContainer.style.height = 'auto';
      scrollContainer.style.maxHeight = 'none';

      restoreStyles = () => {
        scrollContainer.style.overflow = prevOverflow;
        scrollContainer.style.height = prevHeight;
        scrollContainer.style.maxHeight = prevMaxHeight;
      };
    }
  }

  try {
    // Smart readiness check
    await waitForElementReady(element, 400);

    let unwrapGlobal: (() => void) | null = null;
    let unwrapCloned: (() => void) | null = null;
    if (typeof window !== 'undefined') {
      unwrapGlobal = wrapWindowGetComputedStyle(window);
    }

    try {
      const canvas = await html2canvas(element, {
        scale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#000000',
        logging: false,
        imageTimeout: 2500, // Eliminates 15s default hang on broken/slow images
        scrollX: 0,
        scrollY: 0,
        windowWidth: options.windowWidth || element.scrollWidth || 430,
        windowHeight: isFull ? Math.max(element.scrollHeight, 800) : element.clientHeight || 932,
        ignoreElements: (el) => {
          return el.tagName === 'IFRAME';
        },
        onclone: (clonedDoc, clonedElement) => {
          // Requirement 7: Temporarily eliminate animations/transitions in cloned document
          const killAnimationsStyle = clonedDoc.createElement('style');
          killAnimationsStyle.textContent = `
            *, *::before, *::after {
              animation-duration: 0.001s !important;
              animation-delay: 0s !important;
              transition-duration: 0.001s !important;
              transition-delay: 0s !important;
              caret-color: transparent !important;
            }
          `;
          clonedDoc.head?.appendChild(killAnimationsStyle);

          // Normalize position of offscreen capture stage slot in clone so it renders cleanly at 0,0
          const stageInClone =
            (clonedElement?.closest?.('[data-capture-stage="true"]') as HTMLElement | null) ||
            clonedDoc.getElementById('axon-offscreen-capture-stage') ||
            clonedDoc.querySelector('[data-capture-stage="true"]') ||
            clonedElement;

          if (stageInClone) {
            stageInClone.style.position = 'relative';
            stageInClone.style.left = '0px';
            stageInClone.style.top = '0px';
            stageInClone.style.zIndex = '1';
            stageInClone.style.transform = 'none';
          }

          if (clonedElement && clonedElement.getAttribute('data-capture-stage') === 'true') {
            clonedElement.style.position = 'relative';
            clonedElement.style.left = '0px';
            clonedElement.style.top = '0px';
            clonedElement.style.zIndex = '1';
            clonedElement.style.transform = 'none';
          }

          if (clonedDoc.defaultView && clonedDoc.defaultView !== window) {
            unwrapCloned = wrapWindowGetComputedStyle(clonedDoc.defaultView);
          }
          sanitizeClonedTreeForCapture(clonedDoc, clonedElement, element);
        },
      });

      return canvas;
    } finally {
      if (unwrapCloned) {
        unwrapCloned();
      }
      if (unwrapGlobal) {
        unwrapGlobal();
      }
    }
  } finally {
    if (restoreStyles) {
      restoreStyles();
    }
  }
}

export interface DetectedPanel {
  element: HTMLElement;
  id: string;
  name: string;
  index: number;
  isScrollable: boolean;
  scrollElement: HTMLElement | null;
}

export interface MultiPanelDetection {
  hasMultiplePanels: boolean;
  trackElement: HTMLElement | null;
  containerElement: HTMLElement | null;
  panels: DetectedPanel[];
}

/**
 * Checks if an element is an independently scrollable container using DOM inspection.
 */
export function isScrollableElement(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) {
    return false;
  }
  if (el.clientHeight < 60 || el.clientWidth < 60) {
    return false;
  }
  const style = window.getComputedStyle(el);
  return (
    style.overflowY === 'auto' ||
    style.overflowY === 'scroll' ||
    style.overflowX === 'auto' ||
    style.overflowX === 'scroll' ||
    style.overflow === 'auto' ||
    style.overflow === 'scroll'
  );
}

/**
 * Finds the primary scrollable container within a given panel element.
 */
export function findScrollContainer(element: HTMLElement): HTMLElement | null {
  if (isScrollableElement(element)) {
    return element;
  }
  const scrollables = Array.from(element.querySelectorAll<HTMLElement>('*')).filter(isScrollableElement);
  if (scrollables.length === 0) {
    const byClass = element.querySelector<HTMLElement>('.overflow-y-auto, .overflow-auto');
    if (byClass && byClass.scrollHeight > byClass.clientHeight) return byClass;
    return null;
  }
  scrollables.sort((a, b) => b.scrollHeight * b.clientWidth - a.scrollHeight * a.clientWidth);
  return scrollables[0];
}

/**
 * Inspects the actual DOM to detect side-by-side panels, dual-pane layouts,
 * split views, or independently scrollable panels.
 */
export function detectInterfacePanels(rootElement: HTMLElement, baseName: string): MultiPanelDetection {
  // 1. Direct check: AXON DualPaneContainer or explicit dual-pane structures
  const track = (rootElement.id === 'dual-pane-track'
    ? rootElement
    : rootElement.querySelector('#dual-pane-track')) as HTMLElement | null;

  if (track) {
    const container =
      (rootElement.id === 'dual-pane-container'
        ? rootElement
        : rootElement.querySelector('#dual-pane-container') || track.parentElement) as HTMLElement | null;

    const left = (track.querySelector('#dual-pane-left') || track.children[0]) as HTMLElement | null;
    const right = (track.querySelector('#dual-pane-right') || track.children[1]) as HTMLElement | null;

    if (left && right) {
      const panels: DetectedPanel[] = [
        {
          element: left,
          id: 'dual-pane-left',
          name: `${baseName} — Left Panel`,
          index: 0,
          isScrollable: true,
          scrollElement: findScrollContainer(left),
        },
        {
          element: right,
          id: 'dual-pane-right',
          name: `${baseName} — Right Panel`,
          index: 1,
          isScrollable: true,
          scrollElement: findScrollContainer(right),
        },
      ];

      return {
        hasMultiplePanels: true,
        trackElement: track,
        containerElement: container,
        panels,
      };
    }
  }

  // 2. Check for flex-row or grid containers with side-by-side children
  const potentialTracks = Array.from(
    rootElement.querySelectorAll<HTMLElement>('*')
  ).filter((el) => {
    if (el.clientWidth < 160 || el.clientHeight < 100) return false;
    const style = window.getComputedStyle(el);
    const isRow =
      (style.display.includes('flex') && style.flexDirection === 'row') ||
      style.display.includes('grid');
    return isRow && el.children.length >= 2;
  });

  for (const pTrack of potentialTracks) {
    const substantiveChildren = Array.from(pTrack.children).filter(
      (c): c is HTMLElement =>
        c instanceof HTMLElement && c.offsetWidth >= 80 && c.offsetHeight >= 80
    );

    if (substantiveChildren.length >= 2) {
      const rect0 = substantiveChildren[0].getBoundingClientRect();
      const rect1 = substantiveChildren[1].getBoundingClientRect();
      const isSideBySide =
        rect0.left < rect1.left || substantiveChildren[0].offsetLeft < substantiveChildren[1].offsetLeft;

      if (isSideBySide) {
        const panels: DetectedPanel[] = substantiveChildren.map((child, idx) => {
          const headerText = child
            .querySelector('h1, h2, h3, h4, header, [role="heading"]')
            ?.textContent?.trim()
            ?.slice(0, 24);

          let panelLabel = `${baseName} — Panel ${idx + 1}`;
          if (headerText && headerText.length > 2) {
            panelLabel = `${baseName} — ${headerText}`;
          }

          return {
            element: child,
            id: `panel-${idx}`,
            name: panelLabel,
            index: idx,
            isScrollable: isScrollableElement(child) || !!findScrollContainer(child),
            scrollElement: findScrollContainer(child),
          };
        });

        return {
          hasMultiplePanels: true,
          trackElement: pTrack,
          containerElement: pTrack.parentElement,
          panels,
        };
      }
    }
  }

  return {
    hasMultiplePanels: false,
    trackElement: null,
    containerElement: null,
    panels: [],
  };
}

/**
 * High-speed single-pass panel capture.
 * Captures panel in full fidelity without repeated 15-slice html2canvas overhead.
 */
async function capturePanelWithIndependentScrolling(
  panel: DetectedPanel,
  _allPanels: DetectedPanel[],
  options: {
    scale?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
    fullHeight?: boolean;
  }
): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? 2;
  return await captureDomElement(panel.element, {
    scale,
    fullHeight: options.fullHeight ?? false,
    format: options.format,
    quality: options.quality,
  });
}

/**
 * Captures the complete side-by-side interface with both panels visible together.
 * Preserves the panels side-by-side without vertical stacking or UI modification.
 */
async function captureCompleteSideBySideInterface(
  targetElement: HTMLElement,
  _detection: MultiPanelDetection,
  options: {
    scale?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
  }
): Promise<HTMLCanvasElement> {
  return await captureDomElement(targetElement, {
    scale: options.scale ?? 2,
    fullHeight: false,
    format: options.format,
    quality: options.quality,
  });
}

/**
 * Core element capture pipeline that produces both the complete interface and
 * individual panel captures when multi-panel is detected.
 */
async function executeElementCaptureWithPanels(
  targetElement: HTMLElement,
  meta: InterfaceMetadata,
  options: CaptureEngineOptions,
  format: 'png' | 'jpeg',
  quality: number
): Promise<CapturedInterfaceResult[]> {
  const detection = detectInterfacePanels(targetElement, meta.name);
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const results: CapturedInterfaceResult[] = [];

  if (!detection.hasMultiplePanels || options.includePanels === false) {
    const canvas = await captureDomElement(targetElement, {
      scale: options.scale ?? 2,
      fullHeight: options.fullHeight ?? false,
      format,
      quality,
    });

    const dataUrl = canvas.toDataURL(mime, quality);
    const approxBytes = Math.round((dataUrl.length * 3) / 4);

    const singleResult: CapturedInterfaceResult = {
      id: meta.id,
      name: meta.name,
      category: meta.category,
      route: meta.route,
      canvas,
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      sizeBytes: approxBytes,
      formattedSize: formatByteSize(approxBytes),
      capturedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      format,
      isSuccess: true,
      panelResults: [],
    };

    return [singleResult];
  }

  // 1. Capture the COMPLETE SIDE-BY-SIDE INTERFACE
  const fullCanvas = await captureCompleteSideBySideInterface(targetElement, detection, {
    scale: options.scale ?? 2,
    format,
    quality,
  });

  const fullDataUrl = fullCanvas.toDataURL(mime, quality);
  const fullBytes = Math.round((fullDataUrl.length * 3) / 4);

  const fullResult: CapturedInterfaceResult = {
    id: `${meta.id}-full`,
    name: `${meta.name} — Full Interface`,
    category: meta.category,
    route: meta.route,
    canvas: fullCanvas,
    dataUrl: fullDataUrl,
    width: fullCanvas.width,
    height: fullCanvas.height,
    sizeBytes: fullBytes,
    formattedSize: formatByteSize(fullBytes),
    capturedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    format,
    isSuccess: true,
    panelResults: [],
  };

  results.push(fullResult);

  // 2. Capture EACH PANEL INDIVIDUALLY
  const panelResults: CapturedInterfaceResult[] = [];

  for (const panel of detection.panels) {
    const panelCanvas = await capturePanelWithIndependentScrolling(panel, detection.panels, {
      scale: options.scale ?? 2,
      format,
      quality,
      fullHeight: options.fullHeight ?? false,
    });

    const panelDataUrl = panelCanvas.toDataURL(mime, quality);
    const panelBytes = Math.round((panelDataUrl.length * 3) / 4);

    const pResult: CapturedInterfaceResult = {
      id: `${meta.id}-panel-${panel.index}`,
      name: panel.name,
      category: meta.category,
      route: meta.route,
      canvas: panelCanvas,
      dataUrl: panelDataUrl,
      width: panelCanvas.width,
      height: panelCanvas.height,
      sizeBytes: panelBytes,
      formattedSize: formatByteSize(panelBytes),
      capturedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      format,
      isSuccess: true,
    };

    panelResults.push(pResult);
    results.push(pResult);
  }

  fullResult.panelResults = panelResults;
  return results;
}

/**
 * Captures the currently active live interface visible on the screen.
 */
export async function captureLiveInterfaceWithPanels(
  currentScreen: ScreenId,
  options: CaptureEngineOptions = {}
): Promise<CapturedInterfaceResult[]> {
  const format = options.format || 'png';
  const quality = options.quality ?? 0.92;
  const meta = getInterfaceById(currentScreen) || {
    id: currentScreen,
    name: 'Current View',
    route: currentScreen,
    category: 'Core',
    description: 'Active screen',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: [],
  };

  const targetElement =
    (document.getElementById(`screen-container-${currentScreen}`) as HTMLElement) ||
    (document.getElementById('app-main-viewport') as HTMLElement) ||
    (document.getElementById('axon-app-root') as HTMLElement) ||
    document.body;

  try {
    return await executeElementCaptureWithPanels(targetElement, meta, options, format, quality);
  } catch (err: any) {
    console.error(`Failed to capture current interface (${currentScreen}):`, err);
    throw new Error(`Unable to capture current interface: ${err?.message || 'Rendering error'}`);
  }
}

/**
 * Captures a specific interface in the background without navigating the active screen.
 * Uses bounded concurrent offscreen stage slots.
 */
export async function captureInterfaceByIdWithPanels(
  interfaceIdOrRoute: string,
  options: CaptureEngineOptions = {},
  visitedIds: Set<string> = new Set<string>(),
  priority: number = 1
): Promise<CapturedInterfaceResult[]> {
  const format = options.format || 'png';
  const quality = options.quality ?? 0.92;
  const meta = getInterfaceById(interfaceIdOrRoute);

  if (!meta) {
    throw new Error(`Unrecognized interface identifier: "${interfaceIdOrRoute}".`);
  }

  if (visitedIds.has(meta.id)) {
    return [];
  }
  visitedIds.add(meta.id);

  let lastError: Error | null = null;
  let baseResults: CapturedInterfaceResult[] | null = null;

  // Ensure stage requester is initialized
  const stageRequester = await waitForStageRequester(1500);

  // Strategy 1: Offscreen Stage (preferred bounded concurrent staging)
  if (stageRequester) {
    let stageHandle: StageHandle | null = null;
    let stageElement: HTMLElement | null = null;

    try {
      const stageResponse = await stageRequester(
        meta.route,
        options.fullHeight ?? false,
        meta.id,
        priority
      );
      if (stageResponse) {
        if ('element' in stageResponse && typeof stageResponse.release === 'function') {
          stageHandle = stageResponse;
          stageElement = stageResponse.element;
        } else if (stageResponse instanceof HTMLElement) {
          stageElement = stageResponse;
        }
      }
    } catch (stageErr: any) {
      console.warn(`Stage setup failed for "${meta.name}":`, stageErr);
      lastError = stageErr;
    }

    if (stageElement) {
      try {
        baseResults = await executeElementCaptureWithPanels(
          stageElement,
          meta,
          options,
          format,
          quality
        );
      } catch (renderErr: any) {
        console.warn(`Stage capture error for "${meta.name}", trying live DOM fallback:`, renderErr);
        lastError = renderErr;
      } finally {
        stageHandle?.release();
      }
    }
  }

  // Strategy 2: Live DOM container lookup for mounted/visited screens
  if (!baseResults) {
    const existingElement =
      document.getElementById(`screen-container-${meta.route}`) ||
      document.getElementById(`screen-container-${meta.id}`);

    if (existingElement) {
      const prevVisibility = existingElement.style.visibility;
      existingElement.style.visibility = 'visible';
      try {
        baseResults = await executeElementCaptureWithPanels(existingElement, meta, options, format, quality);
      } catch (renderErr: any) {
        console.warn(`Live DOM capture failed for "${meta.name}":`, renderErr);
        lastError = renderErr;
      } finally {
        existingElement.style.visibility = prevVisibility;
      }
    }
  }

  // Strategy 3: Direct DOM lookup for modals, overlays, or tools matching interface ID
  if (!baseResults && typeof document !== 'undefined') {
    const directElement =
      document.getElementById(meta.id) ||
      (meta.parent ? document.getElementById(`screen-container-${meta.parent}`) : null);

    if (directElement && directElement instanceof HTMLElement) {
      try {
        baseResults = await executeElementCaptureWithPanels(directElement, meta, options, format, quality);
      } catch (renderErr: any) {
        console.warn(`Component capture failed for "${meta.name}":`, renderErr);
        lastError = renderErr;
      }
    }
  }

  if (!baseResults || baseResults.length === 0) {
    throw new Error(
      `Screenshot generation failed for "${meta.name}": ${lastError?.message || 'Interface could not be staged or found in active DOM'}`
    );
  }

  const allResults: CapturedInterfaceResult[] = [...baseResults];

  // Strategy 4: Recursive traversal of child interfaces (nested tabs, drawers, panels, sub-tools)
  if (options.recursive !== false && meta.childrenIds && meta.childrenIds.length > 0) {
    for (const childId of meta.childrenIds) {
      if (!visitedIds.has(childId)) {
        await new Promise((r) => setTimeout(r, 20));
        try {
          const childResults = await captureInterfaceByIdWithPanels(childId, options, visitedIds, priority + 1);
          allResults.push(...childResults);
        } catch (childErr: any) {
          console.warn(`Recursive capture of child "${childId}" failed:`, childErr);
        }
      }
    }
  }

  return allResults;
}

/**
 * Executes capture for a single interface with automatic retry logic.
 * Requirement 12: Short exponential retries for transient capture errors.
 */
async function captureInterfaceWithRetry(
  interfaceId: string,
  options: CaptureEngineOptions,
  priority: number,
  visitedIds: Set<string>,
  maxRetries = 2
): Promise<CapturedInterfaceResult[]> {
  let attempt = 0;
  let lastError: any = null;

  while (attempt <= maxRetries) {
    try {
      const results = await captureInterfaceByIdWithPanels(
        interfaceId,
        options,
        visitedIds,
        priority
      );
      return results;
    } catch (err: any) {
      lastError = err;
      attempt++;
      if (attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, 120 * attempt));
      }
    }
  }

  throw lastError || new Error(`Capture failed for interface "${interfaceId}"`);
}

/**
 * Core bounded concurrent queue capture architecture.
 * Processes capture jobs concurrently using a managed worker pool,
 * emits incremental results immediately, isolates failures, and respects device resources.
 */
export async function captureInterfacesQueue(
  targets: Array<string | InterfaceMetadata>,
  options: CaptureEngineOptions = {}
): Promise<MultiCaptureReport> {
  const startTime = Date.now();
  const visitedIds = new Set<string>();

  // Normalize targets into unique InterfaceMetadata list
  const normalizedTargets: InterfaceMetadata[] = [];
  for (const t of targets) {
    const meta = typeof t === 'string' ? getInterfaceById(t) : t;
    if (meta && !visitedIds.has(meta.id)) {
      visitedIds.add(meta.id);
      normalizedTargets.push(meta);
    }
  }

  const total = normalizedTargets.length;
  captureMetrics.startBatch(total);

  // Prioritize queue: Root screens = 1, Sub-tools = 2, Modal/Drawers = 3
  interface QueueJob {
    id: string;
    meta: InterfaceMetadata;
    priority: number;
    retries: number;
  }

  const queue: QueueJob[] = normalizedTargets.map((meta) => {
    let priority = options.priority ?? 1;
    if (options.priority === undefined) {
      if (meta.level === 'root') priority = 1;
      else if (meta.level === 'sub_tool') priority = 1;
      else priority = 2;
    }
    return {
      id: meta.id,
      meta,
      priority,
      retries: 0,
    };
  });

  queue.sort((a, b) => a.priority - b.priority);

  const results: CapturedInterfaceResult[] = [];
  const failures: Array<{ name: string; route: string; error: string }> = [];
  let completedCount = 0;

  // Compute concurrency dynamically based on hardware
  const maxConcurrency = Math.min(
    options.concurrency ?? getOptimalConcurrency(),
    Math.max(1, total)
  );

  const inFlightVisited = new Set<string>();
  const workerSlots = Array.from({ length: maxConcurrency });

  const workers = workerSlots.map(async () => {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) break;

      captureMetrics.notifyJobStarted();
      const jobStart = Date.now();

      // Change detection / cache check
      const optionsKey = `${options.format || 'png'}_${options.fullHeight ? 'full' : 'std'}_${options.scale ?? 2}`;
      if (!options.forceRefresh) {
        const cached = getCachedInterfaceResults(job.id, optionsKey);
        if (cached && cached.length > 0) {
          results.push(...cached);
          completedCount++;

          captureMetrics.recordInterfaceLog({
            interfaceId: job.id,
            name: job.meta.name,
            startTime: jobStart,
            totalDurationMs: Date.now() - jobStart,
            retryCount: 0,
            isSuccess: true,
            reusedFromCache: true,
          });

          for (const r of cached) {
            options.onResult?.(r, completedCount, total);
          }
          options.onProgress?.({
            current: completedCount,
            total,
            interfaceName: job.meta.name,
            percent: Math.round((completedCount / total) * 100),
          });

          captureMetrics.notifyJobEnded();
          continue;
        }
      }

      try {
        const itemResults = await captureInterfaceWithRetry(
          job.id,
          options,
          job.priority,
          inFlightVisited,
          2
        );

        setCachedInterfaceResults(job.id, optionsKey, itemResults);
        results.push(...itemResults);
        completedCount++;

        captureMetrics.recordInterfaceLog({
          interfaceId: job.id,
          name: job.meta.name,
          startTime: jobStart,
          captureCompletionTime: Date.now(),
          totalDurationMs: Date.now() - jobStart,
          retryCount: job.retries,
          isSuccess: true,
        });

        // Immediate result storage & progress notification
        for (const r of itemResults) {
          options.onResult?.(r, completedCount, total);
        }
        options.onProgress?.({
          current: completedCount,
          total,
          interfaceName: job.meta.name,
          percent: Math.round((completedCount / total) * 100),
        });
      } catch (err: any) {
        completedCount++;
        const errorMsg = err?.message || 'Capture failed';
        failures.push({
          name: job.meta.name,
          route: String(job.meta.route),
          error: errorMsg,
        });

        captureMetrics.recordInterfaceLog({
          interfaceId: job.id,
          name: job.meta.name,
          startTime: jobStart,
          totalDurationMs: Date.now() - jobStart,
          retryCount: 2,
          isSuccess: false,
          failureReason: errorMsg,
        });

        options.onProgress?.({
          current: completedCount,
          total,
          interfaceName: job.meta.name,
          percent: Math.round((completedCount / total) * 100),
        });
      } finally {
        captureMetrics.notifyJobEnded();
        // Micro-yield between jobs to ensure zero starvation of foreground AXON UI
        await new Promise((r) => setTimeout(r, 12));
      }
    }
  });

  await Promise.all(workers);
  const finalMetrics = captureMetrics.finishBatch();

  return {
    results,
    successfulCount: results.length,
    failedCount: failures.length,
    failures,
    totalDurationMs: Date.now() - startTime,
    metrics: finalMetrics,
  };
}

/**
 * Captures all registered AXON interfaces in high-speed bounded concurrent queue.
 * Automatically discovers all available interfaces dynamically.
 */
export async function captureAllInterfaces(
  options: CaptureEngineOptions = {}
): Promise<MultiCaptureReport> {
  const targets = discoverAvailableInterfaces().filter((i) => i.isAvailable);
  return await captureInterfacesQueue(targets, options);
}

/**
 * Captures multiple specific interfaces concurrently.
 */
export async function captureMultipleInterfaces(
  interfaceIds: string[],
  options: CaptureEngineOptions = {}
): Promise<MultiCaptureReport> {
  return await captureInterfacesQueue(interfaceIds, options);
}

/**
 * Captures the currently active live interface visible on the screen.
 */
export async function captureLiveCurrentInterface(
  currentScreen: ScreenId,
  options: CaptureEngineOptions = {}
): Promise<CapturedInterfaceResult> {
  const results = await captureLiveInterfaceWithPanels(currentScreen, options);
  return results[0];
}

/**
 * Captures a specific interface in the background without navigating the active screen.
 */
export async function captureInterfaceById(
  interfaceIdOrRoute: string,
  options: CaptureEngineOptions = {}
): Promise<CapturedInterfaceResult> {
  const results = await captureInterfaceByIdWithPanels(interfaceIdOrRoute, options);
  return results[0];
}

/**
 * Stitches an array of captured interface canvases vertically into a continuous long image.
 */
export async function stitchCanvasesVertically(
  captures: CapturedInterfaceResult[],
  options: { gap?: number; banner?: boolean; format?: 'png' | 'jpeg'; quality?: number } = {}
): Promise<{ canvas: HTMLCanvasElement; dataUrl: string; width: number; height: number; filename: string }> {
  if (captures.length === 0) {
    throw new Error('No captures provided to stitch.');
  }

  const seenIds = new Set<string>();
  const uniqueCaptures: CapturedInterfaceResult[] = [];
  for (const cap of captures) {
    if (!seenIds.has(cap.id)) {
      seenIds.add(cap.id);
      uniqueCaptures.push(cap);
    }
  }

  const gap = options.gap ?? 28;
  const hasBanner = options.banner ?? true;
  const bannerHeight = hasBanner ? 56 : 0;
  const format = options.format || 'png';
  const quality = options.quality ?? 0.92;

  const maxWidth = Math.max(...uniqueCaptures.map((c) => c.canvas.width), 800);

  let totalHeight = 40;
  for (const cap of uniqueCaptures) {
    totalHeight += bannerHeight + cap.canvas.height + gap;
  }
  totalHeight += 40;

  const master = document.createElement('canvas');
  master.width = maxWidth;
  master.height = totalHeight;
  const ctx = master.getContext('2d');
  if (!ctx) throw new Error('Failed to create canvas 2D context.');

  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, master.width, master.height);

  let currentY = 40;

  for (let i = 0; i < uniqueCaptures.length; i++) {
    const cap = uniqueCaptures[i];

    if (hasBanner) {
      ctx.fillStyle = '#171717';
      ctx.fillRect(0, currentY, maxWidth, bannerHeight);

      ctx.fillStyle = '#262626';
      ctx.fillRect(0, currentY, maxWidth, 1);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1}. ${cap.name}`, 24, currentY + 34);

      ctx.font = '600 14px monospace';
      ctx.fillStyle = '#a3a3a3';
      ctx.textAlign = 'right';
      ctx.fillText(`[${cap.category.toUpperCase()}] • ${cap.width}x${cap.height}px`, maxWidth - 24, currentY + 34);

      currentY += bannerHeight;
    }

    const offsetX = Math.max(0, Math.floor((maxWidth - cap.canvas.width) / 2));
    ctx.drawImage(cap.canvas, offsetX, currentY);

    currentY += cap.canvas.height + gap;
  }

  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const dataUrl = master.toDataURL(mime, quality);

  return {
    canvas: master,
    dataUrl,
    width: master.width,
    height: master.height,
    filename: getSafeInterfaceFileName('All_Interfaces', format === 'jpeg' ? 'jpg' : 'png', true),
  };
}

/**
 * Compiles captures into a multi-page PDF document using jsPDF.
 */
export async function exportCapturesToPdf(
  captures: CapturedInterfaceResult[],
  customFilename?: string
): Promise<{ blob: Blob; dataUrl: string; filename: string }> {
  if (captures.length === 0) {
    throw new Error('No captures provided for PDF export.');
  }

  const seenIds = new Set<string>();
  const uniqueCaptures: CapturedInterfaceResult[] = [];
  for (const cap of captures) {
    if (!seenIds.has(cap.id)) {
      seenIds.add(cap.id);
      uniqueCaptures.push(cap);
    }
  }

  const filename = customFilename || 'AXON_Interface_Documentation.pdf';

  const first = uniqueCaptures[0];
  const isFirstLandscape = first.canvas.width > first.canvas.height;

  const pdf = new jsPDF({
    orientation: isFirstLandscape ? 'landscape' : 'portrait',
    unit: 'px',
    format: [first.canvas.width, first.canvas.height],
    hotfixes: ['px_scaling'],
  });

  const firstImgData = first.canvas.toDataURL('image/png');
  pdf.addImage(firstImgData, 'PNG', 0, 0, first.canvas.width, first.canvas.height, undefined, 'FAST');

  for (let i = 1; i < uniqueCaptures.length; i++) {
    const item = uniqueCaptures[i];
    const isLandscape = item.canvas.width > item.canvas.height;
    pdf.addPage([item.canvas.width, item.canvas.height], isLandscape ? 'landscape' : 'portrait');
    const imgData = item.canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, item.canvas.width, item.canvas.height, undefined, 'FAST');
  }

  const blob = pdf.output('blob');
  const dataUrl = pdf.output('dataurlstring');

  return {
    blob,
    dataUrl,
    filename,
  };
}

/**
 * Triggers a browser download for a dataUrl.
 */
export function triggerCaptureDownload(dataUrl: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function buildResultFileFromCapture(
  result: CapturedInterfaceResult,
  formatOverride?: 'png' | 'jpg'
): GeneratedResultFile {
  const ext = formatOverride || (result.format === 'jpeg' ? 'jpg' : 'png');
  const fileName = getSafeInterfaceFileName(result.name, ext);
  return {
    id: `${result.id}-${ext}`,
    interfaceName: result.name,
    category: result.category,
    route: result.route,
    status: result.isSuccess ? 'success' : 'failed',
    errorMessage: result.error,
    fileName,
    fileFormat: ext.toUpperCase() as 'PNG' | 'JPG',
    fileType: ext === 'jpg' ? 'image/jpeg' : 'image/png',
    fileSize: result.formattedSize,
    dimensions: `${result.width} × ${result.height} px`,
    dataUrl: result.dataUrl,
    capturedAt: result.capturedAt,
  };
}

export function buildResultFileFromPdf(
  pdfDoc: { dataUrl: string; filename: string; blob?: Blob },
  interfaceName: string,
  category = 'Documentation',
  route = 'all',
  pageCount?: number
): GeneratedResultFile {
  const approxBytes = Math.round((pdfDoc.dataUrl.length * 3) / 4);
  return {
    id: `pdf-${pdfDoc.filename}`,
    interfaceName,
    category,
    route,
    status: 'success',
    fileName: pdfDoc.filename,
    fileFormat: 'PDF',
    fileType: 'application/pdf',
    fileSize: formatByteSize(approxBytes),
    dimensions: pageCount ? `${pageCount} page${pageCount > 1 ? 's' : ''}` : 'Document',
    dataUrl: pdfDoc.dataUrl,
    capturedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

export function buildResultFileFromStitched(
  stitched: { dataUrl: string; filename: string; width: number; height: number; format?: 'png' | 'jpeg' },
  interfaceName: string,
  category = 'Combined View',
  route = 'all'
): GeneratedResultFile {
  const approxBytes = Math.round((stitched.dataUrl.length * 3) / 4);
  const ext = stitched.filename.endsWith('.jpg') ? 'JPG' : 'PNG';
  return {
    id: `stitched-${stitched.filename}`,
    interfaceName,
    category,
    route,
    status: 'success',
    fileName: stitched.filename,
    fileFormat: ext,
    fileType: ext === 'JPG' ? 'image/jpeg' : 'image/png',
    fileSize: formatByteSize(approxBytes),
    dimensions: `${stitched.width} × ${stitched.height} px`,
    dataUrl: stitched.dataUrl,
    capturedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

export function buildFailureResultFile(
  name: string,
  route: string,
  error: string,
  category = 'Interface'
): GeneratedResultFile {
  return {
    id: `fail-${route}-${Date.now()}`,
    interfaceName: name,
    category,
    route,
    status: 'failed',
    errorMessage: error,
    fileName: `${name.replace(/\s+/g, '_')}_FAILED.txt`,
    fileFormat: 'PNG',
    fileType: 'text/plain',
    fileSize: '0 B',
    dimensions: 'Unavailable',
    capturedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}
