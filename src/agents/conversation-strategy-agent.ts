import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { config } from '../utils/config';
import { ConversationHistory, ConversationMessage } from '../utils/yaml-config';
import { STRATEGIC_ANALYSIS_PROMPT, RESPONSE_OPTIMIZATION_PROMPT } from '../utils/adk-prompt-templates';
import logger from '../utils/logger';

interface ConversationGoal {
  type: 'qualify_opportunity' | 'extract_details' | 'maintain_control' | 'graceful_exit';
  priority: number;
  status: 'pending' | 'in_progress' | 'completed';
}

interface StrategicAction {
  action: 'ask_question' | 'express_interest' | 'request_info' | 'deflect_pressure' | 'close_conversation';
  content: string;
  reasoning: string;
  expectedOutcome: string;
}

interface ConversationStrategy {
  currentGoals: ConversationGoal[];
  nextActions: StrategicAction[];
  informationGaps: string[];
  recruiterProfile: {
    style: 'pushy' | 'collaborative' | 'professional' | 'unclear';
    responsiveness: 'high' | 'medium' | 'low';
    credibility: 'high' | 'medium' | 'low';
  };
  conversationPhase: 'initial_contact' | 'information_gathering' | 'mutual_evaluation' | 'decision_making' | 'negotiation';
}

export class ConversationStrategyAgent {
  private model: GenerativeModel;

  constructor(apiKey: string) {
    const genAI = new GoogleGenerativeAI(apiKey);
    // For now, use basic model without complex tools to avoid TypeScript issues
    this.model = genAI.getGenerativeModel({ 
      model: config.gemini.model
    });
  }

  async analyzeConversationState(
    conversationHistory: ConversationHistory,
    currentMessage: ConversationMessage,
    userGoals: any
  ): Promise<ConversationStrategy> {
    const prompt = `${STRATEGIC_ANALYSIS_PROMPT}

CURRENT CONVERSATION:
${conversationHistory.messages.map(m => `${m.sender}: ${m.content}`).join('\n')}

LATEST RECRUITER MESSAGE: ${currentMessage.content}

USER PROFILE & GOALS:
${JSON.stringify(userGoals, null, 2)}

Using the multi-step reasoning framework above, analyze this conversation and provide strategic recommendations for the next response. Use the available tools to:

1. Analyze recruiter communication style and tactics
2. Prioritize information gaps that need addressing
3. Optimize question sequencing for this specific recruiter
4. Generate strategic response recommendations

Focus on maintaining conversation control while efficiently extracting key information for decision-making.`;

    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3, // Lower temperature for strategic thinking
          maxOutputTokens: 1000,
        },
      });

      const response = result.response;
      
      // Process function calls if any
      const functionCalls = response.functionCalls();
      if (functionCalls) {
        for (const call of functionCalls) {
          logger.debug('Strategy agent function call', { 
            name: call.name, 
            args: call.args 
          });
        }
      }

      // Extract strategic analysis from response
      const strategy = this.parseStrategyFromResponse(response.text());
      
      logger.debug('Conversation strategy analyzed', {
        phase: strategy.conversationPhase,
        goalCount: strategy.currentGoals.length,
        actionCount: strategy.nextActions.length
      });

      return strategy;
    } catch (error) {
      logger.error('Failed to analyze conversation strategy', { error });
      
      // Fallback strategy
      return {
        currentGoals: [
          { type: 'qualify_opportunity', priority: 1, status: 'pending' }
        ],
        nextActions: [
          {
            action: 'request_info',
            content: 'Ask for key details about the opportunity',
            reasoning: 'Need basic information to evaluate fit',
            expectedOutcome: 'Recruiter provides job details'
          }
        ],
        informationGaps: ['salary_range', 'remote_work_policy', 'tech_stack'],
        recruiterProfile: {
          style: 'unclear',
          responsiveness: 'medium',
          credibility: 'medium'
        },
        conversationPhase: 'information_gathering'
      };
    }
  }

  private parseStrategyFromResponse(_responseText: string): ConversationStrategy {
    // Parse the AI response to extract structured strategy
    // This would typically involve JSON parsing or structured text analysis
    
    // For now, return a sensible default strategy
    return {
      currentGoals: [
        { type: 'qualify_opportunity', priority: 1, status: 'in_progress' },
        { type: 'extract_details', priority: 2, status: 'pending' }
      ],
      nextActions: [
        {
          action: 'request_info',
          content: 'Request specific information about role requirements and compensation',
          reasoning: 'Need to understand opportunity value before investing more time',
          expectedOutcome: 'Recruiter provides concrete details'
        }
      ],
      informationGaps: ['salary_range', 'remote_work_policy', 'ai_ml_projects', 'tech_stack'],
      recruiterProfile: {
        style: 'professional',
        responsiveness: 'medium',
        credibility: 'medium'
      },
      conversationPhase: 'information_gathering'
    };
  }

  async optimizeResponse(
    baseResponse: string,
    strategy: ConversationStrategy,
    conversationHistory: ConversationHistory
  ): Promise<string> {
    const prompt = `${RESPONSE_OPTIMIZATION_PROMPT}

BASE RESPONSE TO OPTIMIZE: "${baseResponse}"

STRATEGIC CONTEXT:
- Conversation Phase: ${strategy.conversationPhase}
- Primary Goal: ${strategy.currentGoals[0]?.type}
- Information Gaps: ${strategy.informationGaps.join(', ')}
- Recruiter Style: ${strategy.recruiterProfile.style}
- Next Actions: ${strategy.nextActions.map(a => a.action).join(', ')}

CONVERSATION HISTORY:
${conversationHistory.messages.slice(-4).map(m => `${m.sender}: ${m.content}`).join('\n')}

Apply the optimization framework to enhance this response for maximum strategic effectiveness while maintaining natural conversation flow.`;

    try {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 300,
        },
      });

      const optimizedResponse = result.response.text().trim();
      
      logger.debug('Response optimized by strategy agent', {
        originalLength: baseResponse.length,
        optimizedLength: optimizedResponse.length
      });

      return optimizedResponse;
    } catch (error) {
      logger.error('Failed to optimize response', { error });
      return baseResponse; // Fallback to original response
    }
  }
}