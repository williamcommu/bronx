#!/bin/bash

# Bronx Bot Dashboard Startup Script

echo "🤖 Starting Bronx Bot Dashboard..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 14+ first."
    exit 1
fi

# Check if we're in the site directory
if [ ! -f "package.json" ]; then
    echo "❌ Please run this script from the site directory"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Creating from template..."
    cp .env.example .env
    echo "✅ Created .env file. Please edit it with your database settings."
    echo "📝 Edit the .env file with your database credentials, then run this script again."
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
    echo "✅ Dependencies installed successfully"
fi

echo "🔌 Testing database connection..."
# You could add a database connectivity test here

echo "🚀 Starting dashboard server..."
echo "📊 Dashboard will be available at: http://localhost:3000"
echo "⏹️  Press Ctrl+C to stop the server"
echo ""

# Start the server
npm start