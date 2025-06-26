# LinkedIn AI Agent Makefile
.PHONY: help install build clean dev test-safe run view-responses setup check-env

# Default target
.DEFAULT_GOAL := help

# Colors for output
CYAN := \033[0;36m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

help: ## Show this help message
	@echo "$(CYAN)LinkedIn AI Agent - Available Commands:$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)Quick Start:$(NC) make setup && make test-safe"

health: ## Run system health check
	@./scripts/health-check.sh

setup: check-env install build ## Initial project setup (install deps + build)
	@echo "$(GREEN)✅ Setup complete! Run 'make test-safe' to test the agent$(NC)"

check-env: ## Check required environment variables
	@echo "$(CYAN)Checking environment...$(NC)"
	@test -f .env || (echo "$(RED)❌ Missing .env file! Copy .env.example to .env$(NC)" && exit 1)
	@grep -q "GEMINI_API_KEY=" .env || (echo "$(RED)❌ Missing GEMINI_API_KEY in .env$(NC)" && exit 1)
	@grep -q "LINKEDIN_EMAIL=" .env || (echo "$(RED)❌ Missing LINKEDIN_EMAIL in .env$(NC)" && exit 1)
	@grep -q "LINKEDIN_PASSWORD=" .env || (echo "$(RED)❌ Missing LINKEDIN_PASSWORD in .env$(NC)" && exit 1)
	@echo "$(GREEN)✅ Environment OK$(NC)"

install: ## Install dependencies
	@echo "$(CYAN)Installing dependencies...$(NC)"
	@npm install
	@npx playwright install chromium
	@echo "$(GREEN)✅ Dependencies installed$(NC)"

build: ## Build TypeScript
	@echo "$(CYAN)Building TypeScript...$(NC)"
	@npm run build
	@echo "$(GREEN)✅ Build complete$(NC)"

clean: ## Clean build artifacts and logs
	@echo "$(CYAN)Cleaning...$(NC)"
	@rm -rf dist/
	@rm -rf logs/*/
	@rm -rf screenshots/*/
	@find . -name "*.log" -type f -delete
	@echo "$(GREEN)✅ Cleaned$(NC)"

dev: ## Start development mode with hot reload
	@echo "$(CYAN)Starting development mode...$(NC)"
	@npm run dev

test-safe: build ## Run in safe mode (no messages sent)
	@echo "$(CYAN)Running in SAFE mode (no messages will be sent)...$(NC)"
	@npm run start:safe

run: build ## Run in production mode (SENDS REAL MESSAGES!)
	@echo "$(RED)⚠️  WARNING: This will send REAL messages to recruiters!$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to cancel, or wait 5 seconds to continue...$(NC)"
	@sleep 5
	@npm run start:prod

view-responses: ## View generated responses for fine-tuning
	@npm run view:responses

logs: ## Tail latest logs
	@echo "$(CYAN)Tailing latest logs...$(NC)"
	@tail -f logs/$$(ls -t logs/ | head -1)/*.log

status: ## Check response history and stats
	@echo "$(CYAN)Response Statistics:$(NC)"
	@node -e "const fs=require('fs'); try { const h=JSON.parse(fs.readFileSync('logs/response-history.json')); console.log('Total responses:', h.length); const today=h.filter(r=>new Date(r.respondedAt).toDateString()===new Date().toDateString()).length; console.log('Today:', today); } catch(e) { console.log('No response history yet'); }"

edit-system: ## Edit AI behavior configuration (ADVANCED USERS ONLY)
	@echo "$(RED)⚠️  WARNING: This affects AI behavior. Only edit if you know what you're doing!$(NC)"
	@${EDITOR:-nano} config/system-prompt.yaml

edit-profile: ## Edit your job preferences and profile
	@echo "$(CYAN)Opening your profile for editing...$(NC)"
	@${EDITOR:-nano} config/profile.yaml

edit-config: edit-profile ## Alias for edit-profile

docker-build: ## Build Docker image
	@echo "$(CYAN)Building Docker image...$(NC)"
	@docker build -f docker/Dockerfile -t linky:latest .

docker-run: ## Run in Docker container
	@docker run --rm -it \
		-v $$(pwd)/data:/app/data \
		-v $$(pwd)/logs:/app/logs \
		-v $$(pwd)/screenshots:/app/screenshots \
		--env-file .env \
		linky:latest