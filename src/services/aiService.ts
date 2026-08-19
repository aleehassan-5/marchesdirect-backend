import axios from 'axios';
import { db } from '../config/database';
import { logger } from '../utils/logger';

// ============================================================================
// CLAUDE API CLIENT
// ============================================================================

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022';
const TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7');
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '2000');

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

const callClaudeAPI = async (
  messages: ClaudeMessage[],
  systemPrompt: string,
  maxTokens: number = MAX_TOKENS
): Promise<string> => {
  try {
    const response = await axios.post(
      ANTHROPIC_API_URL,
      {
        model: MODEL,
        max_tokens: maxTokens,
        temperature: TEMPERATURE,
        system: systemPrompt,
        messages: messages,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        timeout: 30000,
      }
    );

    if (response.data.content && response.data.content[0]) {
      return response.data.content[0].text;
    }

    throw new Error('No response from Claude API');
  } catch (err) {
    logger.error('Claude API error:', err);
    throw err;
  }
};

// ============================================================================
// CLASSIFICATION ENGINE (MILESTONE 6)
// ============================================================================

export const classifyOpportunity = async (
  opportunityId: string
): Promise<boolean> => {
  try {
    // Fetch opportunity
    const oppResult = await db.query(
      `SELECT o.*, ot.name as opp_type_name 
       FROM opportunities o
       LEFT JOIN opportunity_types ot ON o.opportunity_type_id = ot.id
       WHERE o.id = $1`,
      [opportunityId]
    );

    if (oppResult.rows.length === 0) {
      throw new Error(`Opportunity ${opportunityId} not found`);
    }

    const opp = oppResult.rows[0];

    // Update status to processing
    await db.query(
      'UPDATE opportunities SET ai_classification_status = $1 WHERE id = $2',
      ['processing', opportunityId]
    );

    const systemPrompt = `You are a French public procurement expert. Your task is to classify business opportunities by:
1. Trade/Industry (construction, IT, consulting, etc.)
2. CPV codes (EU procurement classification)
3. Complexity level (low, medium, high)
4. Confidence scores

Return a JSON object with:
{
  "trades": [{"name": "...", "confidence": 0.95}, ...],
  "cpv_codes": [{"code": "45200000", "name": "...", "confidence": 0.90}, ...],
  "complexity": "medium",
  "reasoning": "..."
}

Only return valid JSON, no markdown or extra text.`;

    const userMessage = `Classify this opportunity:
Title: ${opp.title}
Description: ${opp.description?.substring(0, 1000) || ''}
Region: ${opp.location_region || 'Not specified'}
Estimated Value: ${opp.estimated_value || 'Not specified'}`;

    const response = await callClaudeAPI(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      1500
    );

    // Parse response
    let classification;
    try {
      classification = JSON.parse(response);
    } catch (err) {
      logger.warn(`Failed to parse classification response for ${opportunityId}`);
      throw new Error('Invalid classification response format');
    }

    // Find and link trades
    const tradeIds: any[] = [];
    if (classification.trades && Array.isArray(classification.trades)) {
      for (const trade of classification.trades) {
        const tradeResult = await db.query(
          'SELECT id FROM trades WHERE LOWER(name) LIKE LOWER($1)',
          [`%${trade.name}%`]
        );
        if (tradeResult.rows.length > 0) {
          tradeIds.push({
            id: tradeResult.rows[0].id,
            confidence: trade.confidence,
            name: trade.name,
          });
        }
      }
    }

    // Find CPV code
    let cpvCodeId = null;
    if (classification.cpv_codes && classification.cpv_codes.length > 0) {
      const cpvResult = await db.query(
        'SELECT id FROM cpv_codes WHERE code = $1',
        [classification.cpv_codes[0].code]
      );
      if (cpvResult.rows.length > 0) {
        cpvCodeId = cpvResult.rows[0].id;
      }
    }

    // Update opportunity with classification results
    await db.query(
      `UPDATE opportunities SET
        ai_classification_status = $1,
        ai_matched_trades = $2,
        cpv_code_id = $3,
        complexity_level = $4,
        updated_at = NOW()
       WHERE id = $5`,
      [
        'classified',
        JSON.stringify(tradeIds),
        cpvCodeId,
        classification.complexity || 'medium',
        opportunityId,
      ]
    );

    logger.info(`✅ Classified opportunity ${opportunityId}: ${tradeIds.map(t => t.name).join(', ')}`);
    return true;
  } catch (err) {
    logger.error(`Classification failed for ${opportunityId}:`, err);

    // Mark as failed
    await db.query(
      'UPDATE opportunities SET ai_classification_status = $1 WHERE id = $2',
      ['failed', opportunityId]
    );

    return false;
  }
};

