import dotenv from 'dotenv';
import { GeminiClient } from './src/agents/gemini-client';
import { LinkedInMessage } from './src/types';

// Load environment variables
dotenv.config();

// Test the Gemini client with mock messages
async function testGemini() {
  console.log('🤖 Testing Gemini client...');
  
  // Mock test messages (both English and Dutch)
  const testMessages: LinkedInMessage[] = [
    {
      id: 'test-1',
      senderId: 'recruiter-1',
      senderName: 'John Smith',
      senderTitle: 'Technical Recruiter',
      senderCompany: 'TechCorp',
      content: 'Hi! I have an exciting Cloud Platform Engineer role at our company in Amsterdam. We work with Kubernetes, AI/ML, and offer hybrid work. The salary is €90k and we have a 4-day work week option. Would you be interested to learn more?',
      timestamp: new Date(),
      isRecruiter: true,
      hasJobOpportunity: true,
    },
    {
      id: 'test-2',
      senderId: 'recruiter-2',
      senderName: 'Marie van der Berg',
      senderTitle: 'Recruitment Consultant',
      senderCompany: 'Dutch Tech BV',
      content: 'Hallo! Ik heb een mooie functie als Cloud Platform Engineer bij een innovatief bedrijf in Amsterdam. Ze werken veel met AI en Kubernetes. De functie is hybride (2 dagen kantoor) en er is mogelijkheid voor een 4-daagse werkweek. Salaris rondom €85k. Interesse?',
      timestamp: new Date(),
      isRecruiter: true,
      hasJobOpportunity: true,
    },
    {
      id: 'test-3',
      senderId: 'recruiter-3',
      senderName: 'Alice Johnson',
      senderTitle: 'HR Manager',
      senderCompany: 'Legacy Corp',
      content: 'We have a great opportunity for a full-time office-based Java developer in Rotterdam. 5 days per week, traditional enterprise environment. €70k salary.',
      timestamp: new Date(),
      isRecruiter: true,
      hasJobOpportunity: true,
    }
  ];

  // Check if we have the API key
  if (!process.env.GEMINI_API_KEY) {
    console.log('❌ GEMINI_API_KEY not found in environment');
    console.log('Please set it by running: export GEMINI_API_KEY="your-api-key"');
    return;
  }

  try {
    const client = new GeminiClient(process.env.GEMINI_API_KEY);
    
    // Test connection first
    console.log('🔌 Testing connection...');
    const connected = await client.testConnection();
    if (!connected) {
      console.log('❌ Failed to connect to Gemini');
      return;
    }
    console.log('✅ Connected to Gemini!');

    // Test each message
    for (const message of testMessages) {
      console.log(`\n📩 Testing message from ${message.senderName}:`);
      console.log(`"${message.content.substring(0, 80)}..."`);
      
      try {
        const response = await client.generateResponse(message);
        console.log(`\n🤖 Generated response:`);
        console.log(`"${response}"`);
        console.log('---');
      } catch (error) {
        console.log(`❌ Error generating response: ${error}`);
      }
    }
    
    console.log('\n🎉 Test completed!');
  } catch (error) {
    console.log(`❌ Test failed: ${error}`);
  }
}

testGemini();