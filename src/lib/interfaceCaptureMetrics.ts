/**
 * Performance instrumentation and diagnostic logging for AXON interface capture.
 * Accurately tracks per-interface latency, readiness timing, retry counts,
 * and batch-level concurrency statistics.
 */

export interface InterfacePerformanceLog {
  interfaceId: string;
  name: string;
  startTime: number;
  readyTime?: number;
  captureStartTime?: number;
  captureCompletionTime?: number;
  totalDurationMs: number;
  retryCount: number;
  isSuccess: boolean;
  failureReason?: string;
  reusedFromCache?: boolean;
}

export interface BatchCaptureMetrics {
  batchId: string;
  totalInterfaces: number;
  completed: number;
  failed: number;
  skippedOrReused: number;
  startTime: number;
  endTime?: number;
  totalElapsedMs: number;
  averageCaptureMs: number;
  maxCaptureMs: number;
  peakConcurrency: number;
  logs: InterfacePerformanceLog[];
}

class CaptureMetricsCollector {
  private currentBatch: BatchCaptureMetrics | null = null;
  private lastCompletedBatch: BatchCaptureMetrics | null = null;
  private activeJobsCount = 0;
  private peakConcurrencyRecorded = 0;

  startBatch(totalInterfaces: number): BatchCaptureMetrics {
    const batchId = `batch_${Date.now()}`;
    this.activeJobsCount = 0;
    this.peakConcurrencyRecorded = 0;
    this.currentBatch = {
      batchId,
      totalInterfaces,
      completed: 0,
      failed: 0,
      skippedOrReused: 0,
      startTime: Date.now(),
      totalElapsedMs: 0,
      averageCaptureMs: 0,
      maxCaptureMs: 0,
      peakConcurrency: 1,
      logs: [],
    };
    return this.currentBatch;
  }

  notifyJobStarted(): void {
    this.activeJobsCount++;
    if (this.activeJobsCount > this.peakConcurrencyRecorded) {
      this.peakConcurrencyRecorded = this.activeJobsCount;
    }
    if (this.currentBatch) {
      this.currentBatch.peakConcurrency = this.peakConcurrencyRecorded;
    }
  }

  notifyJobEnded(): void {
    if (this.activeJobsCount > 0) {
      this.activeJobsCount--;
    }
  }

  recordInterfaceLog(log: InterfacePerformanceLog): void {
    if (!this.currentBatch) {
      this.currentBatch = {
        batchId: `single_${Date.now()}`,
        totalInterfaces: 1,
        completed: 0,
        failed: 0,
        skippedOrReused: 0,
        startTime: log.startTime,
        totalElapsedMs: log.totalDurationMs,
        averageCaptureMs: log.totalDurationMs,
        maxCaptureMs: log.totalDurationMs,
        peakConcurrency: 1,
        logs: [],
      };
    }

    this.currentBatch.logs.push(log);

    if (log.reusedFromCache) {
      this.currentBatch.skippedOrReused++;
      this.currentBatch.completed++;
    } else if (log.isSuccess) {
      this.currentBatch.completed++;
    } else {
      this.currentBatch.failed++;
    }

    // Recalculate rolling stats
    const validLogs = this.currentBatch.logs.filter((l) => !l.reusedFromCache);
    if (validLogs.length > 0) {
      const sum = validLogs.reduce((acc, l) => acc + l.totalDurationMs, 0);
      this.currentBatch.averageCaptureMs = Math.round(sum / validLogs.length);
      this.currentBatch.maxCaptureMs = Math.max(...validLogs.map((l) => l.totalDurationMs));
    }
  }

  finishBatch(): BatchCaptureMetrics {
    if (!this.currentBatch) {
      return {
        batchId: 'none',
        totalInterfaces: 0,
        completed: 0,
        failed: 0,
        skippedOrReused: 0,
        startTime: Date.now(),
        totalElapsedMs: 0,
        averageCaptureMs: 0,
        maxCaptureMs: 0,
        peakConcurrency: 1,
        logs: [],
      };
    }

    const now = Date.now();
    this.currentBatch.endTime = now;
    this.currentBatch.totalElapsedMs = now - this.currentBatch.startTime;
    this.currentBatch.peakConcurrency = Math.max(1, this.peakConcurrencyRecorded);

    this.lastCompletedBatch = { ...this.currentBatch };
    const finished = this.currentBatch;
    this.currentBatch = null;
    this.activeJobsCount = 0;
    return finished;
  }

  getLastBatchMetrics(): BatchCaptureMetrics | null {
    return this.lastCompletedBatch;
  }

  getCurrentBatchMetrics(): BatchCaptureMetrics | null {
    return this.currentBatch;
  }
}

export const captureMetrics = new CaptureMetricsCollector();
