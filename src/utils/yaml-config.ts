import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import logger from './logger';

interface SystemPrompt {
  ai_behavior: {
    core_rules: string[];
    response_structure: string[];
    language_behavior: {
      dutch: { tone: string; closing_format: string };
      english: { tone: string; closing_format: string };
    };
    enthusiasm_levels: {
      high: string;
      medium: string;
      low: string;
      decline: string;
    };
    matching_strategy: {
      decision_thresholds: {
        dream_job: number;
        interested: number;
        exploring: number;
        decline: number;
      };
    };
    prompt_template: string;
  };
}

interface Profile {
  personal: {
    name: string;
    current_role: string;
    location: string;
  };
  current_situation: {
    salary: number;
    currency: string;
    hours_per_week: number;
  };
  dream_job: {
    title: string;
    description: string;
  };
  requirements: {
    salary: {
      minimum: number;
      ideal: number;
      currency: string;
    };
    schedule: {
      days_per_week: number;
      hours_per_day: number;
    };
    location: {
      max_commute_minutes: number;
      remote_days_min: number;
      office_days_max: number;
    };
    must_have: string[];
    nice_to_have: string[];
  };
  skills: string[];
  interests: string[];
  preferences: {
    company_types: {
      prefer: string[];
      avoid: string[];
    };
  };
  ai_assistant?: {
    enabled: boolean;
    persona: string;
    disclosure_message: string;
    show_disclosure: boolean;
    assistant_style: {
      tone: string;
      communication_style: string;
      personality_traits: string[];
    };
    representation: {
      introduce_as?: string;
      speak_for_user: boolean;
      maintain_user_voice: boolean;
    };
    behavior: {
      ask_clarifying_questions: boolean;
      negotiate_strategically: boolean;
      maintain_control: boolean;
      extract_salary_first: boolean;
    };
  };
}

export interface ConversationHistory {
  messages: ConversationMessage[];
  currentPhase: 'initial' | 'follow_up' | 'decision';
  fitAnalysis?: FitAnalysis;
}

export interface ConversationMessage {
  sender: 'user' | 'recruiter';
  content: string;
  timestamp: Date;
}

export interface FitAnalysis {
  overallScore: number;
  positives: string[];
  concerns: string[];
  missingInfo: string[];
  recommendation: 'interested' | 'exploring' | 'decline';
}

export interface PersonalPriorities {
  factors: Array<{
    factor: string;
    importance: number;
    reasoning: string;
  }>;
}

export class YamlConfig {
  private systemPrompt!: SystemPrompt;
  private profile!: Profile;
  private configPath: string;
  private conversations: Map<string, ConversationHistory> = new Map();
  private personalPriorities?: PersonalPriorities;
  private geminiClient?: any;

  constructor(configPath: string = 'config') {
    this.configPath = path.resolve(configPath);
    this.loadConfigs();
  }

  private loadConfigs(): void {
    try {
      this.loadSystemPrompt();
      this.loadProfile();
      logger.info('YAML configuration loaded successfully');
    } catch (error) {
      logger.error('Failed to load YAML configuration', { error });
      throw error;
    }
  }

  private loadSystemPrompt(): void {
    const systemPromptPath = path.join(this.configPath, 'system-prompt.yaml');
    const content = fs.readFileSync(systemPromptPath, 'utf8');
    this.systemPrompt = yaml.load(content) as SystemPrompt;
  }

  private loadProfile(): void {
    const profilePath = path.join(this.configPath, 'profile.yaml');
    const content = fs.readFileSync(profilePath, 'utf8');
    this.profile = yaml.load(content) as Profile;
  }

