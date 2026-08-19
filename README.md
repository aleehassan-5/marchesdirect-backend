# French Public Procurement Platform - Backend

**Version 1.0 | Node.js + Express + PostgreSQL**

Complete backend for a French public procurement opportunities platform with AI-powered classification, intelligent matching, and multi-tenant architecture.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- PostgreSQL 14+
- Redis (for job queue & caching)
- AWS S3 (for file storage)

### Installation

```bash
# Clone and setup
git clone <repo>
cd procurement-platform-backend
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Create database and tables
psql -U postgres -d procurement_platform -f schema.sql

# Start development server
npm run dev

# Production build
npm run build
npm start
```

---

## 📋 Project Structure

```
src/
├── config/
│   ├── database.ts              # PostgreSQL connection pool
│   └── redis.ts                 # Redis client (job queue)
│
├── middleware/
│   ├── auth.ts                  # JWT authentication, MFA
│   ├── errorHandler.ts          # Global error handling
│   └── validation.ts            # Request validation
│
├── services/
│   ├── authService.ts           # Login, registration, MFA (M8)
│   ├── dataCollectionService.ts # BOAMP, PLACE, TED connectors (M2)
│   ├── deduplicationService.ts  # Duplicate detection & merging (M3)
│   ├── aiService.ts             # Claude API for classification, matching, summaries (M6-7)
│   ├── stripeService.ts         # Stripe subscriptions & payments (M8)
│   ├── documentService.ts       # S3 file handling & document generation (M9)
│   └── seoService.ts            # SEO page generation (M11)
│
├── controllers/
│   ├── authController.ts
│   ├── opportunitiesController.ts
│   ├── companiesController.ts
│   ├── dashboardController.ts
│   ├── tenderController.ts
│   ├── chatbotController.ts
│   └── adminController.ts
│
├── routes/
│   ├── auth.ts
│   ├── opportunities.ts
│   ├── companies.ts
│   ├── dashboard.ts
│   ├── tenders.ts
│   ├── chatbot.ts
│   ├── crm.ts
│   └── admin.ts
│
├── jobs/
│   ├── dataCollection.ts        # Scheduled data collection (M2)
│   ├── documentExpiry.ts        # Document expiry alerts (M6)
│   ├── seoGeneration.ts         # SEO page generation (M11)
│   ├── backupManagement.ts      # Database backups (M12)
│   └── aiProcessing.ts          # Batch AI classification & summaries
│
├── utils/
│   ├── logger.ts                # Winston logging
│   ├── validators.ts            # Input validation rules
│   ├── helpers.ts               # Utility functions
│   └── constants.ts             # Global constants
│
├── types/
│   └── index.ts                 # TypeScript interfaces
│
└── server.ts                    # Main Express server
```

---

## 🗄️ Database Schema

**Core tables** (see schema.sql for full definitions):

### Authentication & Multi-Tenancy
- `brands` - Two separate brands (BOAMP Pro, Marchés Locaux)
- `companies` - Companies/end-users
- `users` - User accounts within companies
- `user_sessions` - Active sessions & refresh tokens
- `login_attempts` - Login tracking for rate limiting

### Data & Classification
- `data_sources` - BOAMP, PLACE, TED, etc.
- `connector_logs` - Collection activity logs
- `opportunities` - Main listings from all sources
- `opportunity_duplicates` - Cross-source duplicate tracking (M3)
- `trades` - Business categories (construction, IT, etc.)
- `cpv_codes` - EU procurement classification

### Company Profile & Documents (M6, M9)
- `company_documents` - KBIS, insurance, certifications
- `company_certifications` - Professional qualifications
- `company_resources` - HR, equipment, facilities
- `company_references` - Past projects for proposal reuse
- `company_policies` - Quality, safety, environmental docs

### Tender Response Module (M9)
- `tenders` - Tender analysis (DCE extraction)
- `bid_responses` - Company responses to tenders
  - Auto-generated DC1/DC2/DUME
  - AI-generated technical memos
  - Pricing schedules

