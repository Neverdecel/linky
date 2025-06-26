# Contributing to Linky

Thank you for your interest in contributing to Linky! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Create a new branch for your feature or bugfix
4. Make your changes
5. Test your changes thoroughly
6. Submit a pull request

## Development Setup

1. **Prerequisites**
   - Node.js 18+ 
   - npm or yarn
   - LinkedIn account
   - Google Gemini API key

2. **Installation**
   ```bash
   npm install
   cp .env.example .env
   cp config/profile.example.yaml config/profile.yaml
   ```

3. **Configuration**
   - Update `.env` with your credentials
   - Customize `config/profile.yaml` with your job preferences
   - Update `config/system-prompt.yaml` if needed

4. **Run in development**
   ```bash
   npm run dev
   ```

## Code Style

- Use TypeScript for all new code
- Follow existing code patterns and conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions focused and single-purpose

## Testing

- Test in safe mode first: `npm run start:safe`
- Test in debug mode before production: `npm run start:debug`
- Only use production mode when confident: `npm run start:prod`

## Security Guidelines

- Never commit credentials or personal data
- Use environment variables for sensitive information
- Follow the principle of least privilege
- Be cautious with user data and privacy

## Pull Request Process

1. Ensure your code follows the existing style
2. Update documentation if needed
3. Test your changes thoroughly
4. Write clear commit messages
5. Create a descriptive pull request title and description

## Issues

- Use the issue tracker for bug reports and feature requests
- Search existing issues before creating new ones
- Provide clear reproduction steps for bugs
- Include system information when relevant

## License

By contributing, you agree that your contributions will be licensed under the MIT License.