  public async buildPrompt(messageContent: string, recruiterName: string, recruiterType: string = 'EXTERNAL_RECRUITER', conversationHistory?: ConversationHistory, detectedLanguage?: string): Promise<string> {
    const template = this.systemPrompt.ai_behavior.prompt_template;
    
    // Get or calculate personal priorities
    if (!this.personalPriorities) {
      this.personalPriorities = await this.analyzePersonalPriorities();
    }

    // Generate questions based on conversation phase
    let questionsList = '';
    if (!conversationHistory || conversationHistory.currentPhase === 'initial') {
      questionsList = await this.generateInitialQuestions(recruiterType);
    } else {
      questionsList = await this.generateFollowUpResponse(conversationHistory);
    }
    
    // Generate language-specific instructions
    const languageInstructions = this.buildLanguageInstructions(detectedLanguage);
    const displayLanguage = detectedLanguage || 'auto';
    
    return template
      .replace('{name}', this.profile.personal.name)
      .replace('{current_role}', this.profile.personal.current_role)
      .replace('{location}', this.profile.personal.location)
      .replace('{recruiter_name}', recruiterName)
      .replace('{message_content}', messageContent)
      .replace('{detected_language}', displayLanguage)
      .replace('{language_instructions}', languageInstructions)
      .replace('{profile_summary}', this.buildProfileSummary())
      .replace('{requirements_summary}', this.buildRequirementsSummary())
      .replace('{instructions_list}', this.buildInstructionsList())
      .replace('{questions_list}', questionsList)
      .replace('{assistant_persona_context}', this.buildAssistantPersonaContext())
      .replace('{assistant_behavior_rules}', this.buildAssistantBehaviorRules());
  }

  private buildProfileSummary(): string {
    const { personal, current_situation, skills, interests } = this.profile;
    
    return `- Name: ${personal.name}
- Role: ${personal.current_role}
- Location: ${personal.location}
- Current: €${current_situation.salary.toLocaleString()}/${current_situation.currency}/year, ${current_situation.hours_per_week}h/week
- Skills: ${skills.join(', ')}
- Interests: ${interests.join(', ')}`;
  }

  private buildRequirementsSummary(): string {
    const { requirements } = this.profile;
    
    return `- Salary: €${requirements.salary.minimum.toLocaleString()}+ (ideal: €${requirements.salary.ideal.toLocaleString()})
- Schedule: ${requirements.schedule.days_per_week} days/week, ${requirements.schedule.hours_per_day}h/day
- Location: Max ${requirements.location.max_commute_minutes} min commute, ${requirements.location.remote_days_min}+ remote days
- Must have: ${requirements.must_have.join(', ')}
- Nice to have: ${requirements.nice_to_have.join(', ')}`;
  }

  private buildInstructionsList(): string {
    const rules = this.systemPrompt.ai_behavior.core_rules;
    const structure = this.systemPrompt.ai_behavior.response_structure;
    
    return [...rules, ...structure]
      .map((rule, index) => `${index + 1}. ${rule}`)
      .join('\n');
  }

  private buildAssistantPersonaContext(): string {
    const assistant = this.profile.ai_assistant;
    
    if (!assistant?.enabled) {
      return `You are responding to a LinkedIn recruiter message as ${this.profile.personal.name}, a ${this.profile.personal.current_role} who lives in ${this.profile.personal.location}.`;
    }

    const { persona, representation, assistant_style } = assistant;
    const { tone, communication_style, personality_traits } = assistant_style;

    let context = '';
    
    // When AI assistant mode is enabled, always respond from AI assistant perspective
    if (representation.introduce_as) {
      context = `${representation.introduce_as}. You are ${persona} managing LinkedIn communications for ${this.profile.personal.name}.`;
      context += `\nMaintain a ${tone} tone with ${communication_style} communication style.`;
      context += `\nPersonality traits: ${personality_traits.join(', ')}.`;
      context += `\nIMPORTANT: You MUST speak in third person about ${this.profile.personal.name}. Never use "I am" or "Ik ben".`;
      context += `\nVary your language - don't start every sentence with "${this.profile.personal.name}". Use pronouns (he/hij) and vary sentence structure.`;
      context += `\nBe CONCISE - keep responses short and to the point. Aim for 2-3 paragraphs maximum.`;
      context += `\nYou represent ${this.profile.personal.name}, a ${this.profile.personal.current_role} who lives in ${this.profile.personal.location}.`;
      context += `\nStart by briefly identifying yourself, then speak about ${this.profile.personal.name} naturally.`;
      context += `\nCRITICAL: Match the language of the conversation. If responding in Dutch, translate EVERYTHING to Dutch. If responding in English, keep everything in English.`;
      
      // Add disclosure instruction if enabled
      if (assistant.show_disclosure) {
        context += `\nCRITICAL: End your response with a brief AI disclosure note in the same language as your response. If responding in Dutch, use Dutch for the disclosure. If responding in English, use English for the disclosure.`;
      }
    } else {
      // Fallback to first person if no introduce_as is set
      context = `You are responding to a LinkedIn recruiter message as ${this.profile.personal.name}, a ${this.profile.personal.current_role} who lives in ${this.profile.personal.location}.`;
      context += `\nYou are acting as their ${persona} with a ${tone} tone and ${communication_style} communication style.`;
      context += `\nPersonality traits to embody: ${personality_traits.join(', ')}.`;
    }

    return context;
  }

