# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SuperSub is a full-stack application built on the Cloudflare ecosystem that provides powerful and flexible proxy subscription conversion and management functionality. It allows users to aggregate, process, and distribute customized configuration files for different clients.

## High-Level Architecture

### Frontend
- Vue 3 (Composition API) with TypeScript
- Vite for development and build tooling
- Naive UI component library
- Pinia for state management
- Tailwind CSS for styling
- Vue Router for navigation

### Backend
- Cloudflare Workers with Hono framework
- D1 (SQLite-compatible) database
- KV for key-value storage
- JWT-based authentication

### Key Components
1. **Node Management**: CRUD operations for proxy nodes with health checking
2. **Subscription Management**: Import and manage remote subscription sources
3. **Profile System**: Create output configurations by combining nodes, subscriptions, and processing rules
4. **Processing Pipeline**: Apply filters, sorting, and renaming operations to nodes
5. **Template Engine**: Generate client-specific configuration files (Clash, Surge, etc.)
6. **Health Monitoring**: Test node connectivity and track latency

## Common Development Commands

### Development
```bash
# Install dependencies
npm install

# Initialize local D1 database
npm run db:init

# Start backend (Cloudflare Workers)
npm run dev:backend

# Start frontend (Vite)
npm run dev:frontend

# Both services need to be running simultaneously in separate terminals
```

### Build and Deployment
```bash
# Build for production
npm run build

# Deploy to Cloudflare Pages
npm run deploy
```

### Database
```bash
# Initialize local database
npm run db:init
```

## Key Files and Directories

### Backend API
- `functions/api/[[path]].ts` - Main API implementation with all routes and business logic

### Frontend
- `src/views/` - Page components for each major feature
- `src/components/` - Reusable UI components
- `src/stores/` - Pinia stores for state management
- `src/router/` - Vue Router configuration

### Database
- `db/schema.sql` - Database schema definition
- `migrations/` - Database migration files

### Configuration
- `wrangler.toml` - Cloudflare deployment configuration
- `vite.config.ts` - Frontend build configuration