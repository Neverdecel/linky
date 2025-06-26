#!/bin/bash
# Health check script for LinkedIn AI Agent

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo "🏥 LinkedIn AI Agent Health Check"
echo "=================================="

# Check Node.js
echo -n "Node.js: "
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓${NC} $NODE_VERSION"
else
    echo -e "${RED}✗${NC} Not installed"
    exit 1
fi

# Check npm
echo -n "npm: "
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✓${NC} $NPM_VERSION"
else
    echo -e "${RED}✗${NC} Not installed"
    exit 1
fi

# Check TypeScript build
echo -n "TypeScript build: "
if [ -d "dist" ] && [ -f "dist/index.js" ]; then
    echo -e "${GREEN}✓${NC} Built"
else
    echo -e "${YELLOW}⚠${NC} Not built (run: make build)"
fi

# Check environment
echo -n "Environment (.env): "
if [ -f ".env" ]; then
    if grep -q "GEMINI_API_KEY=" .env && grep -q "LINKEDIN_EMAIL=" .env; then
        echo -e "${GREEN}✓${NC} Configured"
    else
        echo -e "${YELLOW}⚠${NC} Missing required variables"
    fi
else
    echo -e "${RED}✗${NC} Not found (run: cp .env.example .env)"
fi

# Check Playwright
echo -n "Playwright: "
if [ -d "node_modules/playwright" ]; then
    echo -e "${GREEN}✓${NC} Installed"
else
    echo -e "${RED}✗${NC} Not installed (run: npm install)"
fi

# Check directories
echo -n "Required directories: "
MISSING_DIRS=""
for dir in data logs screenshots; do
    if [ ! -d "$dir" ]; then
        MISSING_DIRS="$MISSING_DIRS $dir"
    fi
done

if [ -z "$MISSING_DIRS" ]; then
    echo -e "${GREEN}✓${NC} All present"
else
    echo -e "${YELLOW}⚠${NC} Missing:$MISSING_DIRS"
    mkdir -p data logs screenshots
    echo "  Created missing directories"
fi

# Check preferences
echo -n "Preferences: "
if [ -f "data/preferences.json" ]; then
    echo -e "${GREEN}✓${NC} Found"
else
    echo -e "${RED}✗${NC} Missing data/preferences.json"
fi

echo ""
echo "Summary:"
if [ -f ".env" ] && [ -d "dist" ] && [ -d "node_modules" ]; then
    echo -e "${GREEN}✅ System is ready!${NC}"
    echo ""
    echo "Run: make test-safe"
else
    echo -e "${YELLOW}⚠️  Setup required${NC}"
    echo ""
    echo "Run: make setup"
fi