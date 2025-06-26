import { LinkedInAgent } from './agents/linkedin-agent';
import { config, validateConfig } from './utils/config';
import logger from './utils/logger';
import { SessionManager } from './utils/session-manager';
import path from 'path';

async function main() {
  try {
    // Initialize session directories
    await SessionManager.createSessionInfo(path.join(process.cwd(), 'logs'));
    await SessionManager.createSessionInfo(path.join(process.cwd(), 'screenshots'));

    // Clean old sessions (older than 7 days)
    await SessionManager.cleanOldSessions(path.join(process.cwd(), 'logs'), 7);
    await SessionManager.cleanOldSessions(path.join(process.cwd(), 'screenshots'), 7);

    logger.info('Starting LinkedIn AI Agent', {
      mode: config.runMode,
      version: '1.0.0',
      sessionId: SessionManager.getSessionId(),
    });

    // Validate configuration
    validateConfig();

    // Create agent instance
    const agent = new LinkedInAgent();

    // Run once and exit
    await runAgent(agent);
    
    logger.info('Agent run completed. Shutting down...');
    await agent.cleanup();
    process.exit(0);

  } catch (error) {
    logger.error('Fatal error in main process', { error });
    process.exit(1);
  }
}

async function runAgent(agent: LinkedInAgent) {
  try {
    await agent.run();
  } catch (error) {
    logger.error('Agent run failed', { error });
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error });
  process.exit(1);
});

// Start the application
main();