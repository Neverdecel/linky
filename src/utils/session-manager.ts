import fs from 'fs/promises';
import path from 'path';
import logger from './logger';

export class SessionManager {
  public static sessionId: string;
  public static sessionStartTime: Date;

  static {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-mm-ss
    const mode = process.env.RUN_MODE || 'unknown';
    this.sessionId = `${dateStr}_${timeStr}_${mode}`;
    this.sessionStartTime = now;
  }

  static getSessionId(): string {
    return this.sessionId;
  }

  static async createSessionInfo(baseDir: string): Promise<void> {
    try {
      const sessionDir = path.join(baseDir, this.sessionId);
      await fs.mkdir(sessionDir, { recursive: true });

      const sessionInfo = {
        sessionId: this.sessionId,
        startTime: this.sessionStartTime.toISOString(),
        mode: process.env.RUN_MODE || 'unknown',
        platform: process.platform,
        nodeVersion: process.version,
        workingDirectory: process.cwd(),
        environment: {
          RUN_MODE: process.env.RUN_MODE,
          LOG_LEVEL: process.env.LOG_LEVEL,
          NODE_ENV: process.env.NODE_ENV,
        }
      };

      const sessionInfoPath = path.join(sessionDir, 'session-info.json');
      await fs.writeFile(sessionInfoPath, JSON.stringify(sessionInfo, null, 2));
      
      logger.info('Session info created', { 
        sessionId: this.sessionId,
        sessionDir,
        sessionInfoPath 
      });
    } catch (error) {
      logger.error('Failed to create session info', { error });
    }
  }

  static async cleanOldSessions(baseDir: string, daysToKeep: number = 7): Promise<void> {
    try {
      const sessions = await fs.readdir(baseDir);
      const now = Date.now();
      const maxAge = daysToKeep * 24 * 60 * 60 * 1000;

      for (const session of sessions) {
        const sessionPath = path.join(baseDir, session);
        const stats = await fs.stat(sessionPath);
        
        if (stats.isDirectory() && now - stats.mtime.getTime() > maxAge) {
          await fs.rmdir(sessionPath, { recursive: true });
          logger.info('Cleaned old session', { session, age: Math.round((now - stats.mtime.getTime()) / (1000 * 60 * 60 * 24)) + ' days' });
        }
      }
    } catch (error) {
      logger.error('Failed to clean old sessions', { error });
    }
  }
}