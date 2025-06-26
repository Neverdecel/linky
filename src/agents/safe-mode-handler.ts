import { Page } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { RunMode, PlannedResponse, ActionLog } from '../types';
import { config } from '../utils/config';
import logger from '../utils/logger';
import { SessionManager } from '../utils/session-manager';

export class SafeModeHandler {
  private baseDir: string;
  private sessionDir: string;
  private sessionId: string;
  private actionLogs: ActionLog[] = [];

  constructor(private mode: RunMode) {
    this.baseDir = path.join(process.cwd(), 'screenshots');
    this.sessionId = SessionManager.getSessionId();
    this.sessionDir = path.join(this.baseDir, this.sessionId);
    this.ensureScreenshotDir();
  }

  private async ensureScreenshotDir(): Promise<void> {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      logger.info('Safe mode session directory created', { 
        sessionId: this.sessionId,
        path: this.sessionDir 
      });
    } catch (error) {
      logger.error('Failed to create screenshot directory', { error });
    }
  }

  async captureScreenshot(page: Page, name: string): Promise<string | undefined> {
    if (!config.safeMode.captureScreenshots) {
      return undefined;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${this.mode}-${name}-${timestamp}.png`;
      const filepath = path.join(this.sessionDir, filename);
      
      await page.screenshot({ path: filepath, fullPage: true });
      logger.debug('Screenshot captured', { filename, name });
      
      return filename;
    } catch (error) {
      logger.error('Failed to capture screenshot', { error, name });
      return undefined;
    }
  }

  async logAction(action: string, details: Record<string, any>, success: boolean = true, error?: string): Promise<void> {
    const log: ActionLog = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      action,
      details,
      timestamp: new Date(),
      mode: this.mode,
      success,
      error,
    };

    this.actionLogs.push(log);
    
    if (config.safeMode.logAllActions) {
      logger.info('Action logged', log);
    }
  }

  async sendMessage(page: Page, recipient: string, message: string): Promise<void> {
    const actionDetails = {
      recipient,
      messageLength: message.length,
      messagePreview: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
    };

    if (this.mode === RunMode.SAFE) {
      await this.logAction('mock_send_message', actionDetails);
      logger.info(`[SAFE MODE] Generated response for ${recipient} but NOT sending`, actionDetails);
      return;
    }

    if (this.mode === RunMode.DEBUG) {
      const approved = await this.requestApproval(recipient, message);
      if (!approved) {
        await this.logAction('message_rejected', actionDetails);
        logger.info(`[DEBUG MODE] Message rejected for ${recipient}`);
        return;
      }
    }

    try {
      await this.performActualSend(page, recipient, message);
      await this.logAction('send_message', actionDetails);
      logger.info(`[PRODUCTION] Message sent to ${recipient}`, actionDetails);
    } catch (error) {
      await this.logAction('send_message', actionDetails, false, String(error));
      throw error;
    }
  }


  private async requestApproval(recipient: string, message: string): Promise<boolean> {
    logger.info('Approval required for message', { recipient, message });
    
    // In a real implementation, this would integrate with a dashboard or CLI prompt
    // For now, we'll auto-approve in debug mode
    return !config.safeMode.requireApproval;
  }

  private async performActualSend(page: Page, recipient: string, message: string): Promise<void> {
    try {
      logger.info(`Starting LinkedIn message send process for ${recipient}`);
      
      // Step 1: Find and click on the conversation with this recipient
      await this.findAndOpenConversation(page, recipient);
      
      // Step 2: Wait for conversation to load and locate message input
      await this.waitForConversationToLoad(page);
      
      // Step 3: Compose and send the message
      await this.composeAndSendMessage(page, message);
      
      logger.info(`✅ Successfully sent message to ${recipient}`);
      
    } catch (error) {
      logger.error(`Failed to send message to ${recipient}`, { error });
      await this.captureScreenshot(page, `send-error-${recipient.replace(/\s+/g, '-')}`);
      throw error;
    }
  }

  private async findAndOpenConversation(page: Page, recipient: string): Promise<void> {
    logger.debug(`Looking for conversation with ${recipient}`);
    
    // Wait for conversations list to load
    await page.waitForSelector('.msg-conversations-container__conversations-list', {
      timeout: 10000,
    });
    
    // Get all conversation items
    const conversationItems = await page.$$('.msg-conversation-listitem');
    
    for (const item of conversationItems) {
      try {
        // Get the participant name from this conversation
        const participantName = await item.$eval(
          '.msg-conversation-listitem__participant-names .truncate',
          el => el.textContent?.trim() || ''
        ).catch(() => '');
        
        // Check if this matches our recipient (case-insensitive, partial match)
        if (participantName.toLowerCase().includes(recipient.toLowerCase()) || 
            recipient.toLowerCase().includes(participantName.toLowerCase())) {
          
          logger.debug(`Found matching conversation: "${participantName}"`);
          
          // Add human-like hover before clicking
          await item.hover();
          await this.addRandomDelay(300, 700);
          
          // Click on the conversation
          await item.click();
          await this.addRandomDelay(500, 1200);
          
          logger.debug(`Opened conversation with ${participantName}`);
          return;
        }
      } catch (error) {
        logger.debug(`Error checking conversation item: ${error}`);
        continue;
      }
    }
    
    throw new Error(`Could not find conversation with ${recipient}`);
  }

  private async waitForConversationToLoad(page: Page): Promise<void> {
    logger.debug('Waiting for conversation to load');
    
    // Wait for the message thread to be visible
    const messageThreadSelectors = [
      '.msg-s-message-list-container',
      '.msg-conversation-listitem--active',
      '.msg-form',
      '[data-test-id="msg-form"]'
    ];
    
    // Try multiple selectors as LinkedIn UI can vary
    let threadLoaded = false;
    for (const selector of messageThreadSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        logger.debug(`Message thread loaded using selector: ${selector}`);
        threadLoaded = true;
        break;
      } catch (error) {
        logger.debug(`Selector ${selector} not found, trying next`);
      }
    }
    
    if (!threadLoaded) {
      await this.captureScreenshot(page, 'conversation-load-failed');
      throw new Error('Message thread failed to load');
    }
    
    // Add human-like pause to "read" the conversation
    await this.addRandomDelay(1000, 2500);
  }

  private async composeAndSendMessage(page: Page, message: string): Promise<void> {
    logger.debug('Composing message');
    
    // Find the message input field - LinkedIn uses various selectors
    const messageInputSelectors = [
      '.msg-form__contenteditable[role="textbox"]',
      '.msg-form__msg-content-container--scrollable [contenteditable="true"]',
      '[data-test-id="msg-form-send-button"] ~ div[contenteditable="true"]',
      '.msg-s-form [contenteditable="true"]',
      '.msg-form__compose-box [contenteditable="true"]'
    ];
    
    let messageInput;
    let selectedSelector = '';
    for (const selector of messageInputSelectors) {
      try {
        messageInput = await page.$(selector);
        if (messageInput) {
          selectedSelector = selector;
          logger.debug(`Found message input using selector: ${selector}`);
          break;
        }
      } catch (error) {
        continue;
      }
    }
    
    if (!messageInput) {
      await this.captureScreenshot(page, 'message-input-not-found');
      throw new Error('Could not find message input field');
    }
    
    // Click on the input field to focus it
    await messageInput.click();
    await this.addRandomDelay(300, 600);
    
    // Clear any existing content and fill with the complete message
    await page.keyboard.press('Control+a');
    await this.addRandomDelay(100, 200);
    
    // Use fill() for reliable message input (prevents splitting)
    try {
      await page.fill(selectedSelector, message);
      logger.debug('Message filled successfully using page.fill()');
    } catch (error) {
      logger.warn('page.fill() failed, falling back to typing method');
      await this.typeMessageHumanLike(page, message);
    }
    
    await this.addRandomDelay(500, 1000);
    
    // Wait a moment before sending (human-like review time)
    await this.addRandomDelay(1000, 3000);
    
    // Find and click the send button
    await this.clickSendButton(page);
  }

  private async typeMessageHumanLike(page: Page, message: string): Promise<void> {
    logger.debug('Typing message with human-like behavior');
    
    // Split message into segments, handling newlines properly
    const segments = message.split(/(\s+|\n)/);
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      if (segment === '\n') {
        // Use Shift+Enter for line breaks (doesn't send message in LinkedIn)
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
        await this.addRandomDelay(200, 400);
      } else if (segment.match(/^\s+$/)) {
        // Handle spaces
        await page.keyboard.type(segment);
        await this.addRandomDelay(150, 300);
      } else if (segment) {
        // Type regular text character by character
        for (const char of segment) {
          await page.keyboard.type(char);
          // Random delay between characters (realistic typing speed)
          await this.addRandomDelay(80, 180);
        }
        
        // Random longer pause after some words (like humans think/pause)
        if (Math.random() < 0.15) {
          await this.addRandomDelay(500, 1200);
        }
      }
    }
    
    logger.debug('Finished typing message');
  }

  private async clickSendButton(page: Page): Promise<void> {
    logger.debug('Looking for send button');
    
    // LinkedIn send button selectors
    const sendButtonSelectors = [
      '[data-test-id="msg-form-send-button"]',
      '.msg-form__send-btn',
      '.msg-form__send-button',
      'button[aria-label*="Send"]',
      'button[data-control-name="send_button"]',
      '.msg-s-form button[type="submit"]'
    ];
    
    let sendButton;
    for (const selector of sendButtonSelectors) {
      try {
        sendButton = await page.$(selector);
        if (sendButton) {
          // Check if button is enabled
          const isDisabled = await sendButton.evaluate(el => el.hasAttribute('disabled'));
          if (!isDisabled) {
            logger.debug(`Found enabled send button using selector: ${selector}`);
            break;
          }
        }
      } catch (error) {
        continue;
      }
    }
    
    if (!sendButton) {
      await this.captureScreenshot(page, 'send-button-not-found');
      throw new Error('Could not find enabled send button');
    }
    
    // Hover over send button (human-like)
    await sendButton.hover();
    await this.addRandomDelay(200, 500);
    
    // Click the send button
    await sendButton.click();
    await this.addRandomDelay(500, 1000);
    
    // Wait for message to be sent (check if input is cleared or send button is disabled)
    try {
      await page.waitForFunction(
        () => {
          const input = document.querySelector('.msg-form__contenteditable[role="textbox"]');
          return !input || input.textContent?.trim() === '';
        },
        { timeout: 5000 }
      );
      logger.debug('Message appears to have been sent successfully');
    } catch (error) {
      logger.warn('Could not confirm message was sent, but send button was clicked');
    }
  }

  async clickElement(page: Page, selector: string, description: string): Promise<void> {
    const actionDetails = { selector, description };

    // For this test, always actually click (but won't send messages)
    // if (this.mode === RunMode.SAFE) {
    //   // Check if element exists and highlight it
    //   try {
    //     const element = await page.$(selector);
    //     if (element) {
    //       // Highlight the element for screenshot
    //       await page.evaluate((sel) => {
    //         const el = document.querySelector(sel) as HTMLElement;
    //         if (el) {
    //           el.style.border = '3px solid red';
    //           el.style.backgroundColor = 'yellow';
    //           el.style.opacity = '0.8';
    //         }
    //       }, selector);
    //       await this.captureScreenshot(page, `would-click-${description}`);
    //       logger.info(`[SAFE MODE] Found element to click: ${description} at ${selector}`);
    //     } else {
    //       logger.warn(`[SAFE MODE] Element not found: ${selector} for ${description}`);
    //     }
    //   } catch (error) {
    //     logger.warn(`[SAFE MODE] Error checking element: ${error}`);
    //   }
    //   
    //   await this.logAction('mock_click', actionDetails);
    //   
    //   if (config.safeMode.mockDelayMs > 0) {
    //     await new Promise(resolve => setTimeout(resolve, config.safeMode.mockDelayMs / 2));
    //   }
    //   return;
    // }

    try {
      // Add human-like behavior
      await this.addRandomDelay(200, 800);
      
      // Hover before clicking (more human-like)
      await page.hover(selector);
      await this.addRandomDelay(100, 300);
      
      // Click with human-like options
      await page.click(selector, {
        delay: this.getRandomDelay(50, 150), // Random click duration
      });
      
      await this.addRandomDelay(300, 800);
      await this.logAction('click', actionDetails);
      logger.debug(`Clicked: ${description}`, actionDetails);
    } catch (error) {
      await this.logAction('click', actionDetails, false, String(error));
      throw error;
    }
  }

  async typeText(page: Page, selector: string, text: string, description: string): Promise<void> {
    const actionDetails = { 
      selector, 
      description, 
      textLength: text.length,
      textPreview: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
    };

    // For this test, always actually type (but won't send messages)
    // if (this.mode === RunMode.SAFE) {
    //   // Check if element exists and highlight it
    //   try {
    //     const element = await page.$(selector);
    //     if (element) {
    //       // Highlight the input field
    //       await page.evaluate((sel) => {
    //         const el = document.querySelector(sel) as HTMLElement;
    //         if (el) {
    //           el.style.border = '3px solid blue';
    //           el.style.backgroundColor = 'lightblue';
    //         }
    //       }, selector);
    //       await this.captureScreenshot(page, `would-type-${description}`);
    //       logger.info(`[SAFE MODE] Found input field: ${description} at ${selector}`);
    //       logger.info(`[SAFE MODE] Would type: "${actionDetails.textPreview}"`);
    //     } else {
    //       logger.warn(`[SAFE MODE] Input field not found: ${selector} for ${description}`);
    //     }
    //   } catch (error) {
    //     logger.warn(`[SAFE MODE] Error checking input: ${error}`);
    //   }
    //   
    //   await this.logAction('mock_type', actionDetails);
    //   
    //   if (config.safeMode.mockDelayMs > 0) {
    //     await new Promise(resolve => setTimeout(resolve, config.safeMode.mockDelayMs / 2));
    //   }
    //   return;
    // }

    try {
      // Clear field first
      await page.click(selector);
      await this.addRandomDelay(100, 300);
      await page.keyboard.press('Control+a');
      await this.addRandomDelay(50, 150);
      
      // Type like a human with realistic typing speed
      await page.type(selector, text, {
        delay: this.getRandomDelay(80, 200), // Random delay between keystrokes
      });
      
      await this.addRandomDelay(200, 500);
      await this.logAction('type', actionDetails);
      logger.debug(`Typed text in: ${description}`, actionDetails);
    } catch (error) {
      await this.logAction('type', actionDetails, false, String(error));
      throw error;
    }
  }

  private getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private async addRandomDelay(min: number, max: number): Promise<void> {
    const delay = this.getRandomDelay(min, max);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private async addHumanLikePause(): Promise<void> {
    // Simulate human reading/thinking time
    await this.addRandomDelay(1000, 3000);
  }

  async navigate(page: Page, url: string): Promise<void> {
    const actionDetails = { url };

    if (this.mode === RunMode.SAFE) {
      // In safe mode, actually load the page so we can take meaningful screenshots
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      await this.logAction('safe_navigate', actionDetails);
      logger.info(`[SAFE MODE] Loaded page for inspection: ${url}`);
      return;
    }

    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      
      // Add human-like pause after navigation
      await this.addHumanLikePause();
      
      await this.logAction('navigate', actionDetails);
      logger.debug(`Navigated to: ${url}`);
    } catch (error) {
      await this.logAction('navigate', actionDetails, false, String(error));
      throw error;
    }
  }

  getActionLogs(): ActionLog[] {
    return [...this.actionLogs];
  }

  async savePlannedResponse(response: PlannedResponse): Promise<void> {
    // In a real implementation, this would save to the database
    logger.info('Planned response saved', { 
      messageId: response.messageId,
      recipient: response.recipientName,
      status: response.status,
    });
  }
}