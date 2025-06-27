# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Core Development:**
- `npm run dev` - Hot reload development mode using tsx
- `npm run build` - TypeScript compilation to dist/
- `npm start` - Run compiled application

**Run Modes (Critical):**
- `npm run start:safe` - Safe mode: full pipeline except message sending (default for testing)
- `npm run start:debug` - Debug mode with verbose logging
- `npm run start:prod` - Production mode: ⚠️ ACTUALLY SENDS LINKEDIN MESSAGES

**Utilities:**
- `npm run view:responses` - View generated response history
- `npm run setup` - Initial configuration setup

**Environment Variables:**
- `RUN_MODE`: safe|debug|production (controls message sending)
- `LINKEDIN_EMAIL` & `LINKEDIN_PASSWORD` - Required for LinkedIn automation
- `GEMINI_API_KEY` - Required for AI response generation

## Architecture Overview

Linky is a conversational AI agent for LinkedIn automation with a safety-first design. The architecture follows an agent pattern where specialized components handle different aspects of the automation pipeline.

### Core Flow
```
LinkedInAgent (orchestrator) → Browser Automation → Message Extraction
     ↓
GeminiClient (AI) → Recruiter Classification → Response Generation
     ↓  
SafeModeHandler → Mode-Aware Execution → Message Sending/Logging
```

### Key Components

**LinkedInAgent** (`src/agents/linkedin-agent.ts`):
- Main orchestrator using Playwright for browser automation
- Implements anti-detection measures (realistic mouse movements, delays, user agents)
- Handles login with multiple selector fallbacks for UI changes
- Manages session lifecycle and cleanup

**GeminiClient** (`src/agents/gemini-client.ts`):
- Google Gemini AI integration with safety settings
- Recruiter type detection (INTERNAL_RECRUITER vs EXTERNAL_RECRUITER)
- Multi-phase conversation management (initial → follow_up → decision)
- Job fit analysis based on user profile
- Strategic salary inquiry (extract their range without revealing ours)

**YamlConfig** (`src/utils/yaml-config.ts`):
- Configuration management for profile and system prompts
- Conversation history tracking across multiple exchanges
- Personal priorities analysis for job matching
- Profile-driven response personalization

**SafeModeHandler** (`src/agents/safe-mode-handler.ts`):
- Mode-aware action execution (prevents accidental message sending)
- Response tracking to prevent duplicates
- Message composition and sending pipeline

### Configuration System

**Profile Configuration** (`config/profile.yaml`):
- Personal preferences: salary, schedule, location, must-haves
- Skills, interests, and company type preferences  
- AI disclosure settings (optional transparency about AI assistance)
- Used for job fit analysis and response personalization

**System Prompts** (`config/system-prompt.yaml`):
- AI behavior control and response templates
- Language-specific rules (Dutch/English automatic detection)
- Professional guidelines and enthusiasm levels
- Strategic conversation tactics

### Safety Architecture

**Three-Tier Run Mode System:**
- SAFE: Full automation except message sending (for testing)
- DEBUG: Safe mode with verbose logging
- PRODUCTION: Live message sending (use with extreme caution)

**Protection Mechanisms:**
- Prompt injection sanitization in GeminiClient
- Response tracking prevents duplicate messages to same recruiter
- Screenshot capture for debugging
- Comprehensive logging with Winston

### Conversation Intelligence

**Multi-Turn Conversations:**
- Maintains conversation state across LinkedIn message exchanges
- Context-aware follow-up responses
- Job fit scoring influences response strategy

**Dynamic Question Generation:**
- Questions generated based on user profile and missing job information
- Recruiter type determines appropriate question set
- Strategic salary discussions (extract their budget first)

### Key Architectural Patterns

**Agent Pattern:** LinkedInAgent orchestrates specialized components
**Strategy Pattern:** Different behaviors based on run mode and recruiter type  
**Template Method:** YAML-driven prompt building with variable substitution
**Factory Pattern:** Message classification and response generation based on context

### Development Considerations

**Testing Strategy:**
- Always test in SAFE mode first
- Use DEBUG mode for troubleshooting AI responses
- Only use PRODUCTION mode when confident

**Configuration Updates:**
- Profile changes affect job matching and personalization
- System prompt changes affect AI behavior and tone
- Both support hot reloading in development mode

**Browser Automation:**
- LinkedIn UI changes frequently - update selectors in linkedin-agent.ts
- Human-like behavior prevents detection - maintain realistic delays
- Screenshot debugging available in logs/ directory

**AI Integration:**
- Gemini API has rate limits and token limits
- Safety settings prevent harmful content generation
- Response parsing handles markdown-wrapped JSON responses

### File Priority for Understanding
1. `src/index.ts` - Entry point and session management
2. `src/agents/linkedin-agent.ts` - Core automation and browser control
3. `src/agents/gemini-client.ts` - AI conversation management
4. `config/system-prompt.yaml` - AI behavior configuration
5. `config/profile.example.yaml` - User preference structure