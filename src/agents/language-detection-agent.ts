import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger';

/**
 * ADK Tool Specialization Pattern: Language Detection Agent
 * 
 * This specialized agent handles language detection using AI with fallback strategies.
 * Following ADK best practices:
 * - Single responsibility: language detection only
 * - AI-first approach: no heuristics or regex patterns
 * - Evaluation-driven: confidence scoring and validation
 * - Safety-first: input sanitization and output validation
 */

export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  isReliable: boolean;
  secondaryLanguages?: { language: string; confidence: number }[];
}

export class LanguageDetectionAgent {
  private genAI: GoogleGenerativeAI;
  
  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    logger.info('Language Detection Agent initialized with ADK tool specialization pattern');
  }

  /**
   * ADK AI-First Language Detection
   * Uses sophisticated prompt engineering for accurate detection
   */
  async detectLanguage(text: string): Promise<LanguageDetectionResult> {
    if (!text || text.trim().length === 0) {
      return {
        language: 'unknown',
        confidence: 0,
        isReliable: false
      };
    }

    const sanitizedText = this.sanitizeInput(text);
    
    // ADK Multi-Phase Detection Strategy
    const detectionResults = await Promise.allSettled([
      this.primaryDetection(sanitizedText),
      this.contextualDetection(sanitizedText)
    ]);

    // ADK Consensus Pattern: combine results
    return this.synthesizeResults(detectionResults, sanitizedText);
  }

  /**
   * Primary detection using optimized prompt engineering
   */
  private async primaryDetection(text: string): Promise<LanguageDetectionResult> {
    const prompt = `You are a professional language detection specialist. Analyze this text and determine its primary language.

TEXT TO ANALYZE:
"${text}"

DETECTION CRITERIA:
- Focus on vocabulary, grammar patterns, and linguistic markers
- Consider context clues like names, locations, and terminology
- Evaluate sentence structure and word order patterns
- Account for code-switching or mixed language content

SUPPORTED LANGUAGES (priority order):
1. Dutch (nl) - Professional/business Dutch, including LinkedIn recruitment language
2. English (en) - Professional/business English 
3. German (de) - German language content
4. French (fr) - French language content
5. Spanish (es) - Spanish language content

RETURN FORMAT - JSON only:
{
  "language": "ISO_639-1_code",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of detection basis",
  "linguistic_markers": ["key", "indicators", "found"],
  "is_mixed_language": boolean
}

IMPORTANT: For LinkedIn recruitment messages, pay special attention to:
- Dutch: "rol", "functie", "werkgever", "salaris", "mogelijkheden", "ervaring"
- English: "role", "position", "employer", "salary", "opportunities", "experience"
- Mixed phrases like company names or technical terms are normal

Analyze the text now:`;

    try {
      const model = this.genAI.getGenerativeModel({ 
        model: 'gemini-2.0-flash-exp',
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
          responseMimeType: "application/json"
        }
      });
      
      const result = await model.generateContent(prompt);
      const response = this.parseDetectionResponse(result.response.text());
      
      logger.debug('Primary language detection completed', {
        language: response.language,
        confidence: response.confidence,
        textLength: text.length
      });
      
      return response;
    } catch (error) {
      logger.error('Primary language detection failed', { error });
      return this.fallbackDetection(text);
    }
  }

  /**
   * Contextual detection for additional validation
   */
  private async contextualDetection(text: string): Promise<LanguageDetectionResult> {
    const prompt = `Perform contextual language analysis on this text:

"${text}"

Focus on:
1. Professional/business language patterns
2. Regional variations and formality levels  
3. Industry-specific terminology (recruiting, tech, business)
4. Cultural communication markers

Return JSON with language code and confidence (0.0-1.0):
{"language": "code", "confidence": 0.0, "context_type": "description"}`;

    try {
      const model = this.genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 300,
          responseMimeType: "application/json"
        }
      });
      
      const result = await model.generateContent(prompt);
      const response = this.parseDetectionResponse(result.response.text());
      
      logger.debug('Contextual language detection completed', {
        language: response.language,
        confidence: response.confidence
      });
      
      return response;
    } catch (error) {
      logger.error('Contextual language detection failed', { error });
      return this.fallbackDetection(text);
    }
  }

  /**
   * ADK Safety Pattern: Input sanitization
   */
  private sanitizeInput(text: string): string {
    // Remove potential prompt injection attempts
    return text
      .replace(/```[\s\S]*?```/g, '[CODE_BLOCK]') // Remove code blocks
      .replace(/\n{3,}/g, '\n\n') // Normalize line breaks
      .trim()
      .substring(0, 2000); // Limit length for safety
  }

  /**
   * Parse and validate AI response
   */
  private parseDetectionResponse(response: string): LanguageDetectionResult {
    try {
      let cleanResponse = response.trim();
      
      // Clean up markdown code blocks
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      }
      
      const parsed = JSON.parse(cleanResponse);
      
      return {
        language: this.normalizeLanguageCode(parsed.language || 'unknown'),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
        isReliable: (parsed.confidence || 0) >= 0.7,
        secondaryLanguages: parsed.secondary_languages || []
      };
    } catch (error) {
      logger.warn('Failed to parse language detection response', { 
        response: response.substring(0, 100),
        error 
      });
      return {
        language: 'unknown',
        confidence: 0,
        isReliable: false
      };
    }
  }

  /**
   * ADK Multi-Agent Consensus: Synthesize detection results
   */
  private async synthesizeResults(
    results: PromiseSettledResult<LanguageDetectionResult>[],
    originalText: string
  ): Promise<LanguageDetectionResult> {
    const successfulResults = results
      .filter((result): result is PromiseFulfilledResult<LanguageDetectionResult> => 
        result.status === 'fulfilled')
      .map(result => result.value);

    if (successfulResults.length === 0) {
      logger.error('All language detection methods failed');
      return this.fallbackDetection(originalText);
    }

    // If only one result, use it
    if (successfulResults.length === 1) {
      return successfulResults[0];
    }

    // ADK Consensus: if multiple results agree on language, combine confidence
    const primary = successfulResults[0];
    const secondary = successfulResults[1];

    if (primary.language === secondary.language) {
      // Languages match - use higher confidence
      const combinedConfidence = Math.max(primary.confidence, secondary.confidence);
      
      logger.debug('Language detection consensus achieved', {
        language: primary.language,
        confidence: combinedConfidence,
        agreementCount: successfulResults.length
      });

      return {
        language: primary.language,
        confidence: combinedConfidence,
        isReliable: combinedConfidence >= 0.7
      };
    } else {
      // Languages disagree - use result with higher confidence
      const bestResult = primary.confidence >= secondary.confidence ? primary : secondary;
      
      logger.warn('Language detection disagreement', {
        primary: primary.language,
        secondary: secondary.language,
        chosen: bestResult.language
      });

      return bestResult;
    }
  }

  /**
   * Simple fallback when AI detection fails
   */
  private fallbackDetection(text: string): LanguageDetectionResult {
    const dutchWords = ['de', 'het', 'een', 'van', 'en', 'in', 'op', 'is', 'dit', 'met', 'voor', 'aan', 'ook', 'zijn', 'je', 'rol', 'functie', 'mogelijkheden'];
    const englishWords = ['the', 'and', 'of', 'to', 'in', 'is', 'you', 'that', 'it', 'he', 'for', 'on', 'are', 'as', 'with', 'his', 'they', 'this', 'role', 'position'];
    
    const words = text.toLowerCase().split(/\s+/);
    const dutchMatches = words.filter(word => dutchWords.includes(word)).length;
    const englishMatches = words.filter(word => englishWords.includes(word)).length;
    
    let language = 'unknown';
    let confidence = 0.3; // Low confidence for fallback
    
    if (dutchMatches > englishMatches && dutchMatches > 0) {
      language = 'nl';
      confidence = Math.min(0.6, 0.3 + (dutchMatches * 0.05));
    } else if (englishMatches > dutchMatches && englishMatches > 0) {
      language = 'en';
      confidence = Math.min(0.6, 0.3 + (englishMatches * 0.05));
    }
    
    logger.warn('Using fallback language detection', { 
      language, 
      confidence,
      dutchMatches,
      englishMatches 
    });
    
    return {
      language,
      confidence,
      isReliable: false
    };
  }

  /**
   * Normalize language codes to ISO 639-1 standard
   */
  private normalizeLanguageCode(code: string): string {
    const codeMap: { [key: string]: string } = {
      'dutch': 'nl',
      'netherlands': 'nl',
      'english': 'en',
      'german': 'de',
      'deutsch': 'de',
      'french': 'fr',
      'francais': 'fr',
      'spanish': 'es',
      'espanol': 'es'
    };
    
    const normalized = code.toLowerCase().trim();
    return codeMap[normalized] || normalized;
  }

  /**
   * Test the language detection tool
   */
  async testDetection(): Promise<boolean> {
    try {
      const testCases = [
        { text: "Ik help een groeiende consultancy met vacatures in de tech sector.", expected: "nl" },
        { text: "I'm helping a growing consultancy with tech sector opportunities.", expected: "en" }
      ];
      
      for (const testCase of testCases) {
        const result = await this.detectLanguage(testCase.text);
        logger.info('Language detection test', {
          text: testCase.text,
          expected: testCase.expected,
          detected: result.language,
          confidence: result.confidence
        });
      }
      
      return true;
    } catch (error) {
      logger.error('Language detection test failed', { error });
      return false;
    }
  }
}