### Subscriptions & Payments (M8)
- `subscription_plans` - Free, Pro, Enterprise tiers
- `subscriptions` - Active company subscriptions
- `invoices` - Payment history

### AI & Matching (M6, M7)
- Opportunities table columns: `ai_classification_status`, `ai_matched_trades`, `ai_summary`
- `chatbot_conversations` - Chat history by topic
- `chatbot_messages` - Individual messages with source citations

### Alerts & Notifications (M8)
- `company_alerts` - New opportunities, deadlines, expirations
- `security_incidents` - Access attempts, auth failures

### System
- `audit_logs` - All data modifications (GDPR compliance)
- `backup_logs` - Backup & restoration history (M12)
- `system_health` - Health check logs
- `seo_pages` - Auto-generated SEO pages (M11)

---

## 🔐 Authentication & Security (Milestone 8)

### JWT Flow
```
1. User registers → Company + User created → 14-day trial
2. Login → Verify password (bcrypt) → Generate JWT + Refresh Token
3. Protected routes → Verify JWT → Check company access
4. Token expiry → Use refresh token → Generate new JWT
```

### MFA (Optional)
```
1. User enables MFA → Generate TOTP secret + QR code
2. Verify token → Enable on account
3. Next login → After password, request TOTP token
4. Complete authentication → Issue full JWT
```

### Company Isolation
Every route checks: `user.companyId === requestedCompanyId` 
- Prevents cross-company data access
- All queries filtered by `company_id`
- Audit logged if violation attempted

---

## 📊 Data Collection Pipeline (Milestones 2-3)

### Architecture
```
BOAMP API → Fetch raw data → Transform → Deduplicate → Store → Classify (AI)
PLACE API → ↓                ↓         ↓              ↓
TED Feed  → etc...
```

### Milestone 2: Automated Collection
- **BOAMP connector**: Polls every 6 hours, auto-retry on failure
- **PLACE connector**: EU government procurement platform
- **TED connector**: EU-wide tenders (RSS feed)
- Logs in `connector_logs` table showing 3+ successful runs with NO manual action

### Milestone 3: Deduplication
- **Problem**: Same tender on BOAMP + PLACE = duplicate records
- **Solution**: Compare title similarity (>85%) + deadline (<24h diff)
- **Proof**: 
  - Import same data twice → zero duplicates created
  - One ID maintained for merged records
  - `opportunity_duplicates` table tracks merges
- **Acceptance**: Run `verifyDeduplicationQuality()` → returns true

---

## 🤖 AI Integration (Milestones 6-7)

### Milestone 6: Classification & Matching

**Classification** (`classifyOpportunity`):
```
Input: Title, Description, Location, Value
↓
Claude API: Extract trade, CPV code, complexity level
↓
Output: Trades [{}], CPV codes [{}], Complexity (low/med/high)
↓
Update: ai_matched_trades, cpv_code_id, complexity_level
```

**Matching** (`matchOpportunitiesToCompany`):
```
Input: Company certified trades, location, working radius, budget
↓
Query: Find opportunities matching company profile
↓
Filter by: Trade (AI-matched), Distance, Value range
↓
Output: Sorted list of relevant opportunities
```

### Milestone 7: Summaries & Chatbot

**Summaries** (`generateOpportunitySummary`):
```
Input: Full opportunity data
↓
Claude: Highlight work, requirements, timeline, risks
↓
Output: 2-3 paragraph summary
↓
Save: ai_summary, ai_summary_status = 'generated'
```

**Chatbot** (`chatbot`):
```
Input: User question + conversation context
↓
Claude: Answer based on opportunity docs + company data
↓
Rules: Only cite sources, never invent facts
↓
Output: Answer with `source_citations` JSONB
↓
Test: 30-question benchmark at 90%+ accuracy
```

---

## 💳 Subscriptions & Payments (Milestone 8)

### Stripe Integration
```typescript
// Create subscription
const stripeCustomer = await stripe.customers.create({ email });
const subscription = await stripe.subscriptions.create({
  customer: stripeCustomer.id,
  items: [{ price: plan.stripe_price_id }],
  trial_period_days: 14,
});

// Save to DB
await db.query('INSERT INTO subscriptions ...', [stripeCustomer.id, subscription.id]);
```

