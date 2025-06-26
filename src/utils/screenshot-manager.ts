import { Page } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import logger from './logger';
import { SessionManager } from './session-manager';

export class ScreenshotManager {
  private baseDir: string;
  private sessionDir: string;
  private sessionId: string;

  constructor() {
    this.baseDir = path.join(process.cwd(), 'screenshots');
    this.sessionId = SessionManager.getSessionId();
    this.sessionDir = path.join(this.baseDir, this.sessionId);
    this.ensureDirectory();
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      logger.info('Screenshot session directory created', { 
        sessionId: this.sessionId,
        path: this.sessionDir 
      });
    } catch (error) {
      logger.error('Failed to create screenshot directory', { error });
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async capture(page: Page, name: string, fullPage: boolean = true): Promise<string | null> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${name}-${timestamp}.png`;
      const filepath = path.join(this.sessionDir, filename);

      await page.screenshot({ 
        path: filepath, 
        fullPage,
        type: 'png',
      });

      logger.debug('Screenshot captured', { filename, fullPage });
      return filepath;
    } catch (error) {
      logger.error('Failed to capture screenshot', { error, name });
      return null;
    }
  }

  async captureElement(page: Page, selector: string, name: string): Promise<string | null> {
    try {
      const element = await page.$(selector);
      if (!element) {
        logger.warn('Element not found for screenshot', { selector });
        return null;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${name}-element-${timestamp}.png`;
      const filepath = path.join(this.sessionDir, filename);

      await element.screenshot({ path: filepath });
      
      logger.debug('Element screenshot captured', { filename, selector });
      return filepath;
    } catch (error) {
      logger.error('Failed to capture element screenshot', { error, name, selector });
      return null;
    }
  }

  async cleanOldSessions(daysToKeep: number = 7): Promise<void> {
    try {
      const sessions = await fs.readdir(this.baseDir);
      const now = Date.now();
      const maxAge = daysToKeep * 24 * 60 * 60 * 1000;

      for (const session of sessions) {
        const sessionPath = path.join(this.baseDir, session);
        const stats = await fs.stat(sessionPath);
        
        if (stats.isDirectory() && now - stats.mtime.getTime() > maxAge) {
          await fs.rmdir(sessionPath, { recursive: true });
          logger.debug('Deleted old session', { session });
        }
      }
    } catch (error) {
      logger.error('Failed to clean old sessions', { error });
    }
  }
}