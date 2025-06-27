import { GoogleGenerativeAI, GenerativeModel, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { LinkedInMessage } from '../types';
import { config } from '../utils/config';
import { YamlConfig, ConversationHistory, FitAnalysis, PersonalPriorities } from '../utils/yaml-config';
import { ResponseTracker } from '../utils/response-tracker';
import { ConversationStrategyAgent } from './conversation-strategy-agent';
import logger from '../utils/logger';

export class GeminiClient {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private yamlConfig: YamlConfig;
  private responseTracker?: ResponseTracker;
  private strategyAgent: ConversationStrategyAgent;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ 
      model: config.gemini.model,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    });
    this.yamlConfig = new YamlConfig();
    this.yamlConfig.setGeminiClient(this);
    this.strategyAgent = new ConversationStrategyAgent(apiKey);
  }

  public setResponseTracker(responseTracker: ResponseTracker): void {
    this.responseTracker = responseTracker;
  }

  // Basic input sanitization to prevent obvious prompt injection attempts
  private sanitizeInput(content: string): string {
    return content
      .replace(/\/system|IGNORE PREVIOUS|FORGET EVERYTHING|ACT AS|YOU ARE NOW/gi, '[FILTERED]')
      .replace(/\[INST\]|\[\/INST\]/gi, '[FILTERED]')
      .trim();
  }

  // Detect if message content suggests Dutch language
  private isDutchMessage(content: string): boolean {
    const dutchIndicators = /\b(de|het|een|van|voor|met|in|is|zijn|heb|kan|wil|graag|bedankt|mvg|groeten)\b/gi;
    const matches = content.match(dutchIndicators);
    return matches ? matches.length > 2 : false;
  }

  // Add AI disclosure to response if enabled
  private addAIDisclosure(response: string, messageContent: string): string {
    const profile = this.yamlConfig.getProfile();
    
    if (!profile.ai_disclosure?.enabled) {
      return response;
    }

    const isDutch = this.isDutchMessage(messageContent);
    const disclosure = isDutch 
      ? "✨ AI-ondersteunde reactie"
      : profile.ai_disclosure.message;

    return `${response}\n\n${disclosure}`;
  }

  async classifyMessage(message: LinkedInMessage): Promise<string> {
    // Check if we've previously responded to this person as a recruiter
    if (this.responseTracker) {
      const conversationId = `linkedin-${message.senderName.toLowerCase().replace(/\s+/g, '-')}`;
      const hasResponded = await this.responseTracker.hasResponded(conversationId);
      
      if (hasResponded) {
        // If we've previously responded to them, they were likely a recruiter
        // Check the response history to see what type of recruiter they were
        const history = await this.responseTracker.getResponseHistory();
        const previousResponse = history.find(r => r.conversationId === conversationId);
        
        if (previousResponse) {
          // Default to EXTERNAL_RECRUITER for follow-up messages from known recruiters
          const recruiterType = 'EXTERNAL_RECRUITER';
          logger.debug('Message classified based on history', { 
            messageId: message.id,
            senderName: message.senderName,
            classification: recruiterType,
            previouslyRespondedAt: previousResponse.respondedAt
          });
          return recruiterType;
        }
      }
    }

    const prompt = this.yamlConfig.buildClassificationPrompt(message.content, message.senderName);
    
    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1, // Low temperature for consistent classification
          maxOutputTokens: 10,
        },
      });
      
      const classification = result.response.text().trim().toUpperCase();
      logger.debug('Message classified', { 
        messageId: message.id,
        senderName: message.senderName,
        classification 
      });

      return classification;
    } catch (error) {
      logger.error('Failed to classify message', { error, messageId: message.id });
      return 'OTHER'; // Fallback classification
    }
  }

  async generateResponse(message: LinkedInMessage, recruiterType: string = 'EXTERNAL_RECRUITER', conversationHistory?: ConversationHistory): Promise<string> {
    // Sanitize input to prevent basic prompt injection attempts
    const sanitizedMessage = {
      ...message,
      content: this.sanitizeInput(message.content)
    };
    
    const prompt = await this.yamlConfig.buildPrompt(sanitizedMessage.content, sanitizedMessage.senderName, recruiterType, conversationHistory);
    
    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: config.gemini.temperature,
          maxOutputTokens: 300,
        },
      });
      
      const response = result.response.text();
      logger.debug('Response generated', { 
        messageId: message.id, 
        responseLength: response.length 
      });

      // Add AI disclosure if enabled
      const finalResponse = this.addAIDisclosure(response.trim(), message.content);
      
      return finalResponse;
    } catch (error) {
      logger.error('Failed to generate response', { error, messageId: message.id });
      throw error;
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
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1500,
        },
      });
      
      const response = result.response.text();
      logger.debug('Raw LLM response for priorities:', { response: response.substring(0, 200) + '...' });
      
      try {
        // Extract JSON from markdown code blocks if present
        let jsonText = response.trim();
        if (jsonText.startsWith('```json') && jsonText.endsWith('```')) {
          jsonText = jsonText.slice(7, -3).trim();
        } else if (jsonText.startsWith('```') && jsonText.endsWith('```')) {
          jsonText = jsonText.slice(3, -3).trim();
        }
        
        const priorities = JSON.parse(jsonText);
        logger.debug('Personal priorities analyzed', { 
          factorCount: priorities.factors.length 
        });
        return priorities;
      } catch (parseError) {
        logger.error('Failed to parse priorities JSON', { parseError, responseStart: response.substring(0, 200) });
        throw parseError;
      }
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
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 400,
        },
      });
      
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
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 600,
        },
      });
      
      const response = result.response.text();
      logger.debug('Raw LLM response for job fit:', { response: response.substring(0, 200) + '...' });
      
      try {
        // Extract JSON from markdown code blocks if present
        let jsonText = response.trim();
        if (jsonText.startsWith('```json') && jsonText.endsWith('```')) {
          jsonText = jsonText.slice(7, -3).trim();
        } else if (jsonText.startsWith('```') && jsonText.endsWith('```')) {
          jsonText = jsonText.slice(3, -3).trim();
        }
        
        const analysis = JSON.parse(jsonText);
        logger.debug('Job fit evaluated', { 
          score: analysis.overallScore,
          recommendation: analysis.recommendation 
        });
        return analysis;
      } catch (parseError) {
        logger.error('Failed to parse job fit JSON', { parseError, responseStart: response.substring(0, 200) });
        throw parseError;
      }
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
    
    // Get the latest recruiter message to respond to contextually
    const latestRecruiterMessage = conversationHistory.messages
      .filter(m => m.sender === 'recruiter')
      .pop();
    
    if (!latestRecruiterMessage) {
      throw new Error('No recruiter message found in conversation history');
    }

    // Use strategy agent to analyze conversation and plan response
    const strategy = await this.strategyAgent.analyzeConversationState(
      conversationHistory,
      latestRecruiterMessage,
      profile
    );
    
    logger.debug('Strategic analysis completed', {
      phase: strategy.conversationPhase,
      topGoal: strategy.currentGoals[0]?.type,
      recruiterStyle: strategy.recruiterProfile.style
    });
    
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
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 350,
        },
      });
      
      const response = result.response.text().trim();
      
      logger.debug('Base follow-up response generated', { 
        recommendation: fitAnalysis.recommendation,
        responseLength: response.length 
      });

      // Use strategy agent to optimize the response
      const optimizedResponse = await this.strategyAgent.optimizeResponse(
        response,
        strategy,
        conversationHistory
      );

      logger.debug('Follow-up response optimized', { 
        originalLength: response.length,
        optimizedLength: optimizedResponse.length,
        strategy: strategy.conversationPhase
      });

      return optimizedResponse;
    } catch (error) {
      logger.error('Failed to generate follow-up response', { error });
      return 'Thank you for the additional information. Let me review this and get back to you.';
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      console.log('Testing with model:', config.gemini.model);
      console.log('API key starts with:', config.gemini.apiKey.substring(0, 10) + '...');
      
      const result = await this.model.generateContent('Say "Hello, Gemini is connected!"');
      const response = result.response.text();
      logger.info('Gemini connection test successful', { response });
      return true;
    } catch (error) {
      console.log('Full error details:', error);
      logger.error('Gemini connection test failed', { error });
      return false;
    }
  }
}