### Lead Capture
Form on homepage → Email + Phone + Trade + Location → CRM
- Saved in `crm_leads` table
- Synced to CRM (HubSpot/Pipedrive) via API

---

## 📄 Tender Response Module (Milestone 9)

### DCE Analysis (Automatic)
```
1. Upload tender documents (DC, CCAP, CCTP)
2. Claude extracts: Selection criteria, Required docs, Deadlines, Complexity
3. Save to `tenders` table
4. Generate checklist vs. company profile
```

### Company Profile (One-Time Entry)
- KBIS, insurance, certifications
- HR, equipment, resources
- Past projects with photos
- Quality/safety/environmental policies
- Auto-stored in S3, indexed in DB

### Document Generation
```
INPUT: Company profile + Tender requirements
↓
GENERATE:
  - DC1/DC2/DUME (auto-prefilled)
  - Engagement Act (acte d'engagement)
  - Technical Memo (mémoire technique) - AI-drafted
  - Pricing Schedule (BPU/DPGF)
  - Appendices
↓
OUTPUT: Single ready-to-submit ZIP
```

### Acceptance Proof
Generate full bid package on real tender → all 8 docs produced → no invented data

---

## 📱 SEO & Content Generation (Milestone 11)

### Auto-Generated Pages
By Trade, Region, Department, City + Opportunity Type:
```
/trade/plomberie/region/ile-de-france/tenders
/trade/electricite/departement/75/public-procurement
/region/occitanie/subcontracting
```

Structure:
- Title & Meta: SEO-optimized
- Filter links to relevant opportunities
- Analytics tracking (page views, conversions)
- Refresh on new data collection

### Materialized View
```sql
opportunity_search_index
├── Full-text search (French)
├── Deadline for sorting
├── Indexed by trade, region, source
```

---

## 🔒 Security & Compliance (Milestone 12)

### Code Security
- No hardcoded secrets → .env file
- Encrypted API keys in DB (if stored)
- bcrypt password hashing (rounds: 10)
- JWT secret rotation recommended (monthly)

### Data Protection (GDPR)
- Personal data in Europe (EU data center)
- Audit logs for all modifications
- Delete user endpoint → GDPR compliance
- Data retention: 365 days default

### Backup & Restoration
- Daily backups to S3 at 5am Paris time
- Restoration test required (not just scheduled)
- Proof: Full restoration from backup → verify data

### Audit Trail
Every change logged:
```sql
INSERT INTO audit_logs (user_id, action, entity_type, old_values, new_values)
```

---

## 🧪 Acceptance Testing Checklist

### Milestone 1: Foundations
- [ ] Repositories created under client control
- [ ] Database schema deployed
- [ ] Schema reviewable

### Milestone 2: First Connector (BOAMP)
- [ ] BOAMP runs automatically every 6 hours
- [ ] Screenshot/log showing 3 automated runs
- [ ] No manual button clicks

### Milestone 3: Deduplication
- [ ] Import same data twice → 0 duplicates
- [ ] Same ID maintained for merged record
- [ ] `opportunity_duplicates` table populated

### Milestone 4: Homepage
- [ ] 3-way entry point (Tenders / Public / Subcontracting)
- [ ] All paths working end-to-end

### Milestone 5: Search & Filters
- [ ] Full search-to-detail flow on all 3 journeys
- [ ] Filters working (trade, region, deadline, value)

### Milestone 6: AI Classification & Matching
- [ ] Real classification on live data (not "Not analyzed")
- [ ] Matching engine returns results
- [ ] Confidence scores visible

### Milestone 7: Summaries & Chatbot
- [ ] 30 test questions → 90%+ accuracy
- [ ] No hallucinated facts
- [ ] All info sourced

### Milestone 8: Auth & Subscriptions
- [ ] Cross-company access denied + logged
- [ ] Subscription flow end-to-end
- [ ] MFA working

### Milestone 9: Tender Response
- [ ] Full bid package on real tender
- [ ] All 8 docs generated
- [ ] No invented data

