import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { LinkedInMessage, RunMode } from '../types';
import { config } from '../utils/config';
import { SafeModeHandler } from './safe-mode-handler';
import { GeminiClient } from './gemini-client';
import { ScreenshotManager } from '../utils/screenshot-manager';
import { ResponseTracker } from '../utils/response-tracker';
import { responseLogger } from '../utils/response-logger';
import { ConversationMessage } from '../utils/yaml-config';
import { LinkedInSessionManager } from '../utils/linkedin-session-manager';
import { SessionManager } from '../utils/session-manager';
import logger from '../utils/logger';

export class LinkedInAgent {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private safeModeHandler: SafeModeHandler;
  private geminiClient: GeminiClient;
  private screenshotManager: ScreenshotManager;
  private responseTracker: ResponseTracker;
  private sessionManager: LinkedInSessionManager;
  private isLoggedIn: boolean = false;

  constructor() {
    this.safeModeHandler = new SafeModeHandler(config.runMode);
    this.geminiClient = new GeminiClient(config.gemini.apiKey);
    this.screenshotManager = new ScreenshotManager();
    this.responseTracker = new ResponseTracker();
    this.sessionManager = new LinkedInSessionManager(SessionManager.getSessionId());
    
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
        timezoneId: 'Europe/Amsterdam', // Configure your timezone
        geolocation: { latitude: 52.3676, longitude: 4.9041 }, // Configure your coordinates
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

      // Try to load saved LinkedIn session
      const sessionLoaded = await this.sessionManager.loadSession(this.context);
      if (sessionLoaded) {
        // Test if the loaded session is still valid
        const sessionValid = await this.sessionManager.testSession(this.context);
        if (sessionValid) {
          logger.info('Using existing LinkedIn session - login not required');
          this.isLoggedIn = true;
        } else {
          logger.info('Saved session is invalid - will need to login');
          this.sessionManager.clearSession();
        }
      }

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

    // Skip login if we already have a valid session
    if (this.isLoggedIn) {
      logger.info('Already logged in with saved session - skipping login');
      return;
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

      // Check for captcha/challenge before checking login status
      await this.checkForChallenges();
      
      // Check if we're logged in
      const isLoggedIn = await this.checkLoginStatus();
      
      if (isLoggedIn) {
        this.isLoggedIn = true;
        logger.info('Successfully logged into LinkedIn');
        
        // Save the session for future use
        try {
          await this.sessionManager.saveSession(this.context!);
          logger.info('LinkedIn session saved for future use');
        } catch (error) {
          logger.warn('Failed to save LinkedIn session', { error });
        }
        
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

  async checkForChallenges(): Promise<void> {
    if (!this.page) {
      return;
    }

    try {
      const url = this.page.url();
      
      // Check for various challenge/captcha indicators
      const challengeIndicators = [
        // URL patterns
        url.includes('/checkpoint/challenge'),
        url.includes('/challenge/'),
        url.includes('/captcha'),
        url.includes('/verify'),
        url.includes('/security'),
        
        // Page content indicators
        await this.page.locator('text=complete this security check').isVisible().catch(() => false),
        await this.page.locator('text=verify your identity').isVisible().catch(() => false),
        await this.page.locator('text=solve this puzzle').isVisible().catch(() => false),
        await this.page.locator('text=are you a robot').isVisible().catch(() => false),
        await this.page.locator('text=security challenge').isVisible().catch(() => false),
        await this.page.locator('text=please complete').isVisible().catch(() => false),
        
        // Common challenge selectors
        await this.page.locator('iframe[src*="captcha"]').isVisible().catch(() => false),
        await this.page.locator('div[class*="captcha"]').isVisible().catch(() => false),
        await this.page.locator('div[class*="challenge"]').isVisible().catch(() => false),
        await this.page.locator('input[name="captcha"]').isVisible().catch(() => false),
        await this.page.locator('[data-test="challenge"]').isVisible().catch(() => false)
      ];

      const hasChallengeIndicator = challengeIndicators.some(indicator => indicator);

      if (hasChallengeIndicator) {
        logger.warn('🚨 Challenge/Captcha detected! Pausing for manual intervention...');
        await this.screenshotManager.capture(this.page, 'challenge-detected');
        
        logger.info('📋 Challenge Detection Details:');
        logger.info(`   URL: ${url}`);
        logger.info(`   Please complete the challenge manually in the browser window.`);
        logger.info(`   The automation will wait for you to complete it.`);
        logger.info(`   Press Ctrl+C to stop if needed.`);
        
        // Wait for the challenge to be resolved
        await this.waitForChallengeResolution();
      }
    } catch (error) {
      logger.error('Error checking for challenges', { error });
    }
  }

  async waitForChallengeResolution(): Promise<void> {
    if (!this.page) {
      return;
    }

    const maxWaitTime = 5 * 60 * 1000; // 5 minutes max wait
    const checkInterval = 5000; // Check every 5 seconds
    const startTime = Date.now();

    logger.info('⏳ Waiting for challenge resolution...');

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const url = this.page.url();
        
        // Check if we're still on a challenge page
        const stillOnChallenge = 
          url.includes('/checkpoint/challenge') ||
          url.includes('/challenge/') ||
          url.includes('/captcha') ||
          url.includes('/verify') ||
          await this.page.locator('text=complete this security check').isVisible().catch(() => false) ||
          await this.page.locator('text=solve this puzzle').isVisible().catch(() => false);

        if (!stillOnChallenge) {
          logger.info('✅ Challenge appears to be resolved! Continuing...');
          await this.screenshotManager.capture(this.page, 'challenge-resolved');
          return;
        }

        // Show progress indicator
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const remaining = Math.round((maxWaitTime - (Date.now() - startTime)) / 1000);
        logger.info(`⏳ Still waiting... (${elapsed}s elapsed, ${remaining}s remaining)`);

        await this.page.waitForTimeout(checkInterval);
      } catch (error) {
        logger.error('Error while waiting for challenge resolution', { error });
        break;
      }
    }

    // If we get here, the timeout was reached
    logger.warn('⚠️ Challenge resolution timeout reached. You may need to complete it manually.');
    throw new Error('Challenge resolution timeout - manual intervention may be required');
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


  async extractFullConversation(conversationId: string, senderName: string): Promise<ConversationMessage[]> {
    const messages: ConversationMessage[] = [];
    
    try {
      if (!this.page) {
        throw new Error('Page not available');
      }

      logger.debug('Attempting to extract full conversation', { 
        conversationId, 
        senderName 
      });

      // First, try to find and click the specific conversation thread
      let conversationOpened = false;
      
      // Multiple strategies to find the conversation
      const conversationSelectors = [
        // Generic conversation items (we'll verify sender name after clicking)
        '.msg-conversation-listitem'
      ];
      
      for (const selector of conversationSelectors) {
        try {
          const conversationElements = await this.page.$$(selector);
          
          for (const element of conversationElements) {
            try {
              // Check if this conversation matches our sender
              const participantName = await element.$eval(
                '.msg-conversation-listitem__participant-names .truncate',
                el => el.textContent?.trim() || ''
              ).catch(() => '');
              
              if (participantName.toLowerCase().includes(senderName.toLowerCase()) || 
                  senderName.toLowerCase().includes(participantName.toLowerCase())) {
                
                logger.debug('Found matching conversation, clicking to open', { 
                  participantName, 
                  senderName 
                });
                
                await element.click();
                await this.page.waitForTimeout(3000); // Wait longer for conversation to load
                conversationOpened = true;
                break;
              }
            } catch (error) {
              logger.debug('Error checking conversation participant', { error: error instanceof Error ? error.message : String(error) });
              continue;
            }
          }
          
          if (conversationOpened) break;
        } catch (error) {
          logger.debug(`Conversation selector ${selector} failed`, { error: error instanceof Error ? error.message : String(error) });
          continue;
        }
      }

      if (!conversationOpened) {
        logger.warn('Could not open specific conversation, trying to extract from current view', { senderName });
      }

      // Wait for message content to load
      await this.page.waitForTimeout(2000);

      // Try multiple selectors for the message container
      const messageListSelectors = [
        '.msg-s-message-list-container',
        '.msg-s-message-list',
        '.msg-s-message-list__event', // Original selector
        '.msg-conversation-card__content', // Alternative
        '[role="log"]', // ARIA role for message lists
        '.msg-s-message-group' // Message groups
      ];

      let messageElements: any[] = [];
      for (const selector of messageListSelectors) {
        try {
          const elements = await this.page.$$(selector);
          if (elements.length > 0) {
            messageElements = elements;
            logger.debug(`Found ${elements.length} message elements using selector: ${selector}`);
            break;
          }
        } catch (error) {
          continue;
        }
      }

      if (messageElements.length === 0) {
        logger.warn('No message elements found with any selector, taking screenshot for debugging');
        await this.screenshotManager.capture(this.page, `conversation-extraction-failed-${senderName.replace(/\s+/g, '-')}`);
        
        // Try a more generic approach - look for any text content in the conversation area
        const conversationArea = await this.page.$('.msg-s-message-list-container, .msg-conversation-card__content');
        if (conversationArea) {
          const allText = await conversationArea.textContent();
          logger.debug('Raw conversation area text (first 500 chars)', { 
            text: allText?.substring(0, 500) || 'No text found'
          });
        }
        
        return messages;
      }
      
      // Extract messages from elements
      for (const messageElement of messageElements) {
        try {
          // Try multiple approaches to extract message content
          let content = '';
          let sender = 'unknown';
          
          // Strategy 1: Look for structured message content
          const contentSelectors = [
            '.msg-s-event-listitem__body .msg-s-event-listitem__content',
            '.msg-s-event-listitem__body',
            '.msg-s-message-group__content',
            'p', // Simple paragraph content
            '.t-14', // LinkedIn's text styling classes
            '.break-words' // LinkedIn's word-wrap classes
          ];
          
          for (const contentSelector of contentSelectors) {
            try {
              const contentEl = await messageElement.$(contentSelector);
              if (contentEl) {
                const textContent = await contentEl.textContent();
                if (textContent && textContent.trim().length > 0) {
                  content = textContent.trim();
                  break;
                }
              }
            } catch (error) {
              continue;
            }
          }
          
          // Strategy 2: Determine sender
          const senderSelectors = [
            '.msg-s-message-group__name',
            '.msg-s-event-listitem__message-sender', 
            '.msg-conversation-listitem__participant-names',
            '[data-control-name="overlay_message_sender_name"]'
          ];
          
          for (const senderSelector of senderSelectors) {
            try {
              const senderEl = await messageElement.$(senderSelector);
              if (senderEl) {
                const senderText = await senderEl.textContent();
                if (senderText && senderText.trim().length > 0) {
                  sender = senderText.trim();
                  break;
                }
              }
            } catch (error) {
              continue;
            }
          }
          
          // If we can't find structured sender info, infer from position or content
          if (sender === 'unknown' || sender === '') {
            // Check if element has classes that indicate it's our message vs theirs
            const elementClasses = await messageElement.getAttribute('class') || '';
            if (elementClasses.includes('msg-s-message-group--other') || 
                elementClasses.includes('msg-s-event-listitem--other')) {
              sender = 'recruiter';
            } else if (elementClasses.includes('msg-s-message-group--self') || 
                       elementClasses.includes('msg-s-event-listitem--self')) {
              sender = 'user';
            } else {
              // Default assumption: if we're extracting from a recruiter's conversation, 
              // and we can't determine sender, assume it's from the recruiter
              sender = 'recruiter';
            }
          } else {
            // Classify based on sender name
            const isOurMessage = sender.toLowerCase().includes('you') || 
                               sender.toLowerCase().includes('floris') ||
                               sender === 'You';
            sender = isOurMessage ? 'user' : 'recruiter';
          }

          if (content && content.length > 0) {
            // Skip very short messages that might be system messages
            if (content.length < 5) {
              logger.debug('Skipping very short message', { content });
              continue;
            }
            
            messages.push({
              sender: sender as 'user' | 'recruiter',
              content,
              timestamp: new Date() // LinkedIn timestamps are complex, using current time as fallback
            });
            
            logger.debug('Extracted message', { 
              sender, 
              contentLength: content.length,
              preview: content.substring(0, 50) + '...'
            });
          }
        } catch (error) {
          logger.debug('Failed to extract individual message', { 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      }

      logger.debug('Extracted conversation history from LinkedIn', { 
        conversationId,
        messageCount: messages.length 
      });

      // If we still have no messages, try a fallback approach
      if (messages.length === 0) {
        logger.warn('No messages extracted with primary approach, trying fallback method');
        await this.screenshotManager.capture(this.page, `no-messages-extracted-${senderName.replace(/\s+/g, '-')}`);
        
        // Fallback: Try to extract any text content from the conversation area
        const fallbackMessages = await this.extractConversationFallback(senderName);
        messages.push(...fallbackMessages);
        
        if (messages.length > 0) {
          logger.info('Fallback extraction succeeded', { messageCount: messages.length });
        } else {
          // Log the page content for debugging
          const pageContent = await this.page.content();
          const messageAreaMatch = pageContent.match(/<div[^>]*msg-s-message[^>]*>[\s\S]*?<\/div>/i);
          if (messageAreaMatch) {
            logger.debug('Message area HTML for debugging', { 
              html: messageAreaMatch[0].substring(0, 1000) + '...'
            });
          }
        }
      }

    } catch (error) {
      logger.warn('Failed to extract full conversation from LinkedIn', { 
        conversationId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Take a screenshot for debugging
      if (this.page) {
        await this.screenshotManager.capture(this.page, `conversation-extraction-error-${senderName.replace(/\s+/g, '-')}`);
      }
    }

    return messages;
  }

  private async extractConversationFallback(senderName: string): Promise<ConversationMessage[]> {
    const messages: ConversationMessage[] = [];
    
    if (!this.page) {
      return messages;
    }
    
    try {
      logger.debug('Attempting fallback conversation extraction', { senderName });
      
      // Try to find the conversation content area with broader selectors
      const conversationAreaSelectors = [
        '.msg-s-message-list-container',
        '.msg-conversation-card__content-container',
        '.conversation-pane',
        '.msg-s-event-listitem__content',
        '.msg-overlay-conversation-bubble__content',
        '[role="main"] .msg-s-message-list'
      ];
      
      let conversationArea = null;
      for (const selector of conversationAreaSelectors) {
        conversationArea = await this.page.$(selector);
        if (conversationArea) {
          logger.debug('Found conversation area with selector', { selector });
          break;
        }
      }
      
      if (!conversationArea) {
        logger.warn('No conversation area found for fallback extraction');
        return messages;
      }
      
      // Extract all text content and try to parse it
      const allText = await conversationArea.textContent();
      if (!allText || allText.trim().length === 0) {
        logger.warn('No text content found in conversation area');
        return messages;
      }
      
      // Try to find message patterns in the text
      // LinkedIn often has patterns like "SenderName\nMessage content\nTimestamp"
      const lines = allText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      let currentMessage = '';
      let currentSender = 'recruiter'; // Default assumption
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Skip very short lines (likely UI elements)
        if (line.length < 3) continue;
        
        // Check if this line might be a sender name
        if (line.includes('You') || line.toLowerCase().includes('floris')) {
          currentSender = 'user';
          continue;
        } else if (line.toLowerCase().includes(senderName.toLowerCase()) || 
                   senderName.toLowerCase().includes(line.toLowerCase())) {
          currentSender = 'recruiter';
          continue;
        }
        
        // Check if this looks like a timestamp (skip it)
        if (line.match(/^\d{1,2}:\d{2}/) || line.match(/^\w{3}\s+\d{1,2}/) || 
            line.includes('min ago') || line.includes('hour ago') || line.includes('day ago')) {
          continue;
        }
        
        // Check if this line looks like a message (substantial content)
        if (line.length > 10 && !line.match(/^[A-Z\s]+$/) && // Not all caps
            !line.includes('•') && // Not bullet points
            !line.includes('LinkedIn') && // Not UI text
            !line.includes('Message') && // Not UI text
            !line.includes('Send') && // Not UI text
            line.includes(' ')) { // Has spaces (likely sentence)
          
          if (currentMessage.length > 0) {
            // Save the previous message
            messages.push({
              sender: currentSender as 'user' | 'recruiter',
              content: currentMessage,
              timestamp: new Date()
            });
          }
          
          currentMessage = line;
        } else if (currentMessage.length > 0 && line.length > 5) {
          // Might be a continuation of the current message
          currentMessage += ' ' + line;
        }
      }
      
      // Don't forget the last message
      if (currentMessage.length > 0) {
        messages.push({
          sender: currentSender as 'user' | 'recruiter',
          content: currentMessage,
          timestamp: new Date()
        });
      }
      
      logger.debug('Fallback extraction completed', { 
        messagesFound: messages.length,
        textLength: allText.length 
      });
      
    } catch (error) {
      logger.warn('Fallback conversation extraction failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
    
    return messages;
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
          
          // PRIORITY 1: Extract actual conversation from LinkedIn
          logger.info('🔍 Extracting current conversation state from LinkedIn', { conversationId });
          const linkedInMessages = await this.extractFullConversation(conversationId, message.senderName);
          
          if (linkedInMessages.length > 0) {
            // Clear existing conversation and rebuild from LinkedIn
            yamlConfig.clearConversationHistory(conversationId);
            
            // Add all LinkedIn messages to conversation history
            for (const msg of linkedInMessages) {
              yamlConfig.updateConversationHistory(conversationId, msg);
            }
            
            // Determine phase based on conversation length
            const history = yamlConfig.getConversationHistory(conversationId);
            if (history) {
              if (history.messages.length > 2) {
                history.currentPhase = 'follow_up';
              } else {
                history.currentPhase = 'initial';
              }
            }
            
            logger.info('✅ Conversation state synchronized from LinkedIn', {
              conversationId,
              messageCount: linkedInMessages.length,
              phase: history?.currentPhase
            });
          } else {
            // FALLBACK: LinkedIn extraction failed, start fresh conversation
            logger.warn('🔄 LinkedIn extraction failed, starting fresh conversation');
            
            // For known recruiters (from response history), set phase to follow_up
            // but don't reconstruct fake conversation history
            const responseHistory = await this.responseTracker.getResponseHistory();
            const previousResponse = responseHistory.find(r => r.conversationId === conversationId);
            
            if (previousResponse) {
              // We know this is a follow-up conversation, but start fresh
              const history = yamlConfig.getConversationHistory(conversationId);
              if (history) {
                history.currentPhase = 'follow_up';
                logger.debug('Set known recruiter conversation to follow_up phase', {
                  conversationId,
                  previousResponseDate: previousResponse.respondedAt
                });
              }
            }
          }
          
          conversationHistory = yamlConfig.getConversationHistory(conversationId);
          
          // Only add the current recruiter message if it's not already in the conversation
          if (conversationHistory) {
            const lastMessage = conversationHistory.messages[conversationHistory.messages.length - 1];
            const isCurrentMessageAlreadyAdded = lastMessage && 
              lastMessage.sender === 'recruiter' && 
              lastMessage.content.trim() === message.content.trim();
              
            if (!isCurrentMessageAlreadyAdded) {
              const recruiterMessage: ConversationMessage = {
                sender: 'recruiter',
                content: message.content,
                timestamp: new Date()
              };
              
              yamlConfig.updateConversationHistory(conversationId, recruiterMessage);
              logger.debug('Added current recruiter message to conversation', { 
                conversationId,
                messageLength: message.content.length 
              });
            } else {
              logger.debug('Current recruiter message already exists in conversation', { 
                conversationId 
              });
            }
          } else {
            // First message in conversation
            const recruiterMessage: ConversationMessage = {
              sender: 'recruiter',
              content: message.content,
              timestamp: new Date()
            };
            
            yamlConfig.updateConversationHistory(conversationId, recruiterMessage);
          }
          
          conversationHistory = yamlConfig.getConversationHistory(conversationId);
          
          // Re-classify message with full conversation context (ADK best practice)
          if (conversationHistory && conversationHistory.messages.length > 0) {
            logger.debug('Re-classifying message with conversation context', {
              conversationId,
              messageCount: conversationHistory.messages.length
            });
            
            const updatedClassification = await this.geminiClient.classifyMessage(
              message, 
              conversationHistory.messages
            );
            
            if (updatedClassification !== message.messageClassification) {
              logger.info('🔄 Classification updated with conversation context', {
                senderName: message.senderName,
                original: message.messageClassification,
                updated: updatedClassification
              });
              message.messageClassification = updatedClassification;
            }
          }
          
          // CRITICAL: Detect language BEFORE generating response (ADK best practice)
          logger.info('🔍 Detecting message language for appropriate response generation');
          const detectedLanguage = await this.geminiClient.detectLanguage(message.content);
          logger.info(`📝 Language detected: ${detectedLanguage}`);
          
          // Generate response using the new conversational system with language context
          const response = await this.geminiClient.generateResponse(
            message, 
            message.messageClassification || 'EXTERNAL_RECRUITER',
            conversationHistory,
            detectedLanguage
          );
          
          // Add our response to conversation history (avoid duplicates)
          const userMessage: ConversationMessage = {
            sender: 'user',
            content: response,
            timestamp: new Date()
          };
          
          yamlConfig.updateConversationHistory(conversationId, userMessage);
          
          logger.info(`\n🤖 Generated ${conversationHistory?.currentPhase} response (${detectedLanguage}):`);
          logger.info(`"${response}"`);
          logger.info(`\n📝 Response saved but NOT sent (safe mode)`);
          
          // Log the response for fine-tuning (language already detected)
          responseLogger.logResponse(
            message.senderName,
            message.content,
            response,
            detectedLanguage,
            conversationHistory
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