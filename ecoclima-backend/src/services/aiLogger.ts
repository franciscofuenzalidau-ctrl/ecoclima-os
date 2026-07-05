import fs from 'fs';
import path from 'path';
import { db } from './firebase';

export interface AILog {
  timestamp: string;
  phone: string;
  type: 'image_analysis' | 'text_message' | 'location_received' | 'error';
  message: string;
  tokens_used?: number;
  latency_ms?: number;
}

export interface AIMetrics {
  totalCalls: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRate: number;
  errorsCount: number;
}

class AILogger {
  private logsPath = path.resolve(process.cwd(), 'data_mock', 'ai_logs.json');
  private metricsPath = path.resolve(process.cwd(), 'data_mock', 'ai_metrics.json');

  constructor() {
    this.ensureDataMockDir();
    this.initializeFiles();
  }

  private ensureDataMockDir() {
    const dir = path.resolve(process.cwd(), 'data_mock');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private initializeFiles() {
    if (!fs.existsSync(this.logsPath)) {
      fs.writeFileSync(this.logsPath, JSON.stringify([], null, 2), 'utf8');
    }
    if (!fs.existsSync(this.metricsPath)) {
      const initialMetrics: AIMetrics = {
        totalCalls: 0,
        totalTokens: 0,
        avgLatencyMs: 0,
        successRate: 100,
        errorsCount: 0
      };
      fs.writeFileSync(this.metricsPath, JSON.stringify(initialMetrics, null, 2), 'utf8');
    }
  }

  public async getLogsAsync(): Promise<AILog[]> {
    if (db) {
      try {
        const snapshot = await db.collection('ai_logs').orderBy('timestamp', 'desc').limit(100).get();
        const logs: AILog[] = [];
        snapshot.forEach(doc => {
          logs.push(doc.data() as AILog);
        });
        if (logs.length > 0) return logs;
      } catch (err) {
        console.error('Error fetching AI logs from Firestore:', err);
      }
    }
    return this.getLogsSync();
  }

  public getLogsSync(): AILog[] {
    try {
      if (fs.existsSync(this.logsPath)) {
        return JSON.parse(fs.readFileSync(this.logsPath, 'utf8'));
      }
    } catch (err) {
      console.error('Error reading AI logs:', err);
    }
    return [];
  }

  public async getMetricsAsync(): Promise<AIMetrics> {
    if (db) {
      try {
        const doc = await db.collection('ai_metrics').doc('summary').get();
        if (doc.exists) {
          return doc.data() as AIMetrics;
        }
      } catch (err) {
        console.error('Error fetching AI metrics from Firestore:', err);
      }
    }
    return this.getMetricsSync();
  }

  public getMetricsSync(): AIMetrics {
    try {
      if (fs.existsSync(this.metricsPath)) {
        return JSON.parse(fs.readFileSync(this.metricsPath, 'utf8'));
      }
    } catch (err) {
      console.error('Error reading AI metrics:', err);
    }
    return {
      totalCalls: 0,
      totalTokens: 0,
      avgLatencyMs: 0,
      successRate: 100,
      errorsCount: 0
    };
  }

  public async logEvent(
    phone: string,
    type: 'image_analysis' | 'text_message' | 'location_received' | 'error',
    message: string,
    tokens_used?: number,
    latency_ms?: number
  ) {
    const newLog: AILog = {
      timestamp: new Date().toISOString(),
      phone,
      type,
      message,
      tokens_used,
      latency_ms
    };

    if (db) {
      try {
        await db.collection('ai_logs').add(newLog);

        const metricsRef = db.collection('ai_metrics').doc('summary');
        await db.runTransaction(async (t) => {
          const doc = await t.get(metricsRef);
          let metrics = doc.exists ? (doc.data() as AIMetrics) : { totalCalls: 0, totalTokens: 0, avgLatencyMs: 0, successRate: 100, errorsCount: 0 };
          
          metrics.totalCalls += 1;
          if (type === 'error') metrics.errorsCount += 1;
          if (tokens_used) metrics.totalTokens += tokens_used;
          
          if (latency_ms) {
            const sumLatency = metrics.avgLatencyMs * (metrics.totalCalls - 1) + latency_ms;
            metrics.avgLatencyMs = Math.round(sumLatency / metrics.totalCalls);
          }

          if (metrics.totalCalls > 0) {
            metrics.successRate = Math.round(((metrics.totalCalls - metrics.errorsCount) / metrics.totalCalls) * 100);
          }

          t.set(metricsRef, metrics);
        });
      } catch (err) {
        console.error('Error logging AI event to Firestore:', err);
      }
    }

    try {
      const logs = this.getLogsSync();
      const metrics = this.getMetricsSync();

      logs.unshift(newLog);
      if (logs.length > 100) {
        logs.pop();
      }

      fs.writeFileSync(this.logsPath, JSON.stringify(logs, null, 2), 'utf8');

      metrics.totalCalls += 1;
      if (type === 'error') {
        metrics.errorsCount += 1;
      }
      if (tokens_used) {
        metrics.totalTokens += tokens_used;
      }
      if (latency_ms) {
        const validLatenciesCount = logs.filter(l => l.latency_ms !== undefined).length;
        if (validLatenciesCount > 0) {
          const sumLatency = logs.reduce((acc, curr) => acc + (curr.latency_ms || 0), 0);
          metrics.avgLatencyMs = Math.round(sumLatency / validLatenciesCount);
        }
      }
      if (metrics.totalCalls > 0) {
        metrics.successRate = Math.round(((metrics.totalCalls - metrics.errorsCount) / metrics.totalCalls) * 100);
      }

      fs.writeFileSync(this.metricsPath, JSON.stringify(metrics, null, 2), 'utf8');
      console.log(`[AI LOGGER] Event logged: ${type} - ${message}`);
    } catch (err) {
      console.error('Error logging AI event to fallback file:', err);
    }
  }

  public async resetAsync() {
    if (db) {
      try {
        const metricsRef = db.collection('ai_metrics').doc('summary');
        await metricsRef.set({
          totalCalls: 0,
          totalTokens: 0,
          avgLatencyMs: 0,
          successRate: 100,
          errorsCount: 0
        });

        const logsSnapshot = await db.collection('ai_logs').get();
        const batch = db.batch();
        logsSnapshot.forEach((doc) => {
          batch.delete(doc.ref);
        });
        await batch.commit();
      } catch (err) {
        console.error('Error resetting AI logs/metrics in Firestore:', err);
      }
    }

    try {
      const emptyLogs: AILog[] = [];
      const resetMetrics: AIMetrics = {
        totalCalls: 0,
        totalTokens: 0,
        avgLatencyMs: 0,
        successRate: 100,
        errorsCount: 0
      };

      fs.writeFileSync(this.logsPath, JSON.stringify(emptyLogs, null, 2), 'utf8');
      fs.writeFileSync(this.metricsPath, JSON.stringify(resetMetrics, null, 2), 'utf8');
      console.log('[AI LOGGER] Logs and metrics reset successfully.');
    } catch (err) {
      console.error('Error resetting AI metrics/logs:', err);
    }
  }
}

export const aiLogger = new AILogger();
