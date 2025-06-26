import winston from 'winston';
import path from 'path';
import { SessionManager } from './session-manager';

class ResponseLogger {
  private logger: winston.Logger;

  constructor() {
    const logDir = path.join(process.cwd(), 'logs', SessionManager.getSessionId());
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
        winston.format.printf(({ timestamp, senderName, messageContent, generatedResponse, language }) => {
          return JSON.stringify({
            timestamp,
            senderName,
            messageContent,
            generatedResponse,
            language,
          }, null, 2);
        })
      ),
      transports: [
        new winston.transports.File({
          filename: path.join(logDir, 'responses.log'),
        }),
      ],
    });
  }

  logResponse(
    senderName: string, 
    messageContent: string, 
    generatedResponse: string,
    language?: string
  ): void {
    this.logger.info({
      senderName,
      messageContent, // Don't truncate the original message
      generatedResponse, // Don't truncate the response
      language: language || this.detectLanguage(messageContent),
    });
  }

  private detectLanguage(text: string): string {
    // Simple heuristic - can be improved
    const dutchWords = ['je', 'jij', 'bent', 'heeft', 'naar', 'voor', 'bij', 'met', 'van'];
    const lowercaseText = text.toLowerCase();
    const dutchCount = dutchWords.filter(word => 
      lowercaseText.includes(` ${word} `) || 
      lowercaseText.startsWith(`${word} `) ||
      lowercaseText.endsWith(` ${word}`)
    ).length;
    
    return dutchCount >= 3 ? 'nl' : 'en';
  }
}

export const responseLogger = new ResponseLogger();