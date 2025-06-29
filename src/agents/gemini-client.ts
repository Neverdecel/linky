import { GoogleGenerativeAI } from '@google/generative-ai';
import { LinkedInMessage } from '../types';
import { YamlConfig, ConversationHistory, ConversationMessage, FitAnalysis, PersonalPriorities } from '../utils/yaml-config';
import { ResponseTracker } from '../utils/response-tracker';
import { ConversationStrategyAgent } from './conversation-strategy-agent';
import { LanguageDetectionAgent } from './language-detection-agent';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

// Simple AI configuration
interface AIConfig {
  models: {
    classification: { primary: string; fallback: string; temperature: number; max_tokens: number };
    response_generation: { primary: string; fallback: string; temperature: number; max_tokens: number };
    analysis: { primary: string; fallback: string; temperature: number; max_tokens: number };
  };
  safety: {
    input_sanitization: { enabled: boolean; filters: Array<{ pattern: string; replacement: string }> };
    output_validation: { enabled: boolean; rules: any };
  };
  quality: {
    min_confidence_score: number;
    regenerate_on_low_quality: boolean;
    max_regeneration_attempts: number;
  };
  prompts: {
    classification_template: string;
    response_quality_check: string;
  };
}

export class GeminiClient {
  private genAI: GoogleGenerativeAI;
  private yamlConfig: YamlConfig;
  private responseTracker?: ResponseTracker;
  private strategyAgent: ConversationStrategyAgent;
  private languageDetectionAgent: LanguageDetectionAgent;
  private aiConfig: AIConfig;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.yamlConfig = new YamlConfig();
    this.yamlConfig.setGeminiClient(this);
    this.strategyAgent = new ConversationStrategyAgent(apiKey);
    this.languageDetectionAgent = new LanguageDetectionAgent(apiKey);
    
    // Load simplified AI configuration
    this.aiConfig = this.loadAIConfig();
    