// ============================================================================
// MATCHING ENGINE (MILESTONE 6)
// ============================================================================

export const matchOpportunitiesToCompany = async (
  companyId: string
): Promise<string[]> => {
  try {
    // Fetch company details
    const companyResult = await db.query(
      'SELECT * FROM companies WHERE id = $1',
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      throw new Error(`Company ${companyId} not found`);
    }

    const company = companyResult.rows[0];

    // Fetch company's certified trades
    const tradesResult = await db.query(
      `SELECT DISTINCT t.id, t.name FROM company_certifications cc
       JOIN trades t ON cc.certification_name ILIKE '%' || t.name || '%'
       WHERE cc.company_id = $1 AND cc.is_expired = false`,
      [companyId]
    );

    const trades = tradesResult.rows.map(r => r.name);

    if (trades.length === 0) {
      logger.warn(`No certified trades found for company ${companyId}`);
      return [];
    }

    // Find matching opportunities (by trade, distance, value, etc.)
    const matchResult = await db.query(
      `SELECT o.id,
              o.title,
              o.estimated_value,
              o.deadline,
              (
                CASE 
                  WHEN $1::point IS NOT NULL THEN 
                    ROUND(CAST(point($2, $3) <-> point($4, $5) AS numeric) * 111, 2)
                  ELSE 999999
                END
              ) as distance_km
       FROM opportunities o
       LEFT JOIN trades t ON o.trade_id = t.id
       WHERE o.status = 'active'
         AND o.deadline > NOW()
         AND o.ai_classification_status = 'classified'
         AND (
           t.id IN (SELECT id FROM trades WHERE name = ANY($6::text[]))
           OR o.ai_matched_trades::text ILIKE ANY($6::text[])
         )
         AND (
           $7::decimal IS NULL OR o.estimated_value >= $7
         )
         AND (
           $8::decimal IS NULL OR o.estimated_value <= $8
         )
         AND (
           $9::integer IS NULL OR 
           point($2, $3) IS NULL OR
           (CAST(point($2, $3) <-> point($4, $5) AS numeric) * 111) <= $9
         )
       ORDER BY o.deadline, distance_km ASC
       LIMIT 50`,
      [
        company.location_latitude ? `(${company.location_longitude}, ${company.location_latitude})` : null,
        company.location_longitude,
        company.location_latitude,
        company.location_longitude,
        company.location_latitude,
        trades,
        company.annual_revenue || 0,
        null,
        company.working_radius_km || 100,
      ]
    );

    const matchedIds = matchResult.rows.map(r => r.id);
    logger.info(`✅ Found ${matchedIds.length} matching opportunities for company ${companyId}`);

    return matchedIds;
  } catch (err) {
    logger.error(`Matching failed for company ${companyId}:`, err);
    return [];
  }
};

// ============================================================================
// SUMMARIES & HIGHLIGHTS (MILESTONE 7)
// ============================================================================

export const generateOpportunitySummary = async (opportunityId: string): Promise<string> => {
  try {
    const oppResult = await db.query(
      'SELECT * FROM opportunities WHERE id = $1',
      [opportunityId]
    );

    if (oppResult.rows.length === 0) {
      throw new Error(`Opportunity ${opportunityId} not found`);
    }

    const opp = oppResult.rows[0];

    const systemPrompt = `You are a French business opportunity analyst. Generate a clear, concise summary highlighting:
- Main work/deliverables
- Key requirements
- Timeline
- Opportunity for small businesses
- Red flags or risks

Keep it to 2-3 paragraphs. Use simple, actionable language.`;

    const userMessage = `Title: ${opp.title}
Description: ${opp.description}
Deadline: ${opp.deadline}
Estimated Value: ${opp.estimated_value || 'Not specified'} EUR
Location: ${opp.location_city}, ${opp.location_region}`;

    const summary = await callClaudeAPI(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      800
    );

    // Save summary
    await db.query(
      'UPDATE opportunities SET ai_summary = $1, ai_summary_status = $2 WHERE id = $3',
      [summary, 'generated', opportunityId]
    );

    return summary;
  } catch (err) {
    logger.error(`Summary generation failed for ${opportunityId}:`, err);
    throw err;
  }
};

