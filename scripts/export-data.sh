#!/bin/bash
# Export important data for backup or analysis

set -e

# Create export directory with timestamp
EXPORT_DIR="exports/export-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$EXPORT_DIR"

echo "📦 Exporting LinkedIn AI Agent data..."
echo "Export directory: $EXPORT_DIR"
echo ""

# Export response history
if [ -f "data/response-history.json" ]; then
    cp data/response-history.json "$EXPORT_DIR/"
    echo "✓ Response history exported"
else
    echo "- No response history found"
fi

# Export latest session logs
LATEST_LOG_SESSION=$(ls -t logs/ 2>/dev/null | head -1)
if [ -n "$LATEST_LOG_SESSION" ]; then
    mkdir -p "$EXPORT_DIR/logs"
    cp -r "logs/$LATEST_LOG_SESSION" "$EXPORT_DIR/logs/"
    echo "✓ Latest session logs exported: $LATEST_LOG_SESSION"
else
    echo "- No log sessions found"
fi

# Export preferences (without sensitive data)
if [ -f "data/preferences.json" ]; then
    cp data/preferences.json "$EXPORT_DIR/"
    echo "✓ Preferences exported"
fi

# Create summary report
cat > "$EXPORT_DIR/summary.txt" << EOF
LinkedIn AI Agent Export Summary
================================
Export Date: $(date)

Response History:
$(if [ -f "data/response-history.json" ]; then echo "- $(jq length data/response-history.json 2>/dev/null || echo "0") total responses recorded"; else echo "- No history"; fi)

Recent Sessions:
$(ls -t logs/ 2>/dev/null | head -5 | sed 's/^/- /')

Configuration:
- Run Mode: ${RUN_MODE:-not set}
- Log Level: ${LOG_LEVEL:-info}
EOF

echo "✓ Summary report created"
echo ""
echo "Export complete! Files saved to: $EXPORT_DIR"

# Optional: Create compressed archive
read -p "Create compressed archive? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    ARCHIVE_NAME="linky-export-$(date +%Y%m%d-%H%M%S).tar.gz"
    tar -czf "$ARCHIVE_NAME" -C exports "$(basename $EXPORT_DIR)"
    echo "✓ Archive created: $ARCHIVE_NAME"
fi