    logger.info('GeminiClient initialized with ADK tool specialization pattern including LanguageDetectionAgent');
  }
  
  private loadAIConfig(): AIConfig {
    try {
      const configPath = path.join(__dirname, '../../config/ai-config.yaml');
      const fileContent = fs.readFileSync(configPath, 'utf8');
      return yaml.load(fileContent) as AIConfig;
    } catch (error) {
      logger.error('Failed to load AI config, using defaults', { error });
      // Return sensible defaults
      return {
        models: {
          classification: { primary: 'gemini-2.5-flash', fallback: 'gemini-1.5-flash', temperature: 0.1, max_tokens: 500 },
          response_generation: { primary: 'gemini-2.5-pro', fallback: 'gemini-2.5-flash', temperature: 0.7, max_tokens: 800 },
          analysis: { primary: 'gemini-2.5-flash', fallback: 'gemini-1.5-flash', temperature: 0.3, max_tokens: 2000 }
        },
        safety: {
          input_sanitization: { enabled: true, filters: [] },
          output_validation: { enabled: true, rules: {} }
        },
        quality: {
          min_confidence_score: 0.6,
          regenerate_on_low_quality: true,
          max_regeneration_attempts: 1
        },
        prompts: {
          classification_template: 'Classify this message as INTERNAL_RECRUITER, EXTERNAL_RECRUITER, or OTHER',
          response_quality_check: 'Check if this response is appropriate'
        }
      };
    }
  }

  public setResponseTracker(responseTracker: ResponseTracker): void {
    this.responseTracker = responseTracker;
  }

  async detectLanguage(text: string): Promise<string> {
    try {
      // ADK Hierarchical Delegation: delegate to specialized language detection agent
      const result = await this.languageDetectionAgent.detectLanguage(text);
      
      logger.debug('Language detected via specialized agent', { 
        language: result.language, 
        confidence: result.confidence,
        isReliable: result.isReliable,
        textLength: text.length 
      });
      
      return result.language;
    } catch (error) {
      logger.error('Language detection via specialized agent failed', { error });
      return 'auto';
    }
  }

  // Simplified input sanitization
  private sanitizeInput(content: string): string {
    if (!this.aiConfig.safety.input_sanitization.enabled) {
      return content;
    }
    
    let sanitized = content;
    for (const filter of this.aiConfig.safety.input_sanitization.filters) {
      sanitized = sanitized.replace(new RegExp(filter.pattern, 'gi'), filter.replacement);
    }
    return sanitized.trim();
  }

  // ADK Best Practice: Extract full conversation context for better classification
  private async extractConversationContext(message: LinkedInMessage): Promise<string> {
    try {
      // Return the full message content as context for now
      // This will be enhanced when we integrate with LinkedInAgent's conversation extraction
      const content = message.content.trim();
      
      // For better classification, we provide the full message content
      // plus any additional context we can derive
      const contextParts = [];
      
      // Add the sender information
      contextParts.push(`Sender: ${message.senderName}`);
      
      // Add sender title/company if available
      if (message.senderTitle) {
        contextParts.push(`Title: ${message.senderTitle}`);
      }
      if (message.senderCompany) {
        contextParts.push(`Company: ${message.senderCompany}`);
      }
      
      // Add the full message content
      contextParts.push(`Message: ${content}`);
      
      // Note: In a full implementation, this would extract the conversation thread
      // from LinkedIn using the LinkedInAgent's conversation extraction methods
      // For now, we're using the single message as context
      
      const fullContext = contextParts.join('\n');
      
      logger.debug('Full conversation context extracted', {
        senderName: message.senderName,
        contextLength: fullContext.length,
        hasSenderInfo: !!(message.senderTitle || message.senderCompany)
      });
      
      return fullContext;
    } catch (error) {
      logger.error('Failed to extract conversation context', { error });
      return `Sender: ${message.senderName}\nMessage: ${message.content}`;
    }
  }

  async classifyMessage(message: LinkedInMessage, conversationHistory?: ConversationMessage[]): Promise<string> {
    // Check historical data first
    if (this.responseTracker) {
      const conversationId = `linkedin-${message.senderName.toLowerCase().replace(/\s+/g, '-')}`;
      const hasResponded = await this.responseTracker.hasResponded(conversationId);
      
      if (hasResponded) {
        const history = await this.responseTracker.getResponseHistory();
        const previousResponse = history.find(r => r.conversationId === conversationId);
        
        if (previousResponse) {
          const recruiterType = 'EXTERNAL_RECRUITER';
          logger.debug('Message classified based on history', { 
            messageId: message.id,
            senderName: message.senderName,
            classification: recruiterType
          });
          return recruiterType;
        }
      }
    }

    // ADK Best Practice: Use full conversation context for better classification
    let conversationContext: string;
    
    if (conversationHistory && conversationHistory.length > 0) {
      // Use the actual conversation history from LinkedIn
      const contextParts = [];
      contextParts.push(`Sender: ${message.senderName}`);
      if (message.senderTitle) contextParts.push(`Title: ${message.senderTitle}`);
      if (message.senderCompany) contextParts.push(`Company: ${message.senderCompany}`);
      
      contextParts.push('\nConversation History:');
      // Use the first 2-3 messages for context (most recent exchanges)
      const recentMessages = conversationHistory.slice(-3);
      for (const msg of recentMessages) {
        contextParts.push(`${msg.sender}: ${msg.content}`);
      }
      
      conversationContext = contextParts.join('\n');
      
      logger.debug('Using conversation history for classification', {
        senderName: message.senderName,
        messageCount: recentMessages.length,
        contextLength: conversationContext.length
      });
    } else {
      // Fallback to single message context
      conversationContext = await this.extractConversationContext(message);
    }
    const sanitizedContent = this.sanitizeInput(message.content);
    
    const prompt = this.aiConfig.prompts.classification_template
      .replace('{content}', sanitizedContent)
      .replace('{sender_name}', message.senderName)
      .replace('{conversation_context}', conversationContext);
    
    try {
      const modelConfig = this.aiConfig.models.classification;
      const model = this.genAI.getGenerativeModel({ 
        model: modelConfig.primary,
        generationConfig: {
          temperature: modelConfig.temperature,
          maxOutputTokens: modelConfig.max_tokens,
          responseMimeType: "application/json"
        }
      });
      
      const result = await model.generateContent(prompt);
      const response = result.response.text();
      
      let parsed: any;
      try {
        // Clean up response - remove markdown code blocks if present
        let cleanResponse = response.trim();
        if (cleanResponse.startsWith('```json')) {
          cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanResponse.startsWith('```')) {
          cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        // Handle empty responses
        if (!cleanResponse || cleanResponse.length < 10) {
          logger.warn('Empty or very short classification response', { response });
          return 'OTHER';
        }
        
        parsed = JSON.parse(cleanResponse);
      } catch (parseError) {
        logger.error('Failed to parse classification JSON', { 
          response: response.substring(0, 200),
          error: parseError instanceof Error ? parseError.message : String(parseError)
        });
        return 'OTHER';
      }
      
      const classification = parsed.classification || 'OTHER';
      const confidence = parsed.confidence || 0.5;
      
      // Check confidence threshold
      if (confidence < this.aiConfig.quality.min_confidence_score) {
        logger.warn('Classification confidence below threshold', { 
          classification, 
          confidence,
          threshold: this.aiConfig.quality.min_confidence_score
        });
        return 'OTHER';
      }
      
      logger.debug('Message classified', {
        messageId: message.id,
        classification,
        confidence,
        reasoning: parsed.reasoning
      });
      
      return classification;
    } catch (error) {
      logger.error('Classification failed, trying fallback', { error });
      
      // Try fallback model
      try {
        const modelConfig = this.aiConfig.models.classification;
        const model = this.genAI.getGenerativeModel({ 
          model: modelConfig.fallback,
          generationConfig: {
            temperature: modelConfig.temperature,
            maxOutputTokens: modelConfig.max_tokens,
          }
        });
        
        const result = await model.generateContent(prompt);
        const response = result.response.text();
        
        // Simple pattern matching as last resort
        if (response.includes('INTERNAL_RECRUITER')) return 'INTERNAL_RECRUITER';
        if (response.includes('EXTERNAL_RECRUITER')) return 'EXTERNAL_RECRUITER';
        return 'OTHER';
      } catch (fallbackError) {
        logger.error('Fallback classification also failed', { fallbackError });
        return 'OTHER';
      }
    }
  }

  async generateResponse(message: LinkedInMessage, recruiterType: string = 'EXTERNAL_RECRUITER', conversationHistory?: ConversationHistory, detectedLanguage?: string): Promise<string> {
    const sanitizedMessage = {
      ...message,
      content: this.sanitizeInput(message.content)
    };
    
    try {
      // Build prompt using existing YamlConfig with detected language
      const prompt = await this.yamlConfig.buildPrompt(
        sanitizedMessage.content, 
        sanitizedMessage.senderName, 
        recruiterType, 
        conversationHistory,
        detectedLanguage
      );
      
      const modelConfig = this.aiConfig.models.response_generation;
      const model = this.genAI.getGenerativeModel({ 
        model: modelConfig.primary,
        generationConfig: {
          temperature: modelConfig.temperature,
          maxOutputTokens: modelConfig.max_tokens,
        }
      });
      
      const result = await model.generateContent(prompt);
      let response = result.response.text().trim();
      
      // Validate response quality including language matching
      if (this.aiConfig.safety.output_validation.enabled) {
        const isValid = await this.validateResponse(response, message, detectedLanguage);
        
        if (!isValid && this.aiConfig.quality.regenerate_on_low_quality) {
          logger.warn('Response failed validation, regenerating');
          
          // Try once more with adjusted temperature
          const adjustedModel = this.genAI.getGenerativeModel({ 
            model: modelConfig.primary,
            generationConfig: {
              temperature: Math.max(0.3, modelConfig.temperature - 0.2),
              maxOutputTokens: modelConfig.max_tokens,
            }
          });
          
          const retryResult = await adjustedModel.generateContent(prompt);
          response = retryResult.response.text().trim();
        }
      }
      
      logger.debug('Response generated', {
        messageId: message.id,
        responseLength: response.length,
        recruiterType
      });
      
      return response;
    } catch (error) {
      logger.error('Response generation failed', { error, messageId: message.id });
      
      // Simple fallback response
      return "Thank you for reaching out. I'd be happy to learn more about this opportunity. Could you share some details about the role and company?";
    }
  }

  private async validateResponse(response: string, originalMessage: LinkedInMessage, expectedLanguage?: string): Promise<boolean> {
    try {
      // Enhanced validation prompt that includes language checking
      const languageCheck = expectedLanguage ? 
        `\n\nIMPORTANT: Check that the response is written in ${expectedLanguage.toUpperCase()}. If the original message was in Dutch (nl), the response MUST be in Dutch. If English (en), it MUST be in English.` : '';
      
      const prompt = `${this.aiConfig.prompts.response_quality_check}
        
Response to validate: "${response}"
Original message language: ${expectedLanguage || 'unknown'}${languageCheck}

Return JSON: {"passed": boolean, "issues": string[], "language_match": boolean}`;
      
      const model = this.genAI.getGenerativeModel({ 
        model: this.aiConfig.models.analysis.primary,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
          responseMimeType: "application/json"
        }
      });
      
      const result = await model.generateContent(prompt);
      const validation = JSON.parse(result.response.text());
      
      if (!validation.passed) {
        logger.warn('Response validation failed', { 
          issues: validation.issues,
          messageId: originalMessage.id 
        });
      }
      
      return validation.passed;
    } catch (error) {
      logger.error('Response validation error', { error });
      return true; // Default to passing if validation fails
    }
  }

  async analyzePersonalPriorities(): Promise<PersonalPriorities> {
    const profile = this.yamlConfig.getProfile();
    
    const prompt = `Analyze this person's professional profile and determine their personal priorities when evaluating job opportunities.

PROFILE DATA:
${JSON.stringify(profile, null, 2)}

Based on this profile, identify the key factors that matter most to this person when evaluating job opportunities. Consider:
- Their requirements (salary, schedule, location preferences)
- Must-have vs nice-to-have items
- Current situation vs aspirations
- Skills and interests alignment
- Company type preferences

Return a JSON response with this structure:
{
  "factors": [
    {
      "factor": "descriptive name of the factor",
      "importance": number from 1-100,
      "reasoning": "why this matters to them based on their profile"
    }
  ]
}

Focus on what would actually impact their decision-making process. Be specific and personalized to their profile.`;

    try {
      const modelConfig = this.aiConfig.models.analysis;
      const model = this.genAI.getGenerativeModel({ 
        model: modelConfig.primary,
        generationConfig: {
          temperature: modelConfig.temperature,
          maxOutputTokens: modelConfig.max_tokens,
          responseMimeType: "application/json"
        }
      });
      
      const result = await model.generateContent(prompt);
      const priorities = JSON.parse(result.response.text());
      
      logger.debug('Personal priorities analyzed', { 
        factorCount: priorities.factors.length 
      });
      
      return priorities;
    } catch (error) {
      logger.error('Failed to analyze personal priorities', { error });
      // Return fallback priorities
      return {
        factors: [
          { factor: 'Salary alignment', importance: 80, reasoning: 'Based on profile requirements' },
          { factor: 'Work-life balance', importance: 70, reasoning: 'Based on schedule preferences' },
          { factor: 'Role relevance', importance: 90, reasoning: 'Based on skills and interests' }
        ]
      };
    }
  }

  async generateInitialQuestions(recruiterType: string, priorities: PersonalPriorities): Promise<string> {
    const profile = this.yamlConfig.getProfile();
    
    const prompt = `Generate intelligent questions for a recruiter based on this person's profile and priorities.

PROFILE SUMMARY:
- Name: ${profile.personal.name}
- Current Role: ${profile.personal.current_role}
- Requirements: ${JSON.stringify(profile.requirements)}
- Preferences: ${JSON.stringify(profile.preferences)}

PERSONAL PRIORITIES:
${priorities.factors.map(f => `- ${f.factor} (${f.importance}%): ${f.reasoning}`).join('\n')}

RECRUITER TYPE: ${recruiterType}

Generate 4-6 targeted questions that will help this person evaluate if the opportunity is a good fit. Questions should:
- Address their highest priorities first
- Be specific to their needs and preferences
- Adapt to whether this is an internal or external recruiter
- Help them make an informed decision
- Be strategic about salary discussions - ask about their range/budget WITHOUT revealing our expectations

SALARY STRATEGY:
- Ask "What is the salary range for this position?" or "What's the budget allocated for this role?"
- NEVER say our target salary or current salary
- Let them reveal their range first for better negotiation position

For INTERNAL recruiters: Focus on company culture, team dynamics, role details
For EXTERNAL recruiters: Focus on client company info, process clarity, role specifics

Return questions in a natural conversational format, not as a bullet list.`;

    try {
      const modelConfig = this.aiConfig.models.response_generation;
      const model = this.genAI.getGenerativeModel({ 
        model: modelConfig.primary,
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: modelConfig.max_tokens,
        }
      });
      
      const result = await model.generateContent(prompt);
      const questions = result.response.text().trim();
      
      logger.debug('Initial questions generated', { 
        recruiterType,
        questionLength: questions.length 
      });

      return questions;
    } catch (error) {
      logger.error('Failed to generate initial questions', { error });
      return 'I have a few questions about this opportunity. Could you share more details about the role and company?';
    }
  }

  async evaluateJobFit(recruiterResponses: string, conversationHistory: ConversationHistory): Promise<FitAnalysis> {
    const profile = this.yamlConfig.getProfile();
    
    const prompt = `Evaluate how well this job opportunity fits this person's profile and priorities.

PERSON'S PROFILE:
${JSON.stringify(profile, null, 2)}

CONVERSATION HISTORY:
${conversationHistory.messages.map(m => `${m.sender}: ${m.content}`).join('\n\n')}

RECRUITER'S LATEST RESPONSES:
${recruiterResponses}

Analyze the fit between this opportunity and the person's requirements. Consider:
- Salary alignment with their minimum/ideal range
- Schedule compatibility (days per week, hours, remote work)
- Location and commute requirements
- Must-have vs nice-to-have alignment
- Company type preferences (prefer vs avoid)
- Role relevance to their skills and interests

Return a JSON response:
{
  "overallScore": number from 0-100,
  "positives": ["specific good matches"],
  "concerns": ["specific concerns or misalignments"],
  "missingInfo": ["important info still needed"],
  "recommendation": "interested" | "exploring" | "decline"
}

Be specific and reference actual details from the conversation.`;

    try {
      const modelConfig = this.aiConfig.models.analysis;
      const model = this.genAI.getGenerativeModel({ 
        model: modelConfig.primary,
        generationConfig: {
          temperature: modelConfig.temperature,
          maxOutputTokens: modelConfig.max_tokens,
          responseMimeType: "application/json"
        }
      });
      
      const result = await model.generateContent(prompt);
      const analysis = JSON.parse(result.response.text());
      
      logger.debug('Job fit evaluated', { 
        score: analysis.overallScore,
        recommendation: analysis.recommendation 
      });
      
      return analysis;
    } catch (error) {
      logger.error('Failed to evaluate job fit', { error });
      // Return cautious fallback analysis
      return {
        overallScore: 50,
        positives: ['Some alignment with profile'],
        concerns: ['Need more information'],
        missingInfo: ['Salary details', 'Work arrangement details'],
        recommendation: 'exploring'
      };
    }
  }

  async generateFollowUpResponse(conversationHistory: ConversationHistory, fitAnalysis: FitAnalysis): Promise<string> {
    const profile = this.yamlConfig.getProfile();
    
    // Get the latest recruiter message
    const latestRecruiterMessage = conversationHistory.messages
      .filter(m => m.sender === 'recruiter')
      .pop();
    
    if (!latestRecruiterMessage) {
      throw new Error('No recruiter message found in conversation history');
    }

    // Use strategy agent for sophisticated analysis
    const strategy = await this.strategyAgent.analyzeConversationState(
      conversationHistory,
      latestRecruiterMessage,
      profile
    );
    
    const prompt = `Generate a contextual follow-up response to the recruiter's latest message.

PERSON'S PROFILE:
Name: ${profile.personal.name}
Current Role: ${profile.personal.current_role}
Key Requirements: ${profile.requirements.must_have.join(', ')}

CONVERSATION CONTEXT:
${conversationHistory.messages.map(m => `${m.sender}: ${m.content}`).join('\n\n')}

RECRUITER'S LATEST MESSAGE TO RESPOND TO:
"${latestRecruiterMessage?.content || 'No message'}"

FIT ANALYSIS:
Score: ${fitAnalysis.overallScore}/100
Recommendation: ${fitAnalysis.recommendation}
Concerns: ${fitAnalysis.concerns.join(', ')}
Missing Info: ${fitAnalysis.missingInfo.join(', ')}

RESPONSE GUIDELINES:
1. FIRST: Directly address what the recruiter just said/asked in their latest message
2. THEN: Based on fit analysis (${fitAnalysis.recommendation}):
   - If INTERESTED (score 70+): Express genuine interest and ask strategic questions
   - If EXPLORING (score 40-69): Ask for more information about concerns/missing details
   - If DECLINE (score <40): Politely decline with brief reasoning

CRITICAL CONVERSATION RULES:
- FIRST: Acknowledge what they just said naturally (vacation, call request, etc.)
- NEVER give phone number - deflect call requests conversationally 
- Use phrases like "LinkedIn works great for me" or "Let's continue here"
- Sound like a human having a conversation, not following a script
- Keep under 150 words and be genuinely conversational
- Respond to THEIR specific message, don't just ask standard questions

Generate a natural, human-like follow-up response that actually responds to what they said:`;

    try {
      const modelConfig = this.aiConfig.models.response_generation;
      const model = this.genAI.getGenerativeModel({ 
        model: modelConfig.primary,
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: modelConfig.max_tokens,
        }
      });
      
      const result = await model.generateContent(prompt);
      const response = result.response.text().trim();
      
      // Use strategy agent to optimize
      const optimizedResponse = await this.strategyAgent.optimizeResponse(
        response,
        strategy,
        conversationHistory
      );

      logger.debug('Follow-up response generated', { 
        recommendation: fitAnalysis.recommendation,
        responseLength: optimizedResponse.length 
      });

      return optimizedResponse;
    } catch (error) {
      logger.error('Failed to generate follow-up response', { error });
      return 'Thank you for the additional information. Let me review this and get back to you.';
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent('Say "Hello" in one word');
      
      if (result.response.text().toLowerCase().includes('hello')) {
        logger.info('Gemini connection test successful');
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Gemini connection test failed', { error });
      return false;
    }
  }
}