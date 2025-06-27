import fs from 'fs/promises';
import path from 'path';
import logger from './logger';

export interface ResponseRecord {
  conversationId: string;
  recipientName: string;
  respondedAt: Date;
  messageContent: string;
  generatedResponse: string;
}

export class ResponseTracker {
  private dataFile: string;
  private responses: Map<string, ResponseRecord>;

  constructor() {
    // Store response history in global logs directory for conversation continuity
    const logDir = path.join(process.cwd(), 'logs');
    this.dataFile = path.join(logDir, 'response-history.json');
    this.responses = new Map();
    this.loadResponseHistory();
  }

  private async loadResponseHistory(): Promise<void> {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      const records: ResponseRecord[] = JSON.parse(data);
      
      // Convert dates back to Date objects
      records.forEach(record => {
        record.respondedAt = new Date(record.respondedAt);
        this.responses.set(record.conversationId, record);
      });
      
      logger.info('Response history loaded', { 
        totalResponses: this.responses.size
      });
    } catch (error) {
      // File doesn't exist or is corrupt, start fresh
      logger.info('No response history found, starting fresh');
      this.responses = new Map();
    }
  }

  private async saveResponseHistory(): Promise<void> {
    try {
      // Ensure data directory exists
      await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
      
      // Convert Map to array for JSON serialization
      const records = Array.from(this.responses.values());
      await fs.writeFile(this.dataFile, JSON.stringify(records, null, 2));
      
      logger.debug('Response history saved', { 
        totalResponses: this.responses.size 
      });
    } catch (error) {
      logger.error('Failed to save response history', { error });
    }
  }

  async hasResponded(conversationId: string): Promise<boolean> {
    return this.responses.has(conversationId);
  }

  async recordResponse(
    conversationId: string, 
    recipientName: string, 
    messageContent: string,
    generatedResponse: string
  ): Promise<void> {
    const record: ResponseRecord = {
      conversationId,
      recipientName,
      respondedAt: new Date(),
      messageContent, // Store full message for debugging
      generatedResponse, // Store full response for debugging
    };

    this.responses.set(conversationId, record);
    await this.saveResponseHistory();
    
    logger.info('Response recorded', { 
      conversationId, 
      recipientName 
    });
  }

  async getResponseHistory(): Promise<ResponseRecord[]> {
    return Array.from(this.responses.values())
      .sort((a, b) => b.respondedAt.getTime() - a.respondedAt.getTime());
  }

  async cleanOldResponses(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    let removed = 0;
    for (const [id, record] of this.responses.entries()) {
      if (record.respondedAt < cutoffDate) {
        this.responses.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      await this.saveResponseHistory();
      logger.info('Cleaned old responses', { 
        removed, 
        remaining: this.responses.size 
      });
    }

    return removed;
  }
}