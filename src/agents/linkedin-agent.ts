import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { LinkedInMessage, RunMode } from '../types';
import { config } from '../utils/config';
import { SafeModeHandler } from './safe-mode-handler';
import { GeminiClient } from './gemini-client';
import { ScreenshotManager } from '../utils/screenshot-manager';
import { ResponseTracker } from '../utils/response-tracker';
import { responseLogger } from '../utils/response-logger';
import { ConversationMessage } from '../utils/yaml-config';
import logger from '../utils/logger';

export class LinkedInAgent {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private safeModeHandler: SafeModeHandler;
  private geminiClient: GeminiClient;
  private screenshotManager: ScreenshotManager;
  private responseTracker: ResponseTracker;
  private isLoggedIn: boolean = false;

  constructor() {
    this.safeModeHandler = new SafeModeHandler(config.runMode);
    this.geminiClient = new GeminiClient(config.gemini.apiKey);
    this.screenshotManager = new ScreenshotManager();
    this.responseTracker = new ResponseTracker();
    
    // Set the response tracker on the Gemini client for history-aware classification
    this.geminiClient.setResponseTracker(this.responseTracker);
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Initializing LinkedIn agent', { mode: config.runMode });

      // Clean old responses (older than 30 days)
      await this.responseTracker.cleanOldResponses(30);

      // Test Gemini connection
      const geminiConnected = await this.geminiClient.testConnection();
      if (!geminiConnected) {
        throw new Error('Failed to connect to Gemini API');
      }

      // Launch browser with human-like settings
      this.browser = await chromium.launch({
        headless: config.runMode === RunMode.PRODUCTION,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=VizDisplayCompositor',
          '--disable-extensions',
          '--disable-plugins-discovery',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-web-security',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--window-size=1366,768'
        ],
        slowMo: config.runMode !== RunMode.PRODUCTION ? 100 : 50, // Slow down actions
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1366, height: 768 }, // Common laptop resolution
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US,en;q=0.9,nl;q=0.8', // Multi-language to match your profile
        timezoneId: 'Europe/Amsterdam', // Your timezone
        geolocation: { latitude: 52.3676, longitude: 4.9041 }, // Amsterdam coordinates
        permissions: ['geolocation'],
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9,nl;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-User': '?1',
          'Sec-Fetch-Dest': 'document',
        },
      });

      // Add human-like behaviors
      await this.context.addInitScript(`
        // Remove webdriver property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });

        // Mock plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });

        // Mock languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en', 'nl'],
        });

        // Add realistic screen properties
        Object.defineProperty(screen, 'availWidth', { get: () => 1366 });
        Object.defineProperty(screen, 'availHeight', { get: () => 728 });
        Object.defineProperty(screen, 'width', { get: () => 1366 });
        Object.defineProperty(screen, 'height', { get: () => 768 });
      `);

      this.page = await this.context.newPage();

      logger.info('LinkedIn agent initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize LinkedIn agent', { error });
      throw error;
    }
  }

  async login(): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    try {
      logger.info('Attempting LinkedIn login');

      await this.safeModeHandler.navigate(this.page, 'https://www.linkedin.com/login');
      await this.page.waitForLoadState('networkidle');

      // Capture login page screenshot
      await this.screenshotManager.capture(this.page, 'login-page');

      // Human-like behavior: scroll and look around before interacting
      await this.page.mouse.move(500, 300);
      await this.page.waitForTimeout(1000);
      
      // Sometimes scroll a bit (like a human would)
      if (Math.random() > 0.5) {
        await this.page.mouse.wheel(0, 100);
        await this.page.waitForTimeout(500);
        await this.page.mouse.wheel(0, -100);
        await this.page.waitForTimeout(800);
      }

      // Enter credentials with human-like pauses - try multiple selectors for login fields
      const emailSelectors = [
        'input[name="session_key"]',
        'input[placeholder*="Email"]',
        'input[placeholder*="email"]',
        'input[autocomplete="username"]',
        '#username'
      ];
      
      const passwordSelectors = [
        'input[name="session_password"]',
        'input[placeholder*="Password"]',
        'input[placeholder*="password"]',
        'input[autocomplete="current-password"]',
        '#password'
      ];
      
      const submitSelectors = [
        'button[type="submit"]',
        'button[aria-label*="Sign in"]',
        'button:has-text("Sign in")',
        '.sign-in-form__submit-button'
      ];

      // Find and fill email field
      let emailFilled = false;
      for (const selector of emailSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await this.safeModeHandler.typeText(this.page, selector, config.linkedin.email, 'email field');
            emailFilled = true;
            break;
          }
        } catch (error) {
          continue;
        }
      }
      
      if (!emailFilled) {
        throw new Error('Could not find email input field');
      }

      // Pause between fields (like humans do)
      await this.page.waitForTimeout(this.getRandomDelay(800, 1500));

      // Find and fill password field
      let passwordFilled = false;
      for (const selector of passwordSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await this.safeModeHandler.typeText(this.page, selector, config.linkedin.password, 'password field');
            passwordFilled = true;
            break;
          }
        } catch (error) {
          continue;
        }
      }
      
      if (!passwordFilled) {
        throw new Error('Could not find password input field');
      }

      // Human-like pause before clicking login
      await this.page.waitForTimeout(this.getRandomDelay(1000, 2000));

      // Find and click submit button
      let submitClicked = false;
      for (const selector of submitSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await this.safeModeHandler.clickElement(this.page, selector, 'login button');
            submitClicked = true;
            break;
          }
        } catch (error) {
          continue;
        }
      }
      
      if (!submitClicked) {
        throw new Error('Could not find submit button');
      }

      // Don't wait for networkidle - LinkedIn feed has constant activity
      // Just wait a moment for initial page load
      await this.page.waitForTimeout(3000);

      // Check if we're logged in
      const isLoggedIn = await this.checkLoginStatus();
      
      if (isLoggedIn) {
        this.isLoggedIn = true;
        logger.info('Successfully logged into LinkedIn');
        await this.screenshotManager.capture(this.page, 'logged-in');
      } else {
        // Check for 2FA
        const needs2FA = await this.page.isVisible('input[name="pin"]');
        if (needs2FA) {
          logger.warn('2FA required - manual intervention needed');
          await this.screenshotManager.capture(this.page, '2fa-required');
          throw new Error('2FA required - please complete manually');
        }
        throw new Error('Login failed - unknown reason');
      }
    } catch (error) {
      logger.error('Login failed', { error });
      await this.screenshotManager.capture(this.page, 'login-error');
      throw error;
    }
  }

  private async checkLoginStatus(): Promise<boolean> {
    if (!this.page) return false;

    try {
      logger.info('Starting login status check...');
      
      // Wait for page to start loading after login click
      await this.page.waitForTimeout(2000);
      
      // Check URL first (fastest indicator)
      const currentUrl = this.page.url();
      logger.info(`Current URL after login attempt: ${currentUrl}`);
      
      // If URL changed from login page, we're likely logged in
      if (!currentUrl.includes('/login') && currentUrl.includes('linkedin.com')) {
        logger.info(`✅ Login appears successful - URL changed: ${currentUrl}`);
        return true; // Don't overthink it - URL change is enough
      }
      
      // Check for login error messages
      logger.info('Checking for login errors...');
      const errorSelectors = [
        '.form__label--error',
        '.login-form__error', 
        '[role="alert"]',
        '.alert--error'
      ];
      
      for (const selector of errorSelectors) {
        try {
          const isVisible = await this.page.isVisible(selector, { timeout: 1000 });
          if (isVisible) {
            const errorText = await this.page.textContent(selector);
            logger.warn(`❌ Login error detected: ${errorText}`);
            return false;
          }
        } catch (error) {
          // Continue checking
        }
      }
      
      // Still on login page
      logger.warn('❌ Still on login page, login may have failed');
      return false;
      
    } catch (error) {
      logger.error('Error checking login status', { error });
      return false;
    }
  }

  async navigateToMessages(): Promise<void> {
    if (!this.page || !this.isLoggedIn) {
      throw new Error('Not logged in');
    }

    try {
      logger.info('Navigating to messages');

      // Try clicking the messaging link in nav first (more human-like)
      const messagingSelectors = [
        'a[href*="/messaging"]',
        '[data-control-name="nav.messaging"]',
        'a[href="/messaging/"]',
        '.global-nav__primary-link[href*="messaging"]'
      ];

      let navigationSuccess = false;
      for (const selector of messagingSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            logger.info(`Found messaging link: ${selector}`);
            await this.safeModeHandler.clickElement(this.page, selector, 'messaging link');
            await this.page.waitForTimeout(2000);
            navigationSuccess = true;
            break;
          }
        } catch (error) {
          logger.debug(`Messaging selector ${selector} not found, trying next`);
        }
      }

      // Fallback to direct navigation
      if (!navigationSuccess) {
        logger.info('Direct navigation to messaging URL');
        // Don't use safeModeHandler.navigate() for messaging - it waits for networkidle
        // LinkedIn messaging has constant activity so we need a different approach
        await this.page.goto('https://www.linkedin.com/messaging/', {
          waitUntil: 'domcontentloaded', // Just wait for DOM, not network idle
          timeout: 15000,
        });
      }
      
      // Don't wait for networkidle - messaging page has constant activity  
      await this.page.waitForTimeout(3000);
      await this.screenshotManager.capture(this.page, 'messages-page');
      
      logger.info('Successfully navigated to messages');
    } catch (error) {
      logger.error('Failed to navigate to messages', { error });
      throw error;
    }
  }

  async getUnreadMessages(): Promise<LinkedInMessage[]> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    try {
      logger.info('Fetching recent conversations');

      const messages: LinkedInMessage[] = [];

      // Wait for conversation list to load
      await this.page.waitForSelector('.msg-conversations-container__conversations-list', {
        timeout: 10000,
      });

      // Get all conversation threads (using the structure from your HTML)
      const conversationItems = await this.page.$$('.msg-conversation-listitem');
      
      logger.info(`Found ${conversationItems.length} conversation threads`);

      // Take first few conversations (limit to avoid overwhelming)
      const conversationsToProcess = conversationItems.slice(0, 5);

      for (let i = 0; i < conversationsToProcess.length; i++) {
        const thread = conversationsToProcess[i];
        try {
          // Extract sender name
          const senderName = await thread.$eval(
            '.msg-conversation-listitem__participant-names .truncate',
            el => el.textContent?.trim() || ''
          ).catch(() => 'Unknown Sender');

          // Extract message preview from the snippet
          const messageSnippet = await thread.$eval(
            '.msg-conversation-card__message-snippet',
            el => el.textContent?.trim() || ''
          ).catch(() => '');

          // Extract timestamp
          const timeText = await thread.$eval(
            '.msg-conversation-listitem__time-stamp',
            el => el.textContent?.trim() || ''
          ).catch(() => '');

          // Parse timestamp to check if older than 7 days
          const messageAge = this.parseLinkedInTimestamp(timeText);
          logger.debug('Timestamp parsing', { 
            senderName, 
            rawTimeText: timeText,
            parsedAge: messageAge ? `${messageAge} days` : 'null'
          });
          
          if (messageAge && messageAge > 7) {
            logger.debug('Skipping old conversation', { 
              senderName, 
              age: `${messageAge} days`,
              rawTimeText: timeText
            });
            continue;
          }

          // Create unique conversation ID based on sender name
          const conversationId = `linkedin-${senderName.toLowerCase().replace(/\s+/g, '-')}`;
          
          // Check if we've already responded
          const hasResponded = await this.responseTracker.hasResponded(conversationId);
          if (hasResponded) {
            logger.debug('Already responded to this conversation', { 
              senderName,
              conversationId 
            });
            continue;
          }

          // Create unique message ID
          const messageId = conversationId + `-${Date.now()}`;

          // Extract sender from snippet (format: "SenderName: message content")
          let actualSender = senderName;
          let messageContent = messageSnippet;
          
          if (messageSnippet.includes(':')) {
            const parts = messageSnippet.split(':', 2);
            actualSender = parts[0].trim();
            messageContent = parts[1].trim();
          }

          // Skip if it's our own message or empty
          if (actualSender.toLowerCase().includes('floris') || !messageContent) {
            logger.debug('Skipping own message or empty content', { actualSender });
            continue;
          }

          // Classify message using LLM
          const tempMessage: LinkedInMessage = {
            id: messageId,
            senderId: `sender-${i}`,
            senderName: actualSender,
            senderTitle: 'Unknown Title',
            senderCompany: 'Unknown Company',
            content: messageContent,
            timestamp: new Date(),
            isRecruiter: false,
            hasJobOpportunity: false,
            conversationId: conversationId
          };

          const messageClassification = await this.geminiClient.classifyMessage(tempMessage);

          // Only process recruiter messages (both internal and external)
          if (!messageClassification.includes('RECRUITER')) {
            logger.info('Skipping non-recruiter message', { 
              senderName: actualSender, 
              classification: messageClassification,
              messagePreview: messageContent.substring(0, 80) + '...'
            });
            continue;
          }

          logger.info('✅ Recruiter message detected', { 
            senderName: actualSender, 
            classification: messageClassification 
          });

          // Update message with classification result
          tempMessage.isRecruiter = true;
          tempMessage.messageClassification = messageClassification;
          messages.push(tempMessage);
          
          logger.info(`✅ Extracted message from ${actualSender}:`, { 
            preview: messageContent.substring(0, 80) + '...'
          });

        } catch (error) {
          logger.error('Failed to extract conversation', { error, index: i });
        }
      }

      logger.info(`Successfully parsed ${messages.length} recent messages`);
      return messages;
    } catch (error) {
      logger.error('Failed to get conversations', { error });
      await this.screenshotManager.capture(this.page, 'conversations-error');
      throw error;
    }
  }


  private parseLinkedInTimestamp(timeText: string): number | null {
    try {
      const now = new Date();
      const lowercaseTime = timeText.toLowerCase();
      
      // Handle time formats like "12:52 PM" - recent messages (same day)
      if (timeText.match(/^\d{1,2}:\d{2}\s*(AM|PM)?$/i)) {
        return 0; // Same day
      }
      
      // Handle different LinkedIn time formats
      if (lowercaseTime.includes('min') || lowercaseTime.includes('minute')) {
        return 0; // Less than a day
      } else if (lowercaseTime.includes('hour') || lowercaseTime.includes('hr')) {
        return 0; // Less than a day
      } else if (lowercaseTime.includes('day') || lowercaseTime.includes('d')) {
        const match = timeText.match(/(\d+)/);
        return match ? parseInt(match[1]) : 1;
      } else if (lowercaseTime.includes('week') || lowercaseTime.includes('w')) {
        const match = timeText.match(/(\d+)/);
        const weeks = match ? parseInt(match[1]) : 1;
        return weeks * 7;
      } else if (lowercaseTime.includes('month') || lowercaseTime.includes('mo')) {
        const match = timeText.match(/(\d+)/);
        const months = match ? parseInt(match[1]) : 1;
        return months * 30; // Approximate
      }
      
      // Handle LinkedIn date formats like "Jun 25", "Dec 15", etc.
      const monthDayMatch = timeText.match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
      if (monthDayMatch) {
        const [, monthStr, dayStr] = monthDayMatch;
        const monthMap: Record<string, number> = {
          'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
          'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
        };
        
        const month = monthMap[monthStr.toLowerCase()];
        const day = parseInt(dayStr);
        
        if (month !== undefined && day) {
          // Assume current year, but check if date is in future (then it's previous year)
          let year = now.getFullYear();
          const testDate = new Date(year, month, day);
          
          if (testDate > now) {
            year -= 1; // Must be previous year
          }
          
          const messageDate = new Date(year, month, day);
          const diffMs = now.getTime() - messageDate.getTime();
          return Math.floor(diffMs / (1000 * 60 * 60 * 24));
        }
      }
      
      // If it's a specific date, try to parse it
      const date = new Date(timeText);
      if (!isNaN(date.getTime())) {
        const diffMs = now.getTime() - date.getTime();
        return Math.floor(diffMs / (1000 * 60 * 60 * 24));
      }
      
      return null; // Can't parse
    } catch (error) {
      logger.debug('Failed to parse timestamp', { timeText, error });
      return null;
    }
  }


  async processMessage(message: LinkedInMessage): Promise<void> {
    try {
      logger.info('Processing message', { 
        messageId: message.id, 
        sender: message.senderName 
      });

      // Generate response with Gemini (single call)
      const response = await this.geminiClient.generateResponse(message, message.messageClassification || 'EXTERNAL_RECRUITER');

      // Save planned response
      await this.safeModeHandler.savePlannedResponse({
        messageId: message.id,
        recipientId: message.senderId,
        recipientName: message.senderName,
        content: response,
        geminiPrompt: 'Single prompt response',
        geminiResponse: response,
        createdAt: new Date(),
        status: config.runMode === RunMode.SAFE ? 'pending' : 'approved',
      });

      // Send response based on mode
      if (this.page) {
        await this.safeModeHandler.sendMessage(
          this.page,
          message.senderName,
          response
        );
      }

      logger.info('Message processed successfully', { 
        messageId: message.id,
      });
    } catch (error) {
      logger.error('Failed to process message', { error, messageId: message.id });
      throw error;
    }
  }

  async run(): Promise<void> {
    try {
      await this.initialize();
      await this.login();
      await this.navigateToMessages();

      const messages = await this.getUnreadMessages();
      
      logger.info(`Found ${messages.length} recent conversations`);
      
      for (const message of messages) {
        try {
          logger.info(`\n🔍 Analyzing message from ${message.senderName}:`);
          logger.info(`"${message.content.substring(0, 100)}..."`);
          
          const conversationId = `linkedin-${message.senderName.toLowerCase().replace(/\s+/g, '-')}`;
          
          // Get or create conversation history
          const yamlConfig = this.geminiClient['yamlConfig']; // Access private property
          let conversationHistory = yamlConfig.getConversationHistory(conversationId);
          
          // If no conversation history exists but we have response history, reconstruct it
          if (!conversationHistory) {
            const responseHistory = await this.responseTracker.getResponseHistory();
            const previousResponse = responseHistory.find(r => r.conversationId === conversationId);
            
            if (previousResponse) {
              // Reconstruct conversation history from response tracker
              yamlConfig.updateConversationHistory(conversationId, {
                sender: 'recruiter',
                content: previousResponse.messageContent,
                timestamp: new Date(previousResponse.respondedAt.getTime() - 1000) // 1 second before our response
              });
              
              yamlConfig.updateConversationHistory(conversationId, {
                sender: 'user',
                content: previousResponse.generatedResponse,
                timestamp: previousResponse.respondedAt
              });
              
              // Update the phase to follow_up since this is a continuation
              const history = yamlConfig.getConversationHistory(conversationId);
              if (history) {
                history.currentPhase = 'follow_up';
              }
              
              logger.debug('Reconstructed conversation history from response tracker', {
                conversationId,
                messageCount: history?.messages.length,
                phase: history?.currentPhase
              });
            }
          }
          
          conversationHistory = yamlConfig.getConversationHistory(conversationId);
          
          // Add the recruiter's message to conversation history
          const recruiterMessage: ConversationMessage = {
            sender: 'recruiter',
            content: message.content,
            timestamp: new Date()
          };
          
          yamlConfig.updateConversationHistory(conversationId, recruiterMessage);
          conversationHistory = yamlConfig.getConversationHistory(conversationId);
          
          // Generate response using the new conversational system
          const response = await this.geminiClient.generateResponse(
            message, 
            message.messageClassification || 'EXTERNAL_RECRUITER',
            conversationHistory
          );
          
          // Add our response to conversation history
          const userMessage: ConversationMessage = {
            sender: 'user',
            content: response,
            timestamp: new Date()
          };
          
          yamlConfig.updateConversationHistory(conversationId, userMessage);
          
          logger.info(`\n🤖 Generated ${conversationHistory?.currentPhase} response:`);
          logger.info(`"${response}"`);
          logger.info(`\n📝 Response saved but NOT sent (safe mode)`);
          
          // Log the response for fine-tuning
          responseLogger.logResponse(
            message.senderName,
            message.content,
            response
          );
          
          // Track that we've responded
          await this.responseTracker.recordResponse(
            conversationId,
            message.senderName,
            message.content,
            response
          );
          
          // Save the planned response for review
          await this.safeModeHandler.savePlannedResponse({
            messageId: message.id,
            recipientId: message.senderId,
            recipientName: message.senderName,
            content: response,
            geminiPrompt: 'Conversational AI agent',
            geminiResponse: response,
            createdAt: new Date(),
            status: 'pending',
          });

          // Test the send pipeline (but won't actually send)
          if (this.page) {
            await this.safeModeHandler.sendMessage(
              this.page,
              message.senderName,
              response
            );
          }
          
          // Add human-like delay between messages (2-8 seconds)
          const delay = this.getRandomDelay(2000, 8000);
          logger.debug(`Waiting ${delay}ms before next message`);
          await new Promise(resolve => setTimeout(resolve, delay));
          
        } catch (error) {
          logger.error('Failed to process individual message', { 
            error, 
            messageId: message.id 
          });
        }
      }

      logger.info(`\n🎉 Pipeline test completed! Generated ${messages.length} responses (not sent)`);
    } catch (error) {
      logger.error('Agent run failed', { error });
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  async cleanup(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
      }
      logger.info('Cleanup completed');
    } catch (error) {
      logger.error('Cleanup failed', { error });
    }
  }

  private getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}