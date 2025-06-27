import winston from 'winston';
import path from 'path';
import { SessionManager } from './session-manager';
import { ConversationHistory } from './yaml-config';

class ResponseLogger {
  private logger: winston.Logger;

  constructor() {
    const logDir = path.join(process.cwd(), 'logs', SessionManager.getSessionId());
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf((info) => {
          return JSON.stringify({
            timestamp: info.timestamp,
            senderName: info.senderName,
            messageContent: info.messageContent,
            generatedResponse: info.generatedResponse,
            language: info.language,
            conversationHistory: info.conversationHistory,
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
    language?: string,
    conversationHistory?: ConversationHistory
  ): void {
    // Get last 4 messages (including the new generated response)
    const last4Messages = this.getLastMessagesWithNewResponse(
      conversationHistory, 
      messageContent, 
      generatedResponse
    );

    const logData = {
      senderName,
      messageContent, // Don't truncate the original message
      generatedResponse, // Don't truncate the response
      language: language || 'auto', // Language should be detected by AI, not heuristics
      conversationHistory: last4Messages,
    };
    
    console.log('Logging data:', logData); // Debug
    this.logger.info('Response logged', logData);
  }

  private getLastMessagesWithNewResponse(
    conversationHistory: ConversationHistory | undefined,
    _latestRecruiterMessage: string,
    _generatedResponse: string
  ): Array<{ sender: string; content: string; timestamp: Date }> {
    // The conversation history already contains the complete conversation
    // including the current recruiter message and generated response
    if (conversationHistory?.messages) {
      // Return the last 4 messages from the complete conversation history
      return conversationHistory.messages.slice(-4);
    }
    
    // Fallback if no conversation history exists (shouldn't happen)
    return [];
  }

}

export const responseLogger = new ResponseLogger();