// ============================================================================
// CHATBOT (MILESTONE 7)
// ============================================================================

export const chatbot = async (
  conversationId: string,
  userMessage: string,
  companyId: string
): Promise<string> => {
  try {
    // Fetch conversation context
    const convResult = await db.query(
      'SELECT * FROM chatbot_conversations WHERE id = $1 AND company_id = $2',
      [conversationId, companyId]
    );

    if (convResult.rows.length === 0) {
      throw new Error('Conversation not found');
    }

    const conversation = convResult.rows[0];

    // Fetch message history (last 10 messages for context)
    const historyResult = await db.query(
      `SELECT role, content FROM chatbot_messages 
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [conversationId]
    );

    const history: ClaudeMessage[] = historyResult.rows.reverse().map(r => ({
      role: r.role,
      content: r.content,
    }));

    // Build context based on conversation topic
    let context = '';
    if (conversation.context?.opportunity_id) {
      const oppResult = await db.query(
        'SELECT title, description, deadline FROM opportunities WHERE id = $1',
        [conversation.context.opportunity_id]
      );
      if (oppResult.rows.length > 0) {
        const opp = oppResult.rows[0];
        context = `\n\nOPPORTUNITY CONTEXT:\nTitle: ${opp.title}\nDescription: ${opp.description}\nDeadline: ${opp.deadline}`;
      }
    }

    const systemPrompt = `You are a helpful assistant for the French Public Procurement Opportunities platform.
You help small businesses and tradespeople understand opportunities, respond to tenders, and navigate the procurement process.

IMPORTANT RULES:
- Only answer questions based on provided information
- If you don't know something, say "I don't have that information"
- NEVER invent facts or deadlines
- Be friendly, professional, and speak in simple French or English

${context}`;

    // Call Claude with conversation history
    const messages = [
      ...history,
      { role: 'user' as const, content: userMessage },
    ];

    const response = await callClaudeAPI(messages, systemPrompt, 1000);

    // Save messages
    await db.query(
      'INSERT INTO chatbot_messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [conversationId, 'user', userMessage]
    );

    await db.query(
      'INSERT INTO chatbot_messages (conversation_id, role, content) VALUES ($1, $2, $3)',
      [conversationId, 'assistant', response]
    );

    // Update conversation timestamp
    await db.query(
      'UPDATE chatbot_conversations SET updated_at = NOW() WHERE id = $1',
      [conversationId]
    );

    return response;
  } catch (err) {
    logger.error(`Chatbot error for conversation ${conversationId}:`, err);
    throw err;
  }
};

// ============================================================================
// BATCH PROCESSING
// ============================================================================

export const classifyUnanalyzedOpportunities = async (limit: number = 100) => {
  try {
    logger.info(`Classifying up to ${limit} unanalyzed opportunities...`);

    const result = await db.query(
      `SELECT id FROM opportunities 
       WHERE ai_classification_status = 'not_analyzed'
       AND status IN ('active')
       AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    let classified = 0;
    let failed = 0;

    for (const opp of result.rows) {
      const success = await classifyOpportunity(opp.id);
      if (success) classified++;
      else failed++;
    }

    logger.info(`Classification batch complete: ${classified} succeeded, ${failed} failed`);
    return { classified, failed };
  } catch (err) {
    logger.error('Batch classification error:', err);
    return { classified: 0, failed: 0 };
  }
};

export const generateSummariesForOpportunities = async (limit: number = 50) => {
  try {
    const result = await db.query(
      `SELECT id FROM opportunities 
       WHERE ai_summary_status = 'not_generated'
       AND ai_classification_status = 'classified'
       AND status = 'active'
       ORDER BY deadline ASC
       LIMIT $1`,
      [limit]
    );

    let generated = 0;

    for (const opp of result.rows) {
      try {
        await generateOpportunitySummary(opp.id);
        generated++;
      } catch (err) {
        logger.warn(`Failed to generate summary for ${opp.id}`);
      }
    }

    logger.info(`Generated ${generated} summaries`);
    return generated;
  } catch (err) {
    logger.error('Summary generation batch error:', err);
    return 0;
  }
};
