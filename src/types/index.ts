export enum RunMode {
  PRODUCTION = 'production',
  SAFE = 'safe',
  DEBUG = 'debug'
}

export interface LinkedInMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderTitle?: string;
  senderCompany?: string;
  content: string;
  timestamp: Date;
  isRecruiter: boolean;
  hasJobOpportunity: boolean;
  conversationId?: string;
  messageClassification?: string;
}


export interface UserPreferences {
  roles: string[];
  currentSalary: {
    amount: number;
    currency: string;
    hoursPerWeek: number;
  };
  minSalary: {
    amount: number;
    currency: string;
    note?: string;
  };
  workSchedule: {
    preferredDaysPerWeek: number;
    hoursPerDay: number;
    totalHoursPerWeek: number;
    flexibility: string;
  };
  locations: {
    homeBase: string;
    maxCommuteMinutes: number;
    acceptableOffices: string[];
    workStyle: string;
  };
  techStack: string[];
  interests: string[];
  companySize: ('startup' | 'scaleup' | 'midsize' | 'enterprise')[];
  mustHave: string[];
  dealBreakers: string[];
}

export interface PlannedResponse {
  messageId: string;
  recipientId: string;
  recipientName: string;
  content: string;
  geminiPrompt: string;
  geminiResponse: string;
  createdAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'sent';
  sentAt?: Date;
}

export interface ActionLog {
  id: string;
  action: string;
  details: Record<string, any>;
  timestamp: Date;
  mode: RunMode;
  screenshot?: string;
  success: boolean;
  error?: string;
}

export interface Config {
  runMode: RunMode;
  linkedin: {
    email: string;
    password: string;
  };
  gemini: {
    apiKey: string;
    model: string;
    temperature: number;
  };
  database: {
    url: string;
  };
  safeMode: {
    captureScreenshots: boolean;
    logAllActions: boolean;
    mockDelayMs: number;
    requireApproval: boolean;
  };
  server: {
    port: number;
  };
}