  private buildAssistantBehaviorRules(): string {
    const assistant = this.profile.ai_assistant;
    
    if (!assistant?.enabled) {
      return '';
    }

    const rules: string[] = [];
    const { behavior } = assistant;

    if (behavior.ask_clarifying_questions) {
      rules.push('Proactively ask relevant questions to gather missing information about the opportunity');
    }

    if (behavior.negotiate_strategically) {
      rules.push('Use strategic conversation tactics to maintain advantage in negotiations');
    }

    if (behavior.maintain_control) {
      rules.push('Keep conversations on LinkedIn rather than moving to phone calls when possible');
    }

    if (behavior.extract_salary_first) {
      rules.push('Try to extract their salary range/budget before revealing expectations');
    }

    // Note: Disclosure message is handled separately by addAIDisclosure method

    return rules.length > 0 ? rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n') : '';
  }

  private buildLanguageInstructions(detectedLanguage?: string): string {
    const languageBehavior = this.systemPrompt.ai_behavior.language_behavior;
    
    if (!detectedLanguage) {
      return "CRITICAL: Respond in the SAME LANGUAGE as the recruiter's message. Use the provided language_behavior guidelines.";
    }

    // Map common language codes to our system
    const languageMap: { [key: string]: string } = {
      'nl': 'dutch',
      'en': 'english',
      'de': 'german',
      'fr': 'french',
      'es': 'spanish'
    };

    const mappedLanguage = languageMap[detectedLanguage.toLowerCase()] || 'english';
    
    if (mappedLanguage === 'dutch' && languageBehavior.dutch) {
      return `CRITICAL: Respond in DUTCH. 
- Tone: ${languageBehavior.dutch.tone}
- Closing: ${languageBehavior.dutch.closing_format}
- Use Dutch equivalents for all phrases
- Never mix English words in a Dutch response
- Follow Dutch professional communication style`;
    } else if (mappedLanguage === 'english' && languageBehavior.english) {
      return `CRITICAL: Respond in ENGLISH.
- Tone: ${languageBehavior.english.tone}
- Closing: ${languageBehavior.english.closing_format}
- Use English professional communication style
- Maintain business-focused tone`;
    } else {
      return `CRITICAL: Respond in ${detectedLanguage.toUpperCase()}.
- Match the tone and formality of the original message
- Use appropriate professional closing format for the language
- Never mix languages in your response`;
    }
  }

  public setGeminiClient(geminiClient: any): void {
    this.geminiClient = geminiClient;
  }

  public async analyzePersonalPriorities(): Promise<PersonalPriorities> {
    if (!this.geminiClient) {
      throw new Error('GeminiClient not set. Call setGeminiClient() first.');
    }
    return await this.geminiClient.analyzePersonalPriorities();
  }

  public async generateInitialQuestions(recruiterType: string): Promise<string> {
    if (!this.geminiClient) {
      throw new Error('GeminiClient not set. Call setGeminiClient() first.');
    }
    
    // Get or calculate personal priorities first
    if (!this.personalPriorities) {
      this.personalPriorities = await this.analyzePersonalPriorities();
    }
    
    return await this.geminiClient.generateInitialQuestions(recruiterType, this.personalPriorities);
  }

  public async generateFollowUpResponse(conversationHistory: ConversationHistory): Promise<string> {
    if (!this.geminiClient) {
      throw new Error('GeminiClient not set. Call setGeminiClient() first.');
    }
    
    // Evaluate the fit first if not already done
    if (!conversationHistory.fitAnalysis) {
      const lastRecruiterMessage = conversationHistory.messages
        .filter(m => m.sender === 'recruiter')
        .pop();
      
      if (lastRecruiterMessage) {
        conversationHistory.fitAnalysis = await this.geminiClient.evaluateJobFit(
          lastRecruiterMessage.content, 
          conversationHistory
        );
      }
    }
    
    return await this.geminiClient.generateFollowUpResponse(conversationHistory, conversationHistory.fitAnalysis!);
  }

