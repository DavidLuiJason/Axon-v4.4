import { AssetManifestItem } from '../types';
import { formatBytes, AVAILABLE_DOWNLOADABLE_PACKS } from './storageManifest';

/**
 * Parses simple arithmetic expressions like:
 * "what is 1 + 1", "50 * 4", "15% of 80", "125 / 5", "2^8", "sqrt(144)", "100 - 45"
 */
export function tryEvaluateMathExpression(rawText: string): string | null {
  const text = rawText.trim().toLowerCase();

  // Guard against non-math text
  if (!text || text.length > 80) return null;

  // Percentage pattern: "15% of 80" or "what is 20% of 150"
  const percentMatch = text.match(/(?:what\s+is\s+)?(\d+(?:\.\d+)?)\s*%\s*(?:of)\s*(\d+(?:\.\d+)?)/);
  if (percentMatch) {
    const p = parseFloat(percentMatch[1]);
    const total = parseFloat(percentMatch[2]);
    const res = (p / 100) * total;
    return `${p}% of ${total} = ${res}`;
  }

  // Remove common prefixes
  const cleaned = text
    .replace(/^(?:what\s+is|calculate|eval|compute|\?)\s*/i, '')
    .replace(/[?!=]+$/, '')
    .trim();

  // Pattern: sqrt(144)
  const sqrtMatch = cleaned.match(/^sqrt\((\d+(?:\.\d+)?)\)$/);
  if (sqrtMatch) {
    const val = parseFloat(sqrtMatch[1]);
    return `sqrt(${val}) = ${Math.sqrt(val)}`;
  }

  // Only allow valid safe arithmetic characters: digits, ., +, -, *, /, (, ), ^, spaces
  if (!/^[\d\s+\-*/()^.]+$/.test(cleaned)) {
    return null;
  }

  // Must contain at least one operator
  if (!/[+\-*/^]/.test(cleaned)) {
    return null;
  }

  try {
    // Replace power operator
    const sanitized = cleaned.replace(/\^/g, '**');

    // Safe evaluation using Function
    // Only contains numbers, parentheses, and arithmetic operators
    const result = Function(`"use strict"; return (${sanitized});`)();

    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      const formatted = Number.isInteger(result) ? result.toString() : result.toFixed(4).replace(/\.?0+$/, '');
      return `${cleaned} = ${formatted}`;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Handles natural language storage commands in chat like:
 * - "how much storage do I have left?"
 * - "show storage status" / "storage report"
 * - "reallocate space"
 * - "download pack <name>"
 */
export function handleStorageChatCommand(
  rawText: string,
  manifest: AssetManifestItem[],
  reallocateAssetSpace: (assetId: string, bytesToFree: number) => { success: boolean; message: string },
  addDownloadablePack: (pack: any) => void
): string | null {
  const text = rawText.trim().toLowerCase();

  const isStorageQuery =
    /\b(storage|space|disk|manifest|quota|memory)\b/.test(text) &&
    /\b(how much|how many|status|left|remaining|usage|report|breakdown|stats|info)\b/.test(text);

  if (isStorageQuery) {
    const totalStored = manifest.reduce((acc, i) => acc + (i.storedSizeBytes || 0), 0);
    const totalOriginal = manifest.reduce((acc, i) => acc + (i.originalSizeBytes || 0), 0);
    const saved = Math.max(0, totalOriginal - totalStored);

    return `📁 **Storage Manifest Report**\n\n` +
      `- **Registered Assets**: ${manifest.length}\n` +
      `- **Active Disk Used**: ${formatBytes(totalStored)}\n` +
      `- **Uncompressed Footprint**: ${formatBytes(totalOriginal)}\n` +
      `- **Space-Saver Savings**: ${formatBytes(saved)}\n\n` +
      `You can fine-tune your quota or run the Trim Optimizer anytime under **Settings > Storage Diagnostics**.`;
  }

  // Check for download pack request
  const downloadMatch = text.match(/(?:download|install|add)\s+(?:the\s+)?(?:pack|knowledge\s+pack)?\s*([a-z0-9\s]+)/i);
  if (downloadMatch) {
    const query = downloadMatch[1].trim().toLowerCase();
    const matchedPack = AVAILABLE_DOWNLOADABLE_PACKS.find(
      (p) => p.name.toLowerCase().includes(query) || p.id.toLowerCase().includes(query)
    );

    if (matchedPack) {
      const alreadyInstalled = manifest.some((a) => a.id === matchedPack.id);
      if (alreadyInstalled) {
        return `✅ The pack **"${matchedPack.name}"** (${formatBytes(matchedPack.sizeBytes)}) is already installed and registered in your asset manifest.`;
      }

      addDownloadablePack(matchedPack);
      return `📦 Successfully initiated offline download for **"${matchedPack.name}"** (${formatBytes(matchedPack.sizeBytes)}). It is now registered in your local manifest.`;
    }
  }

  // Check for free space / prune request
  if (/\b(free up|reallocate|clean up|trim)\s+(?:some\s+)?(?:storage|space|disk|cache)\b/.test(text)) {
    const spaceSaverTarget = manifest.find((a) => a.saveMode === 'archive' && !a.isCore);
    if (spaceSaverTarget) {
      const halfSize = Math.round(spaceSaverTarget.storedSizeBytes * 0.4);
      const res = reallocateAssetSpace(spaceSaverTarget.id, halfSize);
      return `⚡ ${res.message}`;
    }
    return `ℹ️ No non-core candidate assets require space reallocation at this moment. You can also run the **Trim Optimizer** from the Storage Diagnostics screen.`;
  }

  return null;
}