### Milestone 10: Second Brand
- [ ] Independent config
- [ ] No code duplication

### Milestone 11: SEO Generation
- [ ] 100+ pages generated
- [ ] Indexed by Google

### Milestone 12: Security & Backup
- [ ] Audit report from independent review
- [ ] Live backup restoration demonstrated

---

## 📚 API Routes (Summary)

### Public Routes
```
POST   /api/auth/register           # Company registration
POST   /api/auth/login              # User login
POST   /api/auth/refresh            # Refresh JWT
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
POST   /api/auth/mfa/enable
POST   /api/auth/mfa/verify
GET    /api/opportunities           # Search (paginated)
GET    /api/opportunities/:id       # Detail page
GET    /api/trades                  # All trades
POST   /api/crm/leads              # Lead capture
```

### Protected Routes (require JWT)
```
GET    /api/companies/:id           # Company profile
PUT    /api/companies/:id           # Update profile
GET    /api/dashboard               # Summary for user
GET    /api/alerts                  # Notifications
GET    /api/documents               # Uploaded documents
POST   /api/documents/upload        # Upload file to S3
POST   /api/chatbot/create          # Start conversation
POST   /api/chatbot/:id/message     # Send message
POST   /api/tenders/:id/analyze     # Analyze tender
POST   /api/tenders/:id/bid         # Create bid response
```

### Admin Routes (require admin role)
```
GET    /api/admin/sources           # Data sources
POST   /api/admin/sources           # Add source
GET    /api/admin/logs              # Connector logs
GET    /api/admin/audit             # Audit trail
GET    /api/admin/health            # System health
POST   /api/admin/backup            # Trigger backup
```

---

## 🚀 Deployment

### Environment Configuration
```bash
NODE_ENV=production
DB_SSL=true
LOG_LEVEL=info
# ... other vars from .env.example
```

### Database Migrations
```bash
npm run db:migrate
```

### Start Production
```bash
npm run build
npm start
```

### Process Manager
Use PM2 or systemd:
```bash
pm2 start dist/src/server.js --name procurement-api
pm2 save
```

---

## 📖 Key Services Reference

### Data Collection
```typescript
import { collectBoampData, startScheduledCollection } from './services/dataCollectionService';

// Trigger collection immediately
await collectBoampData(sourceId);

// Start automatic scheduling
startScheduledCollection(); // Runs every 6 hours
```

### AI Classification
```typescript
import { classifyOpportunity, matchOpportunitiesToCompany } from './services/aiService';

// Classify single opportunity
await classifyOpportunity(opportunityId);

// Find matches for company
const matches = await matchOpportunitiesToCompany(companyId);
```

### Authentication
```typescript
import { registerCompanyAndUser, loginUser } from './services/authService';

// Register
const result = await registerCompanyAndUser({
  companyName: 'Acme Corp',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@acme.fr',
  password: 'secure_password',
});

// Login
const session = await loginUser('john@acme.fr', 'secure_password');
```

---

## 🐛 Troubleshooting

### Database Connection Issues
```bash
# Check connection
psql -h localhost -U postgres -d procurement_platform -c "SELECT NOW();"

# Reset database
dropdb procurement_platform
createdb procurement_platform
psql -U postgres -d procurement_platform -f schema.sql
```

### Redis Connection
```bash
redis-cli ping
# Should return: PONG
```

### API Key Issues
- BOAMP_API_KEY, OPENAI_API_KEY, STRIPE_SECRET_KEY must be set in .env
- Never commit .env file

### Logs
```bash
tail -f logs/app.log
tail -f logs/error.log
```

---

## 📞 Support

For questions about:
- **Architecture**: Check project structure above
- **Milestones**: See Payment_Terms_v1_2_EN.docx
- **Database**: Review schema.sql for table definitions
- **AI Features**: Check aiService.ts for implementation

---

**Status**: Ready for Milestone 1 implementation  
**Last Updated**: August 2026  
**Built with**: Node.js 18+ | Express 4 | PostgreSQL 14 | Claude API