  public async evaluateJobFit(recruiterResponses: string, conversationHistory: ConversationHistory): Promise<FitAnalysis> {
    if (!this.geminiClient) {
      throw new Error('GeminiClient not set. Call setGeminiClient() first.');
    }
    return await this.geminiClient.evaluateJobFit(recruiterResponses, conversationHistory);
  }

  public updateConversationHistory(conversationId: string, message: ConversationMessage): void {
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, {
        messages: [],
        currentPhase: 'initial'
      });
    }
    
    const conversation = this.conversations.get(conversationId)!;
    conversation.messages.push(message);
    
    // Update phase based on message count and content
    if (conversation.messages.length > 2) {
      conversation.currentPhase = 'follow_up';
    }
  }

  public getConversationHistory(conversationId: string): ConversationHistory | undefined {
    return this.conversations.get(conversationId);
  }

  public clearConversationHistory(conversationId: string): void {
    this.conversations.delete(conversationId);
  }

  public async calculateMatchScore(_opportunityText: string): Promise<number> {
    // This would be called by the GeminiClient using LLM analysis
    // The LLM will analyze the opportunity against personal priorities
    throw new Error('This method should be called from GeminiClient with LLM analysis');
  }

  public getEnthusiasmLevel(matchScore: number): string {
    const thresholds = this.systemPrompt.ai_behavior.matching_strategy.decision_thresholds;
    
    if (matchScore >= thresholds.dream_job) return 'high';
    if (matchScore >= thresholds.interested) return 'medium';
    if (matchScore >= thresholds.exploring) return 'low';
    return 'decline';
  }

  public getProfile(): Profile {
    return this.profile;
  }

  public getSystemPrompt(): SystemPrompt {
    return this.systemPrompt;
  }

  public buildClassificationPrompt(messageContent: string, senderName: string): string {
    return `Analyze this LinkedIn message deeply and classify the sender type. Use sophisticated reasoning to understand context, implications, and conversation patterns.

MESSAGE FROM: ${senderName}
MESSAGE CONTENT: "${messageContent}"

Classify the sender as one of these types:
- INTERNAL_RECRUITER: Employee of the hiring company (HR, talent acquisition, hiring manager)
- EXTERNAL_RECRUITER: Third-party recruiter or agency representing a client company
- COLLEAGUE: Former colleague, current colleague, or professional contact reconnecting
- NETWORKING: Someone looking to connect professionally, build network, or general networking
- SALES: Someone trying to sell services, products, or business opportunities
- SPAM: Generic messages, obvious spam, or irrelevant content
- OTHER: Doesn't fit the above categories

Key reasoning principles:

1. **CONTEXT ANALYSIS**: Understand what the message implies about previous conversations
   - References to "extra info" or "more information" suggest ongoing job discussions
   - Mentions of colleagues calling to "explain" or "discuss" indicate recruitment processes
   - Vacation context with promises of follow-up calls about opportunities

2. **CONVERSATION CONTINUITY**: Recognize follow-up messages in recruitment conversations
   - Even casual messages can be part of professional recruitment if they reference:
     * Previous discussions about roles/opportunities
     * Colleagues who will provide job details
     * Scheduling calls to discuss positions

3. **EXTERNAL_RECRUITER patterns include**:
   - Agency recruiters who coordinate with colleagues to explain client opportunities
   - References to having colleagues call to provide job details
   - Continuation of previous recruitment conversations (even if casual in tone)
   - Messages about providing additional information on job opportunities

4. **MULTILINGUAL CONTEXT**:
   - Dutch phrases like "extra info verschaffen", "collega bellen om toe te lichten" are recruitment language
   - Understand cultural communication patterns in professional Dutch contexts

5. **SOPHISTICATED REASONING**: Don't just look for obvious recruitment keywords
   - Understand the professional relationship context
   - Recognize recruitment process patterns
   - Identify handoff scenarios between recruitment team members

Use your advanced language understanding to recognize nuanced recruitment conversations, even when they don't use explicit recruitment terminology.

Respond with only the classification: INTERNAL_RECRUITER, EXTERNAL_RECRUITER, COLLEAGUE, NETWORKING, SALES, SPAM, or OTHER`;
  }
}