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
  ai_disclosure?: {
    enabled: boolean;
    message: string;
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

  public async buildPrompt(messageContent: string, recruiterName: string, recruiterType: string = 'EXTERNAL_RECRUITER', conversationHistory?: ConversationHistory): Promise<string> {
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
    
    return template
      .replace('{name}', this.profile.personal.name)
      .replace('{current_role}', this.profile.personal.current_role)
      .replace('{location}', this.profile.personal.location)
      .replace('{recruiter_name}', recruiterName)
      .replace('{message_content}', messageContent)
      .replace('{profile_summary}', this.buildProfileSummary())
      .replace('{requirements_summary}', this.buildRequirementsSummary())
      .replace('{instructions_list}', this.buildInstructionsList())
      .replace('{questions_list}', questionsList);
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
    return `Analyze this LinkedIn message and classify the sender type.

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

Consider these indicators for recruiter classification:

INTERNAL_RECRUITER indicators:
- Email domain matches the hiring company
- Job title includes company name or "at [Company]"
- Mentions "we are looking for", "our team", "join us"
- Direct company representative language
- Specific internal role details

EXTERNAL_RECRUITER indicators:
- Works for recruitment agency/consultancy
- Mentions "client", "on behalf of", "representing"
- Agency name in profile/signature
- Multiple job opportunities mentioned
- Commission-based language patterns

Respond with only the classification: INTERNAL_RECRUITER, EXTERNAL_RECRUITER, COLLEAGUE, NETWORKING, SALES, SPAM, or OTHER`;
  }
}