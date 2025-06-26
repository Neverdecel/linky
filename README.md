# Linky 🤖

An intelligent LinkedIn automation agent that responds to recruiter messages using Google Gemini AI. Linky analyzes job opportunities against your personal preferences and generates contextual responses to help streamline your job search process.

## ✨ Features

- **AI-Powered Conversations**: Uses Google Gemini to generate intelligent, contextual responses
- **Recruiter Type Detection**: Automatically identifies internal vs external recruiters
- **Dynamic Question Generation**: Asks relevant questions based on your profile and job requirements
- **Multi-turn Conversations**: Supports follow-up responses and ongoing conversations
- **Salary Discretion**: Strategically extracts salary ranges without revealing your expectations
- **Bilingual Support**: Responds appropriately in Dutch or English
- **Safety Features**: Built-in prompt injection protection and safe mode testing
- **Optional AI Disclosure**: Configurable transparency about AI assistance

## 🚀 Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/Neverdecel/linky.git
cd linky

# 2. Install dependencies
npm install

# 3. Set up configuration
cp .env.example .env
cp config/profile.example.yaml config/profile.yaml

# 4. Configure your credentials and preferences
# Edit .env and config/profile.yaml

# 5. Test in safe mode (no messages sent)
npm run start:safe
```

## 📋 Prerequisites

- Node.js 18+
- Google Gemini API key ([Get one here](https://aistudio.google.com/app/apikey))  
- LinkedIn account credentials
- Playwright browser automation

## 🔧 Configuration

### 1. Environment Variables (`.env`)
```env
# Run mode: safe, debug, production
RUN_MODE=safe

# LinkedIn credentials
LINKEDIN_EMAIL=your-email@example.com
LINKEDIN_PASSWORD=your-password

# Google Gemini API
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=models/gemini-2.0-flash

# Logging
LOG_LEVEL=debug
```

### 2. Profile Configuration (`config/profile.yaml`)
Customize your job preferences, requirements, and personal information:

```yaml
personal:
  name: "Your Name"
  current_role: "Software Engineer"
  location: "Amsterdam, Netherlands"

requirements:
  salary:
    minimum: 85000
    ideal: 95000
    currency: EUR
  
  schedule:
    days_per_week: 4
    hours_per_day: 8
    
  must_have:
    - "Modern tech stack"
    - "Hybrid work options"
    - "Good work-life balance"

ai_disclosure:
  enabled: false  # Set to true to disclose AI assistance
  message: "✨ AI-assisted response"
```

### 3. System Prompts (`config/system-prompt.yaml`)
Fine-tune the AI's behavior and response style.

## 🎯 Usage

### Safe Mode (Recommended for Testing)
```bash
npm run start:safe
```
- ✅ Logs into LinkedIn
- ✅ Reads messages  
- ✅ Generates responses
- ❌ Does NOT send messages

### Debug Mode
```bash
npm run start:debug
```
- Same as safe mode but with detailed logging

### Production Mode ⚠️
```bash
npm run start:prod
```
**WARNING**: This will send actual messages to recruiters!

### View Generated Responses
```bash
npm run view:responses
```

## 🏗️ How It Works

1. **Message Analysis**: Scans LinkedIn messages for recruiter communications
2. **Recruiter Classification**: Identifies if recruiter is internal or external
3. **Profile Matching**: Analyzes job opportunity against your preferences
4. **Dynamic Questions**: Generates relevant questions based on missing information
5. **Response Generation**: Creates contextual, professional responses
6. **Safety Checks**: Validates responses before sending
7. **Conversation Tracking**: Maintains context for follow-up interactions

## 📁 Project Structure

```
linky/
├── src/
│   ├── agents/              # Core automation agents
│   │   ├── linkedin-agent.ts    # LinkedIn interaction logic
│   │   ├── gemini-client.ts     # AI response generation
│   │   └── safe-mode-handler.ts # Message sending logic
│   ├── utils/               # Utilities and helpers
│   └── types/               # TypeScript definitions
├── config/
│   ├── profile.yaml         # Your job preferences (private)
│   ├── profile.example.yaml # Template for configuration
│   └── system-prompt.yaml   # AI behavior configuration
├── logs/                    # Application logs
├── screenshots/             # Debug screenshots
└── data/                    # Response history and tracking
```

## 🛡️ Security & Safety

- **Input Sanitization**: Protects against prompt injection attacks
- **Gemini Safety Settings**: Uses Google's built-in content filtering
- **Safe Mode Testing**: Test everything before going live
- **Response Tracking**: Prevents duplicate responses to the same recruiter
- **Privacy Protection**: Personal data excluded from repository

## 🔍 Advanced Features

### AI Disclosure
Configure transparent AI assistance disclosure:
```yaml
ai_disclosure:
  enabled: true
  message: "✨ AI-assisted response"
```

### Conversation State Tracking
- Maintains context across multiple message exchanges
- Supports follow-up questions and clarifications
- Tracks job fit analysis and decision making

### Salary Strategy
- Strategically extracts recruiter's budget without revealing yours
- Uses collected information for fit analysis
- Maintains professional discretion

## 📊 Monitoring & Debugging

- **Structured Logging**: Winston-based logging with multiple levels
- **Screenshots**: Automatic capture during automation steps
- **Response History**: Track all generated and sent responses
- **Performance Metrics**: Monitor API usage and response times

## 🚨 Troubleshooting

### Common Issues

1. **Login Failures**
   - Verify LinkedIn credentials in `.env`
   - Check for 2FA requirements
   - Ensure account isn't restricted

2. **Message Not Sending**
   - Confirm `RUN_MODE=production` in `.env`
   - Check safe mode overrides
   - Verify LinkedIn UI selectors

3. **AI Response Errors**
   - Validate Gemini API key
   - Check API quotas and billing
   - Review prompt length limits

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This tool is for educational and personal use. Users are responsible for complying with LinkedIn's Terms of Service and applicable laws. Use responsibly and ethically.

---

**Made with ❤️ for intelligent job searching**