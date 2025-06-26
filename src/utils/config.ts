import dotenv from 'dotenv';
import { Config, RunMode } from '../types';

dotenv.config();

function getRunMode(): RunMode {
  const mode = process.env.RUN_MODE?.toLowerCase();
  switch (mode) {
    case 'production':
      return RunMode.PRODUCTION;
    case 'debug':
      return RunMode.DEBUG;
    case 'safe':
    default:
      return RunMode.SAFE;
  }
}

export const config: Config = {
  runMode: getRunMode(),
  linkedin: {
    email: process.env.LINKEDIN_EMAIL || '',
    password: process.env.LINKEDIN_PASSWORD || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'models/gemini-2.0-flash',
    temperature: parseFloat(process.env.GEMINI_TEMPERATURE || '0.7'),
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/linky',
  },
  safeMode: {
    captureScreenshots: process.env.CAPTURE_SCREENSHOTS === 'true',
    logAllActions: true,
    mockDelayMs: parseInt(process.env.MOCK_DELAY_MS || '2000', 10),
    requireApproval: process.env.REQUIRE_APPROVAL === 'true',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  },
};

export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.linkedin.email) {
    errors.push('LINKEDIN_EMAIL is required');
  }

  if (!config.linkedin.password) {
    errors.push('LINKEDIN_PASSWORD is required');
  }

  if (!config.gemini.apiKey) {
    errors.push('GEMINI_API_KEY is required');
  }

  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach(error => console.error(`- ${error}`));
    
    if (config.runMode === RunMode.PRODUCTION) {
      throw new Error('Configuration validation failed');
    } else {
      console.warn('Running in non-production mode with configuration errors');
    